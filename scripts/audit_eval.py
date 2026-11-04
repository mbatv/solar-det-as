"""Audit evaluation: hand labels (.cache/audit/labels.json) vs model candidates (.cache/audit/raw.json).
Match rule: a detection matches a label if IoU > 0.1 or the detection centre lies inside the label box.
Recall = labels matched by >=1 kept detection / labels.  Precision = kept detections matching a label / kept
detections not matching an 'ignore' (uncertain) box.  Writes .cache/audit/eval.json and prints tables."""
import json, sys
L = {k: v for k, v in json.load(open('.cache/audit/labels.json')).items() if not k.startswith('_')}
R = json.load(open('.cache/audit/raw.json'))

def iou(a, b):
    w = max(0, min(a[2], b[2]) - max(a[0], b[0])); h = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = w * h; u = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - i
    return i / u if u else 0
def bx(d): return [d['x1'], d['y1'], d['x2'], d['y2']]
def match(d, lab):
    b = bx(d); cx, cy = (b[0]+b[2])/2, (b[1]+b[3])/2
    return iou(b, lab) > 0.1 or (lab[0] <= cx <= lab[2] and lab[1] <= cy <= lab[3])
def nms(ds, thr=0.45):
    keep = []
    for d in sorted(ds, key=lambda d: -d['score']):
        if all(iou(bx(k), bx(d)) < thr for k in keep): keep.append(d)
    return keep
def avg_merge(a, b, thr=0.5):
    """TTA score averaging: pair boxes across the two passes, mean score; unpaired boxes keep score/2."""
    out, used = [], set()
    for d in a:
        best, bi = 0, -1
        for j, e in enumerate(b):
            if j in used: continue
            v = iou(bx(d), bx(e))
            if v > best: best, bi = v, j
        if best >= thr:
            used.add(bi); e = b[bi]
            out.append({**d, 'score': (d['score'] + e['score']) / 2})
        else: out.append({**d, 'score': d['score'] / 2})
    out += [{**e, 'score': e['score'] / 2} for j, e in enumerate(b) if j not in used]
    return nms(out)

FILTERS = {
    'off': None,
    'current': dict(sat=0.40, green=6, V=205),
    'relaxed': dict(sat=0.50, green=10, V=215),
    'no_white': dict(sat=0.40, green=6, V=999),
}
def reason(d, f):
    if f is None: return None
    if d['sat'] > f['sat']: return 'sea_pool'
    if d['green'] > f['green']: return 'vegetation'
    if d['V'] > f['V']: return 'white_structure'
    return None

def variant(t, name):
    T = R['tiles'][t]
    if name == 'native': return T['native']
    if name == 'flip': return T['flip']
    if name == 'quad': return T['quad']
    if name == 'native+flip(max)': return nms(T['native'] + T['flip'])
    if name == 'native+flip(avg)': return avg_merge(T['native'], T['flip'])
    if name == 'native+quad': return nms(T['native'] + T['quad'])
    if name == 'native+quad+flip': return nms(T['native'] + T['quad'] + T['flip'])
    raise KeyError(name)

def evaluate(name, thr, filt):
    tp_lab = n_lab = tp_det = fp_det = ign = therm = 0
    fps = []; per = {}
    for t, lab in L.items():
        f = FILTERS[filt]
        dets = [d for d in variant(t, name) if d['score'] >= thr and reason(d, f) is None]
        boxes = lab['boxes']; ignore = lab.get('ignore', []); thermal = lab.get('thermal', [])
        hit = [any(match(d, b) for d in dets) for b in boxes]
        tl = sum(hit); tp_lab += tl; n_lab += len(boxes)
        tpd = fpd = 0
        for d in dets:
            if any(match(d, b) for b in boxes): tpd += 1
            elif any(match(d, b) for b in ignore): ign += 1
            else:
                fpd += 1; fps.append((t, d))
                if any(match(d, b) for b in thermal): therm += 1
        tp_det += tpd; fp_det += fpd
        per[t] = dict(labels=len(boxes), found=tl, fp=fpd)
    P = tp_det / (tp_det + fp_det) if tp_det + fp_det else 1
    Rc = tp_lab / n_lab
    return dict(variant=name, thr=thr, filter=filt, recall=Rc, precision=P, tp_labels=tp_lab, labels=n_lab, tp_det=tp_det, fp_det=fp_det, ignored=ign, fp_thermal=therm, per_tile=per), fps

if __name__ == '__main__':
    rows = []
    for name in ['native', 'flip', 'native+flip(max)', 'native+flip(avg)', 'quad', 'native+quad', 'native+quad+flip']:
        for filt in FILTERS:
            for thr in [0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50]:
                r, _ = evaluate(name, thr, filt); rows.append(r)
    json.dump(dict(timing=R['timing'], threads=R['threads'], rows=rows), open('.cache/audit/eval.json', 'w'), indent=1)
    show = sys.argv[1:] or ['current', 'off', 'relaxed']
    for filt in show:
        print(f'\n== filter: {filt} ==')
        print(f"{'variant':20s} " + ' '.join(f'{t:>13.2f}' for t in [0.15,0.2,0.25,0.3,0.35,0.4,0.45,0.5]))
        for name in ['native', 'flip', 'native+flip(max)', 'native+flip(avg)', 'quad', 'native+quad', 'native+quad+flip']:
            cells = [r for r in rows if r['variant'] == name and r['filter'] == filt]
            print(f'{name:20s} ' + ' '.join(f"R{r['recall']:.2f}/P{r['precision']:.2f}({r['fp_det']:2d})" for r in cells))
