// Diagnostic render: a cached tile with roof outlines (grey) and boxes (white = on roof, dashed = off roof).
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { tile, toMerc, TILE_PX } from "../lib/tiles";
import { roofIndex, Roof } from "../lib/geo";
const [col, row] = process.argv[2].split("_").map(Number);
const t = tile(col, row);
const roofs: Roof[] = JSON.parse(readFileSync("public/data/roofs.json", "utf8"));
const dets = JSON.parse(readFileSync("public/data/detections_g0.json", "utf8")).filter((d: any) => d.c === col && d.r === row && !d.reject);
const find = roofIndex(roofs);
const [x0, y0, x1, y1] = t.bbox;
const px = ([lon, lat]: [number, number]) => { const [x, y] = toMerc(lon, lat); return [((x - x0) / (x1 - x0)) * TILE_PX, ((y1 - y) / (y1 - y0)) * TILE_PX]; };
const polys = roofs.map((r) => r.ring.map((p) => px(p))).filter((ring) => ring.some(([a, b]) => a > -50 && a < 562 && b > -50 && b < 562))
  .map((ring) => `<polygon points="${ring.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#00e5ff" stroke-width="1"/>`).join("");
const boxes = dets.map((d: any) => { const on = !!find(d.lon, d.lat); const [a, b, c, e] = d.px;
  return `<rect x="${a}" y="${b}" width="${c - a}" height="${e - b}" fill="none" stroke="${on ? "#fff" : "#ff00ff"}" stroke-width="2" ${d.tier === "review" ? 'stroke-dasharray="2 2"' : ""}/>`; }).join("");
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${polys}${boxes}</svg>`);
await sharp(`.cache/tiles/g0/${col}_${row}.jpg`).composite([{ input: svg }]).png().toFile(`.cache/shots/tile_${col}_${row}.png`);
console.log(`.cache/shots/tile_${col}_${row}.png`, dets.length);
