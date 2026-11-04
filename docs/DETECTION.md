# Detection spec

**Model:** Hugging Face `finloop/yolov8s-seg-solar-panels`, pinned revision `c94c55ff22debf46cdcffb4bbc23a9c464ba83fd`, file `best.pt` (24 MB, MIT licence), sha256 `9379f467a6e97a72bbda1ff81096e56f8f87831660b29436fc5783a043e0b94b`.

- Convert once: Ultralytics export `format=onnx, imgsz=640, opset=17, simplify=False, device=cpu`. The export tool is AGPL; the model is MIT. Output is ~47 MB `best.onnx`.
- Don't commit the `.pt`; host the `.onnx` (public Supabase Storage bucket `models` if Vercel rejects the size).

## Imagery tiles

- WMS `https://geoserveis.icgc.cat/servei/catalunya/orto-territorial/wms`, layer `ortofoto_color_provisional`, `GetMap`, EPSG:3857, 512×512 JPEG.
- Each tile is **128 m on the ground** (0.25 m/px). In EPSG:3857 metres the tile width is `128 / cos(41.0725°)` ≈ 169.85.
- Fixed grid anchored at the pilot's SW corner (lon 1.025, lat 41.055). Pilot box 41.055–41.09 N × 1.025–1.085 E → **40 × 31 = 1,240 tiles**.
- The server sends CORS, so the browser can read pixels (`img.crossOrigin="anonymous"`).
- Retry each tile up to 3× with backoff.

## Inference (same in Node and browser)

- Resize 512 → 640 bilinear, RGB, float32 CHW, ÷255.
- Output 0 is `[1, 37, 8400]`: transpose to 8,400 rows. Columns 0–3 = cx, cy, w, h in 640-px space; **column 4 = panel score**; ignore mask coefficients and output 1.
- Keep score ≥ **0.5**. Scale back to 512 px, clip, greedy NMS at IoU 0.45.

## Colour filter (per box)

- `V` = mean per-pixel max channel; `sat` = mean (max−min)/max; `green` = mean G − (R+B)/2.
- Reject if `sat > 0.40` (sea, pools), `green > 6` (greenhouses, gardens, trees) or `V > 205` (white shade structures). Rejected boxes are kept with a reason, not counted.
- Known leftovers: glass skylights, parapets, the odd road box.

## Roofs

- Overture Maps buildings via duckdb from `s3://overturemaps-us-west-2/release/2026-10-21.0/theme=buildings/type=building/*`, bbox = pilot ± 0.004°.
- Keep footprints ≥ 40 m² (~4,000 roofs expected).
- A detection belongs to the roof containing its box centre. Off-roof boxes within 3 m are grouped into "off-roof arrays" (roof count is a lower bound).

## Neighbourhoods and ranking

- 256 m cells (2×2 tiles); ranked when ≥ 15 roofs.
- Share = roofs with panels ÷ roofs, Wilson 95% interval.
- Percentile among ranked cells (ties count half); median, q75, headroom = max(0, round(q75 × roofs) − with_panels).
- Similar housing: large-roof share = area of roofs ≥ 400 m² ÷ total roof area; peers = 20 ranked cells closest.

## Verdict (peers, falling back to town)

- < 15 roofs → TOO FEW ROOFS TO JUDGE
- percentile ≤ 33: large roofs ≥ 60% area → LOW ADOPTION / MOSTLY APARTMENT BLOCKS; else interval entirely below median → STRONG TARGET / LOW ADOPTION; else LIKELY TARGET / BELOW TYPICAL
- percentile ≥ 67 → MATURE AREA / SELL UPGRADES
- otherwise → TYPICAL / TARGET SELECTIVELY
- scanning → MEASURING…; scan failed → NO VERDICT. Never "install everywhere".

## Lead sizing

- Usable area = footprint × 0.40; 5 m² per kWp; houses capped at 10 kWp (roofs ≥ 400 m² or ≥ 3 floors uncapped, pitched as collective/business).
- kWh/yr = kWp × PVGIS yield for Cambrils (≈ 1,560 kWh/kWp/yr). €/yr at editable €/kWh (default 0.12, an assumption). Every export carries its assumptions.

## Sanity checks

Typical neighbourhoods ≈ 5–15% of roofs with panels; ~0% or > 40% town-wide means a bug. First visual check: Carrer d'Auguste Renoir (41.060932, 1.038792).

## Improvements over the reference model (no training in the 60-minute build)

1. Colour filter (above).
2. Roof prior: only on-roof boxes count.
3. Half-tile offset pass merged by NMS, to recover arrays split by a tile edge.
4. Calibration street: found / missed / false reported.
5. Roadmap: fine-tune on rejected boxes (hard negatives) + calibrated streets, then PNOA tiles for all of Spain.
- **Measured (2026-11-04):** PVGIS v5.3 gives 1,463 kWh/kWp/yr for a 20° south roof-mounted system in Cambrils (`public/data/pvgis.json`); the app uses that instead of the 1,560 estimate.
