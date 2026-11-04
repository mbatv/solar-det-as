// Flight (acquisition) date of the ICGC provisional orthophoto at a point.
//
// The WMS layer `ortofoto_color_provisional` is queryable: GetFeatureInfo on it
// returns the aerial-photo footprint ("fotograma") covering the point, with the
// capture timestamp in the `data` field, e.g.
//   { fotograma: "2026016_292_133_20260727_110202_RGB_DMCIII-27541",
//     data: "2026-07-27 11:02:02", color: "RGB" }
// The server sends `Access-Control-Allow-Origin: *`, so this works from the
// browser as well as Node.

const WMS = "https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms";
const LAYER = "ortofoto_color_provisional";
const TIMEOUT_MS = 8000;

export type FlightDate = { date: string | null; source: string; raw?: string };

function toWebMercator(lat: number, lon: number): [number, number] {
  const x = (lon * 20037508.34) / 180;
  const y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 6378137;
  return [x, y];
}

export async function getFlightDate(lat: number, lon: number): Promise<FlightDate> {
  const source = `ICGC WMS GetFeatureInfo, layer ${LAYER} (photo footprint)`;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { date: null, source: `${source}: invalid coordinates` };
  }

  // 2 m box around the point, 3x3 px image, query the centre pixel.
  const [x, y] = toWebMercator(lat, lon);
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetFeatureInfo",
    LAYERS: LAYER,
    QUERY_LAYERS: LAYER,
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: [x - 1, y - 1, x + 1, y + 1].map((v) => v.toFixed(2)).join(","),
    WIDTH: "3",
    HEIGHT: "3",
    I: "1",
    J: "1",
    INFO_FORMAT: "application/json",
    FEATURE_COUNT: "10",
  });
  const url = `${WMS}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { date: null, source: `${source}: HTTP ${res.status}` };
    const raw = await res.text();

    // Outside the flown area the server answers with an (empty) XML ServiceException.
    if (raw.includes("ServiceException")) {
      return { date: null, source: `${source}: no photo covers this point`, raw };
    }

    let features: Array<{ properties?: Record<string, unknown> }> = [];
    try {
      features = (JSON.parse(raw) as { features?: typeof features }).features ?? [];
    } catch {
      return { date: null, source: `${source}: unreadable response`, raw };
    }

    // `data` looks like "2026-07-27 11:02:02"; keep the day.
    const days = new Set<string>();
    const frames: string[] = [];
    for (const f of features) {
      const d = f.properties?.data;
      const m = typeof d === "string" ? d.match(/^(\d{4}-\d{2}-\d{2})/) : null;
      if (m) days.add(m[1]);
      const frame = f.properties?.fotograma;
      if (typeof frame === "string") frames.push(frame);
    }
    if (days.size === 0) {
      return { date: null, source: `${source}: no flight date at this point`, raw };
    }

    const sorted = [...days].sort();
    const date = sorted.length === 1 ? sorted[0] : `${sorted[0]} – ${sorted[sorted.length - 1]}`;
    return { date, source: `${source}, frame ${frames.join(", ")}`, raw };
  } catch (err) {
    const reason = err instanceof Error && err.name === "AbortError" ? "timed out" : "request failed";
    return { date: null, source: `${source}: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}
