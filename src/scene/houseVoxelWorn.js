import * as THREE from "three";
import { hash, fbm } from "./terrain";

// A weathered, dilapidated variant of the voxel farmhouse (houseVoxel.js),
// modeled after genre paintings of Sengoku/early-Edo farming villages (e.g.
// Nōka Kayaku-zu-style scrolls) where thatched roofs are patched, mossy and
// frayed rather than crisp - individual straw courses hang unevenly past
// the eave, roofs show dark weather-stained and pale sun-bleached patches
// side by side, and mud-plastered walls carry cracks and repair patches of
// mismatched color. This is a standalone copy: buildFarmhouseVoxel() in
// houseVoxel.js (the clean version) is untouched.

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
const ROOF_LAYERS = HALF_SPAN_BASE;
const RIDGE_LAYERS = GRANULARITY;

const COLOR = {
  stone: 0x847e70,
  timber: 0x2a2115,
  wallLower: 0x685640,
  wallUpper: 0xc2b28a,
  door: 0x1f160e,
  window: 0x0c0a08,
  thatchA: 0xa9895a,
  thatchB: 0x8f7148,
  gable: 0xb6a67e,
  ridge: 0x241c12,
  // weathering-only tones
  moss: 0x596a3e,
  mossDark: 0x475430,
  soot: 0x362c1f,
  bleached: 0xc9b98f,
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

// Darkens/lightens a base color with low-frequency noise (grime, sun
// bleaching), then occasionally swaps in an outright patch/moss/soot tone -
// deterministic per position, so the weathering is stable across rebuilds.
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

// How far this roof "rafter" column's thatch overhangs past the gable wall,
// in voxels - ragged and uneven rather than the clean version's constant
// ROOF_OVERHANG, with some columns worn back almost to nothing (missing
// straw) and others hanging long.
function raggedOverhang(ix) {
  const n = fbm(ix * 0.55 + 3, 91, 3);
  return Math.max(0, Math.round(ROOF_OVERHANG * (0.15 + n * 1.5)));
}

function buildVoxelPlan() {
  const voxels = [];
  const add = (ix, iy, iz, color) => voxels.push({ ix, iy, iz, color });

  // stone plinth: weathered, mossy in shaded/low spots
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

  // walls: patchy weathered plaster, occasional repair patches and crack streaks
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

  // eave plate ring - weathered timber
  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      if (ix === 0 || ix === NX - 1 || iz === 0 || iz === NZ - 1) {
        add(ix, WALL_LAYERS + 1, iz, weather(COLOR.timber, ix, WALL_LAYERS + 1, iz, {}));
      }
    }
  }

  // doorstep, worn stone
  for (let ix = doorIx0 - 1; ix <= doorIx0 + doorW; ix++) {
    for (let iz = NZ; iz < NZ + STEP_DEPTH; iz++) {
      add(ix, 0, iz, weather(COLOR.stone, ix, 0, iz, { patchColors: [COLOR.mossDark], patchChance: 0.1, patchScale: 2.5 }));
    }
  }

  // roof: same stepped-taper shell as the clean version, but each "rafter"
  // column gets its own ragged overhang length (raggedOverhang) instead of
  // a constant one, and the thatch surface is patch-weathered (moss, soot,
  // sun-bleached patches, and a scatter of missing-tuft gaps at the fringe).
  const centerIx = (NX - 1) / 2;
  const layerRanges = [];
  for (let j = 0; j < ROOF_LAYERS; j++) {
    const halfWidth = HALF_SPAN_BASE - j;
    layerRanges.push([Math.round(centerIx - (halfWidth - 1)), Math.round(centerIx + (halfWidth - 1))]);
  }
  const [ixMin, ixMax] = layerRanges[0];
  for (let ix = ixMin; ix <= ixMax; ix++) {
    let topJ = 0;
    for (let j = ROOF_LAYERS - 1; j >= 0; j--) {
      if (ix >= layerRanges[j][0] && ix <= layerRanges[j][1]) { topJ = j; break; }
    }
    const overhang = raggedOverhang(ix);
    const izFront = -overhang;
    const izBack = NZ - 1 + overhang;
    const solidIzRows = new Set([izFront, 0, NZ - 1, izBack]);
    for (let iz = izFront; iz <= izBack; iz++) {
      // a scatter of missing tufts right at the fringe tip
      if ((iz === izFront || iz === izBack) && hash(ix * 1.7, iz * 2.3) < 0.22) continue;
      const jStart = solidIzRows.has(iz) ? 0 : topJ;
      for (let j = jStart; j <= topJ; j++) {
        const iy = WALL_LAYERS + 2 + j;
        let base;
        if (j >= ROOF_LAYERS - RIDGE_LAYERS) base = COLOR.ridge;
        else if (iz === 0 || iz === NZ - 1) base = COLOR.gable;
        else base = Math.floor(j / GRANULARITY) % 2 === 0 ? COLOR.thatchA : COLOR.thatchB;
        const color = weather(base, ix, iy, iz, {
          patchColors: [COLOR.moss, COLOR.mossDark, COLOR.soot, COLOR.bleached],
          patchChance: 0.16,
          patchScale: 3,
        });
        add(ix, iy, iz, color);
      }
    }
  }

  return voxels;
}

export function buildFarmhouseVoxelWorn() {
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

  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
