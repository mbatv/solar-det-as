"""Merge building footprints from several open sources into public/data/roofs_v2.json.

Base: public/data/roofs.json (Overture 2026-10-21.0) -> kept verbatim, same ids, src="overture".
Appended in priority order (new ids continue after max id):
  catastro  .cache/buildings/catastro.json   (scripts/buildings_catastro.py)
  icgc      .cache/buildings/icgc.json       (scripts/buildings_icgc.py)   [optional]
  osm       .cache/buildings/osm.json        (scripts/buildings_osm.py)    [optional]
  msft      .cache/buildings/ms_*.csv.gz     (Microsoft Global ML Building Footprints) [optional]
A candidate is skipped if it overlaps any already-kept footprint by > 30% of either polygon's area.
Only footprints >= 40 m2 are kept. Catastro floors/year fill Overture roofs they overlap (> 50% of
the Overture footprint); `floors` is only filled where Overture has null.
Also measures how many of the off-roof detections (.cache/offroof.json) land inside each source.
Usage: python -I scripts/merge_roofs.py   (run from repo root)
"""
import glob, gzip, json, os
from collections import Counter
from pyproj import Transformer
from shapely import STRtree, wkt as swkt
from shapely.geometry import Point, Polygon
from shapely.ops import transform as stransform
from shapely.validation import make_valid

B = ".cache/buildings"
S, N, W, E = 41.051, 41.094, 1.021, 1.089          # roofs.json bbox (pilot +- 0.004)
PS, PN, PW, PE = 41.055, 41.09, 1.025, 1.085       # strict pilot box
MIN_AREA, MAX_OVL = 40.0, 0.30
fw = Transformer.from_crs(4326, 25831, always_xy=True).transform
bw = Transformer.from_crs(25831, 4326, always_xy=True).transform


def clean(p):
    if not p.is_valid:
        p = make_valid(p)
        if p.geom_type != "Polygon":
            polys = [g for g in getattr(p, "geoms", []) if g.geom_type == "Polygon"]
            if not polys:
                return None
            p = max(polys, key=lambda g: g.area)
    return p


def utm(ring_ll):
    return clean(stransform(fw, Polygon(ring_ll)))


def in_box(lon, lat, s=S, n=N, w=W, e=E):
    return s <= lat <= n and w <= lon <= e


def ll_ring(p):
    xs, ys = bw(*zip(*p.exterior.coords))
    return [[round(x, 6), round(y, 6)] for x, y in zip(xs, ys)]


# ---------------- base: Overture ----------------
base = json.load(open("public/data/roofs.json"))
assert [r["id"] for r in base] == list(range(len(base)))
kept = []  # (utm polygon, record)
for r in base:
    rec = dict(r); rec["src"] = "overture"
    kept.append((utm(r["ring"]), rec))

# ---------------- candidates per source ----------------
cands = {}

cat = json.load(open(f"{B}/catastro.json"))
cands["catastro"] = []
for b in cat:
    for k, ring in enumerate(b["polys"]):
        p = utm(ring)
        if p is None:
            continue
        c = p.centroid; lon, lat = bw(c.x, c.y)
        if not in_box(lon, lat):
            continue
        cands["catastro"].append((p, {"oid": f"catastro:{b['ref']}" + (f"#{k}" if k else ""),
                                      "floors": b["floors"], "year": b["year"], "use": b["use"]}))

if os.path.exists(f"{B}/icgc.json"):
    ic = json.load(open(f"{B}/icgc.json"))
    cands["icgc"] = []
    for i, f in enumerate(ic["features"]):
        g = swkt.loads(f["wkt"])
        for p in (getattr(g, "geoms", None) or [g]):
            if p.geom_type != "Polygon":
                continue
            p = clean(Polygon(p.exterior.coords))  # already EPSG:25831
            if p is None:
                continue
            c = p.centroid; lon, lat = bw(c.x, c.y)
            if in_box(lon, lat):
                cands["icgc"].append((p, {"oid": f"icgc:{f.get('fid', f.get('id', i))}", "kind": f.get("_kind")}))

if os.path.exists(f"{B}/osm.json"):
    osm = json.load(open(f"{B}/osm.json"))
    cands["osm"] = []
    for e in osm["elements"]:
        rings = []
        if e["type"] == "way" and "geometry" in e:
            rings = [e["geometry"]]
        elif e["type"] == "relation":
            rings = [m["geometry"] for m in e.get("members", []) if m.get("role") == "outer" and "geometry" in m]
        for g in rings:
            ring = [[q["lon"], q["lat"]] for q in g]
            if len(ring) < 4 or ring[0] != ring[-1]:
                continue
            p = utm(ring)
            if p is None:
                continue
            c = p.centroid; lon, lat = bw(c.x, c.y)
            if in_box(lon, lat):
                lv = e.get("tags", {}).get("building:levels")
                fl = int(lv) if lv and lv.isdigit() else None
                cands["osm"].append((p, {"oid": f"osm:{e['type'][0]}{e['id']}", "floors": fl}))

