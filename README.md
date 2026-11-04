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

1. **Detection:** pinned model `finloop/yolov8s-seg-solar-panels` (MIT), exported to ONNX and run with onnxruntime. The same pre- and post-processing code runs in Node (town scan) and the browser (live check).
2. **Three roof states, not two:** `panel` (score ≥ 0.50), `needs review` (0.35–0.50, never counted and never treated as a lead), `no panels observed`.
3. **Filters for false positives:** pixels inside each box are tested for sea/pools (saturation), greenhouses/trees (green excess) and white shade structures (brightness). Rejected boxes are kept with a reason, not deleted.
4. **Second look before a lead:** every roof without a panel is re-checked on a roof-centred crop at 2× zoom (no tile edges, small arrays bigger), using cached tiles only.
5. **Ranking and verdict:** a circle (100/200/350 m) is ranked against all neighbourhoods and its 20 closest peers by housing type (share of large roofs). This gives a verdict such as *STRONG TARGET / LOW ADOPTION* or *MOSTLY APARTMENT BLOCKS* (pitch shared self-consumption), plus 2–3 concrete work items. Never "install everywhere".
6. **Campaigns:** an area is saved with its verdict and leads. Each lead moves through `to_visit → visited → quoted → won | lost`. The gate is enforced in Postgres, and every change goes to an event log.

## Accuracy checks

- Our TypeScript pipeline reproduces Ultralytics' own predictions on the test tiles (8/9 exact; the 9th differs by one box at exactly the 0.50 threshold). This needed a custom bilinear resize: the image library's resize shifted scores by up to 0.07.
- Visual check on Carrer d'Auguste Renoir: `/debug` shows every box (counted, needs review, rejected with reason) over the photo.

## Assumptions (shown in the UI and printed in every CSV)

Usable roof = 40% of footprint · 5 m² per kWp · houses capped at 10 kWp (≥ 400 m² or ≥ 3 floors uncapped, pitched as collective/business) · 1,560 kWh/kWp/yr (PVGIS, Cambrils) · €0.12/kWh (editable).

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
