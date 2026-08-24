import React, { useEffect, useRef } from "react";
import * as THREE from "three";

const GRID_SIZE = 11;
const HALF = (GRID_SIZE - 1) / 2;

const MAP_ROWS = [
  "GGGGGGGGGGG",
  "GGGPGGGADGG",
  "GGFFFGGGGGG",
  "GGFFFPGGCGG",
  "GPPPPPPPPPG",
  "GGGWWGGBGGG",
  "GGGWWGGGGGG",
  "GGFFFPGGGGG",
  "GGFFFGGGGGG",
  "GGGPGGGGGGG",
  "GGGGGGGGGGG",
];

// small non-blocking decoration (rocks / bushes / flowers) scattered on grass tiles, purely visual
const PROPS = [
  { gx: 4, gy: 1, type: "bush" },
  { gx: 2, gy: 5, type: "rock" },
  { gx: 6, gy: 6, type: "bush" },
  { gx: 9, gy: 3, type: "rock" },
  { gx: 8, gy: 7, type: "bush" },
  { gx: 1, gy: 8, type: "rock" },
  { gx: 9, gy: 8, type: "bush" },
  { gx: 6, gy: 2, type: "rock" },
  { gx: 4, gy: 9, type: "bush" },
  { gx: 2, gy: 1, type: "flower" },
  { gx: 9, gy: 2, type: "flower" },
  { gx: 2, gy: 6, type: "flower" },
  { gx: 6, gy: 8, type: "flower" },
  { gx: 8, gy: 5, type: "flower" },
];

const WALKABLE = new Set(["G", "P", "F"]);

function cellType(x, y) {
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return "T";
  return MAP_ROWS[y][x];
}

function toWorld(gx, gy) {
  return { x: gx - HALF, z: gy - HALF };
}

function bfsPath(start, isGoal, walkable) {
  if (isGoal(start.x, start.y)) return [];
  const key = (x, y) => x + "," + y;
  const visited = new Set([key(start.x, start.y)]);
  const queue = [{ x: start.x, y: start.y, path: [] }];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length) {
    const cur = queue.shift();
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const k = key(nx, ny);
      if (visited.has(k)) continue;
      if (!walkable(nx, ny)) continue;
      const newPath = [...cur.path, { x: nx, y: ny }];
      if (isGoal(nx, ny)) return newPath;
      visited.add(k);
      queue.push({ x: nx, y: ny, path: newPath });
    }
  }
  return null;
}

