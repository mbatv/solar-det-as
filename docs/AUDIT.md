# Detector accuracy audit (2026-11-04)

The audit covers the PV detector only: YOLOv8s-seg `models/best.onnx`, 512 px tiles (0.25 m/px) resized to 640, NMS 0.45 and the colour filter. Building footprints are a separate problem, but they turned out to matter more than the detector (see §6).

**Bottom line:** in production, the detector finds **85 % of the hand-labelled arrays at 88 % precision**. A horizontal-flip TTA pass raises recall to **89 % at the same precision**, and it costs one extra model run per tile. The arrays that are still missed are mostly all-black arrays with no visible cell grid and arrays of 2–3 modules. Thresholds can't fix those; fine-tuning can. The bigger loss is outside the detector: **43 of the 98 labelled arrays (44 %) are not on any footprint in `roofs.json`.** The app does not count those arrays as roofs with panels.

## 1. Sample

There are 16 g0 tiles with 98 confident PV arrays. 26 more items were marked "ignore" (they might be PV, glass or thermal) and 3 were marked "solar thermal" (counted as negatives). All boxes were labelled by eye from 2× full-tile and 4× quadrant crops (`scripts/audit_render.mts`). The labels are in `.cache/audit/labels.json`.

| tile | type | arrays | ignore |
|---|---|---:|---:|
| 5_6 | new flat-roof villas + old townhouses | 14 | 0 |
| 23_13 | new development: townhouse rows + villas | 13 | 0 |
| 9_8 | villas + red-tile apartment block + townhouses | 11 | 0 |
| 8_4 | hotel/commercial + villas | 6 | 0 |
| 9_7 | dense red-tile townhouses + villas | 8 | 1 |
| 3_5 | villas, pitched and flat | 8 | 1 |
| 6_3 | red-tile villas + apartment block | 8 | 1 |
| 17_22 | dense red-tile townhouses | 8 | 1 |
| 31_15 | suburban villas + terraced row | 5 | 0 |
| 22_9 | old-town dense apartment blocks | 5 | 2 |
| 18_13 | town-centre apartment blocks | 1 | 1 |
| 0_3 | villas + campsite bungalows | 4 | 5 |
| 12_9 | detached pitched-roof villas (almost no PV) | 1 | 0 |
| 33_12 | red-tile villas | 3 | 5 |
| 25_10 | town-centre apartment blocks (3 thermal collectors) | 1 | 1 |
| 21_17 | dense terraced housing + caravan park | 2 | 1 |

The smallest labelled array is 6 m² (two modules) and the largest is about 250 m².

## 2. Method

- `scripts/audit_infer.mts` re-runs the model on the 16 tiles with `decode(out, tilePx, 0.05)` and `colourFilter` from `lib/detect.ts`. It runs three passes:
  - **native:** 512 → 640, as in production. This pass reproduces `detections_g0.json` exactly, apart from rounding.
  - **flip:** the 640 input is mirrored horizontally, and the boxes are mirrored back.
  - **quad:** each 256 px quadrant is upscaled to 640, so the model sees 2.5× zoom.

  The script also keeps the pre-NMS candidates so that NMS merges can be spotted. Output goes to `.cache/audit/raw.json`.
- `scripts/audit_eval.py` sweeps thresholds × passes × filter settings and writes `.cache/audit/eval.json`. Matching rules:
  - A detection matches a label if IoU > 0.1 or the detection's centre lies inside the label.
  - **Recall** = labels matched by at least one kept detection.
  - **Precision** = kept detections that match a label, divided by kept detections that don't fall in an ignore box.
  - Passes are merged by concatenation plus NMS 0.45.
- `scripts/audit_summary.py` produces the configuration table and also counts FP *objects*: FP boxes are clustered, so one row of skylights counts as one object. Output: `.cache/audit/summary.json`.
- `scripts/audit_miss.py` categorises the misses and false positives of the production configuration (`.cache/audit/misses.json`).
- `scripts/audit_offroof.mts` checks which labels fall on a footprint.
- **Timing caveat:** two full scans were running at the same time (load average 20–55 on 8 cores), so I ran the model with 2 threads. Absolute times were inflated: about 1.1 s per native run. Only the ratios between passes are used: flip = 1.03× native, quad (4 runs) = 3.95× native. Runtimes below are those ratios scaled to the stated baseline of 144 ms/tile at 6 threads.

## 3. Results

### Threshold sweep, native pass, current filter

| threshold | 0.15 | 0.20 | 0.25 | 0.30 | 0.35 | 0.40 | 0.45 | **0.50** |
|---|---|---|---|---|---|---|---|---|
| recall | 0.90 | 0.90 | 0.89 | 0.89 | 0.89 | 0.88 | 0.87 | **0.85** |
| precision | 0.84 | 0.85 | 0.85 | 0.84 | 0.85 | 0.85 | 0.88 | **0.88** |
| FP boxes | 28 | 26 | 25 | 25 | 24 | 22 | 18 | **16** |

Going below 0.35 gains nothing: the model either recognises an array (score ≥ 0.35) or doesn't see it at all (< 0.05). Counting the review tier (≥ 0.35) adds 4 arrays and 8 FP boxes (6 FP objects).

