"""Export the pinned finloop YOLOv8s-seg solar-panel model to ONNX (see docs/DETECTION.md)."""
from ultralytics import YOLO

model = YOLO("models/best.pt")
print("classes:", model.names)
path = model.export(format="onnx", imgsz=640, opset=17, simplify=False, device="cpu")
print("exported:", path)
