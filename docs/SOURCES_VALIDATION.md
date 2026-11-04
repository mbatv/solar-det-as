# Sources & validation

These are the public sources we used to check the detector's panel counts against official registrations and to set the solar yield. Fetched 2026-11-04 by `scripts/fetch_registry.py` and `scripts/fetch_pvgis.py`. Raw responses are in `.cache/validation/`, and the outputs are `public/data/registry.json` and `public/data/pvgis.json`.

## Sources tried

| Source | URL | Licence | Reachable | Used |
|---|---|---|---|---|
| Registre d'Autoconsum de Catalunya (RAC), dataset `2b4s-skfm` "Instal·lacions d'autoconsum elèctric" | https://analisi.transparenciacatalunya.cat/d/2b4s-skfm (SODA API: `/resource/2b4s-skfm.json`) | Llicència oberta d'ús d'informació – Catalunya (attribution) | Yes, no key | **Yes**: per-installation rows (RAC no., CAU, kW, technology, registration date, IDESCAT municipality code). 138,769 rows in total, rows updated 2026-06-01, latest registration 2025-12-31 |
| IDESCAT EMEX API, indicator `f171` (population) | https://api.idescat.cat/emex/v1/dades.json?id=430385&i=f171 | Idescat open data (attribution) | Yes | **Yes**: 2025 population (from the INE census) |
| RADNE, the national self-consumption registry (MITECO) | https://energia.serviciosmin.gob.es/Radne/RegistroPublico/Consulta (listed on datos.gob.es as "Registro de autoconsumo", CC BY 4.0) | CC BY 4.0 | Page loads (HTTP 200), but every query is behind a **CAPTCHA**. There is no CSV or API download | No. It cannot be scripted. Catalan installations are registered in the RAC and then passed on to RADNE, so RAC is the more detailed source for Cambrils |
| MITECO "Autoconsumo y almacenamiento" statistics | miteco.gob.es (IMS 23106) | – | Survey-based, national/CCAA aggregates | No municipal breakdown |
| PVGIS v5.3 `PVcalc` (EU JRC) | https://re.jrc.ec.europa.eu/api/v5_3/PVcalc | Free with attribution (© EU, JRC) | Yes (worked first try, retry built in) | **Yes**: yield + monthly profile. SARAH3 radiation, ERA5 meteo, 2005–2023, DEM horizon |

## Registered PV self-consumption (RAC, all registrations up to 2025-12-31)

Cambrils and every municipality that borders it. Montbrió del Camp and Vinyols i els Arcs also touch Cambrils, so all 6 neighbours are included.

| Town | INE | Pop. 2025 | PV installs | Total kW | ≤10 kW | per 1,000 res. | kW per 1,000 | Registered by end Jul 2025 |
|---|---|---|---|---|---|---|---|---|
| **Cambrils** | 43038 | 37,068 | **1,140** | 8,322 | 1,091 | **30.8** | 224 | 1,062 |
| Salou | 43905 | 31,018 | 529* | 2,902 | 503 | 17.1* | 94 | 402 |
| Vila-seca | 43171 | 24,158 | 279 | 15,931 | 246 | 11.5 | 659 | 271 |
| Mont-roig del Camp | 43092 | 14,652 | 833 | 5,184 | 803 | 56.9 | 354 | 788 |
| Riudoms | 43129 | 6,927 | 309 | 2,613 | 292 | 44.6 | 377 | 300 |
| Montbrió del Camp | 43088 | 3,167 | 111 | 1,011 | 98 | 35.1 | 319 | 105 |
| Vinyols i els Arcs | 43178 | 2,470 | 92 | 1,204 | 83 | 37.2 | 488 | 88 |

*Salou: 266 of its rows are 0.6 kW shares of collective (apartment-block) self-consumption, registered in batches in 2022-11/12 and 2025-11. Without those rows Salou has about 263 installs, or 8.5 per 1,000 residents.

Cambrils registrations by year: 2019 5 · 2020 20 · 2021 74 · 2022 288 · 2023 362 · 2024 211 · 2025 180. The median system is 4.6 kW, and 49 systems are over 10 kW.

## Sun / yield (PVGIS v5.3, 1 kWp, loss 14 %)

| Config | Centre (41.0687, 1.0590) | (41.06, 1.03) | (41.085, 1.08) | Mean |
|---|---|---|---|---|
| Optimal angles (38°, south), `mountingplace=building` | 1,515 | 1,521 | 1,529 | 1,522 |
| **20° south, `building` (flush roof), recommended** | 1,457 | 1,464 | 1,469 | **1,463** |
| 20° south, `free` (ventilated rack) | 1,514 | 1,521 | 1,527 | 1,521 |

Monthly profile for the recommended case, in kWh/kWp averaged over the 3 points: 87, 95, 125, 137, 157, 159, 164, 149, 124, 104, 83, 79.

`lib/leads.ts` currently uses 1,560 kWh/kWp/yr. That is about 2.5 % above PVGIS even at the optimal tilt and about 6.6 % above the typical-roof value. We recommend **1,460** (typical roof), or 1,520 if you want to model well-oriented, ventilated systems.

## Detected vs registered (Cambrils)

- **Detected:** 363 roofs with panels out of 4,034 footprints in the pilot area (9.0 %), plus about 295 arrays on buildings missing from the footprint data. That is roughly **658 arrays in the pilot area**.
- **Registered:** **1,140** PV self-consumption installations in the **whole municipality** (1,062 registered by end of July 2025).
- The two figures are the same order of magnitude. The pilot area covers only part of Cambrils, so detected ≈ 58 % of the municipal total is plausible. We cannot match installations one to one.

### Caveats
1. **No coordinates in RAC.** Records only identify the municipality, so we cannot match them to buildings or clip them to the pilot area. Both the detected and registered counts would need scaling by the pilot area's share of buildings before they can be compared directly.
2. **Coverage differs.** RAC covers the whole municipality, including urbanisations, industrial estates, farms and ground-mounted systems. It includes only self-consumption under RD 15/2018 / RD 244/2019, so systems registered before 2019, unregistered systems, utility plants and solar-thermal (hot-water) collectors are missing. The detector may count solar-thermal collectors as panels.
3. **Collective self-consumption.** Each participant in a shared system is a separate row, so the row count can exceed the number of physical arrays (see Salou).
4. **Dates.** `data_de_posada_en_servei` equals the registration date in every row we fetched, so the real install date is unknown. Registration trails installation by weeks to months, and the data is closed monthly. To get the registered stock at the time of the photo, sum `byMonth` in `registry.json` up to the imagery flight month.
5. **The ≤10 kW split is only a proxy for residential.** 96 % of Cambrils systems are ≤10 kW.
6. **PVGIS ignores local shading** from neighbouring buildings and trees, and assumes a south-facing roof. East- or west-facing roofs yield roughly 10–15 % less.
