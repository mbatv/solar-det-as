// Lead sizing for roofs with no panels observed. See docs/DETECTION.md ("Lead sizing").
import type { Roof } from "./stats";

export const ASSUMPTIONS = {
  usableFraction: 0.4, // usable area = footprint × 0.40
  m2PerKwp: 5, // 5 m² of usable roof per kWp
  houseCapKwp: 10, // house quotes capped at 10 kWp
  largeRoofM2: 400, // roofs >= 400 m² are uncapped (collective/business)
  largeFloors: 3, // roofs with >= 3 floors are uncapped (collective/business)
  yieldKwhPerKwp: 1560, // PVGIS yield for Cambrils, ≈ 1,560 kWh/kWp/yr
  defaultEurPerKwh: 0.12, // assumption, editable
} as const;

export type Assumptions = typeof ASSUMPTIONS;

export type Segment = "house" | "collective/business";

export type Lead = {
  id: number;
  lon: number;
  lat: number;
  area: number;
  floors: number | null;
  segment: Segment;
  kwp: number; // 1 decimal
  kwhYr: number; // rounded
  eurYr: number; // rounded
};

export type LeadsResult = {
  leads: Lead[]; // status "none", largest area first
  needsReview: Roof[]; // status "review", largest area first; check on site before quoting
};

export function segmentOf(roof: Pick<Roof, "area" | "floors">, a: Assumptions = ASSUMPTIONS): Segment {
  return roof.area >= a.largeRoofM2 || (roof.floors ?? 0) >= a.largeFloors
    ? "collective/business"
    : "house";
}

export function sizeRoof(
  roof: Roof,
  eurPerKwh: number = ASSUMPTIONS.defaultEurPerKwh,
  a: Assumptions = ASSUMPTIONS,
): Lead {
  const segment = segmentOf(roof, a);
  let raw = (roof.area * a.usableFraction) / a.m2PerKwp;
  if (segment === "house") raw = Math.min(raw, a.houseCapKwp);
  const kwp = Math.round(raw * 10) / 10;
  const kwhYr = Math.round(kwp * a.yieldKwhPerKwp);
  const eurYr = Math.round(kwhYr * eurPerKwh);
  return {
    id: roof.id,
    lon: roof.lon,
    lat: roof.lat,
    area: roof.area,
    floors: roof.floors,
    segment,
    kwp,
    kwhYr,
    eurYr,
  };
}

const byAreaDesc = (x: { area: number; id: number }, y: { area: number; id: number }) =>
  y.area - x.area || x.id - y.id;

export function leadsFor(
  roofs: Roof[],
  eurPerKwh: number = ASSUMPTIONS.defaultEurPerKwh,
): LeadsResult {
  const leads = roofs
    .filter((r) => r.status === "none")
    .sort(byAreaDesc)
    .map((r) => sizeRoof(r, eurPerKwh));
  const needsReview = roofs.filter((r) => r.status === "review").sort(byAreaDesc);
  return { leads, needsReview };
}

export function totalKwp(leads: Lead[]): number {
  return Math.round(leads.reduce((s, l) => s + l.kwp, 0) * 10) / 10;
}

export type CsvMeta = {
  centre: { lon: number; lat: number };
  radiusM: number;
  flightDate?: string; // imagery flight date, e.g. "2025-07-14"
  eurPerKwh?: number; // defaults to ASSUMPTIONS.defaultEurPerKwh
  generatedAt?: string; // ISO timestamp
};

/** RFC 4180 field escaping; also neutralises spreadsheet formula injection. */
export function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function comment(line: string): string {
  return "# " + line.replace(/[\r\n]+/g, " ");
}

export function leadsCsv(leads: Lead[], assumptions: Assumptions, meta: CsvMeta): string {
  const eur = meta.eurPerKwh ?? assumptions.defaultEurPerKwh;
  const observed = meta.flightDate
    ? `no panels observed on the aerial photo of ${meta.flightDate}`
    : "no panels observed on the aerial photo (flight date unknown)";
  const lines = [
    comment("Solar Radar lead list (Cambrils)"),
    comment(`area centre: lat ${meta.centre.lat.toFixed(6)}, lon ${meta.centre.lon.toFixed(6)}; radius ${meta.radiusM} m`),
    ...(meta.flightDate ? [comment(`imagery flight date: ${meta.flightDate}`)] : []),
    comment(`every row: ${observed}; roofs flagged for review are excluded`),
    comment(`usable area = footprint x ${assumptions.usableFraction}`),
    comment(`${assumptions.m2PerKwp} m2 per kWp`),
    comment(
      `house quotes capped at ${assumptions.houseCapKwp} kWp; roofs >= ${assumptions.largeRoofM2} m2 or >= ${assumptions.largeFloors} floors uncapped (segment collective/business)`,
    ),
    comment(`kWh/yr = kWp x ${assumptions.yieldKwhPerKwp} (PVGIS yield for Cambrils)`),
    comment(`EUR/yr = kWh/yr x ${eur} EUR/kWh (assumption)`),
    ...(meta.generatedAt ? [comment(`generated: ${meta.generatedAt}`)] : []),
    ["rank", "roof_id", "lat", "lon", "footprint_m2", "floors", "segment", "kwp", "kwh_yr", "eur_yr"].join(","),
    ...leads.map((l, i) =>
      [
        i + 1,
        l.id,
        l.lat.toFixed(6),
        l.lon.toFixed(6),
        Math.round(l.area),
        l.floors ?? "",
        l.segment,
        l.kwp.toFixed(1),
        l.kwhYr,
        l.eurYr,
      ]
        .map(csvField)
        .join(","),
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}
