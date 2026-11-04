// Pure statistics for Solar Radar: shares, Wilson intervals, ranking, peers.
// See docs/DETECTION.md ("Neighbourhoods and ranking").

export type RoofStatus = "panel" | "review" | "none";

export type Roof = {
  id: number;
  area: number; // m² footprint
  floors: number | null;
  lon: number;
  lat: number;
  status: RoofStatus; // panel = detected, review = low-confidence, none = no panels observed
};

export type Cell = {
  key: string;
  roofs: number;
  withPanels: number;
  largeRoofShare: number; // area of roofs >= 400 m² / total roof area
};

export const MIN_ROOFS = 15; // a cell / area is judged only with at least this many roofs
export const LARGE_ROOF_M2 = 400;
export const PEER_COUNT = 20;

export type Interval = { p: number; lo: number; hi: number };

/**
 * Wilson score interval for k successes out of n.
 * n = 0 has no information: returns p = 0 and the full interval [0, 1].
 */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - margin), hi: Math.min(1, centre + margin) };
}

export type AreaStats = {
  roofs: number;
  withPanels: number; // status "panel" only
  review: number; // status "review": in neither numerator
  share: number; // withPanels / roofs (0 when roofs = 0)
  lo: number; // Wilson 95% lower bound of share
  hi: number; // Wilson 95% upper bound of share
  largeRoofShare: number; // area of roofs >= 400 m² / total roof area (0 when no area)
};

export function areaStats(roofs: Roof[]): AreaStats {
  let withPanels = 0;
  let review = 0;
  let total = 0;
  let large = 0;
  for (const r of roofs) {
    if (r.status === "panel") withPanels++;
    else if (r.status === "review") review++;
    total += r.area;
    if (r.area >= LARGE_ROOF_M2) large += r.area;
  }
  const n = roofs.length;
  const w = wilson(withPanels, n);
  return {
    roofs: n,
    withPanels,
    review,
    share: n ? withPanels / n : 0,
    lo: w.lo,
    hi: w.hi,
    largeRoofShare: total > 0 ? large / total : 0,
  };
}

export function cellShare(c: Cell): number {
  return c.roofs ? c.withPanels / c.roofs : 0;
}

export function rankedCells(cells: Cell[]): Cell[] {
  return cells.filter((c) => c.roofs >= MIN_ROOFS);
}

/**
 * Percentile rank (0–100) of value among values, ties counting half:
 * 100 * (count(v < value) + 0.5 * count(v == value)) / n. Empty list -> NaN.
 */
export function percentile(value: number, values: number[]): number {
  const n = values.length;
  if (!n) return NaN;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return (100 * (below + 0.5 * equal)) / n;
}

/**
 * Quantile q in [0, 1] by linear interpolation between order statistics
 * (h = (n − 1)·q, the "type 7" definition used by numpy/R default).
 * Empty list -> NaN.
 */
export function quantile(values: number[], q: number): number {
  const n = values.length;
  if (!n) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const h = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

export type Rank = {
  percentile: number; // 0–100, ties half
  median: number; // median share of the ranked cells
  q75: number; // 75th percentile share
  headroom: number; // roofs to add to reach q75: max(0, round(q75 * roofs) - withPanels)
  n: number; // number of ranked cells compared against
};

/**
 * Rank an area's share against the ranked cells (roofs >= 15) of `cells`.
 * Returns null when there are no ranked cells to compare with.
 */
export function rankAgainst(
  share: number,
  roofs: number,
  withPanels: number,
  cells: Cell[],
): Rank | null {
  const shares = rankedCells(cells).map(cellShare);
  if (!shares.length) return null;
  const q75 = quantile(shares, 0.75);
  return {
    percentile: percentile(share, shares),
    median: quantile(shares, 0.5),
    q75,
    headroom: Math.max(0, Math.round(q75 * roofs) - withPanels),
    n: shares.length,
  };
}

/**
 * The k ranked cells whose largeRoofShare is closest to the given one
 * ("similar housing"). Ties broken by cell key for determinism.
 */
export function peers(largeRoofShare: number, cells: Cell[], k = PEER_COUNT): Cell[] {
  return rankedCells(cells)
    .map((c) => ({ c, d: Math.abs(c.largeRoofShare - largeRoofShare) }))
    .sort((a, b) => a.d - b.d || (a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0))
    .slice(0, k)
    .map((x) => x.c);
}
