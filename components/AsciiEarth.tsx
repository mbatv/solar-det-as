"use client";

import { useEffect, useRef } from "react";

/*
 * Spinning ASCII Earth.
 *
 * Data: /data/landmask.json, built by scripts/build_landmask.py from Natural
 * Earth (public domain). Equirectangular 720x360 grid, RLE: a=sea b=land c=Spain.
 *
 * Projection: orthographic, viewer fixed in space looking at the point
 * (lon0, LAT0). The view frame is fixed, so per screen cell we precompute the
 * latitude and the longitude offset from lon0 once; each frame is only lookups.
 *
 * Rotation direction: the Earth spins west-to-east (counter-clockwise seen from
 * above the North Pole). A point at longitude L sits at inertial angle L + wt;
 * the viewer sits at a fixed inertial angle A, so the sub-viewer longitude is
 * A - wt: it DEcreases over time (the same reason the Sun's subsolar point
 * drifts west). On screen (north up, east right) the surface therefore moves
 * left-to-right: Spain slides off the right-hand limb and the Atlantic and
 * the Americas come into view from the left.
 */

const COLS = 80;
const ROWS = 40; // chars are ~2x taller than wide (line-height 1.2 / advance 0.6)
const LAT0 = 40.4; // view tilt: Madrid's latitude
const LON_START = -3.7; // Madrid
const PERIOD_MS = 40_000; // one revolution per 40 s
const FRAME_MS = 50; // ~20 fps
const SPAIN = { lon: -3.7, lat: 40.4 };

// sun direction in the (fixed) view frame: x right, y up, z towards viewer.
// Slightly right/up of the viewer so the centre is lit and the left limb is night.
const SUN = (() => {
  const v = [0.55, 0.35, 0.75];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((c) => c / n) as [number, number, number];
})();

const RAMP = ":-=+*#%"; // lit land, dim -> bright (Spain alone gets "@")
const SUB = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

type Mask = { w: number; h: number; cells: Uint8Array };

type Cell = {
  inside: boolean;
  limb: boolean;
  light: number; // 0..1 diffuse
  lat: Float32Array; // per subsample
  dlon: Float32Array; // per subsample, degrees east of the view centre
  stip: number; // stable pseudo-random 0..1 for sea stipple
};

function decode(json: { width: number; height: number; rle: string }): Mask {
  const { width: w, height: h, rle } = json;
  const cells = new Uint8Array(w * h);
  const re = /([abc])(\d+)/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rle))) {
    const v = m[1].charCodeAt(0) - 97;
    const n = Number(m[2]);
    if (v) cells.fill(v, i, i + n);
    i += n;
  }
  return { w, h, cells };
}

function buildGrid(): Cell[] {
  const cx = COLS / 2;
  const cy = ROWS / 2;
  const rx = COLS / 2 - 0.5;
  const ry = ROWS / 2 - 0.25;
  const p0 = (LAT0 * Math.PI) / 180;
  const sp = Math.sin(p0);
  const cp = Math.cos(p0);
  const out: Cell[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const lat = new Float32Array(4);
      const dlon = new Float32Array(4);
      let hits = 0;
      for (let s = 0; s < 4; s++) {
        const x = (i + SUB[s][0] - cx) / rx;
        const y = (cy - (j + SUB[s][1])) / ry;
        const r2 = x * x + y * y;
        if (r2 > 1) {
          lat[s] = NaN;
          continue;
        }
        hits++;
        const z = Math.sqrt(1 - r2);
        // world (ECEF with lon0 = 0): X = z cos p0 - y sin p0, Y = x, Z = z sin p0 + y cos p0
        const X = z * cp - y * sp;
        const Y = x;
        const Z = z * sp + y * cp;
        lat[s] = (Math.asin(Math.max(-1, Math.min(1, Z))) * 180) / Math.PI;
        dlon[s] = (Math.atan2(Y, X) * 180) / Math.PI;
      }
      const x = (i + 0.5 - cx) / rx;
      const y = (cy - (j + 0.5)) / ry;
      const r2 = x * x + y * y;
      const z = Math.sqrt(Math.max(0, 1 - r2));
      const light = Math.max(0, x * SUN[0] + y * SUN[1] + z * SUN[2]);
      const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      out.push({
        inside: hits >= 2,
        limb: hits >= 2 && r2 > 0.86,
        light,
        lat,
        dlon,
        stip: h - Math.floor(h),
      });
    }
  }
  return out;
}

// classes: s = sea (faint), n = night land, l = lit land, e = Spain
type Cls = "s" | "n" | "l" | "e";

