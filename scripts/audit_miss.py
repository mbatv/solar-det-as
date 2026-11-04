"""Categorise misses (FN) and false positives (FP) of the production config (native pass, score >= 0.50,
current colour filter) on the labelled sample. Prints a table and writes .cache/audit/misses.json."""
import json, sys
sys.path.insert(0, 'scripts')
from audit_eval import L, R, FILTERS, reason, match, bx, nms, evaluate
from PIL import Image
import numpy as np

THR = 0.50
F = FILTERS['current']
# Visual tags from the labelling pass (what the array looks like); keyed by tile and label box.
VISUAL = {
    ('9_8', (346, 10, 398, 56)): 'dark/black uniform array (no cell grid), whole roof',
    ('9_8', (205, 302, 256, 353)): 'dark/black uniform array (no cell grid) on red apartment roof',
    ('9_8', (428, 6, 444, 21)): 'small array at tile edge',
    ('9_7', (55, 472, 76, 492)): 'grey low-contrast modules, partly shaded',
    ('3_5', (407, 317, 418, 326)): 'two modules',
    ('3_5', (423, 385, 437, 394)): 'two modules',
    ('0_3', (452, 318, 469, 330)): 'small array (2-3 modules)',
    ('0_3', (446, 336, 459, 350)): 'small array (2-3 modules)',
    ('6_3', (335, 325, 350, 345)): 'small array on light roof',
    ('33_12', (290, 152, 320, 183)): 'array split in two by roof ridge, red tile',
}
def stats(id, b):
    img = np.asarray(Image.open(f'.cache/tiles/g0/{id}.jpg').convert('RGB')).astype(float)
    x1, y1, x2, y2 = map(int, b)
    p = img[y1:y2, x1:x2].reshape(-1, 3)
    return float(p.max(1).mean())

out = {'fn': [], 'fp': []}
for t, lab in L.items():
    T = R['tiles'][t]
    kept = [d for d in T['native'] if d['score'] >= THR and reason(d, F) is None]
    for b in lab['boxes']:
        if any(match(d, b) for d in kept): continue
        area = (b[2]-b[0]) * (b[3]-b[1]) * 0.0625
        edge = min(b[0], b[1], 512-b[2], 512-b[3]) <= 20
        cand = [d for d in T['native'] if match(d, b)]
        best = max(cand, key=lambda d: d['score']) if cand else None
        pre = [d for d in T['nativeNoNms'] if d['score'] >= THR and match(d, b)]
        bf = max([d['score'] for d in T['flip'] if match(d, b)], default=0)
        bq = max([d['score'] for d in T['quad'] if match(d, b)], default=0)
        s = best['score'] if best else 0
        if best and s >= THR and reason(best, F): cat = f'colour filter: {reason(best, F)}'
        elif pre: cat = 'suppressed by NMS (pre-NMS box >= 0.5 existed)'
        elif s >= 0.35: cat = 'review tier 0.35-0.50'
        elif s >= 0.20: cat = 'low score 0.20-0.35'
        elif s >= 0.05: cat = 'low score 0.05-0.20'
        else: cat = 'no candidate (< 0.05)'
        out['fn'].append(dict(tile=t, box=b, area_m2=round(area, 1), edge=edge, tiny=area < 4, best_native=round(s, 3),
                              best_flip=round(bf, 3), best_quad=round(bq, 3), category=cat, V=round(stats(t, b)),
                              visual=VISUAL.get((t, tuple(b)), '')))
r, fps = evaluate('native', THR, 'current')
for t, d in fps:
    th = any(match(d, b) for b in L[t].get('thermal', []))
    near = any(match(d, [b[0]-10, b[1]-10, b[2]+10, b[3]+10]) for b in L[t]['boxes'])
    out['fp'].append(dict(tile=t, box=[round(v) for v in bx(d)], score=d['score'], V=d['V'], sat=d['sat'], green=d['green'],
                          auto='solar thermal' if th else ('fragment next to a labelled array' if near else '')))
json.dump(out, open('.cache/audit/misses.json', 'w'), indent=1)
print(f"FN {len(out['fn'])}")
for m in out['fn']: print(' ', m['tile'], m['box'], f"{m['area_m2']}m2", 'EDGE' if m['edge'] else '', 'TINY' if m['tiny'] else '', 'nat', m['best_native'], 'flip', m['best_flip'], 'quad', m['best_quad'], 'V', m['V'], '|', m['category'], '|', m['visual'])
print(f"FP {len(out['fp'])}")
for m in out['fp']: print(' ', m)
