// Joins roofs + scan detections + roof re-check into public/data/town.json for the map:
// per-roof status (panel / review / none, and which pass found it), panel boxes, 256 m cells.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { roofIndex, centroid, Roof } from "../lib/geo";
import { PILOT, tileAt } from "../lib/tiles";

const roofFile = existsSync("public/data/roofs_v2.json") ? "public/data/roofs_v2.json" : "public/data/roofs.json";
const roofs: (Roof & { src?: string })[] = JSON.parse(readFileSync(roofFile, "utf8"));
const dets = JSON.parse(readFileSync("public/data/detections_g0.json", "utf8"));
const recheck = existsSync("public/data/recheck_town.json") ? JSON.parse(readFileSync("public/data/recheck_town.json", "utf8")) : null;
const find = roofIndex(roofs);

const status = new Map<number, { s: "panel" | "review"; score: number; by: "scan" | "recheck" }>();
const boxes: [number, number, number, number, 0 | 1, number][] = []; // w,s,e,n, 1=panel 0=review, roofId|-1
let offRoof = 0;
for (const d of dets) {
  if (d.reject) continue;
  const r = find(d.lon, d.lat);
  boxes.push([...d.bb, d.tier === "panel" ? 1 : 0, r ? r.id : -1] as never);
  if (!r) { if (d.tier === "panel") offRoof++; continue; }
  const cur = status.get(r.id);
  if (!cur || (cur.s === "review" && d.tier === "panel") || (cur.s === d.tier && d.score > cur.score))
    status.set(r.id, { s: d.tier, score: d.score, by: "scan" });
}
for (const [id, v] of Object.entries(recheck?.found ?? {}) as [string, { score: number; tier: "panel" | "review" }][]) {
  const cur = status.get(+id);
  if (!cur || (cur.s === "review" && v.tier === "panel")) status.set(+id, { s: v.tier, score: v.score, by: "recheck" });
}

const S = { none: 0, review: 1, panel: 2 } as const;
const out = [];
const cells = new Map<string, { roofs: number; withPanels: number; area: number; large: number }>();
for (const r of roofs) {
  const [lon, lat] = centroid(r.ring);
  if (lon < PILOT.west || lon > PILOT.east || lat < PILOT.south || lat > PILOT.north) continue;
  const st = status.get(r.id);
  // [id, lon, lat, area, floors, status 0/1/2, score, found by 0 scan / 1 recheck, ring]
  out.push([r.id, +lon.toFixed(6), +lat.toFixed(6), Math.round(r.area), r.floors ?? null, st ? S[st.s] : 0, st ? st.score : 0, st?.by === "recheck" ? 1 : 0, r.ring]);
  const t = tileAt(lon, lat);
  const k = `${t.col >> 1}_${t.row >> 1}`;
  const c = cells.get(k) ?? { roofs: 0, withPanels: 0, area: 0, large: 0 };
  c.roofs++; c.area += r.area; if (r.area >= 400) c.large += r.area; if (st?.s === "panel") c.withPanels++;
  cells.set(k, c);
}
const cellArr = [...cells].map(([key, c]) => ({ key, roofs: c.roofs, withPanels: c.withPanels, largeRoofShare: +(c.large / c.area).toFixed(3) }));
const withPanels = out.filter((r) => r[5] === 2).length;
const meta = { roofSource: roofFile.split("/").pop(), roofs: out.length, withPanels, review: out.filter((r) => r[5] === 1).length,
  foundByRecheck: out.filter((r) => r[7] === 1 && r[5] === 2).length, recheckChecked: recheck?.checked ?? 0, offRoofPanelBoxes: offRoof,
  share: +(withPanels / out.length).toFixed(4), rankedCells: cellArr.filter((c) => c.roofs >= 15).length, builtAt: new Date().toISOString() };
writeFileSync("public/data/town.json", JSON.stringify({ meta, roofs: out, cells: cellArr, boxes }));
console.log(meta);
