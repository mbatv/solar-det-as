"""OpenStreetMap buildings (way/relation building=*) in the pilot box via Overpass -> .cache/buildings/osm.json

Tries several public Overpass mirrors with exponential backoff (identifies itself with a plain
script User-Agent; no browser spoofing). Writes {"mirror":..., "elements":[...]} raw Overpass JSON.
Usage: python -I scripts/buildings_osm.py <out.json>
"""
import json, sys, time, requests

S, W, N, E = 41.047, 1.017, 41.098, 1.093
Q = f"""[out:json][timeout:120];
(way["building"]({S},{W},{N},{E}); relation["building"]({S},{W},{N},{E}););
out tags geom;"""
MIRRORS = ["https://overpass-api.de/api/interpreter",
           "https://overpass.private.coffee/api/interpreter",
           "https://overpass.kumi.systems/api/interpreter",
           "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
           "https://overpass.osm.jp/api/interpreter"]
UA = {"User-Agent": "solar-radar-research/0.1 (python-requests; building footprint coverage study)"}
log = []
for rnd in range(4):
    for m in MIRRORS:
        try:
            r = requests.post(m, data={"data": Q}, headers=UA, timeout=180)
            log.append(f"{m} round{rnd}: {r.status_code}")
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                d = r.json()
                d["mirror"] = m
                json.dump(d, open(sys.argv[1], "w"))
                print("\n".join(log)); print("OK", m, len(d["elements"]), "elements")
                sys.exit(0)
        except Exception as e:
            log.append(f"{m} round{rnd}: {type(e).__name__}")
    time.sleep(15 * 2 ** rnd)
print("\n".join(log)); print("FAILED all mirrors"); sys.exit(1)
