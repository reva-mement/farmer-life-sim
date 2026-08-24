import React, { useEffect, useRef } from "react";
import * as THREE from "three";

function buildAODecal(radius) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(20,14,8,0.5)");
  grad.addColorStop(0.7, "rgba(20,14,8,0.2)");
  grad.addColorStop(1, "rgba(20,14,8,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

// Builds a tapered cylinder ("clothed bone") connecting two joint points.
// Correctly orients itself to point from `a` to `b`, regardless of direction —
// this is what a hand-placed rotation.z guess got wrong earlier (upside-down sleeve).
function boneMesh(a, b, radiusA, radiusB, material, segments = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const geo = new THREE.CylinderGeometry(radiusB, radiusA, length, segments);
  geo.translate(0, length / 2, 0); // shift so local origin sits at the 'a' end
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a);
  const up = new THREE.Vector3(0, 1, 0);
  mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
  mesh.castShadow = true;
  return mesh;
}

// A simple woven-fabric texture: base color plus a faint crosshatch, so cloth
// doesn't read as a single flat, plasticky color.
function fabricTexture(baseHex, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(baseHex);
  ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size; i += 3) {
    ctx.globalAlpha = i % 6 === 0 ? 0.1 : 0.06;
    ctx.strokeStyle = i % 6 === 0 ? "#000000" : "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// A coarser diagonal weave for straw (hat)
function strawTexture(baseHex, size = 64) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = new THREE.Color(baseHex);
  ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "rgba(90,65,30,0.35)";
  ctx.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 7) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + size, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

