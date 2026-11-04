// Fixed 128 m tile grid over the Cambrils pilot (docs/DETECTION.md).
export const PILOT = { south: 41.055, north: 41.09, west: 1.025, east: 1.085 };
export const TILE_PX = 512;
export const TILE_GROUND_M = 128;
const R = 6378137;
const REF_LAT = 41.0725;
// Mercator stretches with latitude: 128 m on the ground is wider in EPSG:3857 metres.
export const TILE_3857 = TILE_GROUND_M / Math.cos((REF_LAT * Math.PI) / 180);

export const toMerc = (lon: number, lat: number): [number, number] => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
export const fromMerc = (x: number, y: number): [number, number] => [
  (x / R) * (180 / Math.PI),
  (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI),
];

const [X0, Y0] = toMerc(PILOT.west, PILOT.south);
const [X1, Y1] = toMerc(PILOT.east, PILOT.north);
export const COLS = Math.ceil((X1 - X0) / TILE_3857);
export const ROWS = Math.ceil((Y1 - Y0) / TILE_3857);

export type Tile = { col: number; row: number; bbox: [number, number, number, number] };

// offset = 0.5 gives the half-tile shifted grid used to recover arrays split by a tile edge.
export function tile(col: number, row: number, offset = 0): Tile {
  const x = X0 + (col + offset) * TILE_3857;
  const y = Y0 + (row + offset) * TILE_3857;
  return { col, row, bbox: [x, y, x + TILE_3857, y + TILE_3857] };
}

export function tileAt(lon: number, lat: number): { col: number; row: number } {
  const [x, y] = toMerc(lon, lat);
  return { col: Math.floor((x - X0) / TILE_3857), row: Math.floor((y - Y0) / TILE_3857) };
}

export const WMS = "https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms";
export const LAYER = "ortofoto_color_provisional";

export function tileUrl(t: Tile): string {
  const p = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: LAYER, STYLES: "",
    CRS: "EPSG:3857", BBOX: t.bbox.join(","), WIDTH: String(TILE_PX), HEIGHT: String(TILE_PX),
    FORMAT: "image/jpeg",
  });
  return `${WMS}?${p}`;
}

// Pixel (in a 512 px tile, y down) -> lon/lat.
export function pxToLonLat(t: Tile, px: number, py: number): [number, number] {
  const [x0, y0, x1, y1] = t.bbox;
  return fromMerc(x0 + (px / TILE_PX) * (x1 - x0), y1 - (py / TILE_PX) * (y1 - y0));
}

// EPSG:3857 point -> which tile of grid g0 it falls in, and the pixel inside that tile (y down).
export function mercToTilePx(x: number, y: number) {
  const fx = (x - X0) / TILE_3857, fy = (y - Y0) / TILE_3857;
  const col = Math.floor(fx), row = Math.floor(fy);
  return { col, row, px: (fx - col) * TILE_PX, py: (1 - (fy - row)) * TILE_PX };
}
