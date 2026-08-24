// Shared ground-texturing utilities, factored out once a second reference
// study (rice-paddy-study.jsx) needed the exact same noise/soil-sampling
// code already ported into VillagePathWalkScene.jsx.

// ---------- value noise (fbm) ----------
export function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function smooth(t) {
  return t * t * (3 - 2 * t);
}
export function noise2D(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
export function fbm(x, y, octaves = 4) {
  let total = 0;
  let amp = 0.5;
  let freq = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / max;
}
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const SOIL = {
  clumpScale: 5.5, grainScale: 18, pebbleScale: 30,
  dispClump: 0.024, dispGrain: 0.005, dispPebble: 0.014,
  colorLow: [124, 76, 54], colorHigh: [178, 108, 72], // shifted toward red clay (akatsuchi)
  speckAmt: 26, pebbleShadeAmt: 14, roughLow: 0.6, roughHigh: 0.95,
};

export function sampleType(cfg, u, v) {
  const clump = fbm(u * cfg.clumpScale, v * cfg.clumpScale, 4);
  const grain = fbm(u * cfg.grainScale + 40, v * cfg.grainScale + 40, 2);
  const pebble = fbm(u * cfg.pebbleScale + 80, v * cfg.pebbleScale + 80, 2);
  let r = cfg.colorLow[0] + (cfg.colorHigh[0] - cfg.colorLow[0]) * clump;
  let g = cfg.colorLow[1] + (cfg.colorHigh[1] - cfg.colorLow[1]) * clump;
  let b = cfg.colorLow[2] + (cfg.colorHigh[2] - cfg.colorLow[2]) * clump;
  const speck = (grain - 0.5) * cfg.speckAmt;
  r += speck; g += speck * 0.9; b += speck * 0.75;
  const pebbleShade = (pebble - 0.5) * cfg.pebbleShadeAmt;
  r += pebbleShade; g += pebbleShade * 0.9; b += pebbleShade * 0.8;
  const height = clump * cfg.dispClump + grain * cfg.dispGrain + pebble * cfg.dispPebble;
  const bumpHeight = clump * 0.5 + grain * 0.25 + pebble * 0.4;
  const rough = cfg.roughHigh - clump * (cfg.roughHigh - cfg.roughLow) - (grain - 0.5) * 0.08;
  return { r, g, b, height, bumpHeight, rough };
}
