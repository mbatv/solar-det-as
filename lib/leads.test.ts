import { describe, expect, it } from "vitest";
import { ASSUMPTIONS, csvField, leadsCsv, leadsFor, sizeRoof } from "./leads";
import type { Roof } from "./stats";

const roof = (id: number, status: Roof["status"], area: number, floors: number | null = 1): Roof => ({
  id, area, floors, lon: 1.0388, lat: 41.0609, status,
});

describe("sizeRoof", () => {
  it("caps houses at 10 kWp", () => {
    const l = sizeRoof(roof(1, "none", 300, 2)); // 300 * 0.4 / 5 = 24 -> 10
    expect(l.segment).toBe("house");
    expect(l.kwp).toBe(10);
    expect(l.kwhYr).toBe(14630);
    expect(l.eurYr).toBe(1756);
  });
  it("small house below the cap", () => {
    expect(sizeRoof(roof(1, "none", 80)).kwp).toBe(6.4);
  });
  it("roofs >= 400 m2 are uncapped collective/business", () => {
    const l = sizeRoof(roof(2, "none", 400), 0.2);
    expect(l.segment).toBe("collective/business");
    expect(l.kwp).toBe(32);
    expect(l.kwhYr).toBe(32 * 1463);
    expect(l.eurYr).toBe(Math.round(32 * 1463 * 0.2));
  });
  it(">= 3 floors is uncapped even on a small footprint", () => {
    const l = sizeRoof(roof(3, "none", 200, 3));
    expect(l.segment).toBe("collective/business");
    expect(l.kwp).toBe(16);
  });
  it("rounds kWp to 1 decimal", () => {
    expect(sizeRoof(roof(4, "none", 61.3)).kwp).toBe(4.9);
  });
});

describe("leadsFor", () => {
  it("keeps only 'none' roofs, largest first, review returned separately", () => {
    const { leads, needsReview } = leadsFor([
      roof(1, "none", 90), roof(2, "panel", 500), roof(3, "review", 120), roof(4, "none", 450), roof(5, "none", 150),
    ]);
    expect(leads.map((l) => l.id)).toEqual([4, 5, 1]);
    expect(needsReview.map((r) => r.id)).toEqual([3]);
  });
});

describe("csv", () => {
  it("escapes fields", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField(null)).toBe("");
    expect(csvField(-3)).toBe("-3");
  });
  it("carries every assumption and the meta", () => {
    const { leads } = leadsFor([roof(1, "none", 450), roof(2, "none", 100)], 0.15);
    const csv = leadsCsv(leads, ASSUMPTIONS, {
      centre: { lon: 1.038792, lat: 41.060932 }, radiusM: 250, flightDate: "2025-07-14", eurPerKwh: 0.15,
    });
    const lines = csv.trim().split("\r\n");
    const comments = lines.filter((l) => l.startsWith("# "));
    const head = comments.join("\n");
    expect(lines[0].startsWith("# ")).toBe(true);
    for (const v of ["0.4", "5 m2 per kWp", "10 kWp", "400 m2", "3 floors", "1463", "0.15 EUR/kWh", "41.060932", "1.038792", "250 m", "2025-07-14"]) {
      expect(head).toContain(v);
    }
    expect(head).toContain("no panels observed on the aerial photo of 2025-07-14");
    const header = lines[comments.length];
    expect(header).toBe("rank,roof_id,lat,lon,footprint_m2,floors,segment,kwp,kwh_yr,eur_yr");
    expect(lines.length).toBe(comments.length + 3);
    expect(lines[comments.length + 1]).toBe("1,1,41.060900,1.038800,450,1,collective/business,36.0,52668,7900");
  });
});
