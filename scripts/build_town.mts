// Joins roofs + scan detections + roof re-check into public/data/town.json for the map:
// per-roof status (panel / review / none, and which pass found it), panel boxes, 256 m cells.
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { roofIndex, centroid, Roof } from "../lib/geo";
import { PILOT, tileAt } from "../lib/tiles";

const roofFile = existsSync("public/data/roofs_v2.json") ? "public/data/roofs_v2.json" : "public/data/roofs.json";
const roofs: (Roof & { src?: string })[] = JSON.parse(readFileSync(roofFile, "utf8"));
type D = { g: string; lon: number; lat: number; bb: [number, number, number, number]; score: number; tier: "panel" | "review"; reject: string | null };
// Grid g0 + half-tile shifted grid g1: merge duplicates by geographic overlap (greedy NMS on lon/lat boxes),
// so an array cut by a g0 tile edge is recovered whole from g1.
const raw: D[] = ["g0", "g1", "z2_0", "z2_1"].filter((g) => existsSync(`public/data/detections_${g}.json`))
  .flatMap((g) => JSON.parse(readFileSync(`public/data/detections_${g}.json`, "utf8")));
const giou = (a: D["bb"], b: D["bb"]) => {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const i = w * h, ar = (q: D["bb"]) => (q[2] - q[0]) * (q[3] - q[1]);
  return i / (ar(a) + ar(b) - i || 1);
};
const contained = (a: D["bb"], b: D["bb"]) => { // share of the smaller box covered by the other
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return (w * h) / Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
};
const dets: D[] = [];
for (const d of [...raw.filter((d) => !d.reject)].sort((a, b) => b.score - a.score))
  if (dets.every((k) => giou(k.bb, d.bb) < 0.45 && contained(k.bb, d.bb) < 0.7)) dets.push(d);
dets.push(...raw.filter((d) => d.reject));
const grids = [...new Set(raw.map((d) => d.g))];
const recheck = existsSync("public/data/recheck_town.json") ? JSON.parse(readFileSync("public/data/recheck_town.json", "utf8")) : null;
const find = roofIndex(roofs);

const status = new Map<number, { s: "panel" | "review"; score: number; by: "scan" | "recheck" }>();
const boxes: [number, number, number, number, 0 | 1, number][] = []; // w,s,e,n, 1=panel 0=review, roofId|-1
let offRoof = 0;
for (const d of dets) {
  if (d.reject) continue;
  const r = find(d.lon, d.lat);
  boxes.push([...d.bb, d.tier === "panel" ? 1 : 0, r ? r.id : -1]);
  if (!r) { if (d.tier === "panel") offRoof++; continue; }
  const cur = status.get(r.id);
  if (!cur || (cur.s === "review" && d.tier === "panel") || (cur.s === d.tier && d.score > cur.score))
    status.set(r.id, { s: d.tier, score: d.score, by: "scan" });
}
// Panels on no mapped building: cluster boxes closer than 3 m and track the cluster as our own
// "detected building" (outline = boxes + 2 m margin). Counts as a roof with panels; src "detected".
const M_LAT = 1 / 110540, M_LON = 1 / (111320 * Math.cos((41.07 * Math.PI) / 180));
const off = dets.filter((d) => !d.reject && d.tier === "panel" && !find(d.lon, d.lat));
const parent = off.map((_, i) => i);
const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
for (let i = 0; i < off.length; i++)
  for (let j = i + 1; j < off.length; j++) {
    const a = off[i].bb, b = off[j].bb;
    const gx = Math.max(0, Math.max(a[0], b[0]) - Math.min(a[2], b[2])) / M_LON, gy = Math.max(0, Math.max(a[1], b[1]) - Math.min(a[3], b[3])) / M_LAT;
    if (Math.hypot(gx, gy) < 3) parent[root(i)] = root(j);
  }
const clusters = new Map<number, D[]>();
off.forEach((d, i) => { const r = root(i); clusters.set(r, [...(clusters.get(r) ?? []), d]); });
let nextId = Math.max(...roofs.map((r) => r.id)) + 1;
const detected: (Roof & { src: string })[] = [];
for (const ds of clusters.values()) {
  const w = Math.min(...ds.map((d) => d.bb[0])) - 2 * M_LON, s = Math.min(...ds.map((d) => d.bb[1])) - 2 * M_LAT;
  const e = Math.max(...ds.map((d) => d.bb[2])) + 2 * M_LON, n = Math.max(...ds.map((d) => d.bb[3])) + 2 * M_LAT;
  const area = ((e - w) / M_LON) * ((n - s) / M_LAT);
  const roof = { id: nextId++, oid: "detected", area: +area.toFixed(1), floors: null, h: null, src: "detected",
    ring: [[w, s], [e, s], [e, n], [w, n], [w, s]].map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]) as [number, number][] };
  detected.push(roof);
  status.set(roof.id, { s: "panel", score: Math.max(...ds.map((d) => d.score)), by: "scan" });
}
roofs.push(...detected);

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
  out.push([r.id, +lon.toFixed(6), +lat.toFixed(6), Math.round(r.area), r.floors ?? null, st ? S[st.s] : 0, st ? st.score : 0, st?.by === "recheck" ? 1 : 0, r.ring, (r as { src?: string }).src === "detected" ? 1 : 0]);
  const t = tileAt(lon, lat);
  const k = `${t.col >> 1}_${t.row >> 1}`;
  const c = cells.get(k) ?? { roofs: 0, withPanels: 0, area: 0, large: 0 };
  c.roofs++; c.area += r.area; if (r.area >= 400) c.large += r.area; if (st?.s === "panel") c.withPanels++;
  cells.set(k, c);
}
const cellArr = [...cells].map(([key, c]) => ({ key, roofs: c.roofs, withPanels: c.withPanels, largeRoofShare: +(c.large / c.area).toFixed(3) }));
const withPanels = out.filter((r) => r[5] === 2).length;
const meta = { roofSource: roofFile.split("/").pop(), grids: grids.join("+"), detectedBuildings: detected.length, roofs: out.length, withPanels, review: out.filter((r) => r[5] === 1).length,
  foundByRecheck: out.filter((r) => r[7] === 1 && r[5] === 2).length, recheckChecked: recheck?.checked ?? 0, offRoofPanelBoxes: offRoof,
  share: +(withPanels / out.length).toFixed(4), rankedCells: cellArr.filter((c) => c.roofs >= 15).length, builtAt: new Date().toISOString() };
writeFileSync("public/data/town.json", JSON.stringify({ meta, roofs: out, cells: cellArr, boxes }));
console.log(meta);
