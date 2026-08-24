import { useEffect, useRef } from "react";
import * as THREE from "three";

// Ported from reference/village-path-walk-study.jsx — per
// farmer-sim-design-doc-v2.md section 4, this is the most complete
// reference implementation (terrain + a farmer walking a single path).
// Logic is carried over as-is; only the outer demo-page chrome (title,
// Google Fonts import, fixed-size card layout) is dropped in favor of a
// full-bleed mount, matching how the rest of the app's scenes are hosted.

const GRID_SIZE = 11;

// ---------- value noise (fbm) — ground ----------
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t) {
  return t * t * (3 - 2 * t);
}
function noise2D(x, y) {
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
function fbm(x, y, octaves = 4) {
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
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const SOIL = {
  clumpScale: 5.5, grainScale: 18, pebbleScale: 30,
  dispClump: 0.024, dispGrain: 0.005, dispPebble: 0.014,
  colorLow: [134, 109, 82], colorHigh: [181, 148, 109],
  speckAmt: 26, pebbleShadeAmt: 14, roughLow: 0.6, roughHigh: 0.95,
};
const PATH = {
  clumpScale: 7, grainScale: 22, pebbleScale: 36,
  dispClump: 0.01, dispGrain: 0.003, dispPebble: 0.007,
  colorLow: [180, 165, 125], colorHigh: [206, 191, 150],
  speckAmt: 14, pebbleShadeAmt: 8, roughLow: 0.7, roughHigh: 0.95,
};
const PATH_CENTER_X = 0;
const PATH_HALF_WIDTH = 0.6; // doubled from the reference study's 0.3
const PATH_EDGE_SOFT = 0.3;

function sampleType(cfg, u, v) {
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
function groundSample(worldX, worldZ) {
  const soil = sampleType(SOIL, worldX, worldZ);
  const path = sampleType(PATH, worldX, worldZ);
  const dist = Math.abs(worldX - PATH_CENTER_X);
  const t = 1 - smoothstep(PATH_HALF_WIDTH, PATH_HALF_WIDTH + PATH_EDGE_SOFT, dist);
  return {
    r: soil.r + (path.r - soil.r) * t,
    g: soil.g + (path.g - soil.g) * t,
    b: soil.b + (path.b - soil.b) * t,
    height: soil.height + (path.height - soil.height) * t,
    bumpHeight: soil.bumpHeight + (path.bumpHeight - soil.bumpHeight) * t,
    rough: soil.rough + (path.rough - soil.rough) * t,
  };
}
function buildGroundTextures(texW, texH, worldW, worldD) {
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
    const worldZ = (py / texH) * worldD - worldD / 2;
    for (let px = 0; px < texW; px++) {
      const worldX = (px / texW) * worldW - worldW / 2;
      const s = groundSample(worldX, worldZ);
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
function buildGround() {
  const worldW = GRID_SIZE;
  const worldD = GRID_SIZE;
  const segs = 88;
  const geo = new THREE.PlaneGeometry(worldW, worldD, segs, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i);
    const worldZ = pos.getY(i);
    const s = groundSample(worldX, worldZ);
    pos.setZ(i, s.height);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const texPerUnit = 130;
  const { colorTex, bumpTex, roughTex } = buildGroundTextures(
    Math.round(worldW * texPerUnit), Math.round(worldD * texPerUnit), worldW, worldD
  );
  const mat = new THREE.MeshStandardMaterial({
    map: colorTex, bumpMap: bumpTex, bumpScale: 0.015,
    roughnessMap: roughTex, roughness: 1, metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- farmer character ----------
function buildAODecal(radius) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(20,14,8,0.5)");
  grad.addColorStop(0.7, "rgba(20,14,8,0.2)");
  grad.addColorStop(1, "rgba(20,14,8,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  mesh.renderOrder = 1;
  return mesh;
}
function boneLocal(length, radiusA, radiusB, material, segments = 8) {
  const geo = new THREE.CylinderGeometry(radiusA, radiusB, length, segments);
  geo.translate(0, -length / 2, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  return mesh;
}
function fabricTexture(baseHex, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(baseHex);
  ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 3) {
    ctx.globalAlpha = i % 6 === 0 ? 0.1 : 0.06;
    ctx.strokeStyle = i % 6 === 0 ? "#000000" : "#ffffff";
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}
function strawTexture(baseHex, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(baseHex);
  ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(90,65,30,0.35)";
  ctx.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 7) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + size, size); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function buildFarmerRigged() {
  const group = new THREE.Group();

  const skin = 0xe3bd93;
  const tunic = 0x2e4a63;
  const trousers = 0x4a3c2b;
  const sash = 0xb5453a;
  const hatColor = 0xd8c37c;
  const shoe = 0xc2a670;
  const hair = 0x241d16;

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const tunicMat = new THREE.MeshStandardMaterial({ map: fabricTexture(tunic), roughness: 0.85 });
  const trouserMat = new THREE.MeshStandardMaterial({ map: fabricTexture(trousers), roughness: 0.9 });
  const sashMat = new THREE.MeshStandardMaterial({ color: sash, roughness: 0.7 });
  const hatMat = new THREE.MeshStandardMaterial({ map: strawTexture(hatColor), roughness: 0.95 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: shoe, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.5 });
  const kyahanMat = new THREE.MeshStandardMaterial({ map: fabricTexture(0x6b5a3f), roughness: 0.95 });
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2d, roughness: 1 });

  group.add(buildAODecal(0.36));

  // upper body (torso, head, hat, arms) pivots forward from the hip — a
  // gentle stoop, like someone walking a field path. Legs stay vertical.
  const HIP_Y = 0.29;
  const STOOP_ANGLE = -0.32;
  const spinePivot = new THREE.Group();
  spinePivot.position.set(0, HIP_Y, 0);
  spinePivot.rotation.x = STOOP_ANGLE;
  group.add(spinePivot);

  const torsoCurve = [
    [0.0, 0.28], [0.0775, 0.3], [0.07, 0.36], [0.061, 0.44],
    [0.059, 0.52], [0.064, 0.58], [0.05, 0.64], [0.025, 0.665], [0.0, 0.67],
  ].map(([r, y]) => new THREE.Vector2(r, y - HIP_Y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoCurve, 16), tunicMat);
  torso.castShadow = true;
  spinePivot.add(torso);

  const sashMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.066, 0.055, 16), sashMat);
  sashMesh.position.y = 0.47 - HIP_Y;
  spinePivot.add(sashMesh);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.02, 0.035, 10), skinMat);
  neck.position.y = 0.685 - HIP_Y;
  spinePivot.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.092, 16, 12), skinMat);
  head.scale.set(0.46, 1, 0.48);
  head.position.y = 0.78 - HIP_Y;
  head.castShadow = true;
  spinePivot.add(head);

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.096, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
  hairCap.scale.set(0.46, 1, 0.48);
  hairCap.position.y = 0.795 - HIP_Y;
  hairCap.castShadow = true;
  spinePivot.add(hairCap);
  const knot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.09, 8), hairMat);
  knot.position.set(0, 0.83 - HIP_Y, -0.08);
  knot.rotation.x = 0.5;
  spinePivot.add(knot);

  const brim = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.065, 20), hatMat);
  brim.position.y = 0.855 - HIP_Y;
  brim.castShadow = true;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.09, 14), hatMat);
  crown.position.y = 0.89 - HIP_Y;
  crown.castShadow = true;
  spinePivot.add(brim, crown);

  // ---- animated limbs: hip/shoulder pivots (thigh/upper-arm swing) each
  // contain a knee/elbow pivot (shin/forearm swing), all rotating on a single
  // local X axis only, so composition is always unambiguous.
  const THIGH_LEN = 0.131;
  const SHIN_LEN = 0.141;
  const UPPER_ARM_LEN = 0.153;
  const FOREARM_LEN = 0.136;

  function buildKyahanLocal(shinLen) {
    const wraps = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = 0.22 + i * 0.26;
      const r = 0.021 - (0.021 - 0.016) * t;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.003, 0.006, 6, 12), kyahanMat);
      ring.position.set(0, -shinLen * t, 0);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = true;
      wraps.add(ring);
    }
    return wraps;
  }
  function buildWaraji() {
    const foot = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.01, 8), shoeMat);
    sole.scale.z = 1.9;
    sole.position.y = 0.005;
    sole.castShadow = true;
    foot.add(sole);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.058, 6), strapMat);
    strap.rotation.z = Math.PI / 2;
    strap.rotation.y = 0.3;
    strap.position.set(0, 0.014, -0.006);
    foot.add(strap);
    return foot;
  }

  function buildLeg(sideX) {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(sideX, 0.29, 0);
    hipPivot.add(boneLocal(THIGH_LEN, 0.025, 0.021, trouserMat, 10));

    const kneePivot = new THREE.Group();
    kneePivot.position.set(0, -THIGH_LEN, 0);
    const kneeCap = new THREE.Mesh(new THREE.SphereGeometry(0.021, 10, 8), trouserMat);
    kneeCap.castShadow = false;
    kneePivot.add(kneeCap);
    kneePivot.add(boneLocal(SHIN_LEN, 0.021, 0.016, trouserMat, 10));
    kneePivot.add(buildKyahanLocal(SHIN_LEN));
    const waraji = buildWaraji();
    waraji.position.set(0, -SHIN_LEN, 0.02);
    kneePivot.add(waraji);

    hipPivot.add(kneePivot);
    return { hipPivot, kneePivot };
  }

  function buildArm(sideX) {
    const shoulderPivot = new THREE.Group();
    shoulderPivot.position.set(sideX, 0.6 - HIP_Y, 0);
    const shoulderCap = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 12), tunicMat);
    shoulderCap.scale.set(1, 1.4, 1);
    shoulderCap.position.y = -0.01;
    shoulderCap.castShadow = false;
    shoulderPivot.add(shoulderCap);
    shoulderPivot.add(boneLocal(UPPER_ARM_LEN, 0.0375, 0.024, tunicMat, 10));

    const elbowPivot = new THREE.Group();
    elbowPivot.position.set(0, -UPPER_ARM_LEN, 0);
    const elbowCap = new THREE.Mesh(new THREE.SphereGeometry(0.024, 10, 8), tunicMat);
    elbowCap.castShadow = false;
    elbowPivot.add(elbowCap);
    elbowPivot.add(boneLocal(FOREARM_LEN, 0.024, 0.016, tunicMat, 10));
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), skinMat);
    hand.position.set(0, -FOREARM_LEN, 0);
    elbowPivot.add(hand);

    shoulderPivot.add(elbowPivot);
    return { shoulderPivot, elbowPivot };
  }

  const legL = buildLeg(-0.07);
  const legR = buildLeg(0.07);
  const armL = buildArm(-0.095);
  const armR = buildArm(0.095);
  group.add(legL.hipPivot, legR.hipPivot);
  spinePivot.add(armL.shoulderPivot, armR.shoulderPivot);

  return {
    group,
    joints: {
      hipL: legL.hipPivot, kneeL: legL.kneePivot,
      hipR: legR.hipPivot, kneeR: legR.kneePivot,
      shoulderL: armL.shoulderPivot, elbowL: armL.elbowPivot,
      shoulderR: armR.shoulderPivot, elbowR: armR.elbowPivot,
    },
  };
}

