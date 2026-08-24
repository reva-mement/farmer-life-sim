import { useEffect, useRef } from "react";
import * as THREE from "three";
import { smoothstep, sampleType, SOIL } from "./terrain";
import { buildPaddy, PADDY_W, PADDY_D, PADDY_BANK_OUTER, PADDY_FRINGE_COLOR } from "./paddy";

// Ported from reference/village-path-walk-study.jsx — per
// farmer-sim-design-doc-v2.md section 4, this is the most complete
// reference implementation (terrain + a farmer walking a single path).
// Logic is carried over as-is; only the outer demo-page chrome (title,
// Google Fonts import, fixed-size card layout) is dropped in favor of a
// full-bleed mount, matching how the rest of the app's scenes are hosted.
// The noise/soil-sampling helpers moved to terrain.js once paddy.js needed
// the identical code; the road-blending config below stays local since it's
// specific to this ground.

const GRID_SIZE = 14; // widened from 11 so the 4x-bigger paddies still clear the path and ground edge

const PATH = {
  clumpScale: 7, grainScale: 22, pebbleScale: 36,
  dispClump: 0.01, dispGrain: 0.003, dispPebble: 0.007,
  colorLow: [180, 165, 125], colorHigh: [206, 191, 150],
  speckAmt: 14, pebbleShadeAmt: 8, roughLow: 0.7, roughHigh: 0.95,
};
const PATH_CENTER_X = 0;
const PATH_HALF_WIDTH = 0.6; // doubled from the reference study's 0.3
const PATH_EDGE_SOFT = 0.3;

// Paddies flank the path, clear of both its soft edge (|x| < 0.9) and the
// ground bounds (|x| < 7).
const PADDY_PLACEMENTS = [
  { x: -3.6, z: 0 },
  { x: 3.6, z: 0 },
];
const PADDY_DEPRESS_Y = -0.2; // well below the paddy floor, so it's fully hidden once carved
// each lane's walker plants 4 rows across its paddy's width, evenly spaced
// and clear of the levee banks — ordered near-to-path first
const PADDY_ROW_FRACTIONS = [0.75, 0.25, -0.25, -0.75]; // x (fraction of half-width) offsets from center
function paddyRowXs(centerX, nearSign) {
  // nearSign points the first (near) row toward the path, whichever side
  // this paddy is on
  return PADDY_ROW_FRACTIONS.map((f) => centerX + nearSign * f * (PADDY_W / 2));
}
const PADDY_ROWS_LEFT = paddyRowXs(PADDY_PLACEMENTS[0].x, 1);
const PADDY_ROWS_RIGHT = paddyRowXs(PADDY_PLACEMENTS[1].x, -1);

// The scene's ground is one continuous mesh, so a paddy sitting "in" it
// needs its own vertices pushed down first — otherwise the ground plane at
// y~0 just covers the basin (floor/water/rice) sitting below it. The
// transition is sized to exactly the bank ring width, so it's hidden under
// the paddy's levee bank mesh.
function paddyDepression(worldX, worldZ) {
  const innerHalfW = PADDY_W / 2;
  const innerHalfD = PADDY_D / 2;
  let t = 0;
  for (const p of PADDY_PLACEMENTS) {
    const ax = Math.max(0, Math.abs(worldX - p.x) - innerHalfW);
    const az = Math.max(0, Math.abs(worldZ - p.z) - innerHalfD);
    const dist = Math.hypot(ax, az);
    t = Math.max(t, 1 - smoothstep(0, PADDY_BANK_OUTER, dist));
  }
  return t;
}

// How close a ground point is to a paddy's outer (bank) edge, 0 far away to
// 1 right at the bank — used to fade the surrounding soil's color toward
// damp mud as it nears the paddy, instead of jumping straight from dry red
// soil to the bank's wet color right at that edge.
const PADDY_FRINGE_WIDTH = 0.9;
function paddyProximity(worldX, worldZ) {
  const outerHalfW = PADDY_W / 2 + PADDY_BANK_OUTER;
  const outerHalfD = PADDY_D / 2 + PADDY_BANK_OUTER;
  let t = 0;
  for (const p of PADDY_PLACEMENTS) {
    const ax = Math.max(0, Math.abs(worldX - p.x) - outerHalfW);
    const az = Math.max(0, Math.abs(worldZ - p.z) - outerHalfD);
    const dist = Math.hypot(ax, az);
    t = Math.max(t, 1 - smoothstep(0, PADDY_FRINGE_WIDTH, dist));
  }
  return t;
}

