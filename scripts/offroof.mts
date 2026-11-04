// Diagnose panel boxes that fall on no roof: distance to nearest roof outline + their tiles.
import { readFileSync, writeFileSync } from "node:fs";
import { roofIndex, Roof } from "../lib/geo";
const roofs: Roof[] = JSON.parse(readFileSync("public/data/roofs.json", "utf8"));
const dets = JSON.parse(readFileSync("public/data/detections_g0.json", "utf8"));
const find = roofIndex(roofs);
const off = dets.filter((d: any) => !d.reject && d.tier === "panel" && !find(d.lon, d.lat));
// nearest roof vertex distance (m) as rough misalignment measure
const pts = roofs.flatMap((r) => r.ring);
const near = off.map((d: any) => Math.min(...pts.map(([x, y]) => Math.hypot((x - d.lon) * 84000, (y - d.lat) * 111000))));
const bins = [2, 5, 10, 20, 1e9].map((b, i, a) => [`<${b}m`, near.filter((n: number) => n < b && n >= (a[i - 1] ?? 0)).length]);
console.log("off-roof panel boxes", off.length, Object.fromEntries(bins));
const byTile: Record<string, number> = {};
for (const d of off) byTile[`${d.c}_${d.r}`] = (byTile[`${d.c}_${d.r}`] ?? 0) + 1;
console.log("top tiles", Object.entries(byTile).sort((a, b) => b[1] - a[1]).slice(0, 8));
const area = off.map((d: any) => ((d.px[2] - d.px[0]) * (d.px[3] - d.px[1])) / 16);
console.log("box area m2 median", area.sort((a: number, b: number) => a - b)[Math.floor(area.length / 2)]);
writeFileSync(".cache/offroof.json", JSON.stringify(off));
