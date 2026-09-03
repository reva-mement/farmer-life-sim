import { useEffect, useRef } from "react";
import * as THREE from "three";
import { smoothstep, sampleType, fbm, hash, SOIL } from "./terrain";
import { buildPaddy, PADDY_W, PADDY_D, PADDY_BANK_OUTER, PADDY_FRINGE_COLOR } from "./paddy";
import { buildFarmhouseVoxel } from "./houseVoxel";
import { buildFarmhouseVoxelWorn } from "./houseVoxelWorn";
import { bakeGroundTextures, buildGroundMaterial } from "./groundMaterial";

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

// The two houses on the road-only tile north of the paddies - one side
// well-kept, one weathered. rotY faces each house's door toward the road.
const HOUSE_PLACEMENTS = [
  { x: -3, z: GRID_SIZE, rotY: Math.PI / 2, worn: false },
  { x: 3, z: GRID_SIZE, rotY: -Math.PI / 2, worn: true },
];
// Ground stays flat right under each house (it sits at a fixed y=0) instead
// of following the new rolling-terrain displacement below - same idea as
// paddyDepression, just flattening toward 0 instead of carving a basin.
// Takes the specific house list to flatten under (rather than closing over
// a module-level constant) since Phase 3 gives each tile its own,
// procedurally-decided set - see getTileContent below.
const HOUSE_FLATTEN_RADIUS = 1.5;
const HOUSE_FLATTEN_WIDTH = 1.1;
function houseFlatten(worldX, worldZ, housePlacements) {
  let t = 0;
  for (const h of housePlacements) {
    const dist = Math.hypot(worldX - h.x, worldZ - h.z);
    t = Math.max(t, 1 - smoothstep(HOUSE_FLATTEN_RADIUS, HOUSE_FLATTEN_RADIUS + HOUSE_FLATTEN_WIDTH, dist));
  }
  return t;
}

// ---------- tile management ----------
// Each tile is one GRID_SIZE x GRID_SIZE square, addressed by integer
// (tileX, tileZ) - see buildGroundTile. getTileContent describes what
// beyond the ground itself belongs in a given tile. TILE_CONTENT holds the
// two hand-authored exceptions - (0,0) has the paddies (built entirely
// outside this system, see the note below) and nothing else; (0,1) has the
// two original houses, unchanged. Every other tile on the road column
// (tileX === 0) gets a procedurally-decided pair of house sites, reusing
// the exact flanking pattern HOUSE_PLACEMENTS already established (x = ∓3,
// facing the road) - each side rolled independently and seeded by tile
// position, so the result is deterministic and stable across reloads
// without needing to store anything.
//
// Paddies and the farmer walkers still stay outside this system entirely:
// they're tightly coupled to the walk-animation code further below (fixed
// lanes, row lists, a hardcoded walk range), and generating new paddies
// procedurally would mean spawning new walker instances too - a bigger
// step than "what belongs in this tile", left for later.
function tileKey(tileX, tileZ) {
  return `${tileX},${tileZ}`;
}
const TILE_CONTENT = {
  [tileKey(0, 0)]: {},
  [tileKey(0, 1)]: { houses: HOUSE_PLACEMENTS },
};
const PROCEDURAL_HOUSE_CHANCE = 0.5; // per side, per eligible tile
function getTileContent(tileX, tileZ) {
  const key = tileKey(tileX, tileZ);
  if (TILE_CONTENT[key]) return TILE_CONTENT[key];
  if (tileX !== 0) return {}; // only the road column has content so far
  const houses = [];
  for (const side of [-1, 1]) {
    const houseRoll = hash(tileZ * 4.7 + side * 12.9, tileZ * 9.3 - side * 3.1);
    if (houseRoll > 1 - PROCEDURAL_HOUSE_CHANCE) {
      const worn = hash(tileZ * 6.1 + side * 2.3, tileZ * 1.7 - side * 8.4) > 0.5;
      houses.push({ x: side * 3, z: tileZ * GRID_SIZE, rotY: side < 0 ? Math.PI / 2 : -Math.PI / 2, worn });
    }
  }
  return houses.length ? { houses } : {};
}

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
  return { r, g, b, height, bumpHeight, rough, pathT: t };
}

