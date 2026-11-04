# Solar Radar — Brief

**One sentence:** click a neighbourhood in Spain → a model finds the solar panels on every roof in that circle from the latest aerial photo → the area is ranked against similar neighbourhoods and the town → you get a verdict, a work plan and a ranked lead list of roofs without panels.

The core idea: give companies that install solar panels evidence of the areas where demand is likely. Cambrils (Tarragona) is the pilot region; the plan is to expand across Spain once the model is trained and everything works.

## MUST — the core flow

1. **Map:** Cambrils on the latest ICGC aerial photo (25 cm), showing **the photo's real flight date**.
2. **Detection:** a pretrained solar-panel model scans the whole pilot area once (local script, runs in the background during the build). The detected arrays are drawn on the map and matched to roof outlines.
3. **Click an area** (radius 100 / 200 / 350 m):
   - roofs in the circle, roofs with detected panels, share with a 95% interval;
   - rank against all 256 m neighbourhoods in town, and against the 20 with the most similar housing;
   - **verdict + 2–3 work items**.
4. **Lead list:** roofs without detected panels, largest first, with estimated kWp, kWh/yr and €/yr (assumptions shown). CSV download.
5. **Campaigns in Supabase:** "Save this area as a campaign" stores the area, verdict and leads. Each lead has a gated status (`to_visit → visited → quoted → won | lost`) with an event log, and there is a campaigns list page.
6. **Deployed** on Vercel, free plan.

## SHOULD (if on time)

- **Live check:** "Re-check this tile live" runs the same model **in the browser** (onnxruntime-web) on the current photo tile and draws the boxes. This proves detection is real, not just precomputed.
- **Calibration:** label one street and report found / missed / false in the README and UI.
- **Town context:** registered PV per 1,000 residents, Cambrils vs 5 neighbours (official registry).

## OUT

Model training/fine-tuning (no time, not needed: the pretrained model at threshold 0.5 plus a colour filter is good enough to rank areas), auth beyond one demo installer, payments, PDFs, 3D, a change-over-time comparison.

## Design

Terminal black & white aesthetic, minimalism. Landing page has a spinning ASCII Earth (real Natural Earth coastlines via `scripts/build_landmask.py`, lit sphere, Spain in bright white, starts facing Madrid, turns east once every 40 s, status line with centre longitude and whether Spain is in view, ~20 fps, pauses when hidden, still under reduced motion).
