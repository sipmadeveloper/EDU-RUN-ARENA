import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { AvatarConfig } from '../types/game';
import { createBlockyRunner, animateBlockyRunner, type BlockyRunnerRig } from '../three/createBlockyRunner';
import { applyStudioEnvironment, createConfiguredRenderer, afterDraw } from '../three/webglGuard';

interface AvatarPreview3DProps {
  avatar: AvatarConfig;
  playerName?: string;
  mode?: 'idle' | 'boost' | 'celebration';
  className?: string;
}

export function AvatarPreview3D({
  avatar,
  playerName = 'Pelari 01',
  mode = 'idle',
  className = 'w-full h-72',
}: AvatarPreview3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef(avatar);
  const nameRef = useRef(playerName);
  const modeRef = useRef(mode);
  const rebuildFnRef = useRef<(() => void) | null>(null);

  avatarRef.current = avatar;
  nameRef.current = playerName;
  modeRef.current = mode;

  useEffect(() => {
    rebuildFnRef.current?.();
  }, [avatar.color, avatar.gender, avatar.outfit, avatar.presetId, playerName]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1a36);

    const camera = new THREE.PerspectiveCamera(
      40,
      (container.clientWidth || 320) / (container.clientHeight || 280),
      0.1,
      50
    );
    camera.position.set(0, 1.95, 4.75);
    camera.lookAt(0, 1.32, 0);

    const { renderer, isSoftwareGl } = createConfiguredRenderer(container);
    const disposeEnv = applyStudioEnvironment(scene, renderer);

    // 3-point stadium preview lighting
    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.85);
    const key = new THREE.DirectionalLight(0xfffbeb, 1.5);
    key.position.set(3, 5, 4);
    key.castShadow = !isSoftwareGl;
    const rim = new THREE.DirectionalLight(0x38bdf8, 0.9);
    rim.position.set(-4, 3, -3);
    scene.add(hemi, key, rim);

    // Pedestal base
    const baseGeo = new THREE.CylinderGeometry(1.15, 1.28, 0.24, 32);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a8a,
      metalness: 0.55,
      roughness: 0.3,
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.12;
    base.receiveShadow = true;
    scene.add(base);

    const ringGeo = new THREE.RingGeometry(1.16, 1.24, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff6b1a, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);

    let rig: BlockyRunnerRig | null = null;
    const buildRunner = () => {
      if (rig) {
        scene.remove(rig.root);
        rig.dispose();
      }
      rig = createBlockyRunner(avatarRef.current, nameRef.current || 'Pelari', 1, true, false);
      scene.add(rig.root);
    };
    buildRunner();
    rebuildFnRef.current = buildRunner;

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 320;
      const h = container.clientHeight || 280;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      if (rig) {
        rig.root.rotation.y += dt * 0.65;
        animateBlockyRunner(rig, elapsed, modeRef.current);
      }
      renderer.render(scene, camera);
      if (isSoftwareGl) {
        frameId = afterDraw(renderer, tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      if (rig) rig.dispose();
      baseGeo.dispose();
      baseMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      disposeEnv();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} className={`rounded-xl overflow-hidden bg-[#0b1a36] ${className}`} />;
}