function render(grid: Cell[], mask: Mask, lon0: number): string {
  const { w, h, cells } = mask;
  let html = "";
  for (let j = 0; j < ROWS; j++) {
    let cur: Cls | "" = "";
    let buf = "";
    let row = "";
    const flush = () => {
      if (buf) row += cur ? `<span class="ae-${cur}">${buf}</span>` : buf;
      buf = "";
    };
    for (let i = 0; i < COLS; i++) {
      const c = grid[j * COLS + i];
      let ch = " ";
      let cls: Cls | "" = "";
      if (c.inside) {
        let land = 0;
        let spain = 0;
        for (let s = 0; s < 4; s++) {
          const la = c.lat[s];
          if (la !== la) continue; // NaN: subsample off the disc
          let lo = lon0 + c.dlon[s];
          lo = (((lo + 180) % 360) + 360) % 360; // 0..360 from 180W
          const col = Math.min(w - 1, Math.floor((lo / 360) * w));
          const r = Math.min(h - 1, Math.max(0, Math.floor(((90 - la) / 180) * h)));
          const v = cells[r * w + col];
          if (v) land++;
          if (v === 2) spain++;
        }
        const L = c.light;
        if (land >= 2 || spain >= 1) {
          if (L > 0.08) {
            ch = spain ? "@" : RAMP[Math.min(RAMP.length - 1, Math.floor(L * L * 1.15 * RAMP.length))];
            cls = spain ? "e" : "l";
          } else {
            ch = spain ? ":" : ".";
            cls = spain ? "e" : "n";
          }
        } else {
          // sea: sparse stipple, a bit denser where lit; night side + limb keep
          // a faint dotted edge so the disc stays round.
          const lit = c.stip < 0.1 + 0.3 * L;
          if (c.limb || (L > 0.08 ? lit : (i + j) % 3 === 0)) {
            ch = L > 0.75 && c.stip < 0.12 ? "-" : ".";
            cls = "s";
          }
        }
      }
      if (cls !== cur) {
        flush();
        cur = cls;
      }
      buf += ch;
    }
    flush();
    html += row + (j < ROWS - 1 ? "\n" : "");
  }
  return html;
}

function fmtLon(lon: number): string {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return `${Math.abs(l).toFixed(1)}°${l < 0 ? "W" : "E"}`;
}

function spainVisible(lon0: number): boolean {
  const r = Math.PI / 180;
  const d =
    Math.cos(LAT0 * r) * Math.cos(SPAIN.lat * r) * Math.cos((SPAIN.lon - lon0) * r) +
    Math.sin(LAT0 * r) * Math.sin(SPAIN.lat * r);
  return d > 0.15;
}

export default function AsciiEarth() {
  const preRef = useRef<HTMLPreElement>(null);
  const statusRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let elapsed = 0; // ms of visible rotation
    let last = 0;
    let mask: Mask | null = null;
    const grid = buildGrid();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      if (!mask || !preRef.current) return;
      const lon0 = LON_START - (360 * elapsed) / PERIOD_MS; // westward drift, see header
      preRef.current.innerHTML = render(grid, mask, lon0);
      if (statusRef.current) {
        statusRef.current.textContent = `lon ${fmtLon(lon0)} · lat ${LAT0.toFixed(1)}°N · ${
          spainVisible(lon0) ? "SPAIN IN VIEW" : "spain on far side"
        }${reduce ? " · paused (reduced motion)" : ""}`;
      }
    };

    const tick = () => {
      const now = performance.now();
      elapsed = (elapsed + (now - last)) % PERIOD_MS;
      last = now;
      draw();
    };

    const start = () => {
      if (reduce || timer || !mask || document.hidden) return;
      last = performance.now();
      timer = setInterval(tick, FRAME_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => (document.hidden ? stop() : start());

    fetch("/data/landmask.json")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        mask = decode(j);
        draw();
        start();
      })
      .catch(() => {
        if (statusRef.current) statusRef.current.textContent = "globe data unavailable";
      });

    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <figure className="ae" aria-label="ASCII globe, Spain highlighted">
      <style>{`
        .ae { margin: 0; max-width: 100%; overflow: hidden; }
        .ae pre {
          font-family: var(--mono);
          font-size: clamp(6px, calc((100vw - 32px) / ${COLS} / 0.62), 13px);
          line-height: 1.2;
          color: #9a9a9a;
          white-space: pre;
          margin: 0;
          width: ${COLS}ch;
          height: ${ROWS * 1.2}em;
          max-width: 100%;
          user-select: none;
        }
        .ae .ae-s { color: #4a4a4a; }
        .ae .ae-n { color: #5e5e5e; }
        .ae .ae-l { color: #9a9a9a; }
        .ae .ae-e { color: #fff; font-weight: 700; }
        .ae figcaption { color: var(--dim); font-size: 12px; margin-top: 8px; font-variant-numeric: tabular-nums; }
      `}</style>
      {/* filled imperatively (innerHTML) each frame; React never owns its children */}
      <pre ref={preRef} aria-hidden="true" />
      <figcaption ref={statusRef}>lon 3.7°W · lat 40.4°N · loading coastlines…</figcaption>
    </figure>
  );
}
