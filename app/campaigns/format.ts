// Small display helpers shared by the campaigns pages (server- and client-safe, no deps).

export const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(Number(n)).toLocaleString("en-GB");

export const fmtKwp = (n: number | null | undefined) =>
  n == null ? "—" : (Math.round(Number(n) * 10) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1 });

/** Timestamp for logs, e.g. "4 Nov 2026, 20:03". UTC so server and client agree. */
export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${fmtDay(iso)}, ${d.toISOString().slice(11, 16)}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Plain day, e.g. "4 Nov 2026" (accepts "2026-11-04" or a full ISO timestamp). */
export const fmtDay = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

/** Human label for a lead status. */
export const STATUS_LABEL: Record<string, string> = {
  to_visit: "to visit",
  visited: "visited",
  quoted: "quoted",
  won: "won",
  lost: "lost",
};

/** Button label for moving a lead to a status. */
export const STEP_LABEL: Record<string, string> = {
  visited: "mark visited",
  quoted: "mark quoted",
  won: "won",
  lost: "lost",
};

export type StatusFilter = "all" | "to_visit" | "in_progress" | "closed";

export const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "all" },
  { key: "to_visit", label: "to visit" },
  { key: "in_progress", label: "in progress" },
  { key: "closed", label: "closed" },
];

export function matchesFilter(status: string, f: StatusFilter): boolean {
  if (f === "all") return true;
  if (f === "to_visit") return status === "to_visit";
  if (f === "in_progress") return status === "visited" || status === "quoted";
  return status === "won" || status === "lost";
}

const PCT_KEYS = /share|^lo$|^hi$|fraction|pct|median|q75|q25/i;

/** Format an arbitrary stats/assumptions value for a key/value list. */
export function fmtValue(key: string, v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (PCT_KEYS.test(key) && v >= 0 && v <= 1 && !/Kwh|eur/i.test(key)) {
      return `${(v * 100).toFixed(1)}%`;
    }
    if (Number.isInteger(v)) return v.toLocaleString("en-GB");
    return String(Math.round(v * 1000) / 1000);
  }
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string" || typeof x === "number")) return v.join(" · ");
    return `${v.length} items`;
  }
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

/** Flatten one level of nesting so {rank: {p: 40}} shows as rank.p. */
export function flatEntries(obj: Record<string, unknown> | null | undefined): [string, unknown][] {
  if (!obj) return [];
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out.push([`${k}.${k2}`, v2]);
    } else {
      out.push([k, v]);
    }
  }
  return out;
}

export const mapsHref = (lat: number, lon: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

export const radarHref = (lat: number, lon: number) => `/map?lat=${lat}&lon=${lon}`;

// Plain-language versions of the assumption keys saved with a campaign.
const ASSUMPTION_TEXT: Record<string, (v: string) => string> = {
  usableFraction: (v) => `usable roof area = footprint x ${v}`,
  m2PerKwp: (v) => `${v} m2 of usable roof per kWp`,
  houseCapKwp: (v) => `house systems capped at ${v} kWp`,
  largeRoofM2: (v) => `roofs >= ${v} m2 count as collective/business (no cap)`,
  largeFloors: (v) => `buildings with >= ${v} floors count as collective/business (no cap)`,
  yieldKwhPerKwp: (v) => `${v} kWh per kWp per year`,
  eurPerKwh: (v) => `electricity price ${v} EUR/kWh`,
  defaultEurPerKwh: (v) => `default electricity price ${v} EUR/kWh`,
};

export function assumptionText(key: string, v: unknown): string {
  const val = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v);
  return ASSUMPTION_TEXT[key]?.(val) ?? `${key} = ${val}`;
}