// Broad, low-frequency rolling undulation for the ground - separate from
// the fine clump/grain/pebble noise in terrain.js's sampleType, which is
// too small-wavelength (and too tied to the soil/path color blend) to read
// as real terrain shape on its own. Suppressed over the road itself (packed
// dirt stays flatter than the surrounding field) via the caller's pathT.
const TERRAIN_ROLL_SCALE = 0.16; // lower = broader hills
const TERRAIN_ROLL_AMP = 0.16; // world units
function terrainRoll(worldX, worldZ, pathT) {
  const n = fbm(worldX * TERRAIN_ROLL_SCALE, worldZ * TERRAIN_ROLL_SCALE, 4);
  return (n - 0.5) * 2 * TERRAIN_ROLL_AMP * (1 - pathT * 0.85);
}
// One tile's ground mesh - GRID_SIZE x GRID_SIZE, centered at
// (tileX*GRID_SIZE, tileZ*GRID_SIZE). Was a single buildGround(worldD,
// zCenter) that built one big mesh spanning as many tiles as needed at
// once (originally 1, then 2 once a road-only tile was appended); split so
// tiles can be loaded/unloaded independently (see loadTile/unloadTile in
// the component below) - same sampling functions, same visual result per
// tile, just addressable and disposable one at a time. First step toward
// the 40x40-tile world: nothing here streams yet (Phase 1 just lays the
// tile plumbing under the still-fixed 2-tile world), but later phases can
// drive loadTile/unloadTile from the camera position without another
// rewrite of this function.
//
// Color/roughness are baked to two small textures per tile on the GPU (see
// bakeGroundTextures in groundMaterial.js) instead of the old CPU canvas
// loop - same visual result, but a GPU-parallel render pass instead of a
// main-thread-blocking pixel loop, so it no longer scales badly with tile
// count. renderer and groundOpts (the soil/path/paddy config the bake
// needs) are passed in rather than imported, keeping this function - and
// groundMaterial.js - decoupled from this file's specific constants.
function buildGroundTile(tileX, tileZ, renderer, groundOpts, tileHouses) {
  const worldW = GRID_SIZE;
  const worldD = GRID_SIZE;
  const xCenter = tileX * GRID_SIZE;
  const zCenter = tileZ * GRID_SIZE;
  const segs = 88;
  const geo = new THREE.PlaneGeometry(worldW, worldD, segs, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i) + xCenter;
    // geo.rotateX(-PI/2) below maps local Y -> world Z *negated* (verified
    // empirically: a vertex at local Y=-1 ends up at Z=+1) - this loop needs
    // that sign for the height/roll/flatten/depress sampling below to
    // describe the same physical location the vertex actually ends up at.
    // (The GPU bake in groundMaterial.js doesn't need this: it maps its own
    // UV space to world position independently via uCenter/uWorldSize, so
    // it can't fall out of sync with this loop the way the old CPU-baked
    // canvas sampling once could.)
    const worldZ = -pos.getY(i) + zCenter;
    const s = groundSample(worldX, worldZ);
    const roll = terrainRoll(worldX, worldZ, s.pathT);
    const flatten = houseFlatten(worldX, worldZ, tileHouses);
    const rolled = (s.height + roll) * (1 - flatten);
    const depress = paddyDepression(worldX, worldZ);
    const finalHeight = rolled * (1 - depress) + PADDY_DEPRESS_Y * depress;
    pos.setZ(i, finalHeight);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const texPerUnit = 75;
  const { colorTarget, roughTarget } = bakeGroundTextures(
    renderer, Math.round(worldW * texPerUnit), Math.round(worldD * texPerUnit),
    worldW, worldD, xCenter, zCenter, groundOpts
  );
  const mat = buildGroundMaterial(colorTarget, roughTarget);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(xCenter, 0, zCenter);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, renderTargets: [colorTarget, roughTarget] };
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

// Lowered from an earlier 0.1: at that zoom the frustum's world footprint
// (top/bottom = d/zoom = 34 units) was far larger than the actual ground
// (14x28), so pinching/scrolling all the way out mostly showed background
// void around a small patch of ground. 0.3 keeps the whole ground roughly
// filling the frame instead.
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.2;

