import { useEffect, useRef } from "react";
import * as THREE from "three";

// Minimal Three.js smoke test: confirms the render + screenshot pipeline
// works end-to-end before any of the reference-implementation logic is
// ported in. See reference/farmer-sim-design-doc-v2.md for the real plan.
export default function PlaceholderScene() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(2.4, 1.8, 2.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xb9cbe0, 0x3a3226, 0.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.2);
    sun.position.set(3, 4, 2);
    scene.add(sun);

    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x2e4a63, roughness: 0.7 })
    );
    scene.add(cube);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshStandardMaterial({ color: 0x7c9459, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    scene.add(ground);

    function animate() {
      cube.rotation.y += 0.008;
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
      ro.disconnect();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} data-testid="scene-mount" style={{ width: "100%", height: "100%" }} />;
}
