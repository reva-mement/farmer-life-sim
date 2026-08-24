import * as THREE from "three";

// A voxel / "dot art" (ドット絵) rendering of the same Sengoku-era farmhouse
// modeled in house.js - a stylized, blocky low-res reinterpretation built
// from small cubes instead of sculpted mesh surfaces. Standalone: not wired
// into the main scene, so it has zero effect on what's deployed. Keeps the
// same iconography as the mesh version (kirizuma gable roof tapering to a
// ridge, exposed corner/mid posts, a darker mud splash-guard band low on
// the walls, a plank door, a small window, a stone plinth) so the two are
// a fair side-by-side comparison of art style rather than of research.

// GRANULARITY scales the voxel grid up while holding the house's real-world
// size fixed - each voxel gets 1/GRANULARITY as large, so features defined
// by physical thickness (posts, door/window openings, eave overhang, the
// thatch banding period, the ridge cap) are widened by GRANULARITY voxels
// too, rather than shrinking down to a hairline single voxel.
const GRANULARITY = 3;
const S = 0.09 / GRANULARITY; // voxel edge length, world units
const NX = 19 * GRANULARITY; // footprint width, voxels (local X, gable-facing)
const NZ = 29 * GRANULARITY; // footprint depth, voxels (local Z, ridge-parallel)
const WALL_LAYERS = 11 * GRANULARITY;
const ROOF_OVERHANG = 2 * GRANULARITY; // voxels, Z eaves overhang past the gable walls
const POST_THICK = GRANULARITY; // exposed-post thickness, in voxels
const PLINTH_MARGIN = GRANULARITY;
const STEP_DEPTH = GRANULARITY; // doorstep depth, in voxels
const HALF_SPAN_BASE = Math.ceil(NX / 2) + ROOF_OVERHANG;
const ROOF_LAYERS = HALF_SPAN_BASE; // tapers 1 voxel/layer to a 1-wide ridge
const RIDGE_LAYERS = GRANULARITY; // top layers colored as the ridge cap

const COLOR = {
  stone: 0x8c887e,
  timber: 0x2c2015,
  wallLower: 0x7d6a4a,
  wallUpper: 0xd9caa0,
  door: 0x241a10,
  window: 0x100c08,
  thatchA: 0xb99450,
  thatchB: 0xa5814a,
  gable: 0xcabb8f,
  ridge: 0x2c2015,
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

function buildVoxelPlan() {
  const voxels = [];
  const add = (ix, iy, iz, color) => voxels.push({ ix, iy, iz, color });

  // stone plinth (kiso-ishi): solid slab, a bit wider than the wall footprint
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

  // walls: hollow perimeter shell, posts exposed (shinkabe), door/window cut in
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

  // eave plate ring
  for (let ix = 0; ix < NX; ix++) {
    for (let iz = 0; iz < NZ; iz++) {
      if (ix === 0 || ix === NX - 1 || iz === 0 || iz === NZ - 1) {
        add(ix, WALL_LAYERS + 1, iz, COLOR.timber);
      }
    }
  }

  // doorstep, poking out past the gable wall
  for (let ix = doorIx0 - 1; ix <= doorIx0 + doorW; ix++) {
    for (let iz = NZ; iz < NZ + STEP_DEPTH; iz++) add(ix, 0, iz, COLOR.stone);
  }

  // roof: a stepped triangular prism, tapering 1 voxel per layer to a ridge.
  // Thatch bands are grouped GRANULARITY layers at a time so their physical
  // (real-world) thickness stays the same as the original prototype's,
  // instead of shrinking 1/GRANULARITY along with the voxel size.
  //
  // Only the exposed shell is built: the single visible top-surface voxel
  // per column, plus a full solid vertical fill at the two gable-wall lines
  // and the two eave tips (so those read as real faces, not floating dots).
  // A fully solid wedge (every layer, every column) looks identical from
  // outside but rasterizes a huge amount of entirely hidden interior volume
  // every frame - fine at the original coarse grid, but enough to make a
  // 3x-finer grid crawl under software (SwiftShader) WebGL rendering.
  const centerIx = (NX - 1) / 2;
  const layerRanges = [];
  for (let j = 0; j < ROOF_LAYERS; j++) {
    const halfWidth = HALF_SPAN_BASE - j;
    layerRanges.push([Math.round(centerIx - (halfWidth - 1)), Math.round(centerIx + (halfWidth - 1))]);
  }
  const [ixMin, ixMax] = layerRanges[0];
  const izFront = -ROOF_OVERHANG;
  const izBack = NZ - 1 + ROOF_OVERHANG;
  const solidIzRows = new Set([izFront, 0, NZ - 1, izBack]);
  for (let ix = ixMin; ix <= ixMax; ix++) {
    let topJ = 0;
    for (let j = ROOF_LAYERS - 1; j >= 0; j--) {
      if (ix >= layerRanges[j][0] && ix <= layerRanges[j][1]) { topJ = j; break; }
    }
    for (let iz = izFront; iz <= izBack; iz++) {
      const jStart = solidIzRows.has(iz) ? 0 : topJ;
      for (let j = jStart; j <= topJ; j++) {
        const iy = WALL_LAYERS + 2 + j;
        let color;
        if (j >= ROOF_LAYERS - RIDGE_LAYERS) color = COLOR.ridge;
        else if (iz === 0 || iz === NZ - 1) color = COLOR.gable;
        else color = Math.floor(j / GRANULARITY) % 2 === 0 ? COLOR.thatchA : COLOR.thatchB;
        add(ix, iy, iz, color);
      }
    }
  }

  return voxels;
}

export function buildFarmhouseVoxel() {
  const voxels = buildVoxelPlan();
  const geo = new THREE.BoxGeometry(S * 0.92, S * 0.92, S * 0.92);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, voxels.length);
  // Shadow casting/receiving off: at this instance count (tens of thousands
  // of tiny cubes) the shadow-map depth pass is what makes this prototype
  // crawl under headless Chromium's software (SwiftShader) WebGL renderer -
  // confirmed by profiling, not guessed. Not needed to judge the art style.
  mesh.castShadow = false;
  mesh.receiveShadow = false;

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
