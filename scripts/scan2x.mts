// Improvement 1: 2x zoom pass. Each cached g0 tile is split into 4 quadrants (256 px = 64 m),
// each upscaled to the model's 640 px input (2.5x vs 1.25x native), so 2-4 module arrays become
// big enough for the model. Only quadrants that contain a building or a detection are scanned.
// Usage: tsx scripts/scan2x.mts <shard> <shards>   -> public/data/detections_z2_<shard>.json
import { readFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { loadModel } from "../lib/infer";
import { INPUT, colourFilter, decode, resizeBilinear, toTensor } from "../lib/detect";
import { COLS, ROWS, TILE_PX, tile, tileAt, pxToLonLat, toMerc } from "../lib/tiles";

const [shard, shards] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? 1)];
const Q = TILE_PX / 2;
// quadrants with something in them: roof centroids (first vertex is enough) + any detection
const busy = new Set<string>();
const mark = (lon: number, lat: number) => {
  const t = tileAt(lon, lat);
  const [x0, y0, x1, y1] = tile(t.col, t.row).bbox;
  const [x, y] = toMerc(lon, lat);
  busy.add(`${t.col}_${t.row}_${x - x0 < (x1 - x0) / 2 ? 0 : 1}_${y1 - y < (y1 - y0) / 2 ? 0 : 1}`);
};
for (const r of JSON.parse(readFileSync("public/data/roofs.json", "utf8"))) for (const [lon, lat] of r.ring) mark(lon, lat);
for (const g of ["g0", "g1"]) for (const d of JSON.parse(readFileSync(`public/data/detections_${g}.json`, "utf8"))) mark(d.lon, d.lat);

const jobs: [number, number, number, number][] = [];
for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) for (let qx = 0; qx < 2; qx++) for (let qy = 0; qy < 2; qy++)
  if (busy.has(`${col}_${row}_${qx}_${qy}`)) jobs.push([col, row, qx, qy]);
const mine = jobs.filter((_, i) => i % shards === shard);
console.log(`quadrants with buildings ${jobs.length} of ${COLS * ROWS * 4}; shard ${shard}/${shards}: ${mine.length}`);

const session = await loadModel("models/best.onnx", 3);
const dets: unknown[] = [];
const t0 = performance.now();
let lastRaw: Buffer | null = null, lastKey = "";
for (let i = 0; i < mine.length; i++) {
  const [col, row, qx, qy] = mine[i];
  const f = `.cache/tiles/g0/${col}_${row}.jpg`;
  if (!existsSync(f)) continue;
  const key = `${col}_${row}`;
  if (key !== lastKey) { lastRaw = await sharp(f).removeAlpha().raw().toBuffer(); lastKey = key; }
  const quad = new Uint8Array(Q * Q * 3);
  for (let y = 0; y < Q; y++) quad.set(lastRaw!.subarray(((qy * Q + y) * TILE_PX + qx * Q) * 3, ((qy * Q + y) * TILE_PX + qx * Q + Q) * 3), y * Q * 3);
  const res = await session.run({ images: new ort.Tensor("float32", toTensor(resizeBilinear(quad, Q, Q, 3), 3), [1, 3, INPUT, INPUT]) });
  const boxes = colourFilter(decode(res.output0.data as Float32Array, Q), quad, Q, 3);
  const t = tile(col, row);
  for (const b of boxes) {
    const ox = qx * Q, oy = qy * Q;
    const [lon, lat] = pxToLonLat(t, ox + (b.x1 + b.x2) / 2, oy + (b.y1 + b.y2) / 2);
    const [w, n] = pxToLonLat(t, ox + b.x1, oy + b.y1);
    const [e, s] = pxToLonLat(t, ox + b.x2, oy + b.y2);
    dets.push({ g: "z2", c: col, r: row, lon: +lon.toFixed(7), lat: +lat.toFixed(7), bb: [+w.toFixed(7), +s.toFixed(7), +e.toFixed(7), +n.toFixed(7)],
      px: [ox + b.x1, oy + b.y1, ox + b.x2, oy + b.y2].map((v) => +v.toFixed(1)), score: +b.score.toFixed(3), tier: b.tier, reject: b.reject,
      V: +b.V.toFixed(0), sat: +b.sat.toFixed(3), green: +b.green.toFixed(1) });
  }
  if (i % 200 === 0) console.log(`${i}/${mine.length} dets ${dets.length} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
await writeFile(`public/data/detections_z2_${shard}.json`, JSON.stringify(dets));
console.log({ shard, quadrants: mine.length, detections: dets.length, sec: Math.round((performance.now() - t0) / 1000) });
