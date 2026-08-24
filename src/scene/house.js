import * as THREE from "three";

// A Sengoku-era (~1467-1615) farmer's dwelling (民家/minka), reworked from the
// earlier toy-scale pyramid-roof placeholder. Reference features for a common
// rural minka of the period, all load-bearing to the geometry below:
//  - kirizuma-zukuri (切妻造): a steep two-slope gable roof, thickly thatched
//    (kayabuki), with open triangular gable ends that vent hearth smoke
//    (there was no chimney - smoke from the sunken irori hearth escaped
//    through the thatch/gable, staining the gable infill dark over time).
//  - shinkabe (真壁): exposed post-and-beam timber frame, with mud-plastered
//    wattle-and-daub infill panels recessed behind the posts rather than
//    a smooth continuous box.
//  - a low stone plinth (kiso-ishi) the posts sit on, raising the timber
//    off damp ground.
//  - a dark, weathered mud "splash guard" band at the base of the plaster,
//    lighter worn plaster above.
//  - a plank sliding door (itado) rather than a hinged panel door, and a
//    small lattice (renji) window opening.
//  - a ridge cap (munaosae) of pressed logs/bundled straw along the peak.

function makeTexture(draw, size = 128, repeatX = 1, repeatY = repeatX) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.encoding = THREE.sRGBEncoding;
  return tex;
}

// Bundled kayabuki thatch: overlapping horizontal courses, each with a
// shadowed underside and straw-tip speckle, rather than plain diagonal hatch.
function thatchTexture() {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = "#b99450";
    ctx.fillRect(0, 0, s, s);
    const courseH = s / 10;
    for (let i = 0; i < 10; i++) {
      const y = i * courseH;
      const grad = ctx.createLinearGradient(0, y, 0, y + courseH);
      grad.addColorStop(0, "rgba(60,40,15,0.4)");
      grad.addColorStop(0.35, "rgba(255,240,200,0.08)");
      grad.addColorStop(1, "rgba(60,40,15,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, y, s, courseH);
      ctx.strokeStyle = "rgba(70,48,18,0.5)";
      ctx.lineWidth = 1;
      for (let x = 0; x < s; x += 5) {
        const jitter = Math.sin(x * 0.7 + i) * 2;
        ctx.beginPath();
        ctx.moveTo(x, y + courseH * 0.15 + jitter);
        ctx.lineTo(x + 2, y + courseH + jitter);
        ctx.stroke();
      }
    }
  }, 96, 1, 2);
}

// Mud-plaster wall with a dark weathered splash-guard band at the base.
function wallTexture() {
  return makeTexture((ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0, "#d9caa0");
    grad.addColorStop(0.55, "#cabb8f");
    grad.addColorStop(0.62, "#7d6a4a");
    grad.addColorStop(1, "#4f4230");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      ctx.fillStyle = y < s * 0.6 ? "rgba(60,45,20,0.08)" : "rgba(20,15,8,0.12)";
      ctx.fillRect(x, y, 2, 2);
    }
    // occasional exposed bamboo lath crack line
    ctx.strokeStyle = "rgba(40,30,15,0.15)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const x = (i + 0.5) * (s / 4) + (Math.random() - 0.5) * 8;
      ctx.beginPath();
      ctx.moveTo(x, s * 0.1);
      ctx.lineTo(x + (Math.random() - 0.5) * 10, s * 0.55);
      ctx.stroke();
    }
  }, 96, 2, 1);
}

// Smoke-darkened plaster infill for the gable ends (no chimney - hearth
// smoke vents here, staining the upper plaster).
function gableTexture() {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = "#cabb8f";
    ctx.fillRect(0, 0, s, s);
    const soot = ctx.createRadialGradient(s / 2, s * 0.15, 0, s / 2, s * 0.15, s * 0.7);
    soot.addColorStop(0, "rgba(30,24,16,0.55)");
    soot.addColorStop(0.5, "rgba(30,24,16,0.22)");
    soot.addColorStop(1, "rgba(30,24,16,0)");
    ctx.fillStyle = soot;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(50,38,20,0.4)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const y = s * 0.2 + i * s * 0.12;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y);
      ctx.stroke();
    }
  }, 96, 1, 1);
}

function timberTexture() {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = "#2c2015";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    for (let i = 0; i < 6; i++) {
      const x = (i / 6) * s;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, s);
      ctx.stroke();
    }
  }, 16, 1, 1);
}

