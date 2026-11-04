import { describe, expect, it } from "vitest";
import { areaStats, peers, percentile, quantile, rankAgainst, wilson, type Cell, type Roof } from "./stats";

const roof = (id: number, status: Roof["status"], area = 100, floors: number | null = 1): Roof => ({
  id, area, floors, lon: 1.03, lat: 41.06, status,
});
const cell = (key: string, roofs: number, withPanels: number, largeRoofShare = 0): Cell => ({
  key, roofs, withPanels, largeRoofShare,
});

describe("wilson", () => {
  it("matches the known 5/50 interval", () => {
    const w = wilson(5, 50);
    expect(w.p).toBeCloseTo(0.1, 10);
    expect(w.lo).toBeCloseTo(0.0435, 4);
    expect(w.hi).toBeCloseTo(0.2136, 4);
  });
  it("handles 0/10 and 10/10", () => {
    expect(wilson(0, 10).lo).toBe(0);
    expect(wilson(0, 10).hi).toBeCloseTo(0.2775, 4);
    expect(wilson(10, 10).hi).toBe(1);
    expect(wilson(10, 10).lo).toBeCloseTo(0.7225, 4);
  });
  it("n = 0 gives the full interval", () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });
});

describe("areaStats", () => {
  it("counts only panel roofs, review separately", () => {
    const s = areaStats([roof(1, "panel"), roof(2, "review"), roof(3, "none"), roof(4, "none", 600)]);
    expect(s.roofs).toBe(4);
    expect(s.withPanels).toBe(1);
    expect(s.review).toBe(1);
    expect(s.share).toBe(0.25);
    expect(s.lo).toBeCloseTo(wilson(1, 4).lo, 10);
    expect(s.largeRoofShare).toBeCloseTo(600 / 900, 10);
  });
  it("empty area", () => {
    expect(areaStats([])).toMatchObject({ roofs: 0, share: 0, lo: 0, hi: 1, largeRoofShare: 0 });
  });
});

describe("percentile", () => {
  it("counts ties as half", () => {
    expect(percentile(0.1, [0.05, 0.1, 0.1, 0.2])).toBe(50); // (1 + 1) / 4
    expect(percentile(0.1, [0.1, 0.1])).toBe(50);
    expect(percentile(0.3, [0.1, 0.2])).toBe(100);
    expect(percentile(0, [0.1, 0.2])).toBe(0);
    expect(percentile(0.1, [])).toBeNaN();
  });
});

describe("quantile", () => {
  it("interpolates linearly", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([4, 1, 3, 2], 0.75)).toBe(3.25);
    expect(quantile([7], 0.75)).toBe(7);
  });
});

describe("rankAgainst", () => {
  const cells = [
    cell("a", 20, 0), cell("b", 20, 2), cell("c", 20, 4), cell("d", 20, 6),
    cell("small", 10, 9), // not ranked (< 15 roofs)
  ];
  it("ignores unranked cells and computes headroom", () => {
    const r = rankAgainst(0.1, 40, 4, cells)!;
    expect(r.n).toBe(4);
    expect(r.percentile).toBe(37.5); // one below, one tie -> (1 + 0.5) / 4
  });
  it("median, q75 and headroom", () => {
    // shares 0, 0.1, 0.2, 0.3 -> median 0.15, q75 0.225
    const r = rankAgainst(0.05, 40, 2, cells)!;
    expect(r.median).toBeCloseTo(0.15, 10);
    expect(r.q75).toBeCloseTo(0.225, 10);
    expect(r.headroom).toBe(Math.round(0.225 * 40) - 2); // 9 - 2 = 7
    expect(r.percentile).toBe(25);
  });
  it("headroom never negative", () => {
    expect(rankAgainst(0.5, 40, 20, cells)!.headroom).toBe(0);
  });
  it("null with no ranked cells", () => {
    expect(rankAgainst(0.1, 40, 4, [cell("x", 3, 1)])).toBeNull();
  });
});

describe("peers", () => {
  it("returns the k ranked cells closest in large-roof share", () => {
    const cells = Array.from({ length: 30 }, (_, i) => cell(`c${i}`, 20, 1, i / 29));
    cells.push(cell("tiny", 5, 1, 0.5)); // closest but unranked
    const p = peers(0.5, cells);
    expect(p).toHaveLength(20);
    expect(p.find((c) => c.key === "tiny")).toBeUndefined();
    const maxD = Math.max(...p.map((c) => Math.abs(c.largeRoofShare - 0.5)));
    const left = cells.filter((c) => c.roofs >= 15 && !p.includes(c));
    for (const c of left) expect(Math.abs(c.largeRoofShare - 0.5)).toBeGreaterThanOrEqual(maxD);
    expect(peers(0, cells, 3).map((c) => c.key)).toEqual(["c0", "c1", "c2"]);
  });
});