// ---------- procedural textures ----------
function makeTexture(draw, size = 128, repeat = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// ---------- value noise (fbm), same technique validated on the soil-tile study ----------
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

// Builds a randomly-bumped ground tile: real vertex displacement (clump-scale) +
// color/bump/roughness maps (clump + grain + pebble layers) for one tile type.
function buildGroundTile(cfg) {
  const {
    size = 1.0,
    segs = 8,
    texSize = 256,
    clumpScale = 5,
    grainScale = 18,
    pebbleScale = 30,
    dispClump = 0.02,
    dispGrain = 0.005,
    dispPebble = 0.01,
    colorLow,
    colorHigh,
    speckAmt = 20,
    pebbleShadeAmt = 12,
    roughLow = 0.55,
    roughHigh = 0.95,
    bumpScale = 0.015,
  } = cfg;

  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / size + 0.5;
    const v = y / size + 0.5;
    const clump = fbm(u * clumpScale, v * clumpScale, 4);
    const grain = fbm(u * grainScale + 40, v * grainScale + 40, 2);
    const pebble = fbm(u * pebbleScale + 80, v * pebbleScale + 80, 2);
    pos.setZ(i, clump * dispClump + grain * dispGrain + pebble * dispPebble);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2); // bake "lie flat" into the geometry itself

  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = texSize;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = texSize;
  const bctx = bumpCanvas.getContext("2d");
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = roughCanvas.height = texSize;
  const rctx = roughCanvas.getContext("2d");
  const cimg = cctx.createImageData(texSize, texSize);
  const bimg = bctx.createImageData(texSize, texSize);
  const rimg = rctx.createImageData(texSize, texSize);

  for (let py = 0; py < texSize; py++) {
    for (let px = 0; px < texSize; px++) {
      const u = px / texSize;
      const v = py / texSize;
      const clump = fbm(u * clumpScale, v * clumpScale, 4);
      const grain = fbm(u * grainScale + 40, v * grainScale + 40, 2);
      const pebble = fbm(u * pebbleScale + 80, v * pebbleScale + 80, 2);

      let r = colorLow[0] + (colorHigh[0] - colorLow[0]) * clump;
      let g = colorLow[1] + (colorHigh[1] - colorLow[1]) * clump;
      let b = colorLow[2] + (colorHigh[2] - colorLow[2]) * clump;

      const speck = (grain - 0.5) * speckAmt;
      r += speck;
      g += speck * 0.9;
      b += speck * 0.75;

      const pebbleShade = (pebble - 0.5) * pebbleShadeAmt;
      r += pebbleShade;
      g += pebbleShade * 0.9;
      b += pebbleShade * 0.8;

      const idx = (py * texSize + px) * 4;
      cimg.data[idx] = Math.max(0, Math.min(255, r));
      cimg.data[idx + 1] = Math.max(0, Math.min(255, g));
      cimg.data[idx + 2] = Math.max(0, Math.min(255, b));
      cimg.data[idx + 3] = 255;

      const height = clump * 0.5 + grain * 0.25 + pebble * 0.4;
      const hByte = Math.max(0, Math.min(255, height * 255));
      bimg.data[idx] = bimg.data[idx + 1] = bimg.data[idx + 2] = hByte;
      bimg.data[idx + 3] = 255;

      const roughVal = roughHigh - clump * (roughHigh - roughLow) - (grain - 0.5) * 0.08;
      const rByte = Math.max(0, Math.min(255, roughVal * 255));
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

  const material = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale,
    roughnessMap: roughTex,
    roughness: 1,
    metalness: 0.02,
  });

  return { geometry: geo, material };
}

function waterTexture() {
  return makeTexture((ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, "#4f7f92");
    grad.addColorStop(1, "#6fa0ac");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const y = (i + 0.5) * (s / 6);
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y - 6, s * 0.7, y + 6, s, y);
      ctx.stroke();
    }
  }, 128, 2);
}

function thatchTexture(tint) {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(70,45,20,0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const y = i * (s / 24);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + 4);
      ctx.stroke();
    }
  }, 64, 1);
}

function plasterTexture(tint) {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 200; i++) {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  }, 64, 1);
}

function woodTexture() {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = "#6e4a2d";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(40,24,12,0.4)";
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      const x = i * (s / 10);
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 2, s);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, 64, 1);
}

let _aoTexture = null;
function aoTexture() {
  if (_aoTexture) return _aoTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(20,14,8,0.55)");
  grad.addColorStop(0.7, "rgba(20,14,8,0.22)");
  grad.addColorStop(1, "rgba(20,14,8,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _aoTexture = new THREE.CanvasTexture(canvas);
  return _aoTexture;
}

let _aoMat = null;
function buildAODecal(radius) {
  if (!_aoMat) {
    _aoMat = new THREE.MeshBasicMaterial({
      map: aoTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });
  }
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), _aoMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.003;
  return mesh;
}

// ---------- object builders ----------
function buildTree() {
  const group = new THREE.Group();
  group.add(buildAODecal(0.32));
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2d, roughness: 1 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.34, 6), trunkMat);
  trunk.position.y = 0.17;
  trunk.castShadow = true;
  group.add(trunk);

  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x5f7d47, roughness: 0.9, flatShading: true });
  const canopyMat2 = new THREE.MeshStandardMaterial({ color: 0x729159, roughness: 0.9, flatShading: true });
  const c1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), canopyMat);
  c1.position.set(0.03, 0.46, -0.02);
  c1.castShadow = true;
  const c2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), canopyMat2);
  c2.position.set(-0.08, 0.58, 0.05);
  c2.castShadow = true;
  group.add(c1, c2);
  return group;
}

