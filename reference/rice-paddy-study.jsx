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

// ---------- soil system, ported from the village build ----------
const SOIL = {
  clumpScale: 5.5, grainScale: 18, pebbleScale: 30,
  dispClump: 0.024, dispGrain: 0.005, dispPebble: 0.014,
  colorLow: [134, 109, 82], colorHigh: [181, 148, 109],
  speckAmt: 26, pebbleShadeAmt: 14, roughLow: 0.6, roughHigh: 0.95,
};
const MUCK = {
  clumpScale: 5, grainScale: 16, pebbleScale: 26,
  dispClump: 0.014, dispGrain: 0.004, dispPebble: 0.008,
  colorLow: [46, 40, 32], colorHigh: [77, 63, 46],
  speckAmt: 12, pebbleShadeAmt: 10, roughLow: 0.55, roughHigh: 0.85,
};

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

function buildSoilTextures(cfg, w, d, x, z) {
  const texW = Math.max(64, Math.round(w * 130));
  const texH = Math.max(64, Math.round(d * 130));
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
    const wz = z + (py / texH) * d - d / 2;
    for (let px = 0; px < texW; px++) {
      const wx = x + (px / texW) * w - w / 2;
      const s = sampleType(cfg, wx, wz);
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

function buildSoilMaterial(cfg, w, d, x, z) {
  const { colorTex, bumpTex, roughTex } = buildSoilTextures(cfg, w, d, x, z);
  return new THREE.MeshStandardMaterial({
    map: colorTex, bumpMap: bumpTex, bumpScale: 0.015,
    roughnessMap: roughTex, roughness: 1, metalness: 0.02,
  });
}

// Builds a real vertex-displaced ground mesh + matching color/bump/rough
// maps for one soil type, sized/positioned in world space.
function buildSoilMesh(cfg, w, d, x, z, segs = 24) {
  const geo = new THREE.PlaneGeometry(w, d, segs, Math.max(2, Math.round((segs * d) / w)));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const s = sampleType(cfg, x + pos.getX(i), z + pos.getY(i));
    pos.setZ(i, s.height);
  }
  geo.computeVertexNormals();
  geo.rotateX(-Math.PI / 2);
  const mat = buildSoilMaterial(cfg, w, d, x, z);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, 0, z);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// ---------- procedural textures ----------
function paintTexture(draw, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// flat, unlit muck for the paddy floor itself — reverted per feedback, kept
// separate from the village-style soil now used for the surrounding ground
function muckTexture() {
  return paintTexture((ctx, s) => {
    for (let py = 0; py < s; py++) {
      for (let px = 0; px < s; px++) {
        const u = px / s, v = py / s;
        const clump = fbm(u * 5, v * 5, 4);
        const dry = [77, 63, 46], wet = [46, 40, 32];
        let r = dry[0] + (wet[0] - dry[0]) * clump;
        let g = dry[1] + (wet[1] - dry[1]) * clump;
        let b = dry[2] + (wet[2] - dry[2]) * clump;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }, 128);
}

function paddyWaterTextures() {
  const size = 256;
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = size;
  const cctx = colorCanvas.getContext("2d");
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext("2d");
  const cimg = cctx.createImageData(size, size);
  const bimg = bctx.createImageData(size, size);

  const deep = [24, 58, 84];
  const lit = [66, 126, 166];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size, v = py / size;
      const swell = fbm(u * 3.2, v * 3.2, 3); // large slow swell
      const ripple = fbm(u * 16 + 50, v * 16 + 50, 3); // fine ripple
      const t = swell * 0.7 + ripple * 0.3;
      let r = deep[0] + (lit[0] - deep[0]) * t;
      let g = deep[1] + (lit[1] - deep[1]) * t;
      let b = deep[2] + (lit[2] - deep[2]) * t;
      const idx = (py * size + px) * 4;
      cimg.data[idx] = r; cimg.data[idx + 1] = g; cimg.data[idx + 2] = b; cimg.data[idx + 3] = 255;
      const height = swell * 0.5 + ripple * 0.5;
      const hByte = Math.max(0, Math.min(255, height * 255));
      bimg.data[idx] = bimg.data[idx + 1] = bimg.data[idx + 2] = hByte;
      bimg.data[idx + 3] = 255;
    }
  }
  cctx.putImageData(cimg, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  const colorTex = new THREE.CanvasTexture(colorCanvas);
  colorTex.encoding = THREE.sRGBEncoding;
  colorTex.wrapS = colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.repeat.set(1, 1); // was 2x2 — the noise doesn't tile seamlessly,
  // which is exactly what created the crossing white seam at the midpoint
  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.repeat.set(1, 1);
  return { colorTex, bumpTex };
}

// ---------- rice ----------
function buildRiceBladeGeometry() {
  const geo = new THREE.PlaneGeometry(0.01, 0.15, 1, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + 0.075) / 0.15; // 0 base, 1 tip
    pos.setZ(i, Math.pow(t, 1.8) * 0.035); // gentle outward droop toward the tip
    pos.setX(i, pos.getX(i) * Math.pow(1 - t, 0.85)); // taper to a true point at the tip
  }
  geo.translate(0, 0.075, 0); // base sits at local y=0
  geo.computeVertexNormals();
  return geo;
}

function buildRiceHill(bladeGeo) {
  const group = new THREE.Group();
  const greenBase = new THREE.Color(0x1f7a1a); // much deeper, more saturated green
  const c = greenBase;
  const mat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
  const bladeCount = 9;
  for (let i = 0; i < bladeCount; i++) {
    const blade = new THREE.Mesh(bladeGeo, mat);
    blade.rotation.y = (i / bladeCount) * Math.PI * 2 + Math.random() * 0.6;
    blade.rotation.z = (Math.random() - 0.5) * 0.12;
    blade.position.set((Math.random() - 0.5) * 0.012, 0, (Math.random() - 0.5) * 0.012);
    const h = 0.8 + Math.random() * 0.35;
    blade.scale.set(0.85 + Math.random() * 0.3, h, 1);
    blade.castShadow = false;
    group.add(blade);
  }
  return group;
}

function buildPaddy() {
  const root = new THREE.Group();

  // sunken paddy basin — real-world proportions: levee ~30cm above the
  // paddy floor, water kept ~5cm deep. Our scale is set by the rice plants
  // (≈50cm tall ≈ 0.15 units), so 30cm ≈ 0.09 units and 5cm ≈ 0.015 units.
  const paddyW = 2.2, paddyD = 1.7;
  const bankTop = 0, floorY = -0.09;
  const waterY = -0.075; // 5cm of water sitting above the mud floor
  const bankOuter = 0.14;
  const hw = paddyW / 2, hd = paddyD / 2;
  const outerHW = hw + bankOuter, outerHD = hd + bankOuter;

  // ground, as four plain non-overlapping rectangles framing the paddy —
  // deliberately NOT a single shape-with-a-hole: that approach left a thin
  // bridging seam between the outer and inner contours, which is what
  // showed up as the crossing white lines. Now using the same real-bump
  // soil system as the village build.
  const outerW = 3.2, outerD = 2.6;
  const northD = outerD / 2 - outerHD, northZ = -(outerHD + northD / 2);
  const southD = northD, southZ = outerHD + southD / 2;
  const ewW = outerW / 2 - outerHW, eastX = outerHW + ewW / 2, westX = -eastX;
  root.add(buildSoilMesh(SOIL, outerW, northD, 0, northZ));
  root.add(buildSoilMesh(SOIL, outerW, southD, 0, southZ));
  root.add(buildSoilMesh(SOIL, ewW, outerHD * 2, eastX, 0));
  root.add(buildSoilMesh(SOIL, ewW, outerHD * 2, westX, 0));

  const muckMat = new THREE.MeshBasicMaterial({ map: muckTexture() });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(paddyW, paddyD), muckMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  root.add(floor);

  // levee banks — plain BoxGeometry walls (vertical, not sloped). This
  // replaces a hand-built sloped quad (raw triangles) that was the one
  // piece of non-standard geometry in the scene; ruling it out first.
  const wallH = bankTop - floorY;

  function buildWall(w, d, x, z) {
    const mat = buildSoilMaterial(MUCK, w, d, x, z);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), mat);
    wall.position.set(x, floorY + wallH / 2, z);
    wall.receiveShadow = true;
    wall.castShadow = true;
    return wall;
  }
  const banks = new THREE.Group();
  // north / south walls (thin in Z, span the full outer width in X)
  banks.add(buildWall(outerHW * 2 + 0.02, bankOuter, 0, -hd - bankOuter / 2));
  banks.add(buildWall(outerHW * 2 + 0.02, bankOuter, 0, hd + bankOuter / 2));
  // east / west walls (thin in X, span just the paddy depth in Z)
  banks.add(buildWall(bankOuter, hd * 2, hw + bankOuter / 2, 0));
  banks.add(buildWall(bankOuter, hd * 2, -hw - bankOuter / 2, 0));

  root.add(banks);

  // water — filled generously, close to the bank top
  const { colorTex: waterColorTex, bumpTex: waterBumpTex } = paddyWaterTextures();
  const waterMat = new THREE.MeshStandardMaterial({
    map: waterColorTex, bumpMap: waterBumpTex, bumpScale: 0.006,
    roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.95,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(paddyW - 0.02, paddyD - 0.02), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterY;
  root.add(water);

  // rice, planted in a grid, poking up through the water
  const bladeGeo = buildRiceBladeGeometry();
  const cols = 15, rows = 11;
  const marginX = 0.14, marginZ = 0.12;
  const usableW = paddyW - marginX * 2;
  const usableD = paddyD - marginZ * 2;
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = -paddyW / 2 + marginX + (usableW * ix) / (cols - 1) + (Math.random() - 0.5) * 0.02;
      const z = -paddyD / 2 + marginZ + (usableD * iz) / (rows - 1) + (Math.random() - 0.5) * 0.02;
      const hill = buildRiceHill(bladeGeo);
      hill.position.set(x, floorY + 0.008, z);
      root.add(hill);
    }
  }

  return { root, water };
}