### Configurations (current colour filter; "off" = filter disabled)

| config | recall | precision | FP boxes / objects | ms/tile (6 thr) | full 1,240 tiles |
|---|---|---|---|---|---|
| A. production: native ≥ 0.50 | **0.847** (83/98) | 0.882 | 16 / 7 | 144 | 3.0 min |
| A. filter off | 0.847 | 0.870 | 18 / 9 | 144 | 3.0 min |
| B. native ≥ 0.35 (count review tier) | 0.888 | 0.846 | 24 / 13 | 144 | 3.0 min |
| **D. native + flip TTA ≥ 0.50** | **0.888** (87/98) | **0.881** | 19 / 9 | ~290 | **6.0 min** |
| E. native + flip ≥ 0.40 | 0.888 | 0.863 | 23 / 13 | ~290 | 6.0 min |
| F. 2× quad only ≥ 0.35 | 0.816 | 0.938 | 8 / 7 | ~570 | 11.8 min |
| G. native + quad ≥ 0.50 | 0.888 | 0.885 | 19 / 9 | ~715 | 14.7 min |
| H. native ≥ 0.50 + quad ≥ 0.40 | 0.888 | 0.878 | 21 / 11 | ~715 | 14.7 min |
| I. native + flip ≥ 0.50 + quad ≥ 0.40 | 0.898 | 0.880 | 22 / 11 | ~860 | 17.8 min |
| J. native + flip + quad ≥ 0.35 | 0.918 | 0.851 | 29 / 18 | ~860 | 17.8 min |

Flip TTA with score averaging (pair the boxes, average their scores) gave 0.86/0.89 at 0.50 and 0.89/0.88 at 0.35. That is no better than the union rule above. The full grid is in `.cache/audit/eval.json`.

With 98 labels, the 95 % interval on recall is about ±7 points, so small differences between rows are noise. The flip gain is real, though. It comes from four specific arrays that native scores at 0.21, 0.38, 0.40 and 0.49, and that flip scores at 0.85, 0.60, 0.78 and 0.73 (§4). The native model is unstable on these arrays, not blind to them.

What the 2× quadrant pass shows:

- It is very precise: it ignores skylight rows and corrugated sheet roofs.
- It finds small arrays: 6_3 [335,325] scores 0.72 in the quad pass and 0.09 native.
- It loses mid-size arrays (25–200 m²) that native finds. Eight labels score under 0.35 in the quad pass but are found by native.
- So it only helps in combination with native, and it costs 4× native for about +1 array on this sample.

### Colour filter

- On the sample, the current filter rejected 2 boxes ≥ 0.50: a skylight on 9_8 (`white_structure`, 0.82) and skylight domes on 0_3 (0.68, in an ignore box).
- **It rejected no real array.**
- Relaxed limits (sat 0.50 / green 10 / V 215) and dropping the V rule both give the same numbers as the current filter or slightly worse ones.
- Turning the filter off adds 2–5 FP boxes in every configuration.
- Town-wide, 55 of 1,209 g0 boxes are rejected: 21 white, 18 vegetation, 16 sea/pool.

**Keep the filter as it is.**

## 4. Misses (production config A: 15 FN)

| category | count | arrays (tile [box], native score → best other pass) |
|---|---:|---|
| review tier 0.35–0.50 | 4 | 8_4 250 m² (0.49 → flip 0.73, quad 0.91); 6_3 42 m² at tile edge (0.40 → flip 0.78, quad 0.91); 22_9 18 m² (0.48 → flip 0.60); 22_9 33 m² old town (0.38) |
| low score 0.05–0.35 | 3 | 23_13 52 m² (0.21 → **flip 0.85**, quad 0.72); 6_3 19 m² on light roof (0.09 → quad 0.72); 33_12 58 m² split by a roof ridge (0.10 → flip 0.35) |
| no candidate (< 0.05) | 8 | see below |
| killed by colour filter | 0 | — |
| merged/suppressed by NMS | 0 | (pre-NMS check found none) |

The 8 "no candidate" misses:

- **All-black uniform arrays with no visible cell grid** (2): 9_8 whole roof 150 m², and 9_8 L-shaped array on a red apartment roof 163 m². These are the most visible misses in the screenshot.
- **2–3 module arrays** (4): 3_5 6 m² and 8 m²; 0_3 13 m² and 11 m² (navy, next to a grey roof).
- **Small array at the tile edge** (1): 9_8 15 m² (quad 0.29).
- **Grey, low-contrast, partly shaded modules** (1): 9_7 26 m² (quad 0.24).

Cross-cutting attributes of the 15 misses:

- **At the tile edge (within 20 px):** 4. The planned g1 half-tile pass would help with these.
- **Tiny (< 4 m²):** 0, but 4 misses are under 13 m².
- **Dark roof or dark array:** 4 (mean brightness V < 130).
- **Occluded or shaded:** 1.

After flip TTA (config D), 11 misses remain: the 8 "no candidate" arrays, plus 6_3 [335,325], 33_12 and 22_9 [406,142].

