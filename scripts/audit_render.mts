// Audit render: tile (or a quadrant) upscaled with a labelled pixel grid (tile px coords), optional detection boxes.
// usage: npx tsx scripts/audit_render.mts <col>_<row> [full|q0|q1|q2|q3] [dets]
import { readFileSync } from "node:fs";
import sharp from "sharp";
const [id, mode = "full", show] = process.argv.slice(2);
const [col, row] = id.split("_").map(Number);
const q = mode === "full" ? null : Number(mode[1]);
const ox = q === null ? 0 : (q % 2) * 256, oy = q === null ? 0 : Math.floor(q / 2) * 256, span = q === null ? 512 : 256;
const OUT = 1024, k = OUT / span;
let svg = "";
const step = q === null ? 32 : 16;
for (let v = 0; v <= 512; v += step) {
  if (v >= ox && v <= ox + span) { const x = (v - ox) * k; svg += `<line x1="${x}" y1="0" x2="${x}" y2="${OUT}" stroke="#ff0" stroke-opacity="${v % 64 ? 0.18 : 0.4}" stroke-width="1"/>`; if (v % (step * 2) === 0) svg += `<text x="${x + 2}" y="12" fill="#ff0" font-size="11" font-family="monospace">${v}</text>`; }
  if (v >= oy && v <= oy + span) { const y = (v - oy) * k; svg += `<line x1="0" y1="${y}" x2="${OUT}" y2="${y}" stroke="#ff0" stroke-opacity="${v % 64 ? 0.18 : 0.4}" stroke-width="1"/>`; if (v % (step * 2) === 0) svg += `<text x="2" y="${y - 2}" fill="#ff0" font-size="11" font-family="monospace">${v}</text>`; }
}
if (show) {
  const dets = JSON.parse(readFileSync(show === "dets" ? "public/data/detections_g0.json" : show, "utf8")).filter((d: any) => (d.c ?? col) === col && (d.r ?? row) === row && (d.tile ? d.tile === id : true));
  for (const d of dets) {
    const [a, b, c, e] = d.px ?? d.bb;
    const color = d.reject ? "#f80" : d.score >= 0.5 ? "#0f0" : d.score >= 0.35 ? "#0ff" : "#f0f";
    svg += `<rect x="${(a - ox) * k}" y="${(b - oy) * k}" width="${(c - a) * k}" height="${(e - b) * k}" fill="none" stroke="${color}" stroke-width="2"/><text x="${(a - ox) * k}" y="${(e - oy) * k + 11}" fill="${color}" font-size="11" font-family="monospace">${d.score.toFixed(2)}</text>`;
  }
}
const img = await sharp(`.cache/tiles/g0/${id}.jpg`).extract({ left: ox, top: oy, width: span, height: span }).resize(OUT, OUT, { kernel: "lanczos3" }).toBuffer();
const out = `.cache/audit/img/${id}_${mode}${show ? "_d" : ""}.png`;
await sharp(img).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${OUT}" height="${OUT}">${svg}</svg>`) }]).png().toFile(out);
console.log(out);