function buildHouse(variant) {
  const group = new THREE.Group();
  const tints = {
    A: { wall: "#ded2ab", roof: "#c2a066" },
    B: { wall: "#cbc0bb", roof: "#ad7d5c" },
    C: { wall: "#c7bfa0", roof: "#a98a55" },
    D: { wall: "#b8ab8e", roof: "#8f6a45" },
  };
  const { wall: wallTint, roof: roofTint } = tints[variant] || tints.A;
  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTexture(wallTint), roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ map: thatchTexture(roofTint), roughness: 1, flatShading: true });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });

  if (variant === "C") {
    // elongated barn with gable (peaked) roof
    group.add(buildAODecal(0.62));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, 0.42), wallMat);
    body.position.y = 0.15;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const slope = new THREE.BoxGeometry(0.9, 0.04, 0.32);
    const left = new THREE.Mesh(slope, roofMat);
    left.position.set(0, 0.42, -0.12);
    left.rotation.x = -0.55;
    left.castShadow = true;
    const right = new THREE.Mesh(slope, roofMat);
    right.position.set(0, 0.42, 0.12);
    right.rotation.x = 0.55;
    right.castShadow = true;
    group.add(left, right);

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.03), doorMat);
    door.position.set(0.3, 0.1, 0.21);
    group.add(door);
    return group;
  }

  if (variant === "D") {
    // watchtower: tall, narrow, small pyramid roof
    group.add(buildAODecal(0.34));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.62, 0.32), wallMat);
    body.position.y = 0.31;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.22, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.62 + 0.11;
    roof.castShadow = true;
    group.add(roof);

    const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.03), doorMat);
    doorMesh.position.set(0, 0.07, 0.165);
    group.add(doorMesh);
    return group;
  }

  // A / B: standard pyramid-roof house
  group.add(buildAODecal(0.5));
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.34, 0.55), wallMat);
  body.position.y = 0.17;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.32, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 0.34 + 0.16;
  roof.castShadow = true;
  group.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.03), doorMat);
  door.position.set(0, 0.09, 0.28);
  group.add(door);

  return group;
}

function buildRock() {
  const group = new THREE.Group();
  group.add(buildAODecal(0.16));
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c8a7c, roughness: 1, flatShading: true });
  const r1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), mat);
  r1.position.set(0, 0.06, 0);
  r1.rotation.set(0.4, 0.6, 0.1);
  r1.castShadow = true;
  const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.055, 0), mat);
  r2.position.set(0.09, 0.035, 0.06);
  r2.castShadow = true;
  group.add(r1, r2);
  return group;
}

function buildBush() {
  const group = new THREE.Group();
  group.add(buildAODecal(0.18));
  const mat = new THREE.MeshStandardMaterial({ color: 0x5f7d47, roughness: 0.95, flatShading: true });
  const mat2 = new THREE.MeshStandardMaterial({ color: 0x729159, roughness: 0.95, flatShading: true });
  const b1 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), mat);
  b1.position.set(0, 0.12, 0);
  b1.castShadow = true;
  const b2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), mat2);
  b2.position.set(0.1, 0.08, 0.05);
  b2.castShadow = true;
  group.add(b1, b2);
  return group;
}

const FLOWER_COLORS = [0xc0453a, 0xd68a3a, 0xb5497e];
function buildFlower() {
  const group = new THREE.Group();
  group.add(buildAODecal(0.14));
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5f7d47, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.6;
    const r = 0.05 + Math.random() * 0.05;
    const px = Math.cos(angle) * r;
    const pz = Math.sin(angle) * r;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 4), stemMat);
    stem.position.set(px, 0.045, pz);
    group.add(stem);
    const color = FLOWER_COLORS[i % FLOWER_COLORS.length];
    const headMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true });
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.028, 0), headMat);
    head.position.set(px, 0.095, pz);
    head.castShadow = true;
    group.add(head);
  }
  return group;
}

function buildBanner(color) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2d, roughness: 1 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 5), poleMat);
  pole.position.y = 0.21;
  pole.castShadow = true;
  group.add(pole);
  const clothMat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.18), clothMat);
  cloth.position.set(0.06, 0.34, 0);
  cloth.castShadow = true;
  group.add(cloth);
  return group;
}


