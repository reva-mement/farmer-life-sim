import React, { useEffect, useRef } from "react";
import * as THREE from "three";

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

// same per-type configs used in the village
const SOIL = {
  clumpScale: 5.5, grainScale: 18, pebbleScale: 30,
  dispClump: 0.024, dispGrain: 0.005, dispPebble: 0.014,
  colorLow: [104, 79, 52], colorHigh: [151, 118, 79],
  speckAmt: 26, pebbleShadeAmt: 14, roughLow: 0.6, roughHigh: 0.95,
};
const PATH = {
  clumpScale: 7, grainScale: 22, pebbleScale: 36,
  dispClump: 0.01, dispGrain: 0.003, dispPebble: 0.007,
  colorLow: [180, 165, 125], colorHigh: [206, 191, 150],
  speckAmt: 14, pebbleShadeAmt: 8, roughLow: 0.7, roughHigh: 0.95,
};

// transition zone width, in "tile units" either side of the boundary (u=1)
const BLEND_HALF = 0.22;

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

function blendedSample(u, v) {
  const soil = sampleType(SOIL, u, v);
  const path = sampleType(PATH, u, v);
  const t = smoothstep(1 - BLEND_HALF, 1 + BLEND_HALF, u);
  return {
    r: soil.r + (path.r - soil.r) * t,
    g: soil.g + (path.g - soil.g) * t,
    b: soil.b + (path.b - soil.b) * t,
    height: soil.height + (path.height - soil.height) * t,
    bumpHeight: soil.bumpHeight + (path.bumpHeight - soil.bumpHeight) * t,
    rough: soil.rough + (path.rough - soil.rough) * t,
  };
}

function buildTextures(size = 1024) {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = size; colorCanvas.height = size / 2;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = size; bumpCanvas.height = size / 2;
  const bctx = bumpCanvas.getContext("2d");
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size; roughCanvas.height = size / 2;
  const rctx = roughCanvas.getContext("2d");

  const w = size, h = size / 2;
  const cimg = cctx.createImageData(w, h);
  const bimg = bctx.createImageData(w, h);
  const rimg = rctx.createImageData(w, h);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const u = (px / w) * 2; // 0..2 (two tile-units wide)
      const v = py / h; // 0..1
      const s = blendedSample(u, v);
      const idx = (py * w + px) * 4;
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

function buildTransitionMesh() {
  const worldW = 4; // 2 tiles wide, 2 world-units each (matches the single-tile studies' scale)
  const worldD = 2;
  const segsW = 160;
  const segsD = 80;
  const geo = new THREE.PlaneGeometry(worldW, worldD, segsW, segsD);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const u = x / worldW + 0.5; // 0..1 across width -> maps to 0..2 tile-units below
    const v = y / worldD + 0.5;
    const s = blendedSample(u * 2, v);
    pos.setZ(i, s.height);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);

  const { colorTex, bumpTex, roughTex } = buildTextures(1024);
  const mat = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale: 0.014,
    roughnessMap: roughTex,
    roughness: 1,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export default function SoilPathTransitionStudy() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    let radius = 4.4;
    let azimuth = 0.55;
    let polar = 1.0;
    function updateCamera() {
      camera.position.set(
        radius * Math.sin(polar) * Math.sin(azimuth),
        radius * Math.cos(polar),
        radius * Math.sin(polar) * Math.cos(azimuth)
      );
      camera.lookAt(0, 0, 0);
    }
    updateCamera();

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
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.4);
    sun.position.set(2.6, 3.4, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -2.5;
    sun.shadow.camera.right = 2.5;
    sun.shadow.camera.top = 1.6;
    sun.shadow.camera.bottom = -1.6;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 10;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.12);
    scene.add(fill);

    const ground = buildTransitionMesh();
    scene.add(ground);

    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: 0xddd0b2, roughness: 1 })
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -0.01;
    backdrop.receiveShadow = true;
    scene.add(backdrop);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    function onPointerDown(e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onPointerMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      azimuth -= dx * 0.006;
      polar = Math.max(0.25, Math.min(1.45, polar - dy * 0.006));
      updateCamera();
    }
    function onPointerUp() {
      dragging = false;
    }
    function onWheel(e) {
      e.preventDefault();
      radius = Math.max(2.2, Math.min(8, radius + e.deltaY * 0.002));
      updateCamera();
    }
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.style.cursor = "grab";
    dom.style.touchAction = "none";

    function animate() {
      renderer.render(scene, camera);
    }
    renderer.setAnimationLoop(animate);

    function handleResize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    const ro = new ResizeObserver(handleResize);
    ro.observe(mount);

    return () => {
      renderer.setAnimationLoop(null);
      dom.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Yuji+Syuku&family=Zen+Maru+Gothic:wght@400;700&display=swap');`}</style>
      <div style={{ fontFamily: "'Yuji Syuku', serif", fontSize: 22, color: "#3a2e22" }}>
        土 → 道 の境目 検証
      </div>
      <div
        ref={mountRef}
        style={{
          width: "min(640px, 92vw)",
          height: "min(460px, 56vh)",
          borderRadius: 14,
          boxShadow: "0 18px 40px rgba(0,0,0,0.3)",
          overflow: "hidden",
          background: "linear-gradient(180deg,#e8dcc0,#d8c9a3)",
        }}
      />
      <div style={{ fontSize: 12, color: "#5b4a38" }}>ドラッグで回転、ホイールでズームできます。左が土、右が道です。</div>
    </div>
  );
}
