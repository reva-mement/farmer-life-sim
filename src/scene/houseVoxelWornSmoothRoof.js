import * as THREE from "three";
import { hash, fbm } from "./terrain";

// Weathered counterpart to houseVoxelSmoothRoof.js: the same voxel-body /
// smooth-roof hybrid, but with houseVoxelWorn.js's weathering (patchy wall
// colors, moss/soot/bleached tones) carried over - baked into the roof's
// canvas texture (patches, not per-voxel, since the roof isn't voxels here)
// and into a slightly wavy, sagging eave line on the roof mesh itself.

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
  stone: 0x847e70,
  timber: 0x2a2115,
  wallLower: 0x685640,
  wallUpper: 0xc2b28a,
  door: 0x1f160e,
  window: 0x0c0a08,
  moss: 0x596a3e,
  mossDark: 0x475430,
  wallPatch: 0x59492f,
  wallCrack: 0x1c150d,
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

function weather(baseHex, x, y, z, { patchColors = [], patchChance = 0.05, patchScale = 4 } = {}) {
  const n = fbm(x * 0.35 + y * 0.11, z * 0.35 - y * 0.07, 3);
  const c = new THREE.Color(baseHex);
  c.multiplyScalar(0.72 + n * 0.56);
  if (patchColors.length) {
    const spotN = fbm(x / patchScale + 50, z / patchScale + 50, 2);
    if (spotN > 1 - patchChance) {
      const which = Math.floor(hash(x * 3.1, z * 2.7) * patchColors.length) % patchColors.length;
      return patchColors[which];
    }
  }
  return c.getHex();
}

function buildVoxelPlan() {
  const voxels = [];
  const add = (ix, iy, iz, color) => voxels.push({ ix, iy, iz, color });

  for (let ix = -PLINTH_MARGIN; ix < NX + PLINTH_MARGIN; ix++) {
    for (let iz = -PLINTH_MARGIN; iz < NZ + PLINTH_MARGIN; iz++) {
      add(ix, 0, iz, weather(COLOR.stone, ix, 0, iz, { patchColors: [COLOR.mossDark], patchChance: 0.08, patchScale: 3 }));
    }
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
        let color;
        if (isPost(ix, iz)) {
          color = weather(COLOR.timber, ix, iy, iz, { patchColors: [COLOR.mossDark], patchChance: 0.04, patchScale: 5 });
        } else {
          const base = lower ? COLOR.wallLower : COLOR.wallUpper;
          color = weather(base, ix, iy, iz, {
            patchColors: [COLOR.wallPatch, COLOR.wallCrack],
            patchChance: 0.1,
            patchScale: 3.5,
          });
        }
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
        add(ix, WALL_LAYERS + 1, iz, weather(COLOR.timber, ix, WALL_LAYERS + 1, iz, {}));
      }
    }
  }

  for (let ix = doorIx0 - 1; ix <= doorIx0 + doorW; ix++) {
    for (let iz = NZ; iz < NZ + STEP_DEPTH; iz++) {
      add(ix, 0, iz, weather(COLOR.stone, ix, 0, iz, { patchColors: [COLOR.mossDark], patchChance: 0.1, patchScale: 2.5 }));
    }
  }

  return voxels;
}