let _fenceMat = null;
function buildFenceSegment(horizontal) {
  if (!_fenceMat) {
    _fenceMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 1 });
  }
  const group = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.05, 0.03), _fenceMat);
  rail.position.y = 0.14;
  rail.castShadow = true;
  const rail2 = rail.clone();
  rail2.position.y = 0.06;
  const postGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.2, 5);
  const postL = new THREE.Mesh(postGeo, _fenceMat);
  postL.position.set(-0.4, 0.1, 0);
  const postR = new THREE.Mesh(postGeo, _fenceMat);
  postR.position.set(0.4, 0.1, 0);
  group.add(rail, rail2, postL, postR);
  if (!horizontal) group.rotation.y = Math.PI / 2;
  return group;
}

function buildCharacter({ body, hat, skin }) {
  const group = new THREE.Group();
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);

  const torsoMat = new THREE.MeshStandardMaterial({ color: body, roughness: 0.85, flatShading: true });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 8), torsoMat);
  torso.position.y = 0.15 + 0.02;
  torso.castShadow = true;
  group.add(torso);

  const headMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8, flatShading: true });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), headMat);
  head.position.y = 0.32 + 0.11 + 0.02;
  head.castShadow = true;
  group.add(head);

  if (hat) {
    const hatMat = new THREE.MeshStandardMaterial({ color: hat, roughness: 0.9, flatShading: true });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.02, 12), hatMat);
    brim.position.y = head.position.y + 0.06;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.09, 10), hatMat);
    cone.position.y = head.position.y + 0.1;
    group.add(brim, cone);
  }

  group.userData.bobBase = 0;
  return group;
}

