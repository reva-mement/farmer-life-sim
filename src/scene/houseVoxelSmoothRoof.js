import * as THREE from "three";

// Experiment: keep the farmhouse's body (walls, posts, plinth, door, window)
// as voxels/"dot art" - the part where blockiness reads fine, even up close,
// as exposed timber and mud-plaster panels - but replace the roof with a
// smooth sculpted surface (like house.js's mesh roof) carrying a detailed,
// bump-mapped thatch texture instead of stepped cubes. The roof is where the
// voxel look reads worst when zoomed in (a thatched roof is the least
// "blocky" thing in nature), so this tests whether smoothing just that
// surface - with enough texture detail to still read as individual straw -
// fixes it while keeping the rest of the house's dot-art character.
//
// Standalone: not wired into the scene. buildFarmhouseVoxel() (clean) and
// buildFarmhouseVoxelWorn() (weathered) are untouched.

const GRANULARITY = 3;
const S = 0.09 / GRANULARITY;
const NX = 19 * GRANULARITY;
const NZ = 29 * GRANULARITY;
const WALL_LAYERS = 11 * GRANULARITY;
const ROOF_OVERHANG = 2 * GRANULARITY;
const POST_THICK = GRANULARITY;
const PLINTH_MARGIN = GRANULARITY;
const STEP_DEPTH = GRANULARITY;
const HALF_SPAN_BASE = Math.ceil(NX / 2) + ROOF_OVERHANG;
const ROOF_LAYERS = HALF_SPAN_BASE; // only used to compute a matching ridge rise

const COLOR = {
  stone: 0x8c887e,
  timber: 0x2c2015,
  wallLower: 0x7d6a4a,
  wallUpper: 0xd9caa0,
  door: 0x241a10,
  window: 0x100c08,
};

function isPost(ix, iz) {
  const midZLo = Math.floor((NZ - 1) / 2) - Math.floor((POST_THICK - 1) / 2);
  const midXLo = Math.floor((NX - 1) / 2) - Math.floor((POST_THICK - 1) / 2);
  const nearXEdge = ix < POST_THICK || ix >= NX - POST_THICK;
  const nearZEdge = iz < POST_THICK || iz >= NZ - POST_THICK;
  const corner = nearXEdge && nearZEdge;
  const midSide = nearXEdge && iz >= midZLo && iz < midZLo + POST_THICK;
  const midGable = nearZEdge && ix >= midXLo && ix < midXLo + POST_THICK;
  return corner || midSide || midGable;
}

// Voxel body only - walls, posts, plinth, door, window, eave plate,
// doorstep. No roof voxels; the roof is a separate smooth mesh.
function buildVoxelPlan() {
  const voxels = [];
  const add = (ix, iy, iz, color) => voxels.push({ ix, iy, iz, color });

  for (let ix = -PLINTH_MARGIN; ix < NX + PLINTH_MARGIN; ix++) {
    for (let iz = -PLINTH_MARGIN; iz < NZ + PLINTH_MARGIN; iz++) add(ix, 0, iz, COLOR.stone);
  }

  const doorIx0 = Math.round(NX * 0.32);
  const doorW = 3 * GRANULARITY;
  const doorTop = Math.round(WALL_LAYERS * 0.62);
  const winIx0 = Math.round(NX * 0.66);
  const winIyLo = Math.round(WALL_LAYERS * 0.45);
  const winIyHi = winIyLo + 2 * GRANULARITY;
  const winW = 2 * GRANULARITY;

  for (let iy = 1; iy <= WALL_LAYERS; iy++) {
    const lower = iy <= WALL_LAYERS * 0.4;
    for (let ix = 0; ix < NX; ix++) {
      for (let iz = 0; iz < NZ; iz++) {
        const onPerimeter = ix === 0 || ix === NX - 1 || iz === 0 || iz === NZ - 1;
        if (!onPerimeter) continue;
        let color = isPost(ix, iz) ? COLOR.timber : lower ? COLOR.wallLower : COLOR.wallUpper;
        if (iz === NZ - 1 && iy <= doorTop && ix >= doorIx0 && ix < doorIx0 + doorW) {
          color = COLOR.door;
        } else if (iz === NZ - 1 && iy >= winIyLo && iy <= winIyHi && ix >= winIx0 && ix < winIx0 + winW) {
          color = COLOR.window;
        }
        add(ix, iy, iz, color);
      }
    }
  }

  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      if (ix === 0 || ix === NX - 1 || iz === 0 || iz === NZ - 1) {
        add(ix, WALL_LAYERS + 1, iz, COLOR.timber);
      }
    }
  }

  for (let ix = doorIx0 - 1; ix <= doorIx0 + doorW; ix++) {
    for (let iz = NZ; iz < NZ + STEP_DEPTH; iz++) add(ix, 0, iz, COLOR.stone);
  }

  return voxels;
}

