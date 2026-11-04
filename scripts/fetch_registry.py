"""Fetch official self-consumption (autoconsum) registrations for Cambrils + neighbours.

Sources
  - Registre d'Autoconsum de Catalunya (RAC), Socrata dataset 2b4s-skfm on
    analisi.transparenciacatalunya.cat (SODA API, no key needed).
  - Population: IDESCAT EMEX API, indicator f171 (INE Padró-based population).

Output: public/data/registry.json   Raw API responses: .cache/validation/
Usage:  .venv/bin/python scripts/fetch_registry.py
"""
from __future__ import annotations

import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "validation"
OUT = ROOT / "public" / "data" / "registry.json"

SODA = "https://analisi.transparenciacatalunya.cat/resource/2b4s-skfm.json"
DATASET_PAGE = "https://analisi.transparenciacatalunya.cat/d/2b4s-skfm"
EMEX = "https://api.idescat.cat/emex/v1/dades.json"

# Cambrils + every municipality sharing a boundary with it (ca.wikipedia "Cambrils").
# idescat = 6-digit IDESCAT code (INE 5-digit code + control digit), as used in the RAC.
TOWNS = [
    {"name": "Cambrils", "ine": "43038", "idescat": "430385", "role": "pilot"},
    {"name": "Salou", "ine": "43905", "idescat": "439057", "role": "neighbour"},
    {"name": "Vila-seca", "ine": "43171", "idescat": "431711", "role": "neighbour"},
    {"name": "Mont-roig del Camp", "ine": "43092", "idescat": "430923", "role": "neighbour"},
    {"name": "Riudoms", "ine": "43129", "idescat": "431299", "role": "neighbour"},
    {"name": "Montbrió del Camp", "ine": "43088", "idescat": "430884", "role": "neighbour"},
    {"name": "Vinyols i els Arcs", "ine": "43178", "idescat": "431785", "role": "neighbour"},
]
SMALL_KW = 10.0


def get(url: str, params: dict, tries: int = 2) -> requests.Response:
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=60)
            r.raise_for_status()
            return r
        except requests.RequestException:
            if i == tries - 1:
                raise
            time.sleep(3)
    raise RuntimeError("unreachable")


def fetch_rows(idescat: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        r = get(SODA, {
            "$where": f"codi_ine_municipi='{idescat}'",
            "$order": "n_mero_rac",
            "$limit": 50000,
            "$offset": offset,
        })
        page = r.json()
        rows += page
        if len(page) < 50000:
            return rows
        offset += 50000


def fetch_population(idescat: str) -> tuple[int, int]:
    r = get(EMEX, {"id": idescat, "i": "f171", "lang": "en"})
    (CACHE / f"idescat_f171_{idescat}.json").write_text(r.text)
    ind = r.json()["fitxes"]["indicadors"]["i"]
    ind = ind[0] if isinstance(ind, list) else ind
    return int(ind["v"].split(",")[0]), int(ind["r"])


def year_of(row: dict, key: str) -> str | None:
    v = row.get(key)
    return v[:4] if v else None


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    meta = get(f"https://analisi.transparenciacatalunya.cat/api/views/2b4s-skfm.json", {}).json()
    (CACHE / "rac_2b4s-skfm_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    rows_updated = datetime.fromtimestamp(meta["rowsUpdatedAt"], timezone.utc).date().isoformat()
    latest = get(SODA, {"$select": "max(data_d_inscripci) as m"}).json()[0]["m"][:10]

    towns = []
    for t in TOWNS:
        rows = fetch_rows(t["idescat"])
        if not rows:
            raise SystemExit(f"no RAC rows for {t}")
        (CACHE / f"rac_{t['idescat']}.json").write_text(json.dumps(rows, ensure_ascii=False))
        pv = [r for r in rows if r.get("tecnologia", "").upper().startswith("FOTOVOLT")]
        other = len(rows) - len(pv)
        kws = [float(r.get("pot_ncia") or 0) for r in pv]
        small = sum(1 for k in kws if k <= SMALL_KW)
        by_year: dict[str, dict] = defaultdict(lambda: {"n": 0, "kw": 0.0})
        by_month: dict[str, int] = defaultdict(int)
        same_dates = sum(1 for r in pv if r.get("data_d_inscripci") == r.get("data_de_posada_en_servei"))
        for r, k in zip(pv, kws):
            y = year_of(r, "data_d_inscripci") or "unknown"
            by_year[y]["n"] += 1
            by_year[y]["kw"] += k
            by_month[(r.get("data_d_inscripci") or "unknown")[:7]] += 1
        pop, pop_year = fetch_population(t["idescat"])
        towns.append({
            "name": t["name"],
            "ine": t["ine"],
            "idescat": t["idescat"],
            "role": t["role"],
            "population": pop,
            "popYear": pop_year,
            "installations": len(pv),
            "totalKw": round(sum(kws), 1),
            "small": small,
            "smallKw": round(sum(k for k in kws if k <= SMALL_KW), 1),
            "large": len(pv) - small,
            "medianKw": round(sorted(kws)[len(kws) // 2], 2) if kws else None,
            "perThousand": round(len(pv) / pop * 1000, 2),
            "kwPerThousand": round(sum(kws) / pop * 1000, 1),
            "nonPvInstallations": other,
            "byYear": {y: {"n": v["n"], "kw": round(v["kw"], 1)} for y, v in sorted(by_year.items())},
            "byMonth": dict(sorted(by_month.items())),
            "under1Kw": sum(1 for k in kws if k < 1.0),
            "commissioningEqualsRegistration": same_dates,
        })
        print(f"{t['name']:<20} pv={len(pv):>5} kW={sum(kws):>9.1f} small={small:>5} pop={pop} ({pop_year})")

    out = {
        "source": "Registre d'Autoconsum de Catalunya (RAC) - Generalitat de Catalunya, Departament de Territori, Habitatge i Transició Ecològica",
        "url": DATASET_PAGE,
        "api": SODA,
        "license": "Llicència oberta d'ús d'informació - Catalunya (attribution required)",
        "populationSource": "IDESCAT EMEX indicator f171 (based on INE population census)",
        "populationUrl": EMEX,
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "datasetRowsUpdated": rows_updated,
        "latestRegistrationInData": latest,
        "smallThresholdKw": SMALL_KW,
        "towns": towns,
        "notes": [
            "Counts = RAC rows with tecnologia FOTOVOLTAICA in the municipality; one row = one registered self-consumption installation (RD 15/2018, RD 244/2019), so pre-2019 systems and non-registered ones are missing.",
            "byYear/byMonth keys = registration date (data_d_inscripci). In this dataset data_de_posada_en_servei equals the registration date for every row in these towns (commissioningEqualsRegistration), so true install dates are not available. Sum byMonth up to the imagery flight month to get the registered stock at flight time.",
            "Registry has no coordinates: it covers the WHOLE municipality (incl. urbanisations, industrial estates, farms, ground-mounted), not just the scanned pilot area.",
            "under1Kw flags collective self-consumption: each participant of a shared (e.g. apartment-block) system is registered as its own row with a fractional share (Salou has ~265 rows of 0.6 kW registered in batches in 2022-11/12 and 2025-11), so row count > physical arrays.",
            "<=10 kW is used as a proxy for residential; collective/community installations on apartment blocks may exceed it.",
            "Data is closed monthly with lag; registrations trail actual installation by weeks to months.",
            "Neighbours = all municipalities sharing a boundary with Cambrils (Salou, Vila-seca, Mont-roig del Camp, Riudoms, Montbrió del Camp, Vinyols i els Arcs).",
        ],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
