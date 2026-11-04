"""ICGC Referencial topografic territorial (topografia-territorial, vigent 2024)
construction polygons (layer _60_construccions_p) in the pilot box -> .cache/buildings/icgc.json

The Catalonia-wide GeoPackage (~10.7 GB) is read remotely with GDAL /vsicurl/ + bbox filter
(HTTP range requests through the GPKG R-tree), so only the Cambrils pages are fetched.
(The per-municipality DGN/DWG downloads are DGN v8 / DWG -> need ODA libs, not available.)
Usage: python -I scripts/buildings_icgc.py <out.json>
"""
import json, os, sys
import pyogrio
from pyogrio.raw import read
from pyproj import Transformer
from shapely import from_wkb

URL = "/vsicurl/https://datacloud.icgc.cat/datacloud/topografia-territorial/vigent/gpkg_unzip/topografia-territorial.gpkg"
LAYER = "_60_construccions_p"
S, N, W, E = 41.047, 41.098, 1.017, 1.093
fw = Transformer.from_crs(4326, 25831, always_xy=True)
xs, ys = fw.transform([W, E, W, E], [S, S, N, N])
box = (min(xs), min(ys), max(xs), max(ys))
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR"); os.environ.setdefault("CPL_VSIL_CURL_CHUNK_SIZE", "1048576")
meta, fids, geom, fields = read(URL, layer=LAYER, bbox=box)
names = list(meta["fields"])
print("crs", meta["crs"], "fields", names)
out = []
for i, g in enumerate(geom):
    if g is None:
        continue
    shp = from_wkb(g)
    rec = {n: (v[i].item() if hasattr(v[i], "item") else v[i]) for n, v in zip(names, fields)}
    rec["wkt"] = shp.wkt
    out.append(rec)
json.dump({"crs": str(meta["crs"]), "box": box, "features": out}, open(sys.argv[1], "w"), default=str)
print("icgc construction polygons:", len(out))