ms_files = sorted(glob.glob(f"{B}/ms_*.csv.gz"))
if ms_files:
    cands["msft"] = []
    n = 0
    for fn in ms_files:
        for line in gzip.open(fn, "rt"):
            f = json.loads(line)
            ring = f["geometry"]["coordinates"][0]
            lon, lat = ring[0]
            if not in_box(lon, lat):
                continue
            p = utm(ring)
            if p is None:
                continue
            n += 1
            cands["msft"].append((p, {"oid": f"msft:{os.path.basename(fn)[3:-7]}:{n}", "floors": None}))

# ---------------- detections that fall on no Overture roof ----------------
off = json.load(open(".cache/offroof.json"))
off_pts = [Point(fw(d["lon"], d["lat"])) for d in off]


def hits(polys):
    t = STRtree(polys)
    return {i for i, pt in enumerate(off_pts) if len(t.query(pt, predicate="within"))}


def strict(p):
    c = p.centroid; lon, lat = bw(c.x, c.y)
    return in_box(lon, lat, PS, PN, PW, PE)


stats = {"overture": {"pilot_ge40": sum(strict(p) for p, _ in kept), "off_hits": len(hits([p for p, _ in kept]))}}
for s, cs in cands.items():
    big = [p for p, _ in cs if p.area >= MIN_AREA]
    stats[s] = {"bbox_all": len(cs), "bbox_ge40": len(big), "pilot_ge40": sum(strict(p) for p in big),
                "off_hits_raw": len(hits(big))}

# ---------------- Catastro attributes onto Overture ----------------
cat_polys = [p for p, _ in cands["catastro"]]
ct = STRtree(cat_polys)
filled_floors = year_set = floor_diff = 0
for p, rec in kept:
    best, ba = None, 0.0
    for j in ct.query(p, predicate="intersects"):
        a = p.intersection(cat_polys[j]).area
        if a > ba:
            best, ba = j, a
    if best is None or ba < 0.5 * p.area:
        continue
    cm = cands["catastro"][best][1]
    if cm["floors"] is not None and cm["floors"] > 0:
        if rec["floors"] is None:
            rec["floors"] = cm["floors"]; filled_floors += 1
        elif rec["floors"] != cm["floors"]:
            floor_diff += 1
    if cm["year"]:
        rec["year"] = cm["year"]; year_set += 1

# ---------------- append ----------------
next_id = max(r["id"] for _, r in kept) + 1
tree_polys = [p for p, _ in kept]
added = Counter()
for s in ["catastro", "icgc", "osm", "msft"]:
    if s not in cands:
        continue
    tree = STRtree(tree_polys)
    new = []
    for p, meta in cands[s]:
        if p.area < MIN_AREA:
            continue
        clash = False
        for j in tree.query(p, predicate="intersects"):
            q = tree_polys[j]
            a = p.intersection(q).area
            if a > MAX_OVL * p.area or a > MAX_OVL * q.area:
                clash = True; break
        if not clash:  # also check against footprints added earlier from this same source
            for q in new:
                if p.intersects(q):
                    a = p.intersection(q).area
                    if a > MAX_OVL * p.area or a > MAX_OVL * q.area:
                        clash = True; break
        if clash:
            continue
        rec = {"id": next_id, "oid": meta["oid"], "area": round(p.area, 1),
               "floors": (meta.get("floors") or None), "h": None, "ring": ll_ring(p), "src": s}
        if meta.get("year"):
            rec["year"] = meta["year"]
        next_id += 1
        kept.append((p, rec)); new.append(p); added[s] += 1
    tree_polys.extend(new)

out = [r for _, r in kept]
json.dump(out, open("public/data/roofs_v2.json", "w"), separators=(",", ":"))

# ---------------- measure after merge ----------------
all_polys = [p for p, _ in kept]
t = STRtree(all_polys)
by_src, covered = Counter(), 0
for pt in off_pts:
    idx = t.query(pt, predicate="within")
    if len(idx):
        covered += 1
        by_src[kept[int(min(idx))][1]["src"]] += 1
print(json.dumps(stats, indent=1))
print("overture roofs: floors filled from catastro:", filled_floors, "| floors differ (kept overture):", floor_diff,
      "| year set:", year_set)
print("appended:", dict(added), "total roofs:", len(out), "max id:", out[-1]["id"])
print(f"off-roof detections now inside a roof: {covered}/{len(off)}  by src: {dict(by_src)}")
print("strict pilot box roofs:", sum(strict(p) for p in all_polys),
      dict(Counter(r["src"] for p, r in kept if strict(p))))
print("file size MB:", round(os.path.getsize("public/data/roofs_v2.json") / 1e6, 2))