function buildFarmer() {
  const group = new THREE.Group();

  const skin = 0xe3bd93;
  const tunic = 0x2e4a63; // indigo (aizome) — the historically typical farmer's dye color
  const trousers = 0x4a3c2b; // dark brown
  const sash = 0xb5453a; // accent
  const hatColor = 0xd8c37c;
  const shoe = 0xc2a670; // straw-sandal (waraji) tone, not dark geta-block color
  const hair = 0x241d16;

  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const tunicMat = new THREE.MeshStandardMaterial({ map: fabricTexture(tunic), roughness: 0.85 });
  const trouserMat = new THREE.MeshStandardMaterial({ map: fabricTexture(trousers), roughness: 0.9 });
  const sashMat = new THREE.MeshStandardMaterial({ color: sash, roughness: 0.7 });
  const hatMat = new THREE.MeshStandardMaterial({ map: strawTexture(hatColor), roughness: 0.95 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: shoe, roughness: 0.9 });
  const hairMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.5 });

  group.add(buildAODecal(0.36));

  // ---- skeleton (joint positions, resting pose) ----
  const J = {
    hipL: new THREE.Vector3(-0.07, 0.29, 0),
    hipR: new THREE.Vector3(0.07, 0.29, 0),
    kneeL: new THREE.Vector3(-0.07, 0.16, 0.018),
    kneeR: new THREE.Vector3(0.07, 0.16, 0.018),
    ankleL: new THREE.Vector3(-0.07, 0.02, 0),
    ankleR: new THREE.Vector3(0.07, 0.02, 0),
    shoulderL: new THREE.Vector3(-0.095, 0.6, 0),
    shoulderR: new THREE.Vector3(0.095, 0.6, 0),
    elbowL: new THREE.Vector3(-0.175, 0.475, 0.035),
    elbowR: new THREE.Vector3(0.175, 0.475, 0.035),
    wristL: new THREE.Vector3(-0.185, 0.34, 0.05),
    wristR: new THREE.Vector3(0.185, 0.34, 0.05),
  };

  // legs: thigh (hip->knee) + shin (knee->ankle), with a small joint sphere at the knee
  const thighL = boneMesh(J.hipL, J.kneeL, 0.025, 0.021, trouserMat, 10);
  const thighR = boneMesh(J.hipR, J.kneeR, 0.025, 0.021, trouserMat, 10);
  const shinL = boneMesh(J.kneeL, J.ankleL, 0.021, 0.016, trouserMat, 10);
  const shinR = boneMesh(J.kneeR, J.ankleR, 0.021, 0.016, trouserMat, 10);
  const kneeCapGeo = new THREE.SphereGeometry(0.021, 10, 8);
  const kneeCapL = new THREE.Mesh(kneeCapGeo, trouserMat);
  kneeCapL.position.copy(J.kneeL);
  const kneeCapR = new THREE.Mesh(kneeCapGeo, trouserMat);
  kneeCapR.position.copy(J.kneeR);
  group.add(thighL, thighR, shinL, shinR, kneeCapL, kneeCapR);

  // kyahan: wrapped cloth leg guards over the shins, common farm/travel wear
  const kyahanMat = new THREE.MeshStandardMaterial({ map: fabricTexture(0x6b5a3f), roughness: 0.95 });
  function buildKyahan(knee, ankle) {
    const wraps = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const t = 0.22 + i * 0.26;
      const p = knee.clone().lerp(ankle, t);
      const r = 0.021 - (0.021 - 0.016) * t;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.003, 0.006, 6, 12), kyahanMat);
      ring.position.copy(p);
      ring.rotation.x = Math.PI / 2;
      ring.castShadow = true;
      wraps.add(ring);
    }
    return wraps;
  }
  group.add(buildKyahan(J.kneeL, J.ankleL), buildKyahan(J.kneeR, J.ankleR));

  // waraji: flat woven straw sandals — an oval sole sitting almost on the ground,
  // plus a thin strap across the arch, instead of a tall geta-style block
  function buildWaraji(mat, strapMat) {
    const foot = new THREE.Group();
    const sole = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.01, 8), mat);
    sole.scale.z = 1.9;
    sole.position.y = 0.005;
    sole.castShadow = true;
    foot.add(sole);
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.058, 6), strapMat);
    strap.rotation.z = Math.PI / 2;
    strap.rotation.y = 0.3;
    strap.position.set(0, 0.014, -0.006);
    foot.add(strap);
    return foot;
  }
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x6e4a2d, roughness: 1 });
  const shoeL = buildWaraji(shoeMat, strapMat);
  shoeL.position.set(J.ankleL.x, 0, J.ankleL.z + 0.018);
  const shoeR = buildWaraji(shoeMat, strapMat);
  shoeR.position.set(J.ankleR.x, 0, J.ankleR.z + 0.018);
  group.add(shoeL, shoeR);

  // torso: lathe-revolved profile for a natural kimono silhouette
  // (radius, height) from hem to neck
  const torsoCurve = [
    [0.0, 0.28],
    [0.0775, 0.3],
    [0.07, 0.36],
    [0.061, 0.44],
    [0.059, 0.52],
    [0.064, 0.58],
    [0.05, 0.64],
    [0.025, 0.665],
    [0.0, 0.67],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoCurve, 16), tunicMat);
  torso.castShadow = true;
  group.add(torso);

  // sash / belt
  const sashMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.063, 0.066, 0.055, 16), sashMat);
  sashMesh.position.y = 0.47;
  group.add(sashMesh);

  // arms: upper arm (shoulder->elbow) + forearm (elbow->wrist), with a small elbow joint
  const upperArmL = boneMesh(J.shoulderL, J.elbowL, 0.0375, 0.024, tunicMat, 10);
  const upperArmR = boneMesh(J.shoulderR, J.elbowR, 0.0375, 0.024, tunicMat, 10);
  const forearmL = boneMesh(J.elbowL, J.wristL, 0.024, 0.016, tunicMat, 10);
  const forearmR = boneMesh(J.elbowR, J.wristR, 0.024, 0.016, tunicMat, 10);
  const elbowCapGeo = new THREE.SphereGeometry(0.024, 10, 8);
  const elbowCapL = new THREE.Mesh(elbowCapGeo, tunicMat);
  elbowCapL.position.copy(J.elbowL);
  const elbowCapR = new THREE.Mesh(elbowCapGeo, tunicMat);
  elbowCapR.position.copy(J.elbowR);
  // shoulder caps: bridge the gap between the torso's narrow top and the arm's start point
  // shoulder: an ellipsoid stretched toward the elbow (not a round ball-joint bump),
  // so the arm reads as flowing out of the body rather than plugged into it
  function buildShoulder(shoulder, elbow, material) {
    const dir = new THREE.Vector3().subVectors(elbow, shoulder).normalize();
    const geo = new THREE.SphereGeometry(0.052, 14, 12);
    geo.scale(1, 1.6, 1); // elongate along local Y before orienting toward the arm
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(shoulder);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.castShadow = true;
    return mesh;
  }
  const shoulderCapL = buildShoulder(J.shoulderL, J.elbowL, tunicMat);
  const shoulderCapR = buildShoulder(J.shoulderR, J.elbowR, tunicMat);
  group.add(upperArmL, upperArmR, forearmL, forearmR, elbowCapL, elbowCapR, shoulderCapL, shoulderCapR);

  // hands, at the wrist joints
  const handGeo = new THREE.SphereGeometry(0.015, 10, 8);
  const handL = new THREE.Mesh(handGeo, skinMat);
  handL.position.copy(J.wristL);
  const handR = new THREE.Mesh(handGeo, skinMat);
  handR.position.copy(J.wristR);
  group.add(handL, handR);

  // neck + head (slightly smaller relative to body for adult proportions)
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.02, 0.035, 10), skinMat);
  neck.position.y = 0.685;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.092, 16, 12), skinMat);
  head.scale.set(0.46, 1, 0.48);
  head.position.y = 0.78;
  head.castShadow = true;
  group.add(head);

  // hair cap + small topknot (chonmage-ish)
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.096, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
  hairCap.scale.set(0.46, 1, 0.48);
  hairCap.position.y = 0.795;
  hairCap.castShadow = true;
  group.add(hairCap);
  const knot = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.09, 8), hairMat);
  knot.position.set(0, 0.83, -0.08);
  knot.rotation.x = 0.5;
  group.add(knot);

  // sugegasa (wide conical straw hat)
  const brim = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.065, 20), hatMat);
  brim.position.y = 0.855;
  brim.castShadow = true;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.09, 14), hatMat);
  crown.position.y = 0.89;
  crown.castShadow = true;
  group.add(brim, crown);

  return group;
}

