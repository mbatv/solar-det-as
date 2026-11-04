import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Tile, tileUrl } from "./tiles";

// Disk cache so re-runs and tuning never re-download; ICGC returns occasional 500s -> 3 retries with backoff.
export async function fetchTile(t: Tile, tag = "g0"): Promise<Buffer> {
  const dir = `.cache/tiles/${tag}`;
  const file = `${dir}/${t.col}_${t.row}.jpg`;
  if (existsSync(file)) return readFile(file);
  await mkdir(dir, { recursive: true });
  let err: unknown;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(tileUrl(t), { signal: AbortSignal.timeout(20000) });
      const ct = r.headers.get("content-type") ?? "";
      if (!r.ok || !ct.includes("image")) throw new Error(`HTTP ${r.status} ${ct}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(file, buf);
      return buf;
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 500 * 2 ** a));
    }
  }
  throw err;
}