function buildVoxelBody() {
  const voxels = buildVoxelPlan();
  const geo = new THREE.BoxGeometry(S * 0.92, S * 0.92, S * 0.92);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, voxels.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const centerIx = (NX - 1) / 2;
  const centerIz = (NZ - 1) / 2;
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  voxels.forEach((v, i) => {
    m.makeTranslation((v.ix - centerIx) * S, (v.iy + 0.5) * S, (v.iz - centerIz) * S);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHex(v.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

// ---------- smooth thatch roof, with a bump-mapped fiber texture ----------

function makeTexture(canvas, repeatX, repeatY, srgb) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// Two synced canvases (color + bump), built together strand-by-strand so
// the bump map's relief lines up with the color map's shading - this is
// what actually reads as "individual straw" once bumpMap catches the light,
// rather than just a painted-on stripe pattern.
function thatchTextures() {
  const size = 320;
  const courses = 16;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");

  cctx.fillStyle = "#b99450";
  cctx.fillRect(0, 0, size, size);
  bctx.fillStyle = "#7a7a7a";
  bctx.fillRect(0, 0, size, size);

  const courseH = size / courses;
  for (let i = 0; i < courses; i++) {
    const y = i * courseH;

    const cgrad = cctx.createLinearGradient(0, y, 0, y + courseH);
    cgrad.addColorStop(0, "rgba(55,36,14,0.5)");
    cgrad.addColorStop(0.28, "rgba(255,235,190,0.14)");
    cgrad.addColorStop(1, "rgba(55,36,14,0)");
    cctx.fillStyle = cgrad;
    cctx.fillRect(0, y, size, courseH);

    const bgrad = bctx.createLinearGradient(0, y, 0, y + courseH);
    bgrad.addColorStop(0, "rgba(0,0,0,0.4)");
    bgrad.addColorStop(0.28, "rgba(255,255,255,0.55)");
    bgrad.addColorStop(1, "rgba(0,0,0,0)");
    bctx.fillStyle = bgrad;
    bctx.fillRect(0, y, size, courseH);

    // individual straw strands, drawn once but stroked onto both canvases
    // so color and relief agree with each other
    const strandCount = Math.round(size / 1.6);
    for (let s = 0; s < strandCount; s++) {
      const x = Math.random() * size;
      const len = courseH * (0.85 + Math.random() * 0.55);
      const startY = y + courseH - len * 0.15;
      const bend = (Math.random() - 0.5) * 5;
      const shade = Math.random();
      const w = 0.5 + Math.random() * 0.7;

      cctx.strokeStyle = `rgba(${Math.round(72 + 45 * shade)},${Math.round(50 + 32 * shade)},${Math.round(20 + 16 * shade)},${0.3 + 0.4 * shade})`;
      cctx.lineWidth = w;
      cctx.beginPath();
      cctx.moveTo(x, startY);
      cctx.lineTo(x + bend, startY - len);
      cctx.stroke();

      const b = Math.round(110 + shade * 120);
      bctx.strokeStyle = `rgba(${b},${b},${b},0.6)`;
      bctx.lineWidth = w;
      bctx.beginPath();
      bctx.moveTo(x, startY);
      bctx.lineTo(x + bend, startY - len);
      bctx.stroke();
    }
  }

  return {
    colorTex: makeTexture(colorCanvas, 2, 4, true),
    bumpTex: makeTexture(bumpCanvas, 2, 4, false),
  };
}

function gableTexture() {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#cabb8f";
  ctx.fillRect(0, 0, size, size);
  const soot = ctx.createRadialGradient(size / 2, size * 0.15, 0, size / 2, size * 0.15, size * 0.7);
  soot.addColorStop(0, "rgba(30,24,16,0.55)");
  soot.addColorStop(0.5, "rgba(30,24,16,0.22)");
  soot.addColorStop(1, "rgba(30,24,16,0)");
  ctx.fillStyle = soot;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(50,38,20,0.4)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const y = size * 0.2 + i * size * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  return makeTexture(canvas, 1, 1, true);
}

function timberTexture() {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2c2015";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  for (let i = 0; i < 6; i++) {
    const x = (i / 6) * size;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  return makeTexture(canvas, 1, 1, false);
}

// Real-world dimensions matching the voxel body's actual footprint/height
// (NX/NZ/WALL_LAYERS * S), not house.js's separately-tuned constants - the
// roof has to sit exactly on top of this specific body.
const W = NX * S;
const D = NZ * S;
const WALL_TOP_Y = (WALL_LAYERS + 2) * S; // wall top + eave plate
const OVERHANG = ROOF_OVERHANG * S;
const RIDGE_RISE = ROOF_LAYERS * S;
const RIDGE_CAP_H = 0.05;

function buildRoof() {
  const { colorTex, bumpTex } = thatchTextures();
  const thatchMat = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale: 0.028,
    roughness: 0.96,
  });
  const gableMat = new THREE.MeshStandardMaterial({ map: gableTexture(), roughness: 0.95 });

  const halfSpan = W / 2 + OVERHANG;
  const roofDepth = D + OVERHANG * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(0, RIDGE_RISE);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: roofDepth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -roofDepth / 2);
  geo.computeVertexNormals();
  // group materialIndex 0 = gable-end caps, 1 = the extruded sides (roof
  // slopes + soffit) - verified empirically for this exact geometry
  // construction when house.js's mesh roof was built.
  const mesh = new THREE.Mesh(geo, [gableMat, thatchMat]);
  mesh.castShadow = true;
  mesh.position.y = WALL_TOP_Y;

  const timberMat = new THREE.MeshStandardMaterial({ map: timberTexture(), roughness: 0.85 });
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(0.13, RIDGE_CAP_H, roofDepth + 0.05), timberMat);
  ridgeCap.position.set(0, WALL_TOP_Y + RIDGE_RISE + RIDGE_CAP_H / 2, 0);
  ridgeCap.castShadow = true;

  const group = new THREE.Group();
  group.add(mesh, ridgeCap);
  return group;
}

export function buildFarmhouseVoxelSmoothRoof() {
  const group = new THREE.Group();
  group.add(buildVoxelBody());
  group.add(buildRoof());
  return group;
}