function buildVoxelBody() {
  const voxels = buildVoxelPlan();
  const geo = new THREE.BoxGeometry(S * 0.92, S * 0.92, S * 0.92);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
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

// ---------- smooth thatch roof, weathered ----------

function makeTexture(canvas, repeatX, repeatY, srgb) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// Same course+strand construction as the clean version's thatchTextures(),
// plus a pass of patch blotches (moss, soot, sun-bleach) stamped into both
// canvases together so the weathering has a touch of relief too, not just
// flat color.
function thatchTexturesWorn() {
  const size = 320;
  const courses = 16;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");

  cctx.fillStyle = "#a9895a";
  cctx.fillRect(0, 0, size, size);
  bctx.fillStyle = "#7a7a7a";
  bctx.fillRect(0, 0, size, size);

  const courseH = size / courses;
  for (let i = 0; i < courses; i++) {
    const y = i * courseH;

    const cgrad = cctx.createLinearGradient(0, y, 0, y + courseH);
    cgrad.addColorStop(0, "rgba(50,33,13,0.5)");
    cgrad.addColorStop(0.28, "rgba(230,210,170,0.12)");
    cgrad.addColorStop(1, "rgba(50,33,13,0)");
    cctx.fillStyle = cgrad;
    cctx.fillRect(0, y, size, courseH);

    const bgrad = bctx.createLinearGradient(0, y, 0, y + courseH);
    bgrad.addColorStop(0, "rgba(0,0,0,0.4)");
    bgrad.addColorStop(0.28, "rgba(255,255,255,0.5)");
    bgrad.addColorStop(1, "rgba(0,0,0,0)");
    bctx.fillStyle = bgrad;
    bctx.fillRect(0, y, size, courseH);

    const strandCount = Math.round(size / 1.6);
    for (let s = 0; s < strandCount; s++) {
      const x = Math.random() * size;
      const len = courseH * (0.8 + Math.random() * 0.65);
      const startY = y + courseH - len * 0.15;
      const bend = (Math.random() - 0.5) * 6;
      const shade = Math.random();
      const w = 0.5 + Math.random() * 0.7;

      cctx.strokeStyle = `rgba(${Math.round(66 + 40 * shade)},${Math.round(46 + 28 * shade)},${Math.round(18 + 14 * shade)},${0.3 + 0.4 * shade})`;
      cctx.lineWidth = w;
      cctx.beginPath();
      cctx.moveTo(x, startY);
      cctx.lineTo(x + bend, startY - len);
      cctx.stroke();

      const b = Math.round(105 + shade * 115);
      bctx.strokeStyle = `rgba(${b},${b},${b},0.6)`;
      bctx.lineWidth = w;
      bctx.beginPath();
      bctx.moveTo(x, startY);
      bctx.lineTo(x + bend, startY - len);
      bctx.stroke();
    }
  }

  // weathering patches: moss (greenish, slightly raised), soot (dark, near
  // top courses), sun-bleach (pale, lowered) - stamped as soft blobs
  const patches = [
    { color: "rgba(76,92,55,0.55)", bump: 0.62, count: 10, rMin: 10, rMax: 24 },
    { color: "rgba(58,72,42,0.5)", bump: 0.58, count: 7, rMin: 8, rMax: 18 },
    { color: "rgba(35,27,18,0.4)", bump: 0.3, count: 8, rMin: 6, rMax: 16, topBias: true },
    { color: "rgba(210,195,155,0.35)", bump: 0.75, count: 9, rMin: 8, rMax: 20 },
  ];
  for (const p of patches) {
    for (let i = 0; i < p.count; i++) {
      const x = Math.random() * size;
      const y = p.topBias ? Math.random() * size * 0.35 : Math.random() * size;
      const r = p.rMin + Math.random() * (p.rMax - p.rMin);
      const cg = cctx.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, p.color);
      cg.addColorStop(1, "rgba(0,0,0,0)");
      cctx.fillStyle = cg;
      cctx.beginPath();
      cctx.arc(x, y, r, 0, Math.PI * 2);
      cctx.fill();

      const bg = bctx.createRadialGradient(x, y, 0, x, y, r);
      const bv = Math.round(p.bump * 255);
      bg.addColorStop(0, `rgba(${bv},${bv},${bv},0.5)`);
      bg.addColorStop(1, "rgba(0,0,0,0)");
      bctx.fillStyle = bg;
      bctx.beginPath();
      bctx.arc(x, y, r, 0, Math.PI * 2);
      bctx.fill();
    }
  }

  return {
    colorTex: makeTexture(colorCanvas, 2, 4, true),
    bumpTex: makeTexture(bumpCanvas, 2, 4, false),
  };
}

function gableTextureWorn() {
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#b6a67e";
  ctx.fillRect(0, 0, size, size);
  const soot = ctx.createRadialGradient(size / 2, size * 0.15, 0, size / 2, size * 0.15, size * 0.75);
  soot.addColorStop(0, "rgba(28,22,15,0.65)");
  soot.addColorStop(0.5, "rgba(28,22,15,0.3)");
  soot.addColorStop(1, "rgba(28,22,15,0)");
  ctx.fillStyle = soot;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(48,36,19,0.45)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const y = size * 0.2 + i * size * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 3 + Math.random() * 8;
    ctx.fillStyle = "rgba(70,85,50,0.25)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return makeTexture(canvas, 1, 1, true);
}

function timberTextureWorn() {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2a2115";
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

const W = NX * S;
const D = NZ * S;
const WALL_TOP_Y = (WALL_LAYERS + 2) * S;
const OVERHANG = ROOF_OVERHANG * S;
const RIDGE_RISE = ROOF_LAYERS * S;
const RIDGE_CAP_H = 0.05;

function buildRoof() {
  const { colorTex, bumpTex } = thatchTexturesWorn();
  const thatchMat = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale: 0.03,
    roughness: 0.97,
  });
  const gableMat = new THREE.MeshStandardMaterial({ map: gableTextureWorn(), roughness: 0.96 });

  const halfSpan = W / 2 + OVERHANG;
  const roofDepth = D + OVERHANG * 2;
  const shape = new THREE.Shape();
  // a slightly wavy, sagging eave line - years of an untended thatch roof
  // settling unevenly - rather than the clean version's dead-straight edge
  const eaveSegs = 12;
  shape.moveTo(-halfSpan, 0);
  for (let i = 1; i < eaveSegs; i++) {
    const t = i / eaveSegs;
    const x = -halfSpan + t * (2 * halfSpan);
    const y = (Math.random() - 0.5) * 0.035;
    shape.lineTo(x, y);
  }
  shape.lineTo(halfSpan, 0);
  shape.lineTo(0, RIDGE_RISE);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: roofDepth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -roofDepth / 2);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, [gableMat, thatchMat]);
  mesh.castShadow = true;
  mesh.position.y = WALL_TOP_Y;

  const timberMat = new THREE.MeshStandardMaterial({ map: timberTextureWorn(), roughness: 0.9 });
  const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(0.13, RIDGE_CAP_H, roofDepth + 0.05), timberMat);
  ridgeCap.position.set(0, WALL_TOP_Y + RIDGE_RISE + RIDGE_CAP_H / 2, 0);
  ridgeCap.castShadow = true;

  const group = new THREE.Group();
  group.add(mesh, ridgeCap);
  return group;
}

export function buildFarmhouseVoxelWornSmoothRoof() {
  const group = new THREE.Group();
  group.add(buildVoxelBody());
  group.add(buildRoof());
  return group;
}
