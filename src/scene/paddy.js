import * as THREE from "three";
import { fbm, sampleType } from "./terrain";

// Ported from reference/rice-paddy-study.jsx. The standalone study framed
// the paddy with its own four soil rectangles (buildSoilMesh calls); those
// are dropped here since the paddy now sits on top of the scene's existing
// continuous ground mesh instead of bringing its own patch of ground.

// Exported so the surrounding ground mesh can carve a matching depression —
// otherwise the scene's single continuous ground plane sits at y~0 and
// hides the whole basin (floor/water/rice) underneath it.
export const PADDY_W = 4.4; // 4x area (2x each dimension)
export const PADDY_D = 3.4;
export const PADDY_BANK_OUTER = 0.14; // levee thickness stays real-world-sized, doesn't scale with the field
export const PADDY_FLOOR_Y = -0.09;

const MUCK = {
  clumpScale: 5, grainScale: 16, pebbleScale: 26,
  dispClump: 0.014, dispGrain: 0.004, dispPebble: 0.008,
  colorLow: [46, 40, 32], colorHigh: [77, 63, 46],
  speckAmt: 12, pebbleShadeAmt: 10, roughLow: 0.55, roughHigh: 0.85,
};
// MUCK's rough average — the color the surrounding ground fades toward as
// it approaches the paddy, so dry soil meets wet mud gradually
export const PADDY_FRINGE_COLOR = [61, 51, 39];