// Encapsulates one farmer's walk-the-path state machine so multiple
// instances can share the logic while walking their own lane (laneX) with
// their own timing, instead of colliding on a single shared position.
function createWalker({ farmer, joints, laneX, walkZFrom, walkZTo, walkDuration, stepFreq, turnDuration, startDir }) {
  const legSwing = 0.25;
  const kneeBend = 0.9;
  const armSwing = 0.4;

  let dir = startDir;
  let z = startDir > 0 ? walkZFrom : walkZTo;
  let state = "walking"; // "walking" | "turning"
  let turnStart = 0;
  let turnFromY = 0;
  let turnToY = 0;
  let turnJointsAtStart = null;

  farmer.position.set(laneX, 0, z);
  farmer.rotation.y = dir > 0 ? Math.PI : 0;

  function jointRotations(phase) {
    return {
      hipL: legSwing * Math.sin(phase),
      hipR: legSwing * Math.sin(phase + Math.PI),
      kneeL: -kneeBend * Math.max(0, Math.sin(phase + 0.5)),
      kneeR: -kneeBend * Math.max(0, Math.sin(phase + Math.PI + 0.5)),
      shoulderL: armSwing * Math.sin(phase + Math.PI),
      shoulderR: armSwing * Math.sin(phase),
      elbowL: 0.15 + 0.15 * Math.max(0, Math.sin(phase + Math.PI + 0.3)),
      elbowR: 0.15 + 0.15 * Math.max(0, Math.sin(phase + 0.3)),
    };
  }
  function applyJointRotations(r) {
    joints.hipL.rotation.x = r.hipL;
    joints.hipR.rotation.x = r.hipR;
    joints.kneeL.rotation.x = r.kneeL;
    joints.kneeR.rotation.x = r.kneeR;
    joints.shoulderL.rotation.x = r.shoulderL;
    joints.shoulderR.rotation.x = r.shoulderR;
    joints.elbowL.rotation.x = r.elbowL;
    joints.elbowR.rotation.x = r.elbowR;
  }

  return {
    update(t, dt) {
      if (state === "walking") {
        const span = walkZTo - walkZFrom;
        const baseSpeed = span / walkDuration;
        const phase = t * Math.PI * 2 * stepFreq;
        // forward speed pulses with the stride: fastest as the legs cross
        // underneath (phase 0, π), nearly paused right as a foot plants
        // (phase π/2, 3π/2) — instead of a constant glide.
        const speedMultiplier = Math.abs(Math.cos(phase)) * 1.571; // avg(|cos|)=2/π, so this averages to 1
        z += dir * baseSpeed * speedMultiplier * dt;
        applyJointRotations(jointRotations(phase));
        farmer.position.set(laneX, Math.abs(Math.sin(phase)) * 0.014, z);
        farmer.rotation.y = dir > 0 ? Math.PI : 0;

        if (z >= walkZTo || z <= walkZFrom) {
          z = z >= walkZTo ? walkZTo : walkZFrom;
          farmer.position.set(laneX, 0, z);
          state = "turning";
          turnStart = t;
          turnFromY = farmer.rotation.y;
          turnToY = dir > 0 ? 0 : Math.PI; // faces the opposite way once turned
          turnJointsAtStart = jointRotations(phase);
        }
      } else {
        // turning in place: relax the stride toward a neutral stance while
        // rotating 180° to face back the way it came
        const tt = Math.min(1, (t - turnStart) / turnDuration);
        const ease = tt < 0.5 ? 2 * tt * tt : 1 - Math.pow(-2 * tt + 2, 2) / 2;
        farmer.rotation.y = turnFromY + (turnToY - turnFromY) * ease;
        const relax = 1 - ease;
        applyJointRotations({
          hipL: turnJointsAtStart.hipL * relax,
          hipR: turnJointsAtStart.hipR * relax,
          kneeL: turnJointsAtStart.kneeL * relax,
          kneeR: turnJointsAtStart.kneeR * relax,
          shoulderL: turnJointsAtStart.shoulderL * relax,
          shoulderR: turnJointsAtStart.shoulderR * relax,
          elbowL: turnJointsAtStart.elbowL * relax + 0.15 * ease,
          elbowR: turnJointsAtStart.elbowR * relax + 0.15 * ease,
        });
        farmer.position.set(laneX, Math.sin(tt * Math.PI) * 0.01, z);

        if (tt >= 1) {
          dir = -dir;
          state = "walking";
        }
      }
    },
  };
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 3.2;

export default function VillagePathWalkScene() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();

    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const d = 3.4;
    const camera = new THREE.OrthographicCamera(
      (-d * width) / height, (d * width) / height, d, -d, 0.1, 100
    );
    camera.position.set(5.2, 5.2, 5.2);
    camera.lookAt(0, 0.3, 0);
    camera.zoom = 1;
    camera.updateProjectionMatrix();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xb9cbe0, 0x3a3226, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.2);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // covers the ground itself, for its own gentle terrain relief —
    // no longer needs to track the character, which no longer casts shadow
    sun.shadow.camera.left = -5.8;
    sun.shadow.camera.right = 5.8;
    sun.shadow.camera.top = 5.8;
    sun.shadow.camera.bottom = -5.8;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 24;
    sun.shadow.bias = -0.0018;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.18);
    scene.add(fill);

    const ground = buildGround();
    scene.add(ground);

    // Two farmers, each in their own lane offset from the path center so
    // they can never collide even when crossing at the same z. Slightly
    // different pacing keeps them from looking robotically synced.
    const walkZFrom = -4.3;
    const walkZTo = 4.3;
    const LANE_OFFSET = 0.18; // well inside the widened solid path (half-width 0.6)

    const farmerA = buildFarmerRigged();
    farmerA.group.traverse((obj) => { obj.castShadow = false; });
    scene.add(farmerA.group);
    const walkerA = createWalker({
      farmer: farmerA.group,
      joints: farmerA.joints,
      laneX: PATH_CENTER_X - LANE_OFFSET,
      walkZFrom, walkZTo,
      walkDuration: 32,
      stepFreq: 0.7,
      turnDuration: 0.9,
      startDir: 1,
    });

    const farmerB = buildFarmerRigged();
    farmerB.group.traverse((obj) => { obj.castShadow = false; });
    scene.add(farmerB.group);
    const walkerB = createWalker({
      farmer: farmerB.group,
      joints: farmerB.joints,
      laneX: PATH_CENTER_X + LANE_OFFSET,
      walkZFrom, walkZTo,
      walkDuration: 27,
      stepFreq: 0.85,
      turnDuration: 0.9,
      startDir: -1,
    });

    const clock = new THREE.Clock();
    function animate() {
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();
      walkerA.update(t, dt);
      walkerB.update(t, dt);
      renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    function handleResize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.left = (-d * w) / h;
      camera.right = (d * w) / h;
      camera.top = d;
      camera.bottom = -d;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    // ---- zoom: mouse wheel (desktop) + two-finger pinch (touch) ----
    function setZoom(z) {
      camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
      camera.updateProjectionMatrix();
    }
    function onWheel(e) {
      e.preventDefault();
      setZoom(camera.zoom * (1 - e.deltaY * 0.001));
    }
    const activePointers = new Map();
    let pinchStartDist = null;
    let pinchStartZoom = 1;
    function pointerDistance() {
      const pts = [...activePointers.values()];
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    function onPointerDown(e) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        pinchStartDist = pointerDistance();
        pinchStartZoom = camera.zoom;
      }
    }
    function onPointerMove(e) {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2 && pinchStartDist) {
        setZoom(pinchStartZoom * (pointerDistance() / pinchStartDist));
      }
    }
    function onPointerUp(e) {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchStartDist = null;
    }
    const dom = renderer.domElement;
    dom.style.touchAction = "none"; // stop the browser handling pinch as page zoom
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}