export default function VillagePathWalkScene() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    // A warm haze tone instead of the page's near-black CSS background
    // showing through - the isometric camera's diamond-shaped view never
    // exactly fills a rectangular viewport, so some margin beyond the
    // ground is unavoidable at wide zoom; this keeps that margin from
    // reading as a broken void.
    scene.background = new THREE.Color(0xcdb992);

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
    // Pan bounds used to be fixed constants (loaded-ground edge + a 1-unit
    // margin), which implicitly assumed panOffset tracks the visible edge.
    // That's only true near zoom=1: this isometric camera's frustum
    // footprint on the ground grows as 1/zoom, so at low zoom the visible
    // area extends far past panOffset itself - at MIN_ZOOM the footprint's
    // diagonal is nearly as wide as the whole loaded ground, so the old
    // fixed clamp let the frustum overshoot the loaded tiles by 10+ units,
    // showing a large background wedge instead of a small margin.
    // Fix: derive the clamp from the camera's actual ground footprint at
    // the current zoom (intersect the 4 frustum corners with the y=0
    // plane). When the footprint is wider than the loaded ground on an
    // axis - always true in X (the ground is only one tile wide) and true
    // in Z at the very lowest zoom - lock that axis to center the ground
    // in the frustum instead of letting it drift to one side.
    const LOADED_TILE_Z_MIN = 0;
    const LOADED_TILE_Z_MAX = 2; // keep in sync with the loadTile range below
    const GROUND_X_MIN = -GRID_SIZE / 2;
    const GROUND_X_MAX = GRID_SIZE / 2;
    const GROUND_Z_MIN = LOADED_TILE_Z_MIN * GRID_SIZE - GRID_SIZE / 2;
    const GROUND_Z_MAX = LOADED_TILE_Z_MAX * GRID_SIZE + GRID_SIZE / 2;
    const viewDir = CAM_BASE_TARGET.clone().sub(CAM_BASE_POS).normalize();
    function groundFootprint(zoom) {
      let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
      for (const u of [camera.left / zoom, camera.right / zoom]) {
        for (const v of [camera.top / zoom, camera.bottom / zoom]) {
          const pos = CAM_BASE_POS.clone()
            .add(basisRight.clone().multiplyScalar(u))
            .add(basisUp.clone().multiplyScalar(v));
          const t = -pos.y / viewDir.y;
          const p = pos.addScaledVector(viewDir, t);
          xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
          zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z);
        }
      }
      return { xMin, xMax, zMin, zMax };
    }
    function clampAxis(fpMin, fpMax, groundMin, groundMax) {
      if (fpMax - fpMin >= groundMax - groundMin) {
        const center = (groundMin + groundMax) / 2 - (fpMin + fpMax) / 2;
        return [center, center];
      }
      return [groundMin - fpMin, groundMax - fpMax];
    }
    function computePanBounds(zoom) {
      const fp = groundFootprint(zoom);
      const [xMin, xMax] = clampAxis(fp.xMin, fp.xMax, GROUND_X_MIN, GROUND_X_MAX);
      const [zMin, zMax] = clampAxis(fp.zMin, fp.zMax, GROUND_Z_MIN, GROUND_Z_MAX);
      return { xMin, xMax, zMin, zMax };
    }
    function clampPanOffset() {
      const b = computePanBounds(camera.zoom);
      panOffset.x = Math.max(b.xMin, Math.min(b.xMax, panOffset.x));
      panOffset.z = Math.max(b.zMin, Math.min(b.zMax, panOffset.z));
    }
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

    // Soil/path/paddy config the GPU bake needs (see buildGroundTile /
    // groundMaterial.js) - built once and reused for every tile's bake.
    const groundOpts = {
      soil: SOIL, path: PATH, pathCenterX: PATH_CENTER_X,
      pathHalfWidth: PATH_HALF_WIDTH, pathEdgeSoft: PATH_EDGE_SOFT,
      paddyPlacements: PADDY_PLACEMENTS, paddyHalfW: PADDY_W / 2, paddyHalfD: PADDY_D / 2,
      paddyBankOuter: PADDY_BANK_OUTER, paddyFringeWidth: PADDY_FRINGE_WIDTH,
      paddyFringeColor: PADDY_FRINGE_COLOR,
    };

    // ---- tile load/unload (see TILE_CONTENT above) ----
    // loadedTiles tracks what's live so a tile can be torn down cleanly:
    // scene.remove() plus disposing every geometry/material/render-target
    // it added. Phase 1 calls loadTile with a fixed list (right below) and
    // never unloads - the plumbing is here so a later phase can drive both
    // calls from the camera's position instead, without touching this
    // function again.
    const loadedTiles = new Map();
    function loadTile(tileX, tileZ) {
      const key = tileKey(tileX, tileZ);
      if (loadedTiles.has(key)) return;
      const group = new THREE.Group();
      const geometries = [];
      const materials = [];
      const renderTargets = [];

      const content = getTileContent(tileX, tileZ);
      const { mesh: groundMesh, renderTargets: groundTargets } = buildGroundTile(
        tileX, tileZ, renderer, groundOpts, content.houses || []
      );
      group.add(groundMesh);
      geometries.push(groundMesh.geometry);
      materials.push(groundMesh.material);
      renderTargets.push(...groundTargets);

      if (content.houses) {
        for (const h of content.houses) {
          const house = h.worn ? buildFarmhouseVoxelWorn() : buildFarmhouseVoxel();
          house.position.set(h.x, 0, h.z);
          house.rotation.y = h.rotY;
          group.add(house);
          house.traverse((obj) => {
            if (obj.geometry) geometries.push(obj.geometry);
            if (obj.material) materials.push(obj.material);
          });
        }
      }

      scene.add(group);
      loadedTiles.set(key, { group, geometries, materials, renderTargets });
    }
    function unloadTile(tileX, tileZ) {
      const key = tileKey(tileX, tileZ);
      const entry = loadedTiles.get(key);
      if (!entry) return;
      scene.remove(entry.group);
      entry.geometries.forEach((g) => g.dispose());
      entry.materials.forEach((m) => m.dispose());
      entry.renderTargets.forEach((rt) => rt.dispose());
      loadedTiles.delete(key);
    }

    // Fixed for now (still no camera-driven streaming - that's a later
    // phase): (0,0) is the original tile (paddies, farmer walk range, z in
    // [-7,7]); (0,1) is the road-only tile north of it (z in [7,21]),
    // holding the two hand-placed houses. (0,2) extends the village one
    // tile further along the same road column, getting whatever
    // getTileContent procedurally decided for it - a working demonstration
    // that tiles beyond the two hand-authored ones aren't just empty
    // ground. Kept to one extra tile rather than several: this dev
    // sandbox's software (non-GPU) renderer got measurably less stable
    // under sustained pan interaction as more tiles' worth of shadow-cast
    // geometry piled up - a property of this environment's renderer, not
    // of the tile system itself (loadTile/unloadTile have no per-call
    // cost that scales with how many tiles came before). The real fix is
    // Phase 4's streaming (only ever a handful of tiles active near the
    // camera, however large the addressable world is) rather than
    // widening this fixed list further.
    for (let tileZ = 0; tileZ <= 2; tileZ++) loadTile(0, tileZ);

    // Rice paddies flanking the path, one on each side, clear of both the
    // path's soft edge (|x| < 0.9) and the ground bounds (|x| < 7).
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
      clampPanOffset();
      applyCameraTransform();
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    // ---- zoom: mouse wheel (desktop) + two-finger pinch (touch) ----
    // ---- pan: one-finger / mouse drag, front-back-left-right on the ground ----
    function setZoom(z) {
      camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
      camera.updateProjectionMatrix();
      // Zooming out shrinks the valid pan range (see clampPanOffset above),
      // so a panOffset that was fine before this zoom change can now sit
      // outside it - reclamp and re-apply immediately rather than waiting
      // for the next drag.
      clampPanOffset();
      applyCameraTransform();
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
        clampPanOffset();
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