export default function FarmerLifeSim3D() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();

    const width = mount.clientWidth;
    const height = mount.clientHeight;
    const d = 7.6;
    const camera = new THREE.OrthographicCamera(
      (-d * width) / height,
      (d * width) / height,
      d,
      -d,
      0.1,
      100
    );
    camera.position.set(9, 9, 9);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputEncoding = THREE.sRGBEncoding;
    mount.appendChild(renderer.domElement);

    // lighting: warm sun (highlights) vs cool sky/ambient (shadows) for a split-tone look
    const hemi = new THREE.HemisphereLight(0xb9cbe0, 0x3a3226, 0.5);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.2);
    sun.position.set(6, 10, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8.5;
    sun.shadow.camera.right = 8.5;
    sun.shadow.camera.top = 8.5;
    sun.shadow.camera.bottom = -8.5;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 28;
    sun.shadow.bias = -0.0018;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.18);
    scene.add(fill);

    // ground tiles: real vertex-displaced geometry + color/bump/roughness maps per type
    const grassGT = buildGroundTile({
      clumpScale: 6,
      grainScale: 20,
      pebbleScale: 34,
      dispClump: 0.014,
      dispGrain: 0.003,
      dispPebble: 0.006,
      colorLow: [107, 112, 72],
      colorHigh: [138, 146, 101],
      speckAmt: 16,
      pebbleShadeAmt: 10,
      roughLow: 0.75,
      roughHigh: 0.98,
      bumpScale: 0.01,
    });
    const soilGT = buildGroundTile({
      clumpScale: 5.5,
      grainScale: 18,
      pebbleScale: 30,
      dispClump: 0.024,
      dispGrain: 0.005,
      dispPebble: 0.014,
      colorLow: [104, 79, 52],
      colorHigh: [151, 118, 79],
      speckAmt: 26,
      pebbleShadeAmt: 14,
      roughLow: 0.6,
      roughHigh: 0.95,
      bumpScale: 0.016,
    });
    const pathGT = buildGroundTile({
      clumpScale: 7,
      grainScale: 22,
      pebbleScale: 36,
      dispClump: 0.006,
      dispGrain: 0.002,
      dispPebble: 0.004,
      colorLow: [180, 165, 125],
      colorHigh: [206, 191, 150],
      speckAmt: 14,
      pebbleShadeAmt: 8,
      roughLow: 0.7,
      roughHigh: 0.95,
      bumpScale: 0.006,
    });
    const treeGT = buildGroundTile({
      clumpScale: 6,
      grainScale: 20,
      pebbleScale: 34,
      dispClump: 0.014,
      dispGrain: 0.003,
      dispPebble: 0.006,
      colorLow: [79, 86, 56],
      colorHigh: [104, 112, 76],
      speckAmt: 14,
      pebbleShadeAmt: 10,
      roughLow: 0.8,
      roughHigh: 0.98,
      bumpScale: 0.01,
    });

    const waterMat = new THREE.MeshStandardMaterial({
      map: waterTexture(),
      roughness: 0.25,
      metalness: 0.1,
      transparent: true,
      opacity: 0.92,
    });
    const waterGeo = new THREE.PlaneGeometry(1.0, 1.0, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);

    const groundByType = { G: grassGT, F: soilGT, P: pathGT, T: treeGT };

    const tileMeshes = [];

    for (let gy = 0; gy < GRID_SIZE; gy++) {
      for (let gx = 0; gx < GRID_SIZE; gx++) {
        const type = cellType(gx, gy);
        const { x, z } = toWorld(gx, gy);

        let tile;
        if (type === "W") {
          tile = new THREE.Mesh(waterGeo, waterMat);
        } else {
          const gt = groundByType[type] || grassGT;
          tile = new THREE.Mesh(gt.geometry, gt.material);
        }
        tile.rotation.y = Math.floor(Math.random() * 4) * (Math.PI / 2);
        tile.position.set(x, 0, z);
        tile.receiveShadow = true;
        tile.castShadow = type !== "W";
        tile.userData = { gx, gy, walkable: WALKABLE.has(type) };
        scene.add(tile);
        tileMeshes.push(tile);

        if (type === "T") {
          const tree = buildTree();
          tree.position.set(x, 0, z);
          scene.add(tree);
        } else if (type === "A" || type === "B" || type === "C" || type === "D") {
          const house = buildHouse(type);
          house.position.set(x, 0, z);
          scene.add(house);
          if (type === "D") {
            const banner = buildBanner(0xb5453a);
            banner.position.set(x - 0.2, 0.62, z - 0.2);
            scene.add(banner);
          }
        } else if (type === "F") {
          const dirs = [
            [1, 0, false],
            [-1, 0, false],
            [0, 1, true],
            [0, -1, true],
          ];
          dirs.forEach(([dx, dy, horizontal]) => {
            const nType = cellType(gx + dx, gy + dy);
            if (nType === "G" || nType === "P") {
              const fence = buildFenceSegment(horizontal);
              fence.position.set(x + dx * 0.5, 0, z + dy * 0.5);
              scene.add(fence);
            }
          });
        }
      }
    }

    PROPS.forEach((p) => {
      const { x, z } = toWorld(p.gx, p.gy);
      const obj = p.type === "rock" ? buildRock() : p.type === "flower" ? buildFlower() : buildBush();
      obj.position.set(x, 0, z);
      obj.rotation.y = Math.random() * Math.PI * 2;
      scene.add(obj);
    });

    // farmer
    const farmerGroup = buildCharacter({ body: 0x3f5b3a, hat: 0xd8b978, skin: 0xe8c9a0 });
    let farmerGrid = { x: 5, y: 4 };
    const startW = toWorld(5, 4);
    farmerGroup.position.set(startW.x, 0, startW.z);
    scene.add(farmerGroup);

    // decorative background crowd: small villagers pacing back and forth, purely visual
    const crowdDefs = [
      { color: 0x8a6a45, waypoints: [{ gx: 2, gy: 1 }, { gx: 5, gy: 1 }] },
      { color: 0x6f7f95, waypoints: [{ gx: 8, gy: 2 }, { gx: 8, gy: 4 }] },
      { color: 0x9a6f6a, waypoints: [{ gx: 2, gy: 4 }, { gx: 8, gy: 4 }] },
      { color: 0x7a8a5a, waypoints: [{ gx: 6, gy: 6 }, { gx: 9, gy: 6 }] },
      { color: 0x836f9a, waypoints: [{ gx: 5, gy: 9 }, { gx: 8, gy: 9 }] },
    ];
    const crowd = crowdDefs.map((def) => {
      const g = buildCharacter({ body: def.color, hat: false, skin: 0xe0c39f });
      g.scale.setScalar(0.85);
      const wps = def.waypoints.map((w) => toWorld(w.gx, w.gy));
      g.position.set(wps[0].x, 0, wps[0].z);
      scene.add(g);
      return { group: g, waypoints: wps, index: 0, t: Math.random(), dir: 1, speed: 0.35 + Math.random() * 0.15 };
    });

    // movement state
    let moveQueue = [];
    let stepStart = null;
    let stepFrom = { x: startW.x, z: startW.z };
    let stepTo = null;
    const STEP_DURATION = 0.34;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function onClick(ev) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(tileMeshes);
      if (!hits.length) return;
      const { gx, gy, walkable } = hits[0].object.userData;
      if (!walkable) return;
      if (moveQueue.length) return; // ignore clicks mid-move for now
      if (farmerGrid.x === gx && farmerGrid.y === gy) return;

      const isBlocked = (x, y) => !WALKABLE.has(cellType(x, y));
      const path = bfsPath(farmerGrid, (x, y) => x === gx && y === gy, (x, y) => !isBlocked(x, y));
      if (!path || path.length === 0) return;
      moveQueue = path;
    }
    renderer.domElement.addEventListener("click", onClick);

    const clock = new THREE.Clock();
    function animate() {
      const dt = clock.getDelta();
      const t = clock.getElapsedTime();

      if (moveQueue.length) {
        if (!stepTo) {
          const next = moveQueue[0];
          stepFrom = { x: farmerGroup.position.x, z: farmerGroup.position.z };
          const w = toWorld(next.x, next.y);
          stepTo = w;
          stepStart = t;
        }
        const progress = Math.min(1, (t - stepStart) / STEP_DURATION);
        const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        farmerGroup.position.x = stepFrom.x + (stepTo.x - stepFrom.x) * ease;
        farmerGroup.position.z = stepFrom.z + (stepTo.z - stepFrom.z) * ease;
        farmerGroup.position.y = Math.sin(progress * Math.PI) * 0.05;
        const dx = stepTo.x - stepFrom.x;
        const dz = stepTo.z - stepFrom.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.001) {
          farmerGroup.rotation.y = Math.atan2(dx, dz);
        }
        if (progress >= 1) {
          farmerGrid = moveQueue.shift();
          stepTo = null;
          farmerGroup.position.y = 0;
        }
      }

      // water shimmer
      const waterTex = waterMat.map;
      if (waterTex) {
        waterTex.offset.x = Math.sin(t * 0.25) * 0.04;
        waterTex.offset.y = Math.cos(t * 0.2) * 0.04;
      }

      // background crowd: pace back and forth between two waypoints
      crowd.forEach((c) => {
        c.t += dt * c.speed * c.dir;
        if (c.t >= 1) {
          c.t = 1;
          c.dir = -1;
        } else if (c.t <= 0) {
          c.t = 0;
          c.dir = 1;
        }
        const a = c.waypoints[0];
        const b = c.waypoints[1];
        const ease = c.t < 0.5 ? 2 * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 2) / 2;
        const px = a.x + (b.x - a.x) * ease;
        const pz = a.z + (b.z - a.z) * ease;
        c.group.position.x = px;
        c.group.position.z = pz;
        c.group.position.y = Math.abs(Math.sin(t * 6 + c.t * 3)) * 0.03;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        c.group.rotation.y = Math.atan2(dx * c.dir, dz * c.dir);
      });

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

    return () => {
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("click", onClick);
      ro.disconnect();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      _aoTexture = null;
      _aoMat = null;
      _fenceMat = null;
    };
  }, []);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "radial-gradient(ellipse at center, #efe6d3 0%, #ddd0b2 60%, #cabd9a 100%)",
        fontFamily: "'Zen Maru Gothic', sans-serif",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Yuji+Syuku&family=Zen+Maru+Gothic:wght@400;700&display=swap');`}</style>
      <div style={{ fontFamily: "'Yuji Syuku', serif", fontSize: 26, color: "#3a2e22", letterSpacing: 2 }}>
        箱庭農民記 <span style={{ fontSize: 12, fontFamily: "'Zen Maru Gothic', sans-serif" }}>(Three.js試作)</span>
      </div>
      <div
        ref={mountRef}
        style={{
          width: "min(680px, 92vw)",
          height: "min(520px, 62vh)",
          borderRadius: 14,
          boxShadow: "0 18px 40px rgba(0,0,0,0.3)",
          overflow: "hidden",
          background: "linear-gradient(180deg,#bcd7e6,#e9dfc4)",
        }}
      />
      <div style={{ fontSize: 12, color: "#5b4a38" }}>歩けるマスをクリックすると農民が歩いていきます。</div>
    </div>
  );
}
