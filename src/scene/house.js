import * as THREE from "three";

// Ported from reference/farmer-life-sim-3d.jsx's buildHouse (variant A) —
// a simple pyramid-roof thatched farmhouse, appropriate to a Sengoku-era
// (or really any pre-modern) Japanese farming village. Scaled up ~2.2x from
// the reference's numbers, which were sized more like a toy model than a
// building a 0.94-unit-tall farmer could actually live in.

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

const SCALE = 2.2;

export function buildFarmhouse() {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ map: plasterTexture("#ded2ab"), roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ map: thatchTexture("#c2a066"), roughness: 1, flatShading: true });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 1 });

  group.add(buildAODecal(0.5 * SCALE));

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

  group.scale.setScalar(SCALE);
  return group;
}
