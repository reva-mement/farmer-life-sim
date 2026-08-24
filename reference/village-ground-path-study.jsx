import React, { useEffect, useRef } from "react";
import * as THREE from "three";

const GRID_SIZE = 11;

// ---------- value noise (fbm) ----------
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

// path runs north-south (back to front) through this X position
const PATH_CENTER_X = 0;
const PATH_HALF_WIDTH = 0.3;
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

// worldX/worldZ are in world units (1 unit = 1 tile), same space as the village grid
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

function buildTextures(texW, texH, worldW, worldD) {
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
  const segs = 88; // 8 per tile, matches the village's per-tile resolution
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
  const { colorTex, bumpTex, roughTex } = buildTextures(
    Math.round(worldW * texPerUnit),
    Math.round(worldD * texPerUnit),
    worldW,
    worldD
  );
  const mat = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale: 0.015,
    roughnessMap: roughTex,
    roughness: 1,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export default function VillageGroundPathStudy() {
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

    const hemi = new THREE.HemisphereLight(0xb9cbe0, 0x3a3226, 0.55);
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

    const ground = buildGround();
    scene.add(ground);

    function animate() {
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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@400;700&display=swap');`}</style>
      <div style={{ fontSize: 18, color: "#3a2e22", fontWeight: 700 }}>地形1枚化 + 奥から手前への道</div>
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
    </div>
  );
}
