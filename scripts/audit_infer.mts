// Audit inference: runs the model on the labelled sample tiles with a LOW threshold (0.05) in several modes and
// stores every candidate box (score, colour stats) so thresholds / filters / merges can be evaluated offline.
// Modes: native (512 -> 640), flip (horizontal flip, boxes un-flipped), quad (four 256 px quadrants -> 640, i.e. 2.5x).
// usage: npx tsx scripts/audit_infer.mts [threads=2]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { INPUT, colourFilter, decode, resizeBilinear, toTensor, type Box } from "../lib/detect";

const threads = Number(process.argv[2] ?? 2);
const LOW = 0.05;
const labels = JSON.parse(readFileSync(".cache/audit/labels.json", "utf8"));
const session = await ort.InferenceSession.create("models/best.onnx", { intraOpNumThreads: threads, graphOptimizationLevel: "all" });

// decode() without the final NMS, to tell "suppressed by NMS" apart from "never scored".
function decodeNoNms(out: Float32Array, tilePx: number, scoreMin: number) {
  const N = 8400, s = tilePx / INPUT, res: { x1: number; y1: number; x2: number; y2: number; score: number }[] = [];
  for (let i = 0; i < N; i++) {
    const score = out[4 * N + i];
    if (score < scoreMin) continue;
    const cx = out[i] * s, cy = out[N + i] * s, w = out[2 * N + i] * s, h = out[3 * N + i] * s;
    const c = (v: number) => Math.max(0, Math.min(tilePx, v));
    res.push({ x1: c(cx - w / 2), y1: c(cy - h / 2), x2: c(cx + w / 2), y2: c(cy + h / 2), score });
  }
  return res;
}
const flipRGB = (src: Uint8Array, w: number, h: number) => {
  const o = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) o[(y * w + (w - 1 - x)) * 3 + c] = src[(y * w + x) * 3 + c];
  return o;
};
const crop = (src: Uint8Array, W: number, x0: number, y0: number, s: number) => {
  const o = new Uint8Array(s * s * 3);
  for (let y = 0; y < s; y++) o.set(src.subarray(((y0 + y) * W + x0) * 3, ((y0 + y) * W + x0 + s) * 3), y * s * 3);
  return o;
};
async function run(rgb640: Uint8Array) {
  const t0 = performance.now();
  const r = await session.run({ images: new ort.Tensor("float32", toTensor(rgb640, 3), [1, 3, INPUT, INPUT]) });
  return { out: r.output0.data as Float32Array, ms: performance.now() - t0 };
}
const round = (b: Box) => ({ x1: +b.x1.toFixed(1), y1: +b.y1.toFixed(1), x2: +b.x2.toFixed(1), y2: +b.y2.toFixed(1), score: +b.score.toFixed(4), V: +b.V.toFixed(1), sat: +b.sat.toFixed(3), green: +b.green.toFixed(1), reject: b.reject });

const result: Record<string, any> = {};
const timing = { native: 0, flip: 0, quad: 0, n: 0 };
for (const id of Object.keys(labels)) {
  const orig = new Uint8Array(await sharp(`.cache/tiles/g0/${id}.jpg`).removeAlpha().raw().toBuffer());
  // native
  const pre0 = performance.now();
  const rs = resizeBilinear(orig, 512, 512, 3);
  const preMs = performance.now() - pre0;
  const nat = await run(rs);
  const native = colourFilter(decode(nat.out, 512, LOW), orig, 512, 3);
  const nativeNoNms = decodeNoNms(nat.out, 512, 0.25).map((b) => ({ ...b, score: +b.score.toFixed(4) }));
  // flip
  const fl = await run(flipRGB(rs, INPUT, INPUT));
  const flip = colourFilter(decode(fl.out, 512, LOW).map((b) => ({ ...b, x1: 512 - b.x2, x2: 512 - b.x1 })), orig, 512, 3);
  // quadrants (256 px -> 640 = 2.5x)
  let quad: Box[] = [], qms = 0;
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * 256, oy = Math.floor(q / 2) * 256;
    const p0 = performance.now();
    const c = resizeBilinear(crop(orig, 512, ox, oy, 256), 256, 256, 3);
    const r = await run(c);
    qms += performance.now() - p0;
    quad.push(...decode(r.out, 256, LOW).map((b) => ({ ...b, x1: b.x1 + ox, x2: b.x2 + ox, y1: b.y1 + oy, y2: b.y2 + oy, qEdge: true })));
  }
  quad = colourFilter(quad, orig, 512, 3);
  timing.native += nat.ms + preMs; timing.flip += fl.ms; timing.quad += qms; timing.n++;
  result[id] = { native: native.map(round), flip: flip.map(round), quad: quad.map(round), nativeNoNms, ms: { native: nat.ms, flip: fl.ms, quad: qms } };
  console.log(id, `native ${native.length} (${nat.ms.toFixed(0)} ms) flip ${flip.length} quad ${quad.length} (${qms.toFixed(0)} ms)`);
}
mkdirSync(".cache/audit", { recursive: true });
writeFileSync(".cache/audit/raw.json", JSON.stringify({ threads, low: LOW, timing: { nativeMs: timing.native / timing.n, flipMs: timing.flip / timing.n, quadMs: timing.quad / timing.n }, tiles: result }));
console.log({ threads, nativeMs: timing.native / timing.n, flipMs: timing.flip / timing.n, quadMs: timing.quad / timing.n });
