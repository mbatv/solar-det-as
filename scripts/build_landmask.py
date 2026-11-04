"""Build public/data/landmask.json for the ASCII Earth on the landing page.

Source: Natural Earth (public domain), GeoJSON mirror at
https://github.com/nvkelso/natural-earth-vector/tree/master/geojson

  ne_50m_land.geojson               (falls back to ne_110m_land.geojson)
  ne_50m_admin_0_countries.geojson  (Spain polygon)

Download them into .cache/ne/ first, e.g.
  mkdir -p .cache/ne && cd .cache/ne && \
  for f in ne_50m_land ne_110m_land ne_50m_admin_0_countries; do
    curl -sSfLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson; done

Run:  .venv/bin/python -I scripts/build_landmask.py [.cache/ne] [public/data/landmask.json]

Output: equirectangular grid, row 0 = 90N, col 0 = 180W, cell values
0 = sea, 1 = land, 2 = Spain. Encoded as run-length text: each run is a
letter for the value ('a'=sea, 'b'=land, 'c'=Spain) followed by the run
length in decimal. Rows are concatenated row-major (runs may span rows).
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

W, H = 720, 360  # 0.5 degree cells
SS = 4  # supersampling factor for anti-aliased majority vote


def rings_of(geom):
    t = geom["type"]
    if t == "Polygon":
        return [geom["coordinates"]]
    if t == "MultiPolygon":
        return geom["coordinates"]
    return []


def draw_polys(draw, polys, sw, sh):
    def px(ring):
        return [((lon + 180.0) / 360.0 * sw, (90.0 - lat) / 180.0 * sh) for lon, lat, *_ in ring]

    for poly in polys:
        outer, *holes = poly
        if len(outer) >= 3:
            draw.polygon(px(outer), fill=255)
        for h in holes:
            if len(h) >= 3:
                draw.polygon(px(h), fill=0)


def raster(features, sw, sh):
    img = Image.new("L", (sw, sh), 0)
    d = ImageDraw.Draw(img)
    for f in features:
        draw_polys(d, rings_of(f["geometry"]), sw, sh)
    # box-filter downsample == fraction of covered subcells
    return img.resize((W, H), Image.Resampling.BOX)


def main():
    src = Path(sys.argv[1] if len(sys.argv) > 1 else ".cache/ne")
    out = Path(sys.argv[2] if len(sys.argv) > 2 else "public/data/landmask.json")

    land_path = src / "ne_50m_land.geojson"
    if not land_path.exists():
        land_path = src / "ne_110m_land.geojson"
    land = json.loads(land_path.read_text())["features"]
    countries = json.loads((src / "ne_50m_admin_0_countries.geojson").read_text())["features"]
    spain = [f for f in countries if f["properties"].get("ADM0_A3") == "ESP"]
    if not spain:
        raise SystemExit("Spain not found in admin-0 countries")
    # keep only mainland + Balearics (drop Canaries / Ceuta / Melilla so the
    # bright patch reads as Iberia): polygons whose first vertex is north of 35N
    sp_geom = spain[0]["geometry"]
    sp_polys = [p for p in rings_of(sp_geom) if p[0][0][1] > 35.5]
    spain = [{"geometry": {"type": "MultiPolygon", "coordinates": sp_polys}}]

    sw, sh = W * SS, H * SS
    land_a = raster(land, sw, sh).load()
    spain_a = raster(spain, sw, sh).load()

    cells = []
    n_land = n_spain = 0
    for y in range(H):
        for x in range(W):
            if spain_a[x, y] >= 96:
                v = 2
                n_spain += 1
            elif land_a[x, y] >= 128:
                v = 1
                n_land += 1
            else:
                v = 0
            cells.append(v)

    letters = "abc"
    parts = []
    prev, run = cells[0], 0
    for v in cells:
        if v == prev:
            run += 1
        else:
            parts.append(f"{letters[prev]}{run}")
            prev, run = v, 1
    parts.append(f"{letters[prev]}{run}")
    rle = "".join(parts)

    payload = {
        "source": "Natural Earth (public domain): " + land_path.name + " + ne_50m_admin_0_countries (ESP)",
        "width": W,
        "height": H,
        "projection": "equirectangular; row 0 = 90N, col 0 = 180W",
        "values": {"a": "sea", "b": "land", "c": "spain"},
        "rle": rle,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"wrote {out} {out.stat().st_size} bytes; land={n_land} spain={n_spain} runs={len(parts)}")


if __name__ == "__main__":
    main()