function stoneTexture() {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = "#8c887e";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 8;
      ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 60 : 200},${Math.random() > 0.5 ? 60 : 200},${Math.random() > 0.5 ? 60 : 200},0.12)`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 64, 2, 2);
}

function latticeTexture() {
  return makeTexture((ctx, s) => {
    ctx.fillStyle = "#100c08";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "#4a3620";
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * s;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s); ctx.stroke();
    }
    const y = s / 2;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s, y); ctx.stroke();
  }, 32, 1, 1);
}

function buildAODecal(radiusX, radiusZ) {
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
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 24), mat);
  mesh.scale.set(radiusX, radiusZ, 1);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

// footprint, in world units (1 unit ~= 1.6-1.7m, per the design doc's scale
// derived from the farmer's ~0.94-unit height).
const W = 1.7; // gable-facing width
const D = 2.6; // ridge-parallel depth
const WALL_H = 1.0;
const PLINTH_H = 0.06;
const POST = 0.09;
const OVERHANG = 0.2;
const RIDGE_RISE = 1.05;
const RIDGE_CAP_H = 0.05;

function buildRoof(thatchMat, gableMat) {
  const halfSpan = W / 2 + OVERHANG;
  const roofDepth = D + OVERHANG * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfSpan, 0);
  shape.lineTo(halfSpan, 0);
  shape.lineTo(0, RIDGE_RISE);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: roofDepth, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -roofDepth / 2);
  geo.computeVertexNormals();
  // group materialIndex 0 = the two gable-end triangular caps; index 1 = the
  // extruded sides (the two roof slopes + the underside soffit) - verified
  // empirically, not assumed, since ExtrudeGeometry's group order is not the
  // "sides first" order one might guess from the constructor argument order.
  const mesh = new THREE.Mesh(geo, [gableMat, thatchMat]);
  mesh.castShadow = true;
  mesh.position.y = PLINTH_H + WALL_H;
  return mesh;
}

export function buildFarmhouse() {
  const group = new THREE.Group();

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 });
  const gableMat = new THREE.MeshStandardMaterial({ map: gableTexture(), roughness: 0.95 });
  const thatchMat = new THREE.MeshStandardMaterial({ map: thatchTexture(), roughness: 1, flatShading: true });
  const timberMat = new THREE.MeshStandardMaterial({ map: timberTexture(), roughness: 0.85 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2e2013, roughness: 0.8 });
  const latticeMat = new THREE.MeshStandardMaterial({ map: latticeTexture(), roughness: 0.9 });

  group.add(buildAODecal(W / 2 + OVERHANG + 0.15, D / 2 + OVERHANG + 0.15));

  // stone plinth (kiso-ishi)
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, PLINTH_H, D + 0.1), stoneMat);
  plinth.position.y = PLINTH_H / 2;
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  group.add(plinth);

  // wattle-and-daub wall panel, recessed behind the exposed posts
  const wallInset = POST;
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(W - wallInset * 2, WALL_H, D - wallInset * 2),
    wallMat
  );
  wall.position.y = PLINTH_H + WALL_H / 2;
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  // exposed corner + mid posts (shinkabe frame)
  const postXs = [-(W / 2 - POST / 2), W / 2 - POST / 2];
  const postZs = [-(D / 2 - POST / 2), 0, D / 2 - POST / 2];
  for (const px of postXs) {
    for (const pz of postZs) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(POST, WALL_H, POST), timberMat);
      post.position.set(px, PLINTH_H + WALL_H / 2, pz);
      post.castShadow = true;
      group.add(post);
    }
  }
  // short-side mid posts too, so the gable walls read as framed as well
  for (const pz of [-(D / 2 - POST / 2), D / 2 - POST / 2]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(POST, WALL_H, POST), timberMat);
    post.position.set(0, PLINTH_H + WALL_H / 2, pz);
    post.castShadow = true;
    group.add(post);
  }

  // eave plate (horizontal beam the rafters bear on, just under the roof)
  const eavePlate = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.05, D - 0.02), timberMat);
  eavePlate.position.y = PLINTH_H + WALL_H + 0.025;
  eavePlate.castShadow = true;
  group.add(eavePlate);

  // roof
  group.add(buildRoof(thatchMat, gableMat));

  // ridge cap (munaosae) - pressed logs along the peak
  const ridgeCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, RIDGE_CAP_H, D + OVERHANG * 2 + 0.05),
    timberMat
  );
  ridgeCap.position.set(0, PLINTH_H + WALL_H + RIDGE_RISE + RIDGE_CAP_H / 2, 0);
  ridgeCap.castShadow = true;
  group.add(ridgeCap);

  // plank sliding door (itado), on the +Z face
  const doorW = 0.34, doorH = 0.62;
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.03), doorMat);
  door.position.set(-0.18, PLINTH_H + doorH / 2, D / 2 - wallInset + 0.015);
  group.add(door);
  // plank seams
  for (let i = 1; i < 3; i++) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.006, doorH, 0.032), timberMat);
    seam.position.set(door.position.x - doorW / 2 + (doorW / 3) * i, door.position.y, door.position.z);
    group.add(seam);
  }

  // lattice window (renji-mado) beside the door
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.02), latticeMat);
  win.position.set(0.32, PLINTH_H + WALL_H * 0.62, D / 2 - wallInset + 0.011);
  group.add(win);

  // a doorstep stone
  const step = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.08, 0.035, 0.14), stoneMat);
  step.position.set(door.position.x, PLINTH_H + 0.0175, D / 2 + 0.09);
  group.add(step);

  return group;
}
