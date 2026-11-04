// Checkpoint 2: run detection on the 3x3 tiles around Carrer d'Auguste Renoir and write a debug view.
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { fetchTile } from "../lib/fetchTile";
import { loadModel, detectJpeg } from "../lib/infer";
import { tile, tileAt } from "../lib/tiles";

const [lat, lon] = [41.060932, 1.038792];
const c = tileAt(lon, lat);
const session = await loadModel("models/best.onnx", 4);
await mkdir("public/debug", { recursive: true });
const out = [];
for (let dr = 1; dr >= -1; dr--)
  for (let dc = -1; dc <= 1; dc++) {
    const t = tile(c.col + dc, c.row + dr);
    const f0 = performance.now();
    const jpeg = await fetchTile(t);
    const fetchMs = performance.now() - f0;
    const { boxes, ms } = await detectJpeg(session, jpeg);
    await copyFile(`.cache/tiles/g0/${t.col}_${t.row}.jpg`, `public/debug/${t.col}_${t.row}.jpg`);
    out.push({ col: t.col, row: t.row, fetchMs: Math.round(fetchMs), inferMs: Math.round(ms), boxes });
    console.log(`${t.col},${t.row} fetch ${fetchMs.toFixed(0)}ms infer ${ms.toFixed(0)}ms kept ${boxes.filter((b) => !b.reject).length} rejected ${boxes.filter((b) => b.reject).length}`);
  }
await writeFile("public/debug/tiles.json", JSON.stringify({ center: c, tiles: out }));
