// Compare colour stats of panel boxes on mapped roofs vs off-roof, to set safe rules for "detected buildings".
import { readFileSync } from "node:fs";
import { roofIndex, Roof } from "../lib/geo";
const roofs: Roof[] = JSON.parse(readFileSync("public/data/roofs.json", "utf8"));
const find = roofIndex(roofs);
const dets = ["g0", "g1"].flatMap((g) => JSON.parse(readFileSync(`public/data/detections_${g}.json`, "utf8"))).filter((d: any) => !d.reject && d.tier === "panel");
const q = (a: number[], p: number) => a.sort((x, y) => x - y)[Math.floor(a.length * p)];
for (const [name, set] of [["on roof", dets.filter((d: any) => find(d.lon, d.lat))], ["off roof", dets.filter((d: any) => !find(d.lon, d.lat))]] as const) {
  const g = set.map((d: any) => d.green), area = set.map((d: any) => ((d.px[2] - d.px[0]) * (d.px[3] - d.px[1])) / 16);
  console.log(name, set.length, "green p10/50/90", q(g, .1), q(g, .5), q(g, .9), "| share green>=0", (g.filter((x: number) => x >= 0).length / g.length).toFixed(2), "| box m2 p50/p90/max", q(area, .5), q(area, .9), q(area, .999));
}
