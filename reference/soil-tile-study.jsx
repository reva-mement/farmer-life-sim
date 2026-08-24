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
// extra fine random bump layer (pebbly, no directionality)
const PEBBLE_SCALE = 30;
const CLUMP_SCALE = 5.5;
const GRAIN_SCALE = 18;

// ---------- procedural textures ----------
function buildTextures(size = 512) {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = roughCanvas.height = size;
  const rctx = roughCanvas.getContext("2d");

  const cimg = cctx.createImageData(size, size);
  const bimg = bctx.createImageData(size, size);
  const rimg = rctx.createImageData(size, size);

  // base soil color (dry, warm brown) vs moist (darker, cooler)
  const dry = [151, 118, 79];
  const moist = [104, 79, 52];

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size;
      const v = py / size;

      const clump = fbm(u * CLUMP_SCALE, v * CLUMP_SCALE, 4); // 0..1 large patches
      const grain = fbm(u * GRAIN_SCALE + 40, v * GRAIN_SCALE + 40, 2); // fine grain
      const pebble = fbm(u * PEBBLE_SCALE + 80, v * PEBBLE_SCALE + 80, 2); // fine random bumps, no direction

      const moisture = clump; // 0 dry .. 1 moist
      let r = dry[0] + (moist[0] - dry[0]) * moisture;
      let g = dry[1] + (moist[1] - dry[1]) * moisture;
      let b = dry[2] + (moist[2] - dry[2]) * moisture;

      // fine grain speckle
      const speck = (grain - 0.5) * 26;
      r += speck;
      g += speck * 0.85;
      b += speck * 0.7;

      // subtle random shading from the pebble layer (no directionality)
      const pebbleShade = (pebble - 0.5) * 14;
      r += pebbleShade;
      g += pebbleShade * 0.9;
      b += pebbleShade * 0.8;

      const idx = (py * size + px) * 4;
      cimg.data[idx] = Math.max(0, Math.min(255, r));
      cimg.data[idx + 1] = Math.max(0, Math.min(255, g));
      cimg.data[idx + 2] = Math.max(0, Math.min(255, b));
      cimg.data[idx + 3] = 255;

      // bump height: combine clump + grain + pebble, all random, no directionality
      const height = clump * 0.5 + grain * 0.25 + pebble * 0.4;
      const hByte = Math.max(0, Math.min(255, height * 255));
      bimg.data[idx] = hByte;
      bimg.data[idx + 1] = hByte;
      bimg.data[idx + 2] = hByte;
      bimg.data[idx + 3] = 255;

      // roughness: moist patches are slightly glossier (lower roughness)
      const roughVal = 0.95 - moisture * 0.35 - (grain - 0.5) * 0.08;
      const rByte = Math.max(0, Math.min(255, roughVal * 255));
      rimg.data[idx] = rByte;
      rimg.data[idx + 1] = rByte;
      rimg.data[idx + 2] = rByte;
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

function buildSoilMesh() {
  const size = 2;
  const segs = 96;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i); // plane's local Y becomes world Z after rotation
    const u = x / size + 0.5;
    const v = y / size + 0.5;
    const clump = fbm(u * CLUMP_SCALE, v * CLUMP_SCALE, 4);
    const grain = fbm(u * GRAIN_SCALE + 40, v * GRAIN_SCALE + 40, 2);
    const pebble = fbm(u * PEBBLE_SCALE + 80, v * PEBBLE_SCALE + 80, 2);
    const height = clump * 0.024 + grain * 0.005 + pebble * 0.014;
    pos.setZ(i, height);
  }
  geo.computeVertexNormals();

  const { colorTex, bumpTex, roughTex } = buildTextures(512);
  const mat = new THREE.MeshStandardMaterial({
    map: colorTex,
    bumpMap: bumpTex,
    bumpScale: 0.016,
    roughnessMap: roughTex,
    roughness: 1,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export default function SoilTileStudy() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    let radius = 3.1;
    let azimuth = 0.7;
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
    sun.position.set(2.2, 3, 1.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -1.5;
    sun.shadow.camera.right = 1.5;
    sun.shadow.camera.top = 1.5;
    sun.shadow.camera.bottom = -1.5;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 8;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.12);
    scene.add(fill);

    const soil = buildSoilMesh();
    scene.add(soil);

    // catch shadow / ground behind, faint
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshStandardMaterial({ color: 0xddd0b2, roughness: 1 })
    );
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -0.01;
    backdrop.receiveShadow = true;
    scene.add(backdrop);

    // simple drag-to-orbit + wheel-to-zoom (no OrbitControls available)
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
      radius = Math.max(1.6, Math.min(5, radius + e.deltaY * 0.0015));
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
        土タイル 一枚検証
      </div>
      <div
        ref={mountRef}
        style={{
          width: "min(560px, 90vw)",
          height: "min(480px, 58vh)",
          borderRadius: 14,
          boxShadow: "0 18px 40px rgba(0,0,0,0.3)",
          overflow: "hidden",
          background: "linear-gradient(180deg,#e8dcc0,#d8c9a3)",
        }}
      />
      <div style={{ fontSize: 12, color: "#5b4a38" }}>ドラッグで回転、ホイールでズームできます。</div>
    </div>
  );
}
