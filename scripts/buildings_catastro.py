"""Parse Catastro INSPIRE Buildings (Cambrils, INE 43038) -> .cache/buildings/catastro.json

Download (done by buildings_fetch.sh / manually):
  ATOM  https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.BU.atom.xml
  ->    https://www.catastro.hacienda.gob.es/INSPIRE/buildings/43/ES.SDGC.bu.atom_43.xml
  ->    https://www.catastro.hacienda.gob.es/INSPIRE/Buildings/43/43038-CAMBRILS/A.ES.SDGC.BU.43038.zip
Note: the Catastro server omits its FNMT intermediate cert; we fetch it from the AIA URL
(http://www.cert.fnmt.es/certs/ACSS2G2E.crt) and add it to a CA bundle (no -k).

Output: list of {ref, ring:[[lon,lat]...] (largest exterior ring), polys (all exterior rings),
area (m2, planar EPSG:25831), floors (max floors above ground over building parts), year, use}.
Usage: python -I scripts/buildings_catastro.py <dir with unzipped GML> <out.json>
"""
import json, sys, xml.etree.ElementTree as ET
from pyproj import Transformer
from shapely.geometry import Polygon

src, out = sys.argv[1], sys.argv[2]
GML = "{http://www.opengis.net/gml/3.2}"
BU = "{http://inspire.jrc.ec.europa.eu/schemas/bu-ext2d/2.0}"
CORE = "{http://inspire.jrc.ec.europa.eu/schemas/bu-core2d/2.0}"
tr = Transformer.from_crs(25831, 4326, always_xy=True)


def rings(el):
    """exterior posLists of every polygon patch (holes ignored; roofs need the outline only)."""
    res = []
    for ext in el.iter(GML + "exterior"):
        pl = ext.find(f".//{GML}posList")
        v = [float(t) for t in pl.text.split()]
        res.append(list(zip(v[0::2], v[1::2])))
    return res


def iter_features(path, tag):
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag == tag:
            yield el
            el.clear()


def num(el, tag):
    e = el.find(f".//{tag}")
    if e is None or not (e.text or "").strip():
        return None
    try:
        return float(e.text)
    except ValueError:
        return None


# floors per building from building parts (max over parts; parts with 0 floors are patios/pools)
floors = {}
for el in iter_features(f"{src}/A.ES.SDGC.BU.43038.buildingpart.gml", BU + "BuildingPart"):
    pid = el.get(GML + "id").replace("ES.SDGC.BU.", "")
    ref = pid.split("_part")[0]
    f = num(el, BU + "numberOfFloorsAboveGround")
    if f is not None:
        floors[ref] = max(floors.get(ref, 0), int(f))

bld = []
for el in iter_features(f"{src}/A.ES.SDGC.BU.43038.building.gml", BU + "Building"):
    ref = el.get(GML + "id").replace("ES.SDGC.BU.", "")
    rs = rings(el.find(f"{BU}geometry"))
    if not rs:
        continue
    polys = [Polygon(r) for r in rs if len(r) >= 4]
    if not polys:
        continue
    area = sum(p.area for p in polys)
    beg = el.find(f".//{CORE}dateOfConstruction//{CORE}beginning")
    # dateOfConstruction/beginning = construction year (end = latest refurbishment, ignored)
    year = int(beg.text[:4]) if beg is not None and beg.text and beg.text[:4].isdigit() else None
    use = el.findtext(f"{BU}currentUse")
    cond = el.findtext(f"{CORE}conditionOfConstruction")
    ll = []
    for p in sorted(polys, key=lambda p: -p.area):
        xs, ys = tr.transform(*zip(*p.exterior.coords))
        ll.append([[round(x, 6), round(y, 6)] for x, y in zip(xs, ys)])
    bld.append({"ref": ref, "area": round(area, 1), "parts_area": [round(p.area, 1) for p in sorted(polys, key=lambda p: -p.area)],
                "floors": floors.get(ref), "year": year, "use": use, "cond": cond, "polys": ll})

json.dump(bld, open(out, "w"), separators=(",", ":"))
print("catastro buildings:", len(bld), "with floors:", sum(b["floors"] is not None for b in bld))