function buildSoilTextures(cfg, w, d, x, z) {
  const texW = Math.max(64, Math.round(w * 130));
  const texH = Math.max(64, Math.round(d * 130));
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = texW; colorCanvas.height = texH;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = texW; bumpCanvas.height = texH;
  const bctx = bumpCanvas.getContext("2d");
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = texW; roughCanvas.height = texH;
  const rctx = roughCanvas.getContext("2d");
  const cimg = cctx.createImageData(texW, texH);
  const bimg = bctx.createImageData(texW, texH);
  const rimg = rctx.createImageData(texW, texH);
  for (let py = 0; py < texH; py++) {
    const wz = z + (py / texH) * d - d / 2;
    for (let px = 0; px < texW; px++) {
      const wx = x + (px / texW) * w - w / 2;
      const s = sampleType(cfg, wx, wz);
      const idx = (py * texW + px) * 4;
      cimg.data[idx] = Math.max(0, Math.min(255, s.r));
      cimg.data[idx + 1] = Math.max(0, Math.min(255, s.g));
      cimg.data[idx + 2] = Math.max(0, Math.min(255, s.b));
      cimg.data[idx + 3] = 255;
      const hByte = Math.max(0, Math.min(255, s.bumpHeight * 255));
      bimg.data[idx] = bimg.data[idx + 1] = bimg.data[idx + 2] = hByte;
      bimg.data[idx + 3] = 255;
      const rByte = Math.max(0, Math.min(255, s.rough * 255));
      rimg.data[idx] = rimg.data[idx + 1] = rimg.data[idx + 2] = rByte;
      rimg.data[idx + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.encoding = THREE.sRGBEncoding;
  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  const roughTex = new THREE.CanvasTexture(roughCanvas);
  return { colorTex, bumpTex, roughTex };
}

function buildSoilMaterial(cfg, w, d, x, z) {
  const { colorTex, bumpTex, roughTex } = buildSoilTextures(cfg, w, d, x, z);
  return new THREE.MeshStandardMaterial({
    map: colorTex, bumpMap: bumpTex, bumpScale: 0.015,
    roughnessMap: roughTex, roughness: 1, metalness: 0.02,
  });
}

function paintTexture(draw, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// flat, unlit muck for the paddy floor itself
function muckTexture() {
  return paintTexture((ctx, s) => {
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const u = px / s, v = py / s;
        const clump = fbm(u * 5, v * 5, 4);
        const dry = [77, 63, 46], wet = [46, 40, 32];
        let r = dry[0] + (wet[0] - dry[0]) * clump;
        let g = dry[1] + (wet[1] - dry[1]) * clump;
        let b = dry[2] + (wet[2] - dry[2]) * clump;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }, 128);
}

function paddyWaterTextures() {
  const size = 256;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");
  const cimg = cctx.createImageData(size, size);
  const bimg = bctx.createImageData(size, size);

  const deep = [24, 58, 84];
  const lit = [66, 126, 166];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size;
      const swell = fbm(u * 3.2, v * 3.2, 3);
      const ripple = fbm(u * 16 + 50, v * 16 + 50, 3);
      const t = swell * 0.7 + ripple * 0.3;
      const r = deep[0] + (lit[0] - deep[0]) * t;
      const g = deep[1] + (lit[1] - deep[1]) * t;
      const b = deep[2] + (lit[2] - deep[2]) * t;
      const idx = (py * size + px) * 4;
      cimg.data[idx] = r; cimg.data[idx + 1] = g; cimg.data[idx + 2] = b; cimg.data[idx + 3] = 255;
      const height = swell * 0.5 + ripple * 0.5;
      const hByte = Math.max(0, Math.min(255, height * 255));
      bimg.data[idx] = bimg.data[idx + 1] = bimg.data[idx + 2] = hByte;
      bimg.data[idx + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.encoding = THREE.sRGBEncoding;
  colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.repeat.set(1, 1); // the noise doesn't tile seamlessly at >1 repeat
  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.repeat.set(1, 1);
  return { colorTex, bumpTex };
}

function buildRiceBladeGeometry() {
  const geo = new THREE.PlaneGeometry(0.01, 0.15, 1, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // clamp: floating-point rounding can push t just past 0 or 1, and a
    // fractional power of a negative base is NaN in JS (caught via the
    // screenshot loop's console-error check — the artifact environment that
    // originated this code had no way to see it)
    const t = Math.max(0, Math.min(1, (y + 0.075) / 0.15));
    pos.setZ(i, Math.pow(t, 1.8) * 0.035);
    pos.setX(i, pos.getX(i) * Math.pow(1 - t, 0.85));
  }
  geo.translate(0, 0.075, 0);
  geo.computeVertexNormals();
  return geo;
}

function buildRiceHill(bladeGeo) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x1f7a1a, side: THREE.DoubleSide });
  const bladeCount = 9;
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(bladeGeo, mat);
    blade.rotation.y = (i / bladeCount) * Math.PI * 2 + Math.random() * 0.6;
    blade.rotation.z = (Math.random() - 0.5) * 0.12;
    blade.position.set((Math.random() - 0.5) * 0.012, 0, (Math.random() - 0.5) * 0.012);
    const h = 0.8 + Math.random() * 0.35;
    blade.scale.set(0.85 + Math.random() * 0.3, h, 1);
    blade.castShadow = false;
    group.add(blade);
  }
  return group;
}

// Builds one paddy basin (levee banks + muck floor + water + rice), without
// any surrounding ground — the caller positions it on top of its own scene's
// ground mesh. Returns { root, water } — `water`'s map/bumpMap offsets
// should be animated per-frame by the caller for the shimmer effect.
export function buildPaddy() {
  const root = new THREE.Group();

  // real-world proportions: levee ~30cm above the paddy floor, water kept
  // ~5cm deep. Scale is set by the rice plants (~50cm tall = 0.15 units).
  const paddyW = PADDY_W, paddyD = PADDY_D;
  const bankTop = 0, floorY = PADDY_FLOOR_Y;
  const waterY = -0.075;
  const bankOuter = PADDY_BANK_OUTER;
  const hw = paddyW / 2, hd = paddyD / 2;

  const muckMat = new THREE.MeshBasicMaterial({ map: muckTexture() });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(paddyW, paddyD), muckMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  root.add(floor);

  // A hand-formed mud levee isn't laser-straight, so each side is a chain of
  // short segments with their own small sideways wobble and height jitter,
  // instead of one perfectly flat box.
  const wallH = bankTop - floorY;
  function buildWallLine(length, thickness, centerX, centerZ, axis) {
    const group = new THREE.Group();
    const segLen = 0.3;
    const segCount = Math.max(1, Math.round(length / segLen));
    const actualSegLen = length / segCount;
    for (let i = 0; i < segCount; i++) {
      const along = -length / 2 + actualSegLen * (i + 0.5);
      const jitterPerp = (Math.random() - 0.5) * thickness * 0.4;
      const jitterH = wallH * (0.82 + Math.random() * 0.36);
      const x = axis === "x" ? centerX + along : centerX + jitterPerp;
      const z = axis === "x" ? centerZ + jitterPerp : centerZ + along;
      // segments overlap along their length so the sideways wobble never
      // opens a gap between neighbors
      const segW = axis === "x" ? actualSegLen * 1.15 : thickness;
      const segD = axis === "x" ? thickness : actualSegLen * 1.15;
      const mat = buildSoilMaterial(MUCK, segW, segD, x, z);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(segW, jitterH, segD), mat);
      seg.position.set(x, floorY + jitterH / 2, z);
      seg.receiveShadow = true;
      seg.castShadow = true;
      group.add(seg);
    }
    return group;
  }
  const banks = new THREE.Group();
  const bankLength = hw * 2 + bankOuter * 2 + 0.02;
  banks.add(buildWallLine(bankLength, bankOuter, 0, -hd - bankOuter / 2, "x"));
  banks.add(buildWallLine(bankLength, bankOuter, 0, hd + bankOuter / 2, "x"));
  banks.add(buildWallLine(hd * 2, bankOuter, hw + bankOuter / 2, 0, "z"));
  banks.add(buildWallLine(hd * 2, bankOuter, -hw - bankOuter / 2, 0, "z"));
  root.add(banks);

  const { colorTex: waterColorTex, bumpTex: waterBumpTex } = paddyWaterTextures();
  const waterMat = new THREE.MeshStandardMaterial({
    map: waterColorTex, bumpMap: waterBumpTex, bumpScale: 0.006,
    roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.95,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(paddyW - 0.02, paddyD - 0.02), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterY;
  root.add(water);

  const bladeGeo = buildRiceBladeGeometry();
  const cols = 15, rows = 11;
  const marginX = 0.14, marginZ = 0.12;
  const usableW = paddyW - marginX * 2;
  const usableD = paddyD - marginZ * 2;
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = -paddyW / 2 + marginX + (usableW * ix) / (cols - 1) + (Math.random() - 0.5) * 0.02;
      const z = -paddyD / 2 + marginZ + (usableD * iz) / (rows - 1) + (Math.random() - 0.5) * 0.02;
      const hill = buildRiceHill(bladeGeo);
      hill.position.set(x, floorY + 0.008, z);
      root.add(hill);
    }
  }

  return { root, water };
}
