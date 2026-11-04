// Full pilot scan: 1,240 tiles (40 x 31). Downloads 6 tiles ahead while the model runs; tiles are cached on disk.
// Output: public/data/detections.json (every box incl. review + rejected, with lon/lat) and scan stats.
import { writeFile, mkdir } from "node:fs/promises";
import { fetchTile } from "../lib/fetchTile";
import { loadModel, detectJpeg } from "../lib/infer";
import { COLS, ROWS, tile, pxToLonLat, type Tile } from "../lib/tiles";

const tag = process.argv[2] ?? "g0";
const offset = tag === "g1" ? 0.5 : 0;
const session = await loadModel("models/best.onnx", 6);
const tiles: Tile[] = [];
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) tiles.push(tile(col, row, offset));

const AHEAD = 6;
const pending = new Map<number, Promise<Buffer | null>>();
const get = (i: number) => {
  if (i < tiles.length && !pending.has(i)) pending.set(i, fetchTile(tiles[i], tag).catch(() => null));
  return pending.get(i)!;
};
const dets: unknown[] = [];
const failed: string[] = [];
let inferMs = 0;
const t0 = performance.now();
for (let i = 0; i < tiles.length; i++) {
  for (let k = 1; k <= AHEAD; k++) get(i + k);
  const jpeg = await get(i);
  pending.delete(i);
  const t = tiles[i];
  if (!jpeg) { failed.push(`${t.col}_${t.row}`); continue; }
  const { boxes, ms } = await detectJpeg(session, jpeg);
  inferMs += ms;
  for (const b of boxes) {
    const [lon, lat] = pxToLonLat(t, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2);
    const [w, n] = pxToLonLat(t, b.x1, b.y1);
    const [e, s] = pxToLonLat(t, b.x2, b.y2);
    dets.push({ g: tag, c: t.col, r: t.row, lon: +lon.toFixed(7), lat: +lat.toFixed(7), bb: [+w.toFixed(7), +s.toFixed(7), +e.toFixed(7), +n.toFixed(7)],
      px: [b.x1, b.y1, b.x2, b.y2].map((v) => +v.toFixed(1)), score: +b.score.toFixed(3), tier: b.tier, reject: b.reject,
      V: +b.V.toFixed(0), sat: +b.sat.toFixed(3), green: +b.green.toFixed(1) });
  }
  if (i % 100 === 0) console.log(`${i}/${tiles.length} dets ${dets.length} elapsed ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
const stats = { grid: tag, tiles: tiles.length, failed, detections: dets.length, inferMsPerTile: Math.round(inferMs / (tiles.length - failed.length)), totalSec: Math.round((performance.now() - t0) / 1000), finishedAt: new Date().toISOString() };
await mkdir("public/data", { recursive: true });
await writeFile(`public/data/detections_${tag}.json`, JSON.stringify(dets));
await writeFile(`public/data/scan_${tag}.json`, JSON.stringify(stats, null, 1));
console.log(stats);
