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
// (tileX, tileZ) - see buildGroundChunk. getTileContent describes what
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
// One chunk's ground mesh - CHUNK_SIZE x CHUNK_SIZE (a batch of
// CHUNK_TILES x CHUNK_TILES tiles baked/meshed together, see CHUNK_TILES
// above), centered at (chunkX*CHUNK_SIZE, chunkZ*CHUNK_SIZE). Was a single
// buildGround(worldD, zCenter) that built one big mesh spanning as many
// tiles as needed at once (originally 1, then 2 once a road-only tile was
// appended); split into addressable, disposable pieces so they can be
// loaded/unloaded independently (see loadChunk/unloadChunk in the
// component below) - same sampling functions, same visual result, just at
// whatever granularity keeps that streaming affordable.
//
// Color/roughness are baked to two small textures per tile on the GPU (see
// bakeGroundTextures in groundMaterial.js) instead of the old CPU canvas
// loop - same visual result, but a GPU-parallel render pass instead of a
// main-thread-blocking pixel loop, so it no longer scales badly with tile
// count. renderer and groundOpts (the soil/path/paddy config the bake
// needs) are passed in rather than imported, keeping this function - and
// groundMaterial.js - decoupled from this file's specific constants.
// segs/texPerUnit are deliberately modest (were 88/75, per-tile) rather
// than as crisp as possible up close: every chunk in the addressable
// world uses this same per-unit density uniformly - up to ~80 chunks can
// be loaded at once once the camera is zoomed out far enough to see the
// whole world - so the cost has to stay low enough to support that worst
// case, not just look good for the handful of chunks near the camera.
// One consistent (if modest) look everywhere beats sharp nearby ground
// next to blurry/simplified distant ground.
const GROUND_SEGS = 8; // per tile-width's worth of the chunk
const GROUND_TEX_PER_UNIT = 6;
// Batching: originally each GRID_SIZE tile baked its own texture and
// geometry, so seeing the whole ~40x40-tile world at once meant up to
// ~1600 separate bake passes in one burst - individually cheap, but the
// sheer *count* (one WebGLRenderTarget + shader pass each) made even
// normal zoomed-in loading slow once the streamed margin grew to match.
// Grouping CHUNK_TILES x CHUNK_TILES tiles into one chunk - one merged
// geometry, one pair of baked textures, covering the same total area and
// the same per-unit resolution as before - cuts the number of bake/mesh
// operations by CHUNK_TILES^2 without changing how anything looks.
// CHUNK_TILES is odd so a chunk's world center lands exactly on its
// middle tile's center, keeping chunk-index/world-position math as
// simple as the old per-tile version (world center = index * size).
const CHUNK_TILES = 7;
const CHUNK_SIZE = GRID_SIZE * CHUNK_TILES;
const CHUNK_TILE_RADIUS = (CHUNK_TILES - 1) / 2;
// All tiles a chunk spans, for content that's still authored per-tile
// (getTileContent's houses) - the ground mesh/texture themselves don't
// need this since groundSample/houseFlatten/paddyDepression already work
// in continuous world coordinates, not tile-by-tile.
function chunkTileRange(chunkX, chunkZ) {
  const tiles = [];
  for (let dx = -CHUNK_TILE_RADIUS; dx <= CHUNK_TILE_RADIUS; dx++) {
    for (let dz = -CHUNK_TILE_RADIUS; dz <= CHUNK_TILE_RADIUS; dz++) {
      tiles.push([chunkX * CHUNK_TILES + dx, chunkZ * CHUNK_TILES + dz]);
    }
  }
  return tiles;
}
function getChunkHouses(chunkX, chunkZ) {
  const houses = [];
  for (const [tx, tz] of chunkTileRange(chunkX, chunkZ)) {
    const content = getTileContent(tx, tz);
    if (content.houses) houses.push(...content.houses);
  }
  return houses;
}
function buildGroundChunk(chunkX, chunkZ, renderer, groundOpts, chunkHouses) {
  const worldW = CHUNK_SIZE;
  const worldD = CHUNK_SIZE;
  const xCenter = chunkX * CHUNK_SIZE;
  const zCenter = chunkZ * CHUNK_SIZE;
  const segs = GROUND_SEGS * CHUNK_TILES;
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
    const flatten = houseFlatten(worldX, worldZ, chunkHouses);
    const rolled = (s.height + roll) * (1 - flatten);
    const depress = paddyDepression(worldX, worldZ);
    const finalHeight = rolled * (1 - depress) + PADDY_DEPRESS_Y * depress;
    pos.setZ(i, finalHeight);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const texPerUnit = GROUND_TEX_PER_UNIT;
  const { colorTarget, roughTarget } = bakeGroundTextures(
    renderer, Math.round(worldW * texPerUnit), Math.round(worldD * texPerUnit),
    worldW, worldD, xCenter, zCenter, groundOpts
  );
  const mat = buildGroundMaterial(colorTarget, roughTarget);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(xCenter, 0, zCenter);
  // No shadows - see the renderer.shadowMap note above.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
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

// Hard safety floor only - the real zoom-out limit is computed per-window
// (see computeMinZoom below), since how far you can zoom out before the
// ground stops filling the screen depends on the window's aspect ratio,
// not just a single fixed number. Low enough to not bind before that
// computed floor does - seeing the full ~40-tile-wide world at once needs
// zooming out to roughly 0.02-0.03 depending on aspect.
const ABSOLUTE_MIN_ZOOM = 0.005;
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
    // near/far were 0.1/100 until streaming grew to cover the whole world.
    // This isometric camera's view axis isn't aligned with either world
    // axis, so a ground point's *depth* (distance along the view
    // direction, what near/far actually clip against) depends on which
    // diagonal direction it sits relative to the camera - not just how far
    // away it looks on screen. Ground extending in the same XZ direction
    // as the camera's own CAM_BASE_POS-CAM_BASE_TARGET offset gets
    // *closer* in depth terms the further out it goes (and goes negative
    // well before 350 world units, i.e. well inside the loaded world's
    // coverage), while the opposite direction gets farther. So both planes
    // need headroom: far=1000 to not clip the far side, and a deeply
    // negative near (orthographic cameras allow this, unlike perspective)
    // so the near side isn't clipped either - it was silently cutting out
    // roughly half the loaded world before this. Depth mapping is linear
    // for an orthographic camera, so this wide a range costs no meaningful
    // z-buffer precision here.
    const camera = new THREE.OrthographicCamera(
      (-d * width) / height, (d * width) / height, d, -d, -1000, 1000
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
    // Instead of a fixed list of loaded chunks, keep a margin loaded
    // around wherever panOffset currently is (see updateStreamedChunks,
    // defined once loadChunk/unloadChunk exist below), and re-run that on
    // every pan *and* zoom change. Ground coverage near the camera is then
    // guaranteed continuously rather than tied to a fixed set of chunks,
    // so the addressable world can be arbitrarily large while only ever a
    // bounded set of chunks are actually loaded.
    //
    // This used to be two tiers - full-detail tiles out to a small radius,
    // plus much cheaper flattened/low-res "far chunks" further out so the
    // camera could zoom out to see the whole world without baking full
    // detail for ~1600 tiles at once (~19GB of GPU texture memory). That
    // worked, but produced a visible quality seam wherever both were on
    // screen together - by design (asked for explicitly): one uniform
    // level of detail everywhere, chosen cheap enough to legitimately
    // cover the *entire* addressable world (see buildGroundChunk's reduced
    // segs/texPerUnit and the disabled shadows below), rather than two
    // tiers that only look consistent at the extremes.
    //
    // Uniform quality made "always keep the whole world loaded" briefly
    // seem like the natural next step (drop the margin concept, load
    // everything within WORLD_TILE_RADIUS unconditionally) - that doesn't
    // work either: even individually-cheap tiles still cost a bake pass
    // each, and baking on the order of 1600 tiles synchronously on every
    // load turned the page unusably slow, even fully zoomed in where
    // almost none of them are visible. currentStreamMargin() below is one
    // fix: the loaded margin tracks the *current* frustum footprint (small
    // when zoomed in, growing as the camera zooms out), capped at the
    // world's edge - so tile count actually scales with how much ground
    // is on screen. Batching (CHUNK_TILES, above buildGroundChunk) is the
    // other: even at maximum zoom-out, grouping tiles into much larger
    // chunks that bake as a single pass cuts the worst-case bake count by
    // CHUNK_TILES^2 (~49x at CHUNK_TILES=7), without changing anything
    // about how the ground actually looks.
    const WORLD_TILE_RADIUS = 20; // generous edge matching the ~40-tile-wide ideal from the original scoping discussion
    const WORLD_MARGIN = WORLD_TILE_RADIUS * GRID_SIZE;
    const WORLD_X_MIN = -WORLD_MARGIN;
    const WORLD_X_MAX = WORLD_MARGIN;
    const WORLD_Z_MIN = -WORLD_MARGIN;
    const WORLD_Z_MAX = WORLD_MARGIN;
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
    // How far out tiles need to be kept loaded at the *current* zoom: half
    // the frustum footprint's larger axis, plus one tile of buffer so a
    // small pan doesn't immediately need a not-yet-loaded tile, capped at
    // the world's edge (matches computeMinZoom's guarantee exactly at
    // minZoom, and stays small at normal play zoom).
    function currentStreamMargin() {
      const fp = groundFootprint(camera.zoom);
      const half = Math.max(fp.xMax - fp.xMin, fp.zMax - fp.zMin) / 2;
      return Math.min(WORLD_MARGIN, half + GRID_SIZE);
    }
    // The frustum-vs-ground containment concern from the previous fixed-
    // tile-range design is now handled by streaming (it keeps at least
    // the current footprint loaded around the camera at all times) plus
    // computeMinZoom (it never lets the frustum exceed WORLD_MARGIN) - so
    // panOffset only needs clamping to the outer world edge, a plain
    // min/max.
    function clampPanOffset() {
      panOffset.x = Math.max(WORLD_X_MIN, Math.min(WORLD_X_MAX, panOffset.x));
      panOffset.z = Math.max(WORLD_Z_MIN, Math.min(WORLD_Z_MAX, panOffset.z));
    }
    function applyCameraTransform() {
      camera.position.copy(CAM_BASE_POS).add(panOffset);
      camera.lookAt(CAM_BASE_TARGET.clone().add(panOffset));
    }
    // A fixed MIN_ZOOM (how far the user can zoom out) can only be correct
    // for one specific window aspect ratio: the frustum footprint's world
    // size scales with 1/zoom AND with aspect (wider window -> wider
    // frustum). So "zoomed out enough to show background" isn't a single
    // zoom value - it depends on the window shape too. Derive the zoom
    // floor from the actual footprint at whatever aspect the window
    // currently has, and never let zoom go below the point where the
    // footprint would exceed WORLD_MARGIN (the world's edge) on either
    // axis - this lets the camera zoom out enough to see the whole
    // ~40x40-tile world at once, all of it kept at the one uniform
    // (deliberately cheap) level of detail buildGroundChunk uses.
    function computeMinZoom() {
      const fp1 = groundFootprint(1); // footprint at zoom=1 (footprint scales as 1/zoom from here)
      const zoomForX = (fp1.xMax - fp1.xMin) / (2 * WORLD_MARGIN);
      const zoomForZ = (fp1.zMax - fp1.zMin) / (2 * WORLD_MARGIN);
      return Math.max(ABSOLUTE_MIN_ZOOM, zoomForX, zoomForZ);
    }
    let minZoom = computeMinZoom();
    if (camera.zoom < minZoom) {
      camera.zoom = minZoom;
      camera.updateProjectionMatrix();
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Shadows were only ever correct within the directional light's small
    // fixed shadow-camera frustum (+-5.8 units, sized for the original
    // two-tile village) - once the world started streaming far beyond
    // that, most tiles/houses silently never got a shadow at all, which
    // was already an inconsistency, just a less visible one. Now that the
    // whole world is meant to look uniform at a glance, drop shadows
    // entirely rather than have them keep working only near the origin -
    // see buildGroundChunk and loadChunk below, which no longer set
    // castShadow/receiveShadow on anything.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xb9cbe0, 0x3a3226, 0.55);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.2);
    sun.position.set(6, 10, 4);
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.18);
    scene.add(fill);

    // Soil/path/paddy config the GPU bake needs (see buildGroundChunk /
    // groundMaterial.js) - built once and reused for every tile's bake.
    const groundOpts = {
      soil: SOIL, path: PATH, pathCenterX: PATH_CENTER_X,
      pathHalfWidth: PATH_HALF_WIDTH, pathEdgeSoft: PATH_EDGE_SOFT,
      paddyPlacements: PADDY_PLACEMENTS, paddyHalfW: PADDY_W / 2, paddyHalfD: PADDY_D / 2,
      paddyBankOuter: PADDY_BANK_OUTER, paddyFringeWidth: PADDY_FRINGE_WIDTH,
      paddyFringeColor: PADDY_FRINGE_COLOR,
    };

    // ---- chunk load/unload (see TILE_CONTENT above, CHUNK_TILES above) ----
    // loadedChunks tracks what's live so a chunk can be torn down cleanly:
    // scene.remove() plus disposing every geometry/material/render-target
    // it added. Driven by updateStreamedChunks (below) from the camera's
    // position, so the addressable world can be arbitrarily large while
    // only ever a bounded, small number of chunks are actually loaded.
    const loadedChunks = new Map();
    function loadChunk(chunkX, chunkZ) {
      const key = tileKey(chunkX, chunkZ);
      if (loadedChunks.has(key)) return;
      const group = new THREE.Group();
      const geometries = [];
      const materials = [];
      const renderTargets = [];

      const houses = getChunkHouses(chunkX, chunkZ);
      const { mesh: groundMesh, renderTargets: groundTargets } = buildGroundChunk(
        chunkX, chunkZ, renderer, groundOpts, houses
      );
      group.add(groundMesh);
      geometries.push(groundMesh.geometry);
      materials.push(groundMesh.material);
      renderTargets.push(...groundTargets);

      for (const h of houses) {
        const house = h.worn ? buildFarmhouseVoxelWorn() : buildFarmhouseVoxel();
        house.position.set(h.x, 0, h.z);
        house.rotation.y = h.rotY;
        group.add(house);
        house.traverse((obj) => {
          if (obj.geometry) geometries.push(obj.geometry);
          if (obj.material) materials.push(obj.material);
          // House builders set these true internally, but with no
          // shadow map (see renderer.shadowMap note above) that only
          // ever did anything for houses within the light's small fixed
          // shadow-camera frustum - override here rather than in the
          // shared builders, which other scenes may still want it on.
          obj.castShadow = false;
          obj.receiveShadow = false;
        });
      }

      scene.add(group);
      loadedChunks.set(key, { group, geometries, materials, renderTargets });
    }
    function unloadChunk(chunkX, chunkZ) {
      const key = tileKey(chunkX, chunkZ);
      const entry = loadedChunks.get(key);
      if (!entry) return;
      scene.remove(entry.group);
      entry.geometries.forEach((g) => g.dispose());
      entry.materials.forEach((m) => m.dispose());
      entry.renderTargets.forEach((rt) => rt.dispose());
      loadedChunks.delete(key);
    }

    // Keep every chunk that could be needed to cover the current zoom's
    // margin (see currentStreamMargin above) around the camera's current
    // ground position loaded, and drop everything else. floor/ceil
    // guarantee the loaded window fully covers [panOffset - margin,
    // panOffset + margin] on each axis regardless of where panOffset
    // falls relative to the chunk grid. tileX=0 is the hand-authored road
    // column (see chunkTileRange/getChunkHouses above for how a chunk's
    // houses are gathered from the tiles it spans) - (0,0) has the
    // paddies/farmer-walk range, (0,1) the two hand-placed houses, further
    // tiles (any tileX, any tileZ) get whatever getTileContent
    // procedurally decides (empty ground off the road column, per its
    // tileX!==0 case).
    function updateStreamedChunks() {
      const margin = currentStreamMargin();
      const minChunkX = Math.floor((panOffset.x - margin) / CHUNK_SIZE);
      const maxChunkX = Math.ceil((panOffset.x + margin) / CHUNK_SIZE);
      const minChunkZ = Math.floor((panOffset.z - margin) / CHUNK_SIZE);
      const maxChunkZ = Math.ceil((panOffset.z + margin) / CHUNK_SIZE);
      const wanted = new Set();
      for (let cx = minChunkX; cx <= maxChunkX; cx++) {
        for (let cz = minChunkZ; cz <= maxChunkZ; cz++) {
          wanted.add(tileKey(cx, cz));
          loadChunk(cx, cz);
        }
      }
      for (const key of [...loadedChunks.keys()]) {
        if (!wanted.has(key)) {
          const [cx, cz] = key.split(",").map(Number);
          unloadChunk(cx, cz);
        }
      }
    }
    updateStreamedChunks();

    // Rice paddies flanking the path, one on each side, clear of both the
    // path's soft edge (|x| < 0.9) and the ground bounds (|x| < 7).
    const paddies = PADDY_PLACEMENTS.map(({ x, z }) => {
      const paddy = buildPaddy();
      paddy.root.position.set(x, 0, z);
      // No shadows anywhere now - see the renderer.shadowMap note above.
      paddy.root.traverse((obj) => {
        obj.castShadow = false;
        obj.receiveShadow = false;
      });
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
      // Aspect ratio changed, so the zoom floor that keeps the ground
      // filling the screen changed too - recompute it, and pull the
      // current zoom back up to it if the window just got relatively
      // wider/taller than before.
      minZoom = computeMinZoom();
      if (camera.zoom < minZoom) camera.zoom = minZoom;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      clampPanOffset();
      updateStreamedChunks();
      applyCameraTransform();
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    // ---- zoom: mouse wheel (desktop) + two-finger pinch (touch) ----
    // ---- pan: one-finger / mouse drag, front-back-left-right on the ground ----
    function setZoom(z) {
      camera.zoom = Math.max(minZoom, Math.min(MAX_ZOOM, z));
      camera.updateProjectionMatrix();
      // Zooming out shrinks the valid pan range (see clampPanOffset above),
      // so a panOffset that was fine before this zoom change can now sit
      // outside it - reclamp and re-apply immediately rather than waiting
      // for the next drag.
      clampPanOffset();
      updateStreamedChunks();
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
        updateStreamedChunks();
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