export default function RicePaddyStudy() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    let radius = 3.6;
    let azimuth = 0.7;
    let polar = 1.05;
    function updateCamera() {
      camera.position.set(
        radius * Math.sin(polar) * Math.sin(azimuth),
        0.5 + radius * Math.cos(polar) * 0.6,
        radius * Math.sin(polar) * Math.cos(azimuth)
      );
      camera.lookAt(0, -0.05, 0);
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
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.2);
    sun.position.set(2.6, 3.6, 1.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -2;
    sun.shadow.camera.right = 2;
    sun.shadow.camera.top = 1.6;
    sun.shadow.camera.bottom = -1.6;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 10;
    sun.shadow.bias = -0.002;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.15);
    scene.add(fill);

    const { root: paddy, water } = buildPaddy();
    scene.add(paddy);

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
      polar = Math.max(0.35, Math.min(1.5, polar - dy * 0.006));
      updateCamera();
    }
    function onPointerUp() {
      dragging = false;
    }
    function onWheel(e) {
      e.preventDefault();
      radius = Math.max(1.4, Math.min(6, radius + e.deltaY * 0.002));
      updateCamera();
    }
    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.style.cursor = "grab";
    dom.style.touchAction = "none";

    const clock = new THREE.Clock();
    function animate() {
      const t = clock.getElapsedTime();
      const ox = Math.sin(t * 0.2) * 0.05;
      const oy = Math.cos(t * 0.16) * 0.05;
      if (water.material.map) {
        water.material.map.offset.set(ox, oy);
      }
      if (water.material.bumpMap) {
        water.material.bumpMap.offset.set(ox * 1.3, oy * 1.3);
      }
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
        田んぼ(8月上旬) 検証
      </div>
      <div
        ref={mountRef}
        style={{
          width: "min(640px, 92vw)",
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
