import * as ort from "onnxruntime-node";
import sharp from "sharp";
import { INPUT, colourFilter, decode, resizeBilinear, toTensor } from "./detect";
import { TILE_PX } from "./tiles";

export async function loadModel(path = "models/best.onnx", threads = 1) {
  return ort.InferenceSession.create(path, { intraOpNumThreads: threads, graphOptimizationLevel: "all" });
}

export async function detectJpeg(session: ort.InferenceSession, jpeg: Buffer) {
  const orig = await sharp(jpeg).removeAlpha().raw().toBuffer();
  const resized = resizeBilinear(orig, TILE_PX, TILE_PX, 3);
  const t0 = performance.now();
  const res = await session.run({ images: new ort.Tensor("float32", toTensor(resized, 3), [1, 3, INPUT, INPUT]) });
  const ms = performance.now() - t0;
  return { boxes: colourFilter(decode(res.output0.data as Float32Array, TILE_PX), orig, TILE_PX, 3), ms };
}
