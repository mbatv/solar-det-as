# Solar Radar

**Shows solar installers where demand is likely, using the panels already visible from the air.**

A pretrained solar-panel detector scans the latest 25 cm aerial photo of a town. It finds which roofs already carry panels and ranks every neighbourhood against the rest of town and against areas with similar housing. The roofs without panels become a sized, ranked lead list that an installer works through as a campaign.

Pilot: **Cambrils (Tarragona)** on the ICGC orthophoto. The method needs only an aerial photo and building outlines, so it extends to the rest of Spain (PNOA imagery).

## How it works

```
ICGC WMS 25 cm photo ──► 1,240 fixed 128 m tiles ──► YOLOv8s-seg (ONNX) ──► colour filter
                                                                                │
Overture building outlines (OSM + IGN) ──► roofs ≥ 40 m² ◄── box centre on roof ┘
                                              │
         roof with no panel ──► 2× zoom roof-centred re-check ──► "no panels observed" ──► lead
                                              │
                         256 m neighbourhood cells ──► share + Wilson 95% CI ──► rank vs town / 20 similar-housing peers
                                              │
                         click a circle ──► verdict + work items + leads (kWp, kWh/yr, €/yr) ──► CSV / campaign (Supabase)
```

1. **Detection:** pinned model `finloop/yolov8s-seg-solar-panels` (MIT), exported to ONNX and run with onnxruntime. The pre- and post-processing is plain TypeScript (`lib/detect.ts`) with no Node-only dependencies, so a live in-browser check (onnxruntime-web) can reuse it; that check is not built yet.
2. **Three roof states, not two:** `panel` (score ≥ 0.50), `needs review` (0.35–0.50, never counted and never treated as a lead), `no panels observed`.
3. **Filters for false positives:** pixels inside each box are tested for sea/pools (saturation), greenhouses/trees (green excess) and white shade structures (brightness). Rejected boxes are kept with a reason, not deleted.
4. **Second look before a lead:** every roof without a panel is re-checked on a roof-centred crop at 2× zoom (no tile edges, small arrays bigger), using cached tiles only.
5. **Ranking and verdict:** a circle (100/200/350 m) is ranked against all neighbourhoods and its 20 closest peers by housing type (share of large roofs). This gives a verdict such as *STRONG TARGET / LOW ADOPTION* or *MOSTLY APARTMENT BLOCKS* (pitch shared self-consumption), plus 2–3 concrete work items. Never "install everywhere".
6. **Campaigns:** an area is saved with its verdict and leads. Each lead moves through `to_visit → visited → quoted → won | lost`. The gate is enforced in Postgres, and every change goes to an event log.

## Accuracy checks

- Our TypeScript pipeline reproduces Ultralytics' own predictions on the test tiles (8/9 exact; the 9th differs by one box at exactly the 0.50 threshold). This needed a custom bilinear resize: the image library's resize shifted scores by up to 0.07.
- Visual check on Carrer d'Auguste Renoir: `/debug` shows every box (counted, needs review, rejected with reason) over the photo.

## Independent checks (public sources)

| Check | Source | Result |
|---|---|---|
| Code matches the reference model | Ultralytics predict on the same tiles | 8/9 tiles identical; 1 box differs at exactly score 0.50 |
| Panels in the right range | Catalan self-consumption registry (RAC, Socrata `2b4s-skfm`) | Cambrils: **1,140 registered installs** (8.3 MW) town-wide vs ~658 arrays detected in the pilot area (363 roofs + ~295 on unmapped buildings). The registry has no coordinates, so this is an order-of-magnitude check only |
| Town context | RAC + IDESCAT population 2025 | Cambrils 30.8 installs per 1,000 residents; neighbours 11.5–56.9 (`public/data/registry.json`) |
| Sun | PVGIS v5.3 API | 1,463 kWh/kWp/yr (20° south, roof-mounted, 14% loss); used for every lead |
| Flight date | ICGC WMS GetFeatureInfo on the photo layer itself | 2026-07-27, looked up for the point being viewed |
| Expected adoption | Brief's sanity range 5–15% | 9.0% of roofs town-wide |

Details: [docs/SOURCES_VALIDATION.md](docs/SOURCES_VALIDATION.md).

## Assumptions (shown in the UI and printed in every CSV)

Usable roof = 40% of footprint · 5 m² per kWp · houses capped at 10 kWp (≥ 400 m² or ≥ 3 floors uncapped, pitched as collective/business) · 1,463 kWh/kWp/yr (PVGIS v5.3, Cambrils, 20° roof-mounted; the brief assumed ≈ 1,560) · €0.12/kWh (editable).

## Known limits

Glass skylights, parapets and the odd road box can still pass the filter. Off-roof arrays are reported separately, so roof counts are a lower bound. A roof with no panels means none were *observed on the photo of that flight date*, not proof.

## Run it

```bash
npm i && python3 -m venv .venv && .venv/bin/pip install ultralytics duckdb onnx
.venv/bin/python scripts/export_onnx.py      # models/best.onnx (needs models/best.pt, pinned sha256 in docs/DETECTION.md)
.venv/bin/python scripts/fetch_roofs.py      # Overture roofs -> public/data/roofs.json
npx tsx scripts/scan.mts g0                  # town scan -> public/data/detections_g0.json
npx tsx scripts/recheck.mts                  # roof-centred re-check
npm run dev
```

Docs: [product brief](docs/BRIEF.md) · [detection spec](docs/DETECTION.md).