export default function FarmerCharacterStudy() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    let radius = 2.1;
    let azimuth = 0.6;
    let polar = 1.15;
    function updateCamera() {
      const target = 0.46;
      camera.position.set(
        radius * Math.sin(polar) * Math.sin(azimuth),
        target + radius * Math.cos(polar) * 0.6,
        radius * Math.sin(polar) * Math.cos(azimuth)
      );
      camera.lookAt(0, target, 0);
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
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.3);
    sun.position.set(1.6, 2.6, 1.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -1;
    sun.shadow.camera.right = 1;
    sun.shadow.camera.top = 1.2;
    sun.shadow.camera.bottom = -0.5;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 6;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    const fill = new THREE.AmbientLight(0x7d8caa, 0.15);
    scene.add(fill);

    const farmer = buildFarmer();
    scene.add(farmer);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0xb99a72, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

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
      polar = Math.max(0.5, Math.min(1.5, polar - dy * 0.006));
      updateCamera();
    }
    function onPointerUp() {
      dragging = false;
    }
    function onWheel(e) {
      e.preventDefault();
      radius = Math.max(1.0, Math.min(3.5, radius + e.deltaY * 0.0015));
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
        農民キャラクター 検証
      </div>
      <div
        ref={mountRef}
        style={{
          width: "min(520px, 90vw)",
          height: "min(520px, 60vh)",
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