function groundSample(worldX, worldZ) {
  const soil = sampleType(SOIL, worldX, worldZ);
  const path = sampleType(PATH, worldX, worldZ);
  const dist = Math.abs(worldX - PATH_CENTER_X);
  const t = 1 - smoothstep(PATH_HALF_WIDTH, PATH_HALF_WIDTH + PATH_EDGE_SOFT, dist);
  let r = soil.r + (path.r - soil.r) * t;
  let g = soil.g + (path.g - soil.g) * t;
  let b = soil.b + (path.b - soil.b) * t;
  let rough = soil.rough + (path.rough - soil.rough) * t;
  const height = soil.height + (path.height - soil.height) * t;
  const bumpHeight = soil.bumpHeight + (path.bumpHeight - soil.bumpHeight) * t;

  const fringe = paddyProximity(worldX, worldZ);
  if (fringe > 0) {
    r += (PADDY_FRINGE_COLOR[0] - r) * fringe;
    g += (PADDY_FRINGE_COLOR[1] - g) * fringe;
    b += (PADDY_FRINGE_COLOR[2] - b) * fringe;
    rough -= fringe * 0.15; // damp soil is slightly glossier than dry soil
  }
  return { r, g, b, height, bumpHeight, rough };
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
    const depress = paddyDepression(worldX, worldZ);
    pos.setZ(i, s.height * (1 - depress) + PADDY_DEPRESS_Y * depress);
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

const STOOP_ANGLE = -0.32; // hoisted so createWalker's planting animation can bow from the same baseline

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
      spine: spinePivot,
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
//
// If paddyRows is given (ordered near-path-edge to deepest-in), the walker
// treats the paddy as that many rows: every time it crosses paddyZ on the
// path, it detours in and works each row in turn — step, bow, step, bow,
// ... x plantCycles — reversing direction and shifting sideways into the
// next row each time (a boustrophedon, like plowing a field), then returns
// to its lane after the last row.
function createWalker({
  farmer, joints, laneX, walkZFrom, walkZTo, walkDuration, stepFreq, turnDuration, startDir,
  paddyRows = null, paddyZ = 0, strafeSpeed = 0.45,
  plantCycles = 8, plantCycleDuration = 2.2, rowStep = 0.18, rowStepDuration = 0.6, // 8 = 4 doubled, matching the paddy's doubled row length
}) {
  const legSwing = 0.25;
  const kneeBend = 0.9;
  const armSwing = 0.4;
  const PADDY_SINK_Y = -0.05;

  let dir = startDir;
  let z = startDir > 0 ? walkZFrom : walkZTo;
  let prevZ = z;
  // "walking" | "turning" | "toPaddy" | "rowStep" | "rowPlant" | "rowShift" | "fromPaddy"
  let state = "walking";
  let turnStart = 0;
  let turnFromY = 0;
  let turnToY = 0;
  let turnJointsAtStart = null;

  // facing while off the path: pick whichever way actually points at the
  // paddy, since sideways motion isn't driven by dir the way path walking is
  const paddyFacingY = paddyRows !== null && paddyRows[0] > laneX ? -Math.PI / 2 : Math.PI / 2;
  let strafeStart = 0;
  let strafeFromX = laneX;
  let strafeToX = laneX;
  let strafeZ = paddyZ;

  // row-planting bookkeeping
  let rowIndex = 0;
  let rowDir = 1; // z direction walked while stepping through the current row
  let rowX = paddyRows ? paddyRows[0] : null;
  let rowZ = paddyZ;
  let cycleIndex = 0;
  let phaseStart = 0; // start time of the current rowStep/rowPlant sub-phase

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
        prevZ = z;
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
        } else if (paddyRows !== null && (prevZ - paddyZ) * (z - paddyZ) < 0) {
          // crossed paddyZ this frame — detour into the paddy
          z = paddyZ;
          farmer.position.set(laneX, 0, z);
          farmer.rotation.y = paddyFacingY;
          state = "toPaddy";
          strafeStart = t;
          strafeFromX = laneX;
          strafeToX = paddyRows[0];
          strafeZ = paddyZ;
        }
      } else if (state === "toPaddy" || state === "rowShift" || state === "fromPaddy") {
        const dist = Math.abs(strafeToX - strafeFromX);
        const duration = Math.max(0.1, dist / strafeSpeed);
        const tt = Math.min(1, (t - strafeStart) / duration);
        const phase = t * Math.PI * 2 * stepFreq;
        const x = strafeFromX + (strafeToX - strafeFromX) * tt;
        const enteringPaddy = state !== "fromPaddy";
        const sink = state === "toPaddy" ? PADDY_SINK_Y * smoothstep(0.5, 1, tt)
          : state === "fromPaddy" ? PADDY_SINK_Y * (1 - smoothstep(0, 0.5, tt))
          : PADDY_SINK_Y;
        applyJointRotations(jointRotations(phase));
        farmer.position.set(x, sink + Math.abs(Math.sin(phase)) * 0.014, strafeZ);
        farmer.rotation.y = enteringPaddy ? paddyFacingY : paddyFacingY + Math.PI;

        if (tt >= 1) {
          if (state === "toPaddy") {
            rowIndex = 0;
            rowDir = 1;
            rowX = paddyRows[0];
            rowZ = strafeZ;
            cycleIndex = 0;
            phaseStart = t;
            state = "rowStep";
          } else if (state === "rowShift") {
            rowIndex += 1;
            rowDir = -rowDir;
            rowX = paddyRows[rowIndex];
            rowZ = strafeZ;
            cycleIndex = 0;
            phaseStart = t;
            state = "rowStep";
          } else {
            farmer.position.set(laneX, 0, strafeZ);
            farmer.rotation.y = dir > 0 ? Math.PI : 0;
            state = "walking";
          }
        }
      } else if (state === "rowStep") {
        // one short step forward through the row before the next plant
        const fromZ = rowZ;
        const toZ = rowZ + rowDir * rowStep;
        const tt = Math.min(1, (t - phaseStart) / rowStepDuration);
        const phase = t * Math.PI * 2 * stepFreq;
        applyJointRotations(jointRotations(phase));
        farmer.position.set(rowX, PADDY_SINK_Y + Math.abs(Math.sin(phase)) * 0.014, fromZ + (toZ - fromZ) * tt);
        farmer.rotation.y = rowDir > 0 ? Math.PI : 0;

        if (tt >= 1) {
          rowZ = toZ;
          phaseStart = t;
          state = "rowPlant";
        }
      } else if (state === "rowPlant") {
        const p = Math.min(1, (t - phaseStart) / plantCycleDuration);
        const bow = Math.sin(p * Math.PI); // 0 -> 1 -> 0, one bow this cycle
        joints.spine.rotation.x = STOOP_ANGLE - bow * 0.55;
        joints.hipL.rotation.x = 0;
        joints.hipR.rotation.x = 0;
        joints.kneeL.rotation.x = -0.15 - bow * 0.25;
        joints.kneeR.rotation.x = -0.15 - bow * 0.25;
        joints.shoulderL.rotation.x = bow * 1.0;
        joints.shoulderR.rotation.x = bow * 1.0;
        joints.elbowL.rotation.x = 0.2 + bow * 0.6;
        joints.elbowR.rotation.x = 0.2 + bow * 0.6;
        farmer.position.set(rowX, PADDY_SINK_Y - bow * 0.02, rowZ);

        if (p >= 1) {
          cycleIndex += 1;
          if (cycleIndex < plantCycles) {
            phaseStart = t;
            state = "rowStep";
          } else if (rowIndex < paddyRows.length - 1) {
            state = "rowShift";
            strafeStart = t;
            strafeFromX = paddyRows[rowIndex];
            strafeToX = paddyRows[rowIndex + 1];
            strafeZ = rowZ;
          } else {
            state = "fromPaddy";
            strafeStart = t;
            strafeFromX = paddyRows[rowIndex];
            strafeToX = laneX;
            strafeZ = rowZ;
          }
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

const MIN_ZOOM = 0.1; // pinched all the way out still fits the whole 14x14 field, even on a narrow phone
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
    const CAM_BASE_POS = new THREE.Vector3(5.2, 5.2, 5.2);
    const CAM_BASE_TARGET = new THREE.Vector3(0, 0.3, 0);
    camera.position.copy(CAM_BASE_POS);
    camera.lookAt(CAM_BASE_TARGET);
    camera.zoom = 1;
    camera.updateProjectionMatrix();

    // Pan basis: the camera only ever translates, never rotates, so its
    // right/up vectors are constant — safe to compute once. panRight/panFwd
    // are their ground-plane (Y=0) projections, letting a screen-space drag
    // move the camera+target together along the ground, like grabbing the
    // world with a finger.
    camera.updateMatrixWorld(true); // matrixWorld is otherwise stale (identity) before the first render
    const basisRight = new THREE.Vector3();
    const basisUp = new THREE.Vector3();
    const basisBack = new THREE.Vector3();
    camera.matrixWorld.extractBasis(basisRight, basisUp, basisBack);
    const panRight = new THREE.Vector3(basisRight.x, 0, basisRight.z).normalize();
    const panFwd = new THREE.Vector3(basisUp.x, 0, basisUp.z).normalize(); // ground projection of "screen up"
    const panOffset = new THREE.Vector3(0, 0, 0);
    const PAN_LIMIT = GRID_SIZE / 2 + 1;
    function applyCameraTransform() {
      camera.position.copy(CAM_BASE_POS).add(panOffset);
      camera.lookAt(CAM_BASE_TARGET.clone().add(panOffset));
    }

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

    // Rice paddies flanking the path, one on each side, clear of both the
    // path's soft edge (|x| < 0.9) and the ground bounds (|x| < 5.5).
    const paddies = PADDY_PLACEMENTS.map(({ x, z }) => {
      const paddy = buildPaddy();
      paddy.root.position.set(x, 0, z);
      scene.add(paddy.root);
      return paddy;
    });

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
      paddyRows: PADDY_ROWS_LEFT,
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
      paddyRows: PADDY_ROWS_RIGHT,
    });

    const clock = new THREE.Clock();
    function animate() {
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();
      walkerA.update(t, dt);
      walkerB.update(t, dt);
      const ox = Math.sin(t * 0.2) * 0.05;
      const oy = Math.cos(t * 0.16) * 0.05;
      for (const { water } of paddies) {
        if (water.material.map) water.material.map.offset.set(ox, oy);
        if (water.material.bumpMap) water.material.bumpMap.offset.set(ox * 1.3, oy * 1.3);
      }
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
    // ---- pan: one-finger / mouse drag, front-back-left-right on the ground ----
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
    let pinchActive = false; // true for the rest of the gesture once a 2nd finger joins
    function pointerDistance() {
      const pts = [...activePointers.values()];
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
    function onPointerDown(e) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        pinchActive = true;
        pinchStartDist = pointerDistance();
        pinchStartZoom = camera.zoom;
      }
    }
    function onPointerMove(e) {
      const prev = activePointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      activePointers.set(e.pointerId, cur);
      if (activePointers.size === 2 && pinchStartDist) {
        setZoom(pinchStartZoom * (pointerDistance() / pinchStartDist));
      } else if (activePointers.size === 1 && !pinchActive) {
        // drag-to-pan: 1 screen pixel moves exactly 1 world pixel's worth of
        // ground, so the point under the finger/cursor tracks it exactly
        const worldPerPixelY = (2 * d) / camera.zoom / mount.clientHeight;
        const dxPixels = cur.x - prev.x;
        const dyPixels = cur.y - prev.y;
        const delta = panRight.clone().multiplyScalar(-dxPixels * worldPerPixelY)
          .add(panFwd.clone().multiplyScalar(dyPixels * worldPerPixelY));
        panOffset.add(delta);
        panOffset.x = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, panOffset.x));
        panOffset.z = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, panOffset.z));
        applyCameraTransform();
      }
    }
    function onPointerUp(e) {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchStartDist = null;
      if (activePointers.size === 0) pinchActive = false;
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
