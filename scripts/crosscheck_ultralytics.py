"""Cross-check our TS decode against Ultralytics' own predict on the same cached tiles (conf 0.5, iou 0.45)."""
import json
from ultralytics import YOLO

m = YOLO("models/best.onnx", task="segment")
ours = json.load(open("public/debug/tiles.json"))
for t in ours["tiles"]:
    r = m.predict(f".cache/tiles/g0/{t['col']}_{t['row']}.jpg", imgsz=640, conf=0.5, iou=0.45, verbose=False)[0]
    ref = sorted(round(float(s), 2) for s in r.boxes.conf)
    mine = sorted(round(b["score"], 2) for b in t["boxes"])
    print(t["col"], t["row"], "ultralytics", len(ref), "ours", len(mine), "MATCH" if len(ref) == len(mine) else f"DIFF {ref} vs {mine}")
