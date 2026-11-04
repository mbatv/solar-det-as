// Idea 4: second look before a roof becomes a lead. For every roof with no panel box in the grid scan,
// cut a window centred on the roof from the cached tiles (no new downloads) and run the model at 2x zoom
// (80 m window -> 640 px), so small arrays look bigger and nothing sits on a tile edge.
// Usage: tsx scripts/recheck.mts [limitToLon,limitToLat,radiusM]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { loadModel } from "../lib/infer";
import { INPUT, colourFilter, decode, resizeBilinear, toTensor } from "../lib/detect";
import { TILE_PX, mercToTilePx, toMerc, fromMerc, PILOT } from "../lib/tiles";
import { Roof, roofIndex, centroid, pointInRing } from "../lib/geo";

type Det = { lon: number; lat: number; score: number; tier: "panel" | "review"; reject: string | null };
const roofs: Roof[] = JSON.parse(await readFile("public/data/roofs.json", "utf8"));
const dets: Det[] = JSON.parse(await readFile("public/data/detections_g0.json", "utf8"));
const find = roofIndex(roofs);
const hit = new Map<number, "panel" | "review">();
for (const d of dets) {
  if (d.reject) continue;
  const r = find(d.lon, d.lat);
  if (r && hit.get(r.id) !== "panel") hit.set(r.id, d.tier);
}

const [qLon, qLat, qR] = (process.argv[2] ?? "").split(",").map(Number);
const near = (lon: number, lat: number) => !qR || Math.hypot((lon - qLon) * 84000, (lat - qLat) * 111000) <= qR;
const todo = roofs.filter((r) => {
  const [lon, lat] = centroid(r.ring);
  return hit.get(r.id) !== "panel" && lon >= PILOT.west && lon <= PILOT.east && lat >= PILOT.south && lat <= PILOT.north && near(lon, lat);
});
console.log(`roofs ${roofs.length} · already panel ${[...hit.values()].filter((v) => v === "panel").length} · to re-check ${todo.length}`);

const tileCache = new Map<string, Buffer | null>();
async function tileRaw(col: number, row: number) {
  const k = `${col}_${row}`;
  if (!tileCache.has(k)) {
    const f = `.cache/tiles/g0/${k}.jpg`;
    tileCache.set(k, existsSync(f) ? await sharp(f).removeAlpha().raw().toBuffer() : null);
    if (tileCache.size > 64) tileCache.delete(tileCache.keys().next().value!);
  }
  return tileCache.get(k)!;
}

const WIN_M = 80, N = WIN_M * 4; // native 0.25 m/px -> 320 px, upscaled to 640 = 2x
const session = await loadModel("models/best.onnx", 6);
const out: Record<number, { score: number; tier: string }> = {};
let missing = 0, n = 0;
await mkdir("public/debug/recheck", { recursive: true });
const shots: unknown[] = [];
const t0 = performance.now();
for (const r of todo) {
  const [lon, lat] = centroid(r.ring);
  const [cx, cy] = toMerc(lon, lat);
  const W = WIN_M / Math.cos((lat * Math.PI) / 180);
  const win = new Uint8Array(N * N * 3);
  let ok = true;
  for (let v = 0; v < N && ok; v++)
    for (let u = 0; u < N; u++) {
      const p = mercToTilePx(cx - W / 2 + ((u + 0.5) * W) / N, cy + W / 2 - ((v + 0.5) * W) / N);
      const raw = await tileRaw(p.col, p.row);
      if (!raw) { ok = false; break; }
      const o = (Math.min(TILE_PX - 1, Math.floor(p.py)) * TILE_PX + Math.min(TILE_PX - 1, Math.floor(p.px))) * 3;
      const d = (v * N + u) * 3;
      win[d] = raw[o]; win[d + 1] = raw[o + 1]; win[d + 2] = raw[o + 2];
    }
  if (!ok) { missing++; continue; }
  const res = await session.run({ images: new ort.Tensor("float32", toTensor(resizeBilinear(win, N, N, 3), 3), [1, 3, INPUT, INPUT]) });
  const boxes = colourFilter(decode(res.output0.data as Float32Array, N), win, N, 3).filter((b) => {
    if (b.reject) return false;
    const [blon, blat] = fromMerc(cx - W / 2 + (((b.x1 + b.x2) / 2) * W) / N, cy + W / 2 - (((b.y1 + b.y2) / 2) * W) / N);
    return pointInRing(blon, blat, r.ring);
  });
  const best = boxes.sort((a, b) => b.score - a.score)[0];
  if (best && (best.tier === "panel" || hit.get(r.id) !== "review")) {
    out[r.id] = { score: +best.score.toFixed(3), tier: best.tier };
    if (shots.length < 60) {
      await sharp(Buffer.from(win), { raw: { width: N, height: N, channels: 3 } }).jpeg().toFile(`public/debug/recheck/${r.id}.jpg`);
      shots.push({ id: r.id, area: r.area, firstPass: hit.get(r.id) ?? "none", boxes: boxes.map((b) => ({ ...b })), ring: r.ring.map(([x, y]) => { const [mx, my] = toMerc(x, y); return [((mx - (cx - W / 2)) / W) * N, ((cy + W / 2 - my) / W) * N]; }) });
    }
  }
  if (++n % 250 === 0) console.log(`${n}/${todo.length} found ${Object.keys(out).length} ${((performance.now() - t0) / 1000).toFixed(0)}s`);
}
const tag = qR ? "local" : "town";
await writeFile(`public/data/recheck_${tag}.json`, JSON.stringify({ windowM: WIN_M, zoom: 2, checked: n, missingTiles: missing, found: out }));
await writeFile("public/debug/recheck.json", JSON.stringify({ size: N, shots }));
console.log({ checked: n, missing, foundPanel: Object.values(out).filter((v) => v.tier === "panel").length, foundReview: Object.values(out).filter((v) => v.tier === "review").length, sec: Math.round((performance.now() - t0) / 1000) });
