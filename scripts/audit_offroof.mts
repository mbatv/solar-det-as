// How many hand-labelled PV arrays in the audit sample sit on a building footprint from roofs.json?
// (Context for the "visible arrays not shown" report: off-footprint detections are not counted as roofs with panels.)
import { readFileSync } from "node:fs";
import { tile, pxToLonLat } from "../lib/tiles";
import { roofIndex, type Roof } from "../lib/geo";
const labels = JSON.parse(readFileSync(".cache/audit/labels.json", "utf8"));
const roofs: Roof[] = JSON.parse(readFileSync("public/data/roofs.json", "utf8"));
const find = roofIndex(roofs);
let on = 0, n = 0; const off: string[] = [];
for (const [id, v] of Object.entries<any>(labels)) {
  if (id.startsWith("_")) continue;
  const [c, r] = id.split("_").map(Number); const t = tile(c, r);
  for (const b of v.boxes) { n++; const [lon, lat] = pxToLonLat(t, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2); if (find(lon, lat)) on++; else off.push(`${id} [${b}]`); }
}
console.log(`labelled arrays on a footprint: ${on}/${n}`); console.log("off footprint:", off.join("; "));
