// Small display helpers shared by the campaigns pages (server-safe, no deps).

export const fmtInt = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(Number(n)).toLocaleString("en-GB");

export const fmtKwp = (n: number | null | undefined) =>
  n == null ? "—" : (Math.round(Number(n) * 10) / 10).toLocaleString("en-GB", { minimumFractionDigits: 1 });

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
};

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