## 5. False positives (production config A: 16 boxes = 7 objects)

| category | boxes | where |
|---|---:|---|
| row of rooftop skylights or roof windows on a flat roof | 6 | 6_3 apartment block (5), 5_6 blue skylight next to arrays (1) |
| corrugated or striped grey sheet roof | 6 | 17_22 top right (several overlapping boxes, IoU < 0.45, survive NMS) |
| solar-thermal collector | 1 | 25_10 (0.85) |
| dark object (chimney or skylight) touching a real array | 1 | 23_13 |
| grey roof or parapet patch | 1 | 6_3 |
| small dark item on a red roof (unclear) | 1 | 33_12 |

None of these is a colour problem; they are all texture look-alikes. These were confirmed visually as correct non-PV:

- glass pergolas (12_9, 21_17)
- dark slate roofs (9_7, 21_17)
- trampolines and pool covers (0_3)
- a blue metal roof (8_4)
- caravans (21_17)

The model scored none of them at 0.50 or above, so they don't appear in the table.

## 6. Footprints vs detector (context for the "visible arrays not shown" screenshot)

`scripts/audit_offroof.mts` shows that only **55/98 labelled arrays have their centre inside a `roofs.json` footprint**. The arrays without one are mostly in newer developments: all 14 in 5_6, 11 of 13 in 23_13, 5 of 11 in 9_8, and so on.

- On footprints, the detector finds 43/55 arrays (78 %). Off footprints, it finds 40/43 (93 %).
- Counting only on-footprint detections, as the roof statistics do, the end-to-end share of real arrays that get credited is about **44 %**.
- So most arrays that are missing from the map are found by the detector but dropped by the footprint join. The other agent's footprint fix is worth more than any detector setting.

## 7. Recommended configuration

1. **Panel tier: native + horizontal-flip TTA**, union of both passes, NMS 0.45, score ≥ **0.50**. Keep "needs review" at 0.35–0.50 and keep the colour filter unchanged.
   - On the sample, recall goes from **0.85 to 0.89** and precision stays at **0.88**: 3 FP boxes and 2 FP objects more.
   - Cost: 2 model runs per tile, about **290 ms/tile → about 6.0 min for 1,240 tiles** at 6 threads, against 3.0 min today. Running only the 701 tiles that touch a footprint would take about 3.4 min.
2. **Don't add the 2× quadrant pass to the main scan.** Precision is excellent, but it costs 4× native for about +1 array (config I: 0.90 recall at 17.8 min).
   - It is a good *second opinion* for the review tier: a 0.35–0.50 box that the quad pass confirms at ≥ 0.6 could be promoted to panel.
   - That would need a dedicated test before adopting it.
3. **Don't lower the panel threshold.** Below 0.45, every extra array costs about 2 FP objects.
4. **Merge the g1 half-tile offset pass with g0.** Four of the 15 misses are within 20 px of a tile edge.
5. **Fine-tuning targets.** Thresholds and TTA can't reach these.
   - **Positives:** all-black gridless arrays on red tile and flat roofs (9_8), and 2–3 module arrays.
   - **Hard negatives:** skylight rows on apartment roofs (6_3), corrugated grey sheet roofs (17_22), solar-thermal collectors (25_10).

### Recommended code change (not applied — lib/ is out of scope for this audit)

`lib/detect.ts` needs a flip helper. `lib/infer.ts` needs a second run, with the two box lists merged before the colour filter:

```ts
// lib/detect.ts
export function flipX(rgb: Uint8Array, w = INPUT, h = INPUT): Uint8Array { // packed RGB, mirrored horizontally
  const o = new Uint8Array(rgb.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 3, d = (y * w + (w - 1 - x)) * 3;
    o[d] = rgb[s]; o[d + 1] = rgb[s + 1]; o[d + 2] = rgb[s + 2];
  }
  return o;
}
// decode() already runs NMS; for TTA call nms([...a, ...b]) on the two decoded lists.

// lib/infer.ts  detectJpeg()
const run = async (px: Uint8Array) => (await session.run({ images: new ort.Tensor("float32", toTensor(px, 3), [1, 3, INPUT, INPUT]) })).output0.data as Float32Array;
const a = decode(await run(resized), TILE_PX);
const b = decode(await run(flipX(resized)), TILE_PX).map((q) => ({ ...q, x1: TILE_PX - q.x2, x2: TILE_PX - q.x1 }));
const boxes = colourFilter(nms([...a, ...b]), orig, TILE_PX, 3);
```

The browser live check (canvas RGBA) needs the same two runs so that its results match the scan.

## Files

- Labels: `.cache/audit/labels.json`
- Raw candidates: `.cache/audit/raw.json`
- Evaluation outputs: `.cache/audit/eval.json`, `summary.json`, `misses.json`
- Crops: `.cache/audit/img/*.png` (the `_d` suffix means the image has detection overlays: green ≥ 0.5, cyan review, orange colour-rejected, magenta < 0.35)
- Scripts: `scripts/audit_render.mts`, `audit_infer.mts`, `audit_eval.py`, `audit_summary.py`, `audit_miss.py`, `audit_offroof.mts`
