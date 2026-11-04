"""Key configurations for docs/AUDIT.md: recall / precision (box-level and object-level) with per-pass thresholds.
Object-level FP = false-positive boxes clustered when they overlap or lie within 8 px of each other (one skylight row,
one corrugated roof = one false object)."""
import json, sys
sys.path.insert(0, 'scripts')
from audit_eval import L, R, FILTERS, reason, match, bx, nms, iou

def kept(t, v, thr, f):
    return [d for d in R['tiles'][t][v] if d['score'] >= thr and reason(d, FILTERS[f]) is None]
def run(cfg, f='current'):
    """cfg: list of (pass, threshold); boxes from all passes are merged with NMS 0.45."""
    tp_l = n_l = tp_d = fp_d = fp_o = 0
    for t, lab in L.items():
        dets = nms(sum((kept(t, v, thr, f) for v, thr in cfg), []))
        B = lab['boxes']; I = lab.get('ignore', [])
        tp_l += sum(any(match(d, b) for d in dets) for b in B); n_l += len(B)
        fps = []
        for d in dets:
            if any(match(d, b) for b in B): tp_d += 1
            elif not any(match(d, b) for b in I): fps.append(bx(d))
        fp_d += len(fps)
        # cluster FP boxes
        groups = []
        for b in fps:
            g = [b[0]-8, b[1]-8, b[2]+8, b[3]+8]
            hit = [G for G in groups if iou(G, g) > 0]
            for G in hit: groups.remove(G); g = [min(g[0], G[0]), min(g[1], G[1]), max(g[2], G[2]), max(g[3], G[3])]
            groups.append(g)
        fp_o += len(groups)
    return dict(recall=tp_l / n_l, found=tp_l, labels=n_l, precision=tp_d / (tp_d + fp_d), fp_boxes=fp_d, fp_objects=fp_o)

CFGS = {
    'A  production: native >=0.50': [('native', 0.50)],
    'B  native >=0.35 (count review tier)': [('native', 0.35)],
    'C  native >=0.25': [('native', 0.25)],
    'D  native+flip >=0.50': [('native', 0.50), ('flip', 0.50)],
    'E  native+flip >=0.40': [('native', 0.40), ('flip', 0.40)],
    'F  quad only >=0.35': [('quad', 0.35)],
    'G  native+quad >=0.50': [('native', 0.50), ('quad', 0.50)],
    'H  native >=0.50 + quad >=0.40': [('native', 0.50), ('quad', 0.40)],
    'I  native+flip >=0.50 + quad >=0.40': [('native', 0.50), ('flip', 0.50), ('quad', 0.40)],
    'J  native+flip+quad >=0.35': [('native', 0.35), ('flip', 0.35), ('quad', 0.35)],
}
COST = {'native': 1.0, 'flip': 1.0, 'quad': 4.0}  # model runs per tile, relative to native
if __name__ == '__main__':
    ms = R['timing']; base = 144
    rel = {'native': 1.0, 'flip': ms['flipMs'] / ms['nativeMs'], 'quad': ms['quadMs'] / ms['nativeMs']}
    rows = []
    for name, cfg in CFGS.items():
        for f in ['current', 'off']:
            r = run(cfg, f)
            c = sum(rel[v] for v in {v for v, _ in cfg})
            rows.append(dict(config=name, filter=f, **r, ms_per_tile=round(base * c), full_scan_min=round(base * c * 1240 / 60000, 1)))
            print(f"{name:40s} {f:8s} R {r['recall']:.3f} ({r['found']}/{r['labels']})  P {r['precision']:.3f}  FPbox {r['fp_boxes']:2d}  FPobj {r['fp_objects']:2d}  ~{base*c:.0f} ms/tile  {base*c*1240/60000:.1f} min/1240")
    json.dump(dict(relative_cost=rel, measured=ms, rows=rows), open('.cache/audit/summary.json', 'w'), indent=1)
