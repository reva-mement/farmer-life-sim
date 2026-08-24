import * as THREE from "three";

// A voxel / "dot art" (ドット絵) rendering of the same Sengoku-era farmhouse
// modeled in house.js - a stylized, blocky low-res reinterpretation built
// from small cubes instead of sculpted mesh surfaces. Standalone: not wired
// into the main scene, so it has zero effect on what's deployed. Keeps the
// same iconography as the mesh version (kirizuma gable roof tapering to a
// ridge, exposed corner/mid posts, a darker mud splash-guard band low on
// the walls, a plank door, a small window, a stone plinth) so the two are
// a fair side-by-side comparison of art style rather than of research.

const S = 0.09; // voxel edge length, world units
const NX = 19; // footprint width, voxels (local X, gable-facing)
const NZ = 29; // footprint depth, voxels (local Z, ridge-parallel)
const WALL_LAYERS = 11;
const ROOF_OVERHANG = 2; // voxels, Z eaves overhang past the gable walls
const HALF_SPAN_BASE = Math.ceil(NX / 2) + 2; // includes X eave overhang
const ROOF_LAYERS = HALF_SPAN_BASE; // tapers 1 voxel/layer to a 1-wide ridge

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
  const midZ = Math.floor((NZ - 1) / 2);
  const midX = Math.floor((NX - 1) / 2);
  const corner = (ix === 0 || ix === NX - 1) && (iz === 0 || iz === NZ - 1);
  const midSide = (ix === 0 || ix === NX - 1) && iz === midZ;
  const midGable = (iz === 0 || iz === NZ - 1) && ix === midX;
  return corner || midSide || midGable;
}

function buildVoxelPlan() {
  const voxels = [];
  const add = (ix, iy, iz, color) => voxels.push({ ix, iy, iz, color });

  // stone plinth (kiso-ishi): solid slab, 1 voxel wider than the wall footprint
  for (let ix = -1; ix <= NX; ix++) {
    for (let iz = -1; iz <= NZ; iz++) add(ix, 0, iz, COLOR.stone);
  }

  const doorIx0 = Math.round(NX * 0.32);
  const doorW = 3;
  const doorTop = Math.round(WALL_LAYERS * 0.62);
  const winIx0 = Math.round(NX * 0.66);
  const winIyLo = Math.round(WALL_LAYERS * 0.45);
  const winIyHi = winIyLo + 2;

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
        } else if (iz === NZ - 1 && iy >= winIyLo && iy <= winIyHi && ix >= winIx0 && ix < winIx0 + 2) {
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
  for (let ix = doorIx0 - 1; ix <= doorIx0 + doorW; ix++) add(ix, 0, NZ, COLOR.stone);

  // roof: a stepped triangular prism, tapering 1 voxel per layer to a ridge
  const centerIx = (NX - 1) / 2;
  for (let j = 0; j < ROOF_LAYERS; j++) {
    const iy = WALL_LAYERS + 2 + j;
    const halfWidth = HALF_SPAN_BASE - j;
    const ixLo = Math.round(centerIx - (halfWidth - 1));
    const ixHi = Math.round(centerIx + (halfWidth - 1));
    const isRidge = j === ROOF_LAYERS - 1;
    for (let ix = ixLo; ix <= ixHi; ix++) {
      for (let iz = -ROOF_OVERHANG; iz < NZ + ROOF_OVERHANG; iz++) {
        let color;
        if (isRidge) color = COLOR.ridge;
        else if (iz === 0 || iz === NZ - 1) color = COLOR.gable;
        else color = j % 2 === 0 ? COLOR.thatchA : COLOR.thatchB;
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
