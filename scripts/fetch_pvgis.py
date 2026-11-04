"""Fetch PV yield (kWh per kWp per year + monthly profile) from the EU JRC PVGIS v5.3 API.

API docs: https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/getting-started-pvgis/api-non-interactive-service_en
Output: public/data/pvgis.json   Raw responses: .cache/validation/pvgis_*.json
Usage:  .venv/bin/python scripts/fetch_pvgis.py
"""
from __future__ import annotations

import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "validation"
OUT = ROOT / "public" / "data" / "pvgis.json"
API = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc"

POINTS = [
    {"name": "Cambrils centre", "lat": 41.0687, "lon": 1.0590},
    {"name": "Pilot west", "lat": 41.06, "lon": 1.03},
    {"name": "Pilot north-east", "lat": 41.085, "lon": 1.08},
]
BASE = {"peakpower": 1, "loss": 14, "outputformat": "json"}
CONFIGS = {
    # PVGIS-optimal tilt/azimuth, building-integrated (poorly ventilated) thermal model
    "optimal_building": {"mountingplace": "building", "optimalangles": 1},
    # typical Spanish pitched tile roof (~20 deg), due south, flush-mounted -> building model
    "roof20_south_building": {"mountingplace": "building", "angle": 20, "aspect": 0},
    # same geometry, rack-mounted/ventilated ("free-standing" thermal model)
    "roof20_south_free": {"mountingplace": "free", "angle": 20, "aspect": 0},
}
RECOMMENDED = "roof20_south_building"


def call(params: dict) -> dict:
    for attempt in range(2):  # one retry
        try:
            r = requests.get(API, params=params, timeout=90)
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError):
            if attempt:
                raise
            time.sleep(5)
    raise RuntimeError("unreachable")


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    configs_out = {}
    for cname, cfg in CONFIGS.items():
        pts = []
        for p in POINTS:
            params = {**BASE, **cfg, "lat": p["lat"], "lon": p["lon"]}
            d = call(params)
            (CACHE / f"pvgis_{cname}_{p['lat']}_{p['lon']}.json").write_text(json.dumps(d))
            fixed = d["inputs"]["mounting_system"]["fixed"]
            tot = d["outputs"]["totals"]["fixed"]
            pts.append({
                "name": p["name"],
                "lat": p["lat"],
                "lon": p["lon"],
                "elevationM": d["inputs"]["location"]["elevation"],
                "slopeDeg": fixed["slope"]["value"],
                "azimuthDeg": fixed["azimuth"]["value"],
                "yearlyKwhPerKwp": tot["E_y"],
                "yearlyIrradiationKwhM2": tot["H(i)_y"],
                "interannualSdKwh": tot["SD_y"],
                "totalLossPct": tot["l_total"],
                "monthly": [m["E_m"] for m in d["outputs"]["monthly"]["fixed"]],
            })
            print(f"{cname:<24} {p['name']:<18} {tot['E_y']:7.1f} kWh/kWp/yr  slope={fixed['slope']['value']} az={fixed['azimuth']['value']}")
        configs_out[cname] = {
            "params": {**BASE, **cfg},
            "meanYearlyKwhPerKwp": round(statistics.mean(x["yearlyKwhPerKwp"] for x in pts), 1),
            "points": pts,
        }
        meteo = d["inputs"]["meteo_data"]

    rec = configs_out[RECOMMENDED]
    out = {
        "source": "PVGIS v5.3, European Commission Joint Research Centre",
        "url": API,
        "license": "PVGIS data free to use with attribution (© European Union, JRC)",
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "meteo": meteo,
        "params": rec["params"],
        "points": rec["points"],
        "recommendedYield": round(rec["meanYearlyKwhPerKwp"]),
        "recommendedConfig": RECOMMENDED,
        "configs": configs_out,
        "notes": [
            "Yield = AC energy per 1 kWp after 14% system losses (PVGIS default) plus temperature/angle-of-incidence/spectral losses; horizon shading from DEM, no local building shading.",
            "recommendedYield uses a 20 deg south-facing flush roof (building thermal model) averaged over the 3 points: the conservative, typical-rooftop case.",
            "East/west-facing or shaded roofs yield less; flat-roof racked systems at optimal tilt yield more (see configs).",
        ],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"recommended {out['recommendedYield']} kWh/kWp/yr -> {OUT}")


if __name__ == "__main__":
    main()
