// Roof lookup: point-in-polygon with a grid-bucket index (~50 m buckets).
export type Roof = { id: number; oid: string; area: number; floors: number | null; h: number | null; ring: [number, number][] };

export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const B = 0.0005;
export function roofIndex(roofs: Roof[]) {
  const buckets = new Map<string, Roof[]>();
  for (const r of roofs) {
    const xs = r.ring.map((p) => p[0]), ys = r.ring.map((p) => p[1]);
    for (let bx = Math.floor(Math.min(...xs) / B); bx <= Math.floor(Math.max(...xs) / B); bx++)
      for (let by = Math.floor(Math.min(...ys) / B); by <= Math.floor(Math.max(...ys) / B); by++) {
        const k = `${bx},${by}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(r);
      }
  }
  return (lon: number, lat: number): Roof | null =>
    buckets.get(`${Math.floor(lon / B)},${Math.floor(lat / B)}`)?.find((r) => pointInRing(lon, lat, r.ring)) ?? null;
}

export function centroid(ring: [number, number][]): [number, number] {
  const n = ring.length - (ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? 1 : 0);
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
  return [x / n, y / n];
}
