// Diagnostic: dump our JS bilinear resize of a tile so it can be compared with OpenCV INTER_LINEAR.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resizeBilinear } from "../lib/detect";
const orig = await sharp(process.argv[2]).removeAlpha().raw().toBuffer();
writeFileSync(process.argv[3], resizeBilinear(orig, 512, 512, 3));
