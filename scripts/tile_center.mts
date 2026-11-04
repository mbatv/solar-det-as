// Print the lon/lat centre of a g0 tile: tsx scripts/tile_center.mts 5_6
import { tile, pxToLonLat } from "../lib/tiles";
const [c, r] = process.argv[2].split("_").map(Number);
const [lon, lat] = pxToLonLat(tile(c, r), 256, 256);
console.log(lat.toFixed(6), lon.toFixed(6));
