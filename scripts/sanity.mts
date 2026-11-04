// Town-wide sanity check: share of roofs (inside pilot) with a counted panel box. Expect ~5-15%.
import { readFileSync } from "node:fs";
import { roofIndex, centroid, Roof } from "../lib/geo";
import { PILOT } from "../lib/tiles";
const roofs: Roof[] = JSON.parse(readFileSync("public/data/roofs.json", "utf8"));
const dets = JSON.parse(readFileSync("public/data/detections_g0.json", "utf8"));
const find = roofIndex(roofs);
const st = new Map<number, string>();
let off = 0;
const reasons: Record<string, number> = {};
for (const d of dets) {
  if (d.reject) { reasons[d.reject] = (reasons[d.reject] ?? 0) + 1; continue; }
  const r = find(d.lon, d.lat);
  if (!r) { if (d.tier === "panel") off++; continue; }
  if (st.get(r.id) !== "panel") st.set(r.id, d.tier);
}
const inside = roofs.filter((r) => { const [x, y] = centroid(r.ring); return x >= PILOT.west && x <= PILOT.east && y >= PILOT.south && y <= PILOT.north; });
const p = inside.filter((r) => st.get(r.id) === "panel").length, rv = inside.filter((r) => st.get(r.id) === "review").length;
const tiers = dets.reduce((a: Record<string, number>, d: { tier: string; reject: string | null }) => { if (!d.reject) a[d.tier] = (a[d.tier] ?? 0) + 1; return a; }, {});
console.log({ roofs: inside.length, withPanels: p, share: (p / inside.length * 100).toFixed(1) + "%", needsReview: rv, offRoofPanelBoxes: off, keptBoxes: tiers, rejected: reasons });
