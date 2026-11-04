import { describe, expect, it } from "vitest";
import { LABELS, verdict } from "./verdict";
import type { AreaStats, Rank } from "./stats";
import { leadsFor } from "./leads";

const stats = (o: Partial<AreaStats> = {}): AreaStats => ({
  roofs: 100, withPanels: 5, review: 0, share: 0.05, lo: 0.02, hi: 0.11, largeRoofShare: 0.2, ...o,
});
const rank = (o: Partial<Rank> = {}): Rank => ({ percentile: 50, median: 0.1, q75: 0.15, headroom: 10, n: 20, ...o });

const check = (v: ReturnType<typeof verdict>) => {
  for (const t of [...v.workItems, ...v.reasons]) expect(t.toLowerCase()).not.toContain("install everywhere");
  return v;
};

describe("verdict", () => {
  it("scanning", () => {
    expect(verdict({ state: "scanning" }).label).toBe("MEASURING…");
  });
  it("failed never guesses", () => {
    const v = verdict({ state: "failed", stats: stats(), peerRank: rank({ percentile: 5 }) });
    expect(v.label).toBe("NO VERDICT");
  });
  it("too few roofs", () => {
    const v = check(verdict({ state: "ok", stats: stats({ roofs: 14, withPanels: 1 }), townRank: rank() }));
    expect(v.label).toBe("TOO FEW ROOFS TO JUDGE");
  });
  it("no rank available -> NO VERDICT", () => {
    expect(verdict({ state: "ok", stats: stats() }).label).toBe(LABELS.noVerdict);
  });
  it("low + mostly apartment blocks", () => {
    const v = check(verdict({ state: "ok", stats: stats({ largeRoofShare: 0.6 }), peerRank: rank({ percentile: 20 }) }));
    expect(v.label).toBe("LOW ADOPTION / MOSTLY APARTMENT BLOCKS");
    expect(v.workItems.join(" ")).toContain("autoconsumo colectivo");
    expect(v.basis).toBe("peers");
  });
  it("low + interval entirely below median -> strong target", () => {
    const { leads } = leadsFor(
      Array.from({ length: 30 }, (_, i) => ({ id: i, area: 100 + i, floors: 1, lon: 1, lat: 41, status: "none" as const })),
    );
    const v = check(
      verdict({ state: "ok", stats: stats({ hi: 0.09, review: 3 }), peerRank: rank({ percentile: 10, headroom: 12 }), leads }),
    );
    expect(v.label).toBe("STRONG TARGET / LOW ADOPTION");
    expect(v.workItems[0]).toMatch(/^Door-knock the 12 largest roofs without panels first \(≈ \d+ kWp\)\.$/);
    expect(v.workItems).toHaveLength(3);
    expect(v.workItems[2]).toBe("Check 3 roofs flagged for review on site before quoting.");
    expect(v.reasons.join(" ")).toContain("9%");
  });
  it("low but interval reaches median -> likely target", () => {
    const v = check(verdict({ state: "ok", stats: stats({ hi: 0.12 }), peerRank: rank({ percentile: 33 }) }));
    expect(v.label).toBe("LIKELY TARGET / BELOW TYPICAL");
    expect(v.workItems.length).toBeGreaterThanOrEqual(2);
  });
  it("high -> mature", () => {
    const v = check(verdict({ state: "ok", stats: stats({ withPanels: 30, share: 0.3 }), peerRank: rank({ percentile: 67 }) }));
    expect(v.label).toBe("MATURE AREA / SELL UPGRADES");
    expect(v.workItems[0]).toContain("30 roofs");
  });
  it("middle -> typical", () => {
    const v = check(verdict({ state: "ok", stats: stats(), peerRank: rank({ percentile: 50 }) }));
    expect(v.label).toBe("TYPICAL / TARGET SELECTIVELY");
    expect(v.workItems.length).toBeGreaterThanOrEqual(2);
  });
  it("falls back to town when fewer than 20 peers", () => {
    const v = verdict({
      state: "ok", stats: stats(), peerRank: rank({ percentile: 90, n: 12 }), townRank: rank({ percentile: 10, n: 80 }),
    });
    expect(v.basis).toBe("town");
    expect(v.label).toBe("LIKELY TARGET / BELOW TYPICAL"); // hi 0.11 >= median 0.1
    expect(verdict({ state: "ok", stats: stats(), peerRank: null, townRank: rank({ n: 80 }) }).basis).toBe("town");
  });
});
