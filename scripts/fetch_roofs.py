"""Overture buildings for the Cambrils pilot (bbox +- 0.004 deg), footprints >= 40 m2 -> public/data/roofs.json."""
import json, os, duckdb

S, N, W, E = 41.055 - 0.004, 41.09 + 0.004, 1.025 - 0.004, 1.085 + 0.004
REL = os.environ.get("OVERTURE_RELEASE", "2026-10-21.0")
con = duckdb.connect()
con.sql("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET geometry_always_xy = true;")
rows = con.sql(f"""
  SELECT id, num_floors, height,
         ST_Area_Spheroid(geometry) AS area_m2,
         ST_AsGeoJSON(geometry) AS g
  FROM read_parquet('s3://overturemaps-us-west-2/release/{REL}/theme=buildings/type=building/*', hive_partitioning=1)
  WHERE bbox.xmin < {E} AND bbox.xmax > {W} AND bbox.ymin < {N} AND bbox.ymax > {S}
""").fetchall()
print("buildings in bbox:", len(rows))
roofs = []
for i, (oid, floors, height, area, g) in enumerate(rows):
    if area is None or area < 40:
        continue
    geom = json.loads(g)
    ring = geom["coordinates"][0] if geom["type"] == "Polygon" else max(geom["coordinates"], key=lambda p: len(p[0]))[0]
    roofs.append({"id": len(roofs), "oid": oid, "area": round(area, 1), "floors": floors, "h": height,
                  "ring": [[round(x, 6), round(y, 6)] for x, y in ring]})
os.makedirs("public/data", exist_ok=True)
json.dump(roofs, open("public/data/roofs.json", "w"), separators=(",", ":"))
print("roofs >= 40 m2:", len(roofs), "release", REL)
