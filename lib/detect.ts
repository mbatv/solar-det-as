// Shared YOLOv8-seg post-processing + colour filter. Runs in Node (scan) and the browser (live check).
export const INPUT = 640;
export const SCORE_MIN = 0.5;
export const NMS_IOU = 0.45;

export type Box = {
  x1: number; y1: number; x2: number; y2: number; // 512 px tile space
  score: number;
  V: number; sat: number; green: number;
  reject: null | "sea_pool" | "vegetation" | "white_structure";
};

// rgb: 640x640 pixels, `channels` per pixel (3 for Node raw, 4 for canvas RGBA) -> float32 CHW / 255.
export function toTensor(rgb: Uint8Array | Uint8ClampedArray, channels: number): Float32Array {
  const n = INPUT * INPUT;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = rgb[i * channels] / 255;
    out[n + i] = rgb[i * channels + 1] / 255;
    out[2 * n + i] = rgb[i * channels + 2] / 255;
  }
  return out;
}

const iou = (a: Box, b: Box) => {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  const area = (q: Box) => (q.x2 - q.x1) * (q.y2 - q.y1);
  return inter / (area(a) + area(b) - inter || 1);
};

export function nms<T extends Box>(boxes: T[], thr = NMS_IOU): T[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep: T[] = [];
  for (const b of sorted) if (keep.every((k) => iou(k, b) < thr)) keep.push(b);
  return keep;
}

// output0 is [1, 37, 8400] row-major: value(c, i) = out[c * 8400 + i]. Column 4 is the panel score.
export function decode(out: Float32Array, tilePx: number, scoreMin = SCORE_MIN): Box[] {
  const N = 8400;
  const s = tilePx / INPUT;
  const raw: Box[] = [];
  for (let i = 0; i < N; i++) {
    const score = out[4 * N + i];
    if (score < scoreMin) continue;
    const cx = out[i] * s, cy = out[N + i] * s, w = out[2 * N + i] * s, h = out[3 * N + i] * s;
    const clip = (v: number) => Math.max(0, Math.min(tilePx, v));
    const b = { x1: clip(cx - w / 2), y1: clip(cy - h / 2), x2: clip(cx + w / 2), y2: clip(cy + h / 2), score, V: 0, sat: 0, green: 0, reject: null };
    if (b.x2 - b.x1 >= 1 && b.y2 - b.y1 >= 1) raw.push(b);
  }
  return nms(raw);
}

// Colour stats on the original tile pixels inside each box; rejected boxes are kept with a reason.
export function colourFilter(boxes: Box[], rgb: Uint8Array | Uint8ClampedArray, tilePx: number, channels: number): Box[] {
  for (const b of boxes) {
    let V = 0, sat = 0, green = 0, n = 0;
    for (let y = Math.floor(b.y1); y < Math.ceil(b.y2); y++)
      for (let x = Math.floor(b.x1); x < Math.ceil(b.x2); x++) {
        const o = (y * tilePx + x) * channels;
        const r = rgb[o], g = rgb[o + 1], bl = rgb[o + 2];
        const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
        V += mx; sat += mx ? (mx - mn) / mx : 0; green += g - (r + bl) / 2; n++;
      }
    b.V = V / n; b.sat = sat / n; b.green = green / n;
    b.reject = b.sat > 0.4 ? "sea_pool" : b.green > 6 ? "vegetation" : b.V > 205 ? "white_structure" : null;
  }
  return boxes;
}

// Bilinear resize with half-pixel centres (matches OpenCV INTER_LINEAR, which the model was trained with).
// Done in JS so Node and every browser feed the model identical pixels. Output is packed RGB.
export function resizeBilinear(src: Uint8Array | Uint8ClampedArray, sw: number, sh: number, channels: number, dw = INPUT, dh = INPUT): Uint8Array {
  const out = new Uint8Array(dw * dh * 3);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    let sy = (y + 0.5) * fy - 0.5;
    if (sy < 0) sy = 0;
    const y0 = Math.min(Math.floor(sy), sh - 1), y1 = Math.min(y0 + 1, sh - 1), wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      let sx = (x + 0.5) * fx - 0.5;
      if (sx < 0) sx = 0;
      const x0 = Math.min(Math.floor(sx), sw - 1), x1 = Math.min(x0 + 1, sw - 1), wx = sx - x0;
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * sw + x0) * channels + c], p01 = src[(y0 * sw + x1) * channels + c];
        const p10 = src[(y1 * sw + x0) * channels + c], p11 = src[(y1 * sw + x1) * channels + c];
        out[(y * dw + x) * 3 + c] = Math.round((p00 * (1 - wx) + p01 * wx) * (1 - wy) + (p10 * (1 - wx) + p11 * wx) * wy);
      }
    }
  }
  return out;
}
