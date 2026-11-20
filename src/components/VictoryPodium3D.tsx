import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RotateCcw, Sparkles, Eye, Award } from 'lucide-react';
import type { PlayerState } from '../types/game';
import {
  createBlockyRunner,
  animateBlockyRunner,
  type BlockyRunnerRig,
} from '../three/createBlockyRunner';
import {
  getVictoryAnimModeForRank,
  getVictoryMetaForRank,
  type VictoryAnimMode,
} from '../three/victoryAnimations';
import {
  attachWornMedalToRunner,
  createFormalPresenterRig,
  evaluateMedalCeremony,
  getMedalLabelId,
  getMedalTierForRank,
  type CeremonyRecipientTarget,
  type MedalAttachmentHandle,
  type MedalTier,
} from '../three/medalCeremony';
import { soundEngine } from '../audio/soundEngine';
import { applyStudioEnvironment, createConfiguredRenderer, afterDraw } from '../three/webglGuard';

interface VictoryPodium3DProps {
  topThree?: PlayerState[];
  players?: PlayerState[];
  localPlayerId?: string;
  className?: string;
}

interface SpotlightEntry {
  key: string;
  rank: number;
  label: string;
  playerName: string;
  isLocal: boolean;
  x: number;
  y: number;
  z: number;
  animMode: VictoryAnimMode;
  accentHex: string;
}

interface CeremonyHudSnapshot {
  phase: 'idle' | 'walking' | 'presenting' | 'draping' | 'applauding' | 'complete';
  activeRank: 1 | 2 | 3 | null;
  activeTier: MedalTier | null;
  activeName: string;
  awardedCount: number;
  totalAwards: number;
  awardedGold: boolean;
  awardedSilver: boolean;
  awardedBronze: boolean;
}

function createRankPlaqueTexture(rankText: string, bgHex: string, fgHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = fgHex;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);

  ctx.fillStyle = fgHex;
  ctx.font = '900 66px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(rankText, canvas.width / 2, canvas.height / 2 + 3);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createTurfStripeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const stripes = 8;
  const stripeW = canvas.width / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#166534' : '#15803d';
    ctx.fillRect(i * stripeW, 0, stripeW, canvas.height);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

export function VictoryPodium3D({
  topThree,
  players,
  localPlayerId,
  className = 'w-full h-80',
}: VictoryPodium3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string>('all');
  const [replayNonce, setReplayNonce] = useState(0);
  const [ceremonyHud, setCeremonyHud] = useState<CeremonyHudSnapshot>({
    phase: 'idle',
    activeRank: null,
    activeTier: null,
    activeName: '',
    awardedCount: 0,
    totalAwards: 0,
    awardedGold: false,
    awardedSilver: false,
    awardedBronze: false,
  });

  const rankedList = useMemo(() => {
    if (players && players.length > 0) return players;
    return topThree ?? [];
  }, [players, topThree]);

  const localRankIdx = useMemo(() => {
    if (!localPlayerId) return -1;
    return rankedList.findIndex((p) => p.id === localPlayerId);
  }, [rankedList, localPlayerId]);

  const localRank = localRankIdx >= 0 ? localRankIdx + 1 : null;
  const localPlayer = localRankIdx >= 0 ? rankedList[localRankIdx] : null;
  const hasFourth = rankedList.length >= 4;
  const localIsExtraFinisher = Boolean(localPlayer && localRank && localRank > 4);

  const spotlightEntries = useMemo<SpotlightEntry[]>(() => {
    const entries: SpotlightEntry[] = [];
    const baseSlots = [
      { idx: 0, rank: 1, x: 0, height: 0.96, z: 0 },
      { idx: 1, rank: 2, x: -2.35, height: 0.68, z: 0.05 },
      { idx: 2, rank: 3, x: 2.35, height: 0.48, z: 0.05 },
      ...(hasFourth ? [{ idx: 3, rank: 4, x: 4.45, height: 0.32, z: 0.08 }] : []),
    ];

    for (const slot of baseSlots) {
      const p = rankedList[slot.idx];
      if (!p) continue;
      const meta = getVictoryMetaForRank(slot.rank);
      entries.push({
        key: `rank-${slot.rank}`,
        rank: slot.rank,
        label: `#${slot.rank}`,
        playerName: p.name,
        isLocal: p.id === localPlayerId,
        x: slot.x,
        y: slot.height,
        z: slot.z,
        animMode: meta.animMode,
        accentHex: meta.accentHex,
      });
    }

    if (localIsExtraFinisher && localPlayer && localRank) {
      const meta = getVictoryMetaForRank(localRank);
      entries.push({
        key: 'local-finisher',
        rank: localRank,
        label: `#${localRank}`,
        playerName: localPlayer.name,
        isLocal: true,
        x: -5.55,
        y: 0.24,
        z: 1.55,
        animMode: meta.animMode,
        accentHex: meta.accentHex,
      });
    }

    return entries;
  }, [rankedList, hasFourth, localPlayerId, localIsExtraFinisher, localPlayer, localRank]);

  const focusKeyRef = useRef(focusKey);
  focusKeyRef.current = focusKey;

  const replayRequestRef = useRef(0);

  // Reset camera focus safely if selected target disappears
  useEffect(() => {
    if (focusKey !== 'all' && !spotlightEntries.some((e) => e.key === focusKey)) {
      setFocusKey('all');
    }
  }, [focusKey, spotlightEntries]);

  useEffect(() => {
    replayRequestRef.current = replayNonce;
  }, [replayNonce]);

  const activeEntry = useMemo(() => {
    if (focusKey !== 'all') {
      return spotlightEntries.find((e) => e.key === focusKey) ?? null;
    }
    if (localPlayerId) {
      return spotlightEntries.find((e) => e.isLocal) ?? spotlightEntries[0] ?? null;
    }
    return spotlightEntries[0] ?? null;
  }, [focusKey, spotlightEntries, localPlayerId]);

  const activeMeta = useMemo(
    () => getVictoryMetaForRank(activeEntry?.rank ?? localRank ?? 1),
    [activeEntry, localRank]
  );

  // Stable key for scene rebuild only when roster/avatars/placements actually change
  const sceneSignature = useMemo(() => {
    return spotlightEntries
      .map((e) => {
        const p = rankedList[e.rank - 1];
        return `${e.key}:${e.rank}:${p?.id ?? ''}:${p?.name ?? ''}:${p?.avatar.presetId ?? ''}:${p?.avatar.color ?? ''}`;
      })
      .join('|');
  }, [spotlightEntries, rankedList]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07132b);
    scene.fog = new THREE.FogExp2(0x07132b, 0.026);

    const camera = new THREE.PerspectiveCamera(
      42,
      (container.clientWidth || 640) / (container.clientHeight || 320),
      0.1,
      90
    );

    const wideCenterX = hasFourth && !localIsExtraFinisher ? 0.85 : localIsExtraFinisher && !hasFourth ? -0.75 : 0.1;
    const wideZ = hasFourth || localIsExtraFinisher ? 11.6 : 9.8;
    const wideY = hasFourth || localIsExtraFinisher ? 4.2 : 3.9;

    camera.position.set(wideCenterX, wideY, wideZ);
    camera.lookAt(wideCenterX, 1.9, 0.4);

    const { renderer, isSoftwareGl } = createConfiguredRenderer(container);
    const disposeEnv = applyStudioEnvironment(scene, renderer);

    const hemi = new THREE.HemisphereLight(0x93c5fd, 0x0f172a, 0.95);
    const key = new THREE.DirectionalLight(0xfffbeb, 1.65);
    key.position.set(6, 10, 8);
    key.castShadow = !isSoftwareGl;
    const rimGold = new THREE.DirectionalLight(0xfacc15, 0.85);
    rimGold.position.set(-5, 7, -4);
    scene.add(hemi, key, rimGold);

    const disposables: Array<{ dispose: () => void }> = [];

    // Striped stadium turf floor
    const turfTex = createTurfStripeTexture();
    const floorGeo = new THREE.PlaneGeometry(46, 46);
    const floorMat = new THREE.MeshStandardMaterial({
      map: turfTex,
      roughness: 0.88,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    disposables.push(turfTex, floorGeo, floorMat);

    // Championship stage platform ring under the podium (widened cleanly for left & right side staircases)
    const STAGE_TOP_Y = 0.16;
    const stageGeo = new THREE.CylinderGeometry(8.35, 8.65, STAGE_TOP_Y, 48);
    const stageMat = new THREE.MeshStandardMaterial({
      color: 0x0f2552,
      roughness: 0.45,
      metalness: 0.35,
    });
    const stageMesh = new THREE.Mesh(stageGeo, stageMat);
    stageMesh.position.set(wideCenterX, STAGE_TOP_Y / 2, 0.55);
    stageMesh.receiveShadow = true;
    scene.add(stageMesh);

    const trimRingGeo = new THREE.TorusGeometry(8.4, 0.06, 8, 56);
    const trimRingMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.22,
      metalness: 0.82,
      emissive: 0xca8a04,
      emissiveIntensity: 0.28,
    });
    const trimRing = new THREE.Mesh(trimRingGeo, trimRingMat);
    trimRing.rotation.x = Math.PI / 2;
    trimRing.position.set(wideCenterX, STAGE_TOP_Y + 0.01, 0.55);
    scene.add(trimRing);

    // Royal red carpet VIP walkway in front of podiums for the medal presenter
    const WALK_Z = 2.68;
    const carpetMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      roughness: 0.78,
      metalness: 0.04,
    });
    const goldTrimMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      roughness: 0.24,
      metalness: 0.82,
    });
    const walkwayGeo = new THREE.BoxGeometry(9.6, 0.03, 1.35);
    const walkwayMesh = new THREE.Mesh(walkwayGeo, carpetMat);
    walkwayMesh.position.set(0.1, STAGE_TOP_Y + 0.015, WALK_Z);
    walkwayMesh.receiveShadow = true;
    scene.add(walkwayMesh);

    const carpetEdgeGeo = new THREE.BoxGeometry(9.6, 0.036, 0.06);
    const carpetEdgeFront = new THREE.Mesh(carpetEdgeGeo, goldTrimMat);
    carpetEdgeFront.position.set(0.1, STAGE_TOP_Y + 0.018, WALK_Z + 0.66);
    const carpetEdgeBack = new THREE.Mesh(carpetEdgeGeo, goldTrimMat);
    carpetEdgeBack.position.set(0.1, STAGE_TOP_Y + 0.018, WALK_Z - 0.66);
    scene.add(carpetEdgeFront, carpetEdgeBack);

    disposables.push(
      stageGeo,
      stageMat,
      trimRingGeo,
      trimRingMat,
      carpetMat,
      goldTrimMat,
      walkwayGeo,
      carpetEdgeGeo
    );

    // Build pedestals, integrated royal front presentation steps, plaques, spotlight cones, and runners
    const rigs: Array<{
      key: string;
      rank: number;
      rig: BlockyRunnerRig;
      wornMedal: MedalAttachmentHandle | null;
      animMode: VictoryAnimMode;
      phaseOffset: number;
      focusX: number;
      focusY: number;
      focusZ: number;
      celebrateStartAt: number | null;
    }> = [];

    const ceremonyTargets: CeremonyRecipientTarget[] = [];

    const beamGeo = new THREE.ConeGeometry(1.45, 7.5, 20, 1, true);
    disposables.push(beamGeo);

    const pedStyles: Record<number, { body: number; cap: number; plaqueBg: string; plaqueFg: string }> = {
      1: { body: 0xd97706, cap: 0xfacc15, plaqueBg: '#1e1b0a', plaqueFg: '#facc15' },
      2: { body: 0x64748b, cap: 0xe2e8f0, plaqueBg: '#0f172a', plaqueFg: '#e2e8f0' },
      3: { body: 0xc2410c, cap: 0xfb923c, plaqueBg: '#1c1008', plaqueFg: '#fb923c' },
      4: { body: 0x0369a1, cap: 0x38bdf8, plaqueBg: '#081e30', plaqueFg: '#38bdf8' },
    };

    for (const entry of spotlightEntries) {
      const player = rankedList[entry.rank - 1];
      if (!player) continue;

      const style = pedStyles[entry.rank] ?? {
        body: 0x047857,
        cap: 0x34d399,
        plaqueBg: '#062019',
        plaqueFg: '#34d399',
      };

      const pedW = entry.rank === 1 ? 2.1 : entry.rank <= 4 ? 1.85 : 1.75;
      const pedD = entry.rank === 1 ? 1.85 : 1.65;
      const pedH = entry.y;

      const pedGeo = new THREE.BoxGeometry(pedW, pedH, pedD);
      const pedMat = new THREE.MeshStandardMaterial({
        color: style.body,
        roughness: 0.34,
        metalness: 0.42,
      });
      const ped = new THREE.Mesh(pedGeo, pedMat);
      ped.position.set(entry.x, pedH / 2 + 0.14, entry.z);
      ped.castShadow = !isSoftwareGl;
      ped.receiveShadow = true;
      scene.add(ped);

      // Metallic beveled top cap
      const capGeo = new THREE.BoxGeometry(pedW + 0.12, 0.1, pedD + 0.12);
      const capMat = new THREE.MeshStandardMaterial({
        color: style.cap,
        roughness: 0.2,
        metalness: 0.72,
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(entry.x, pedH + 0.16, entry.z);
      cap.receiveShadow = true;
      scene.add(cap);

      const topY = pedH + 0.21;
      const frontEdgeZ = entry.z + pedD / 2;

      // Grounded front red-carpet presenter target for Top-3 medalists (podium stairs are on the sides!)
      if (entry.rank === 1 || entry.rank === 2 || entry.rank === 3) {
        ceremonyTargets.push({
          rank: entry.rank,
          name: player.name,
          runnerX: entry.x,
          runnerY: topY,
          runnerZ: entry.z,
          standX: entry.x,
          standY: STAGE_TOP_Y,
          standZ: frontEdgeZ + 0.58,
        });
      }

      // Crisp unobstructed rank number plaque centered prominently on the pedestal front face
      const plaqueTex = createRankPlaqueTexture(`#${entry.rank}`, style.plaqueBg, style.plaqueFg);
      const plaqueW = Math.min(1.18, pedW * 0.64);
      const plaqueH = Math.min(0.56, Math.max(0.24, pedH * 0.64));
      const plaqueGeo = new THREE.PlaneGeometry(plaqueW, plaqueH);
      const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex });
      const plaque = new THREE.Mesh(plaqueGeo, plaqueMat);
      plaque.position.set(entry.x, STAGE_TOP_Y + pedH * 0.5, frontEdgeZ + 0.018);
      scene.add(plaque);

      // Soft spotlight beam above 1st place and local player
      if (entry.rank === 1 || entry.isLocal) {
        const beamMat = new THREE.MeshBasicMaterial({
          color: style.cap,
          transparent: true,
          opacity: entry.rank === 1 ? 0.085 : 0.07,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.set(entry.x, pedH + 3.6, entry.z);
        scene.add(beam);
        disposables.push(beamMat);
      }

      disposables.push(pedGeo, pedMat, capGeo, capMat, plaqueTex, plaqueGeo, plaqueMat);

      const rig = createBlockyRunner(
        player.avatar,
        `#${entry.rank} ${player.name}`,
        player.lane + 1,
        entry.isLocal || entry.rank === 1,
        true
      );
      rig.root.position.set(entry.x, topY, entry.z);
      if (entry.key === 'local-finisher') {
        rig.root.rotation.y = 0.26;
      } else if (entry.rank === 4) {
        rig.root.rotation.y = -0.18;
      }
      scene.add(rig.root);

      const medalTier = getMedalTierForRank(entry.rank);
      const wornMedal = medalTier ? attachWornMedalToRunner(rig.bodyPivot, medalTier) : null;

      rigs.push({
        key: entry.key,
        rank: entry.rank,
        rig,
        wornMedal,
        animMode: getVictoryAnimModeForRank(entry.rank),
        phaseOffset: entry.rank === 1 ? 0 : (entry.rank - 1) * 0.35,
        focusX: entry.x,
        focusY: topY + 1.45,
        focusZ: entry.z,
        celebrateStartAt: medalTier ? null : 0,
      });
    }

    // Grand royal side staircases flanking LEFT and RIGHT sides of the championship podium
    const stairRiserMat = new THREE.MeshStandardMaterial({
      color: 0x0b1730,
      roughness: 0.48,
      metalness: 0.36,
    });
    disposables.push(stairRiserMat);

    const buildPodiumSideStairs = (opts: {
      startX: number;
      endX: number;
      topY: number;
      steps: number;
      depthZ: number;
      zCenter: number;
    }) => {
      const { startX, endX, topY, steps, depthZ, zCenter } = opts;
      const totalRun = endX - startX;
      const stepRun = Math.abs(totalRun) / steps;
      const dir = Math.sign(totalRun) || 1;
      const totalRise = topY - STAGE_TOP_Y;

      for (let s = 0; s < steps; s++) {
        const frac = (s + 1) / steps;
        const h = totalRise * frac;
        const stepTop = STAGE_TOP_Y + h;
        const cx = startX + dir * (s + 0.5) * stepRun;
        const outerEdgeX = cx - dir * (stepRun / 2 - 0.02);

        const sGeo = new THREE.BoxGeometry(stepRun + 0.02, h, depthZ);
        const sMesh = new THREE.Mesh(sGeo, stairRiserMat);
        sMesh.position.set(cx, STAGE_TOP_Y + h / 2, zCenter);
        sMesh.castShadow = !isSoftwareGl;
        sMesh.receiveShadow = true;

        const tGeo = new THREE.BoxGeometry(stepRun + 0.03, 0.03, depthZ - 0.12);
        const tMesh = new THREE.Mesh(tGeo, carpetMat);
        tMesh.position.set(cx, stepTop + 0.012, zCenter);

        const nGeo = new THREE.BoxGeometry(0.05, 0.036, depthZ + 0.02);
        const nMesh = new THREE.Mesh(nGeo, goldTrimMat);
        nMesh.position.set(outerEdgeX, stepTop + 0.012, zCenter);

        scene.add(sMesh, tMesh, nMesh);
        disposables.push(sGeo, tGeo, nGeo);
      }

      // Brushed-gold side handrails along front & rear borders of the side stairs
      const railLen = Math.hypot(totalRun, totalRise) + 0.12;
      const railAngle = Math.atan2(totalRise, totalRun);
      const railGeo = new THREE.CylinderGeometry(0.032, 0.032, railLen, 8);
      const postGeo = new THREE.CylinderGeometry(0.03, 0.036, 0.68, 8);
      const midX = (startX + endX) / 2;
      const midY = (STAGE_TOP_Y + topY) / 2 + 0.65;
      disposables.push(railGeo, postGeo);

      for (const zSide of [-1, 1] as const) {
        const railZ = zCenter + zSide * (depthZ / 2 - 0.03);
        const rail = new THREE.Mesh(railGeo, goldTrimMat);
        rail.position.set(midX, midY, railZ);
        rail.rotation.z = railAngle - Math.PI / 2;

        const pStart = new THREE.Mesh(postGeo, goldTrimMat);
        pStart.position.set(startX + dir * 0.1, STAGE_TOP_Y + 0.34, railZ);

        const pEnd = new THREE.Mesh(postGeo, goldTrimMat);
        pEnd.position.set(endX - dir * 0.1, topY + 0.32, railZ);

        scene.add(rail, pStart, pEnd);
      }
    };

    const hasRank2 = spotlightEntries.some((e) => e.rank === 2);
    const hasRank3 = spotlightEntries.some((e) => e.rank === 3);

    // Left staircase climbing from left flank into Rank 2 (or Rank 1 if solo)
    buildPodiumSideStairs({
      startX: hasRank2 ? -4.95 : -2.65,
      endX: hasRank2 ? -3.28 : -1.05,
      topY: hasRank2 ? 0.89 : 1.17,
      steps: 4,
      depthZ: 1.32,
      zCenter: 0.05,
    });

    // Right staircase climbing from right flank into Rank 4 / Rank 3 / Rank 1
    buildPodiumSideStairs({
      startX: hasFourth ? 6.72 : hasRank3 ? 4.82 : 2.65,
      endX: hasFourth ? 5.38 : hasRank3 ? 3.28 : 1.05,
      topY: hasFourth ? 0.53 : hasRank3 ? 0.69 : 1.17,
      steps: hasFourth ? 3 : 4,
      depthZ: 1.32,
      zCenter: 0.05,
    });

    // Side connecting step bridges between adjacent podium blocks
    const bridgeSpecs: Array<{ x: number; w: number; topY: number }> = [];
    if (hasRank2) bridgeSpecs.push({ x: -1.24, w: 0.38, topY: 1.03 });
    if (hasRank3) bridgeSpecs.push({ x: 1.24, w: 0.38, topY: 0.93 });
    if (hasFourth) bridgeSpecs.push({ x: 3.4, w: 0.28, topY: 0.61 });
    for (const b of bridgeSpecs) {
      const h = b.topY - STAGE_TOP_Y;
      const bGeo = new THREE.BoxGeometry(b.w, h, 1.3);
      const bMesh = new THREE.Mesh(bGeo, stairRiserMat);
      bMesh.position.set(b.x, STAGE_TOP_Y + h / 2, 0.03);
      const btGeo = new THREE.BoxGeometry(b.w + 0.02, 0.03, 1.2);
      const btMesh = new THREE.Mesh(btGeo, carpetMat);
      btMesh.position.set(b.x, b.topY + 0.012, 0.03);
      scene.add(bMesh, btMesh);
      disposables.push(bGeo, btGeo);
    }

    // Formal VIP Medal Presenter wearing tailored dark suit jacket, crisp white formal shirt & tie, and black trousers
    const presenter = createFormalPresenterRig(!isSoftwareGl);
    const presenterStartPos = { x: 4.35, z: WALK_Z };
    const presenterExitPos = { x: -4.15, z: WALK_Z + 0.12, yaw: 0.42 };
    presenter.root.position.set(presenterStartPos.x, STAGE_TOP_Y, presenterStartPos.z);
    presenter.root.rotation.y = -Math.PI / 2;
    scene.add(presenter.root);

    // Placement-scaled celebration confetti
    const confettiCount = 170;
    const cGeo = new THREE.PlaneGeometry(0.18, 0.1);
    const cMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const confetti = new THREE.InstancedMesh(cGeo, cMat, confettiCount);
    const cColors = [0xfacc15, 0xff6b1a, 0x38bdf8, 0x34d399, 0xe2e8f0, 0xec4899];
    const dummy = new THREE.Object3D();
    const parts: Array<{
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      rx: number;
      ry: number;
      rotX: number;
      rotY: number;
    }> = [];

    const seedConfettiBurst = (burst: boolean, originX = wideCenterX, originY = 2.0, originZ = 0) => {
      for (let i = 0; i < confettiCount; i++) {
        const p = parts[i];
        if (!p) continue;
        if (burst) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.0 + Math.random() * 2.8;
          p.x = originX + (Math.random() - 0.5) * 2.6;
          p.y = originY + Math.random() * 1.8;
          p.z = originZ + (Math.random() - 0.5) * 1.8;
          p.vx = Math.cos(angle) * speed;
          p.vy = 2.8 + Math.random() * 3.8;
          p.vz = Math.sin(angle) * speed * 0.7;
        } else {
          p.x = wideCenterX + (Math.random() - 0.5) * 12;
          p.y = 0.8 + Math.random() * 6.8;
          p.z = (Math.random() - 0.5) * 6;
          p.vx = (Math.random() - 0.5) * 0.4;
          p.vy = -(1.1 + Math.random() * 1.8);
          p.vz = (Math.random() - 0.5) * 0.35;
        }
      }
    };

    const tempColor = new THREE.Color();
    for (let i = 0; i < confettiCount; i++) {
      tempColor.setHex(cColors[i % cColors.length]);
      confetti.setColorAt(i, tempColor);
      parts.push({
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: -1.5,
        vz: 0,
        rx: (Math.random() - 0.5) * 6,
        ry: (Math.random() - 0.5) * 6,
        rotX: Math.random() * Math.PI,
        rotY: Math.random() * Math.PI,
      });
    }
    seedConfettiBurst(false);
    if (confetti.instanceColor) confetti.instanceColor.needsUpdate = true;
    scene.add(confetti);
    disposables.push(cGeo, cMat);

    if (!isSoftwareGl) renderer.compile(scene, camera);

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;
    let animOriginTime = 0;
    let seenReplayNonce = replayRequestRef.current;
    const awardedRanks = new Set<number>();
    let lastHudSig = '';

    // Pre-allocated vectors for silky zero-GC camera damping
    const _camDesiredPos = new THREE.Vector3(wideCenterX, wideY, wideZ);
    const _camDesiredLook = new THREE.Vector3(wideCenterX, 1.9, 0.4);
    const _camCurrentLook = new THREE.Vector3(wideCenterX, 1.9, 0.4);

    const resizeObs = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 640;
      const h = container.clientHeight || 320;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObs.observe(container);

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;

      if (replayRequestRef.current !== seenReplayNonce) {
        seenReplayNonce = replayRequestRef.current;
        animOriginTime = elapsed;
        awardedRanks.clear();
        for (let i = 0; i < rigs.length; i++) {
          const item = rigs[i];
          if (item.wornMedal) {
            item.wornMedal.setVisible(false, false);
            item.celebrateStartAt = null;
          }
        }
        seedConfettiBurst(false);
      }

      const animElapsed = Math.max(0, elapsed - animOriginTime);

      // Evaluate sequential formal VIP medal awarding choreography (Bronze #3 -> Silver #2 -> Gold #1)
      const ceremonyStage = evaluateMedalCeremony({
        presenter,
        ceremonyTime: Math.max(0, animElapsed - 0.35),
        targets: ceremonyTargets,
        floorY: STAGE_TOP_Y,
        walkZ: WALK_Z,
        startPos: presenterStartPos,
        exitPos: presenterExitPos,
        awardedRanks,
      });

      // Handle newly draped medal celebration cue (confetti burst + ceremonial chime)
      if (ceremonyStage.newlyAwardedRank !== null) {
        const awardedRank = ceremonyStage.newlyAwardedRank;
        soundEngine.playMedalAwarded(awardedRank);
        const targetInfo = ceremonyTargets.find((t) => t.rank === awardedRank);
        if (targetInfo) {
          seedConfettiBurst(true, targetInfo.runnerX, targetInfo.runnerY + 1.8, targetInfo.runnerZ);
        }
      }

      // Sync ceremony status HUD only when stage meaningfully changes (zero React render churn)
      const hudSig = `${ceremonyStage.phase}:${ceremonyStage.activeRank ?? ''}:${awardedRanks.size}:${ceremonyTargets.length}`;
      if (hudSig !== lastHudSig) {
        lastHudSig = hudSig;
        setCeremonyHud({
          phase: ceremonyStage.phase,
          activeRank: ceremonyStage.activeRank,
          activeTier: ceremonyStage.activeTier,
          activeName: ceremonyStage.activeName,
          awardedCount: awardedRanks.size,
          totalAwards: ceremonyTargets.length,
          awardedGold: awardedRanks.has(1),
          awardedSilver: awardedRanks.has(2),
          awardedBronze: awardedRanks.has(3),
        });
      }

      // Camera target: close-up user spotlight, active medal draping camera, or wide full podium orbit
      const currentFocus = focusKeyRef.current;
      const focusedRig = currentFocus === 'all' ? null : rigs.find((r) => r.key === currentFocus) ?? null;

      if (focusedRig) {
        const sway = Math.sin(elapsed * 0.65) * 0.72;
        _camDesiredPos.set(
          focusedRig.focusX + sway,
          focusedRig.focusY + 0.55,
          focusedRig.focusZ + 4.55
        );
        _camDesiredLook.set(focusedRig.focusX, focusedRig.focusY - 0.1, focusedRig.focusZ);
      } else if (ceremonyStage.focusPoint && ceremonyStage.phase !== 'complete') {
        // Angle slightly off-center so both the formal presenter & recipient face/neck draping are cleanly framed
        const sideOffset = ceremonyStage.activeRank === 2 ? 1.85 : -1.85;
        _camDesiredPos.set(
          ceremonyStage.focusPoint.x + sideOffset,
          ceremonyStage.focusPoint.y + 0.75,
          ceremonyStage.focusPoint.z + 5.15
        );
        _camDesiredLook.set(
          ceremonyStage.focusPoint.x,
          ceremonyStage.focusPoint.y - 0.05,
          ceremonyStage.focusPoint.z
        );
      } else {
        const orbitSway = Math.sin(elapsed * 0.36) * 1.85;
        _camDesiredPos.set(wideCenterX + orbitSway, wideY, wideZ);
        _camDesiredLook.set(wideCenterX, 1.95, 0.4);
      }

      camera.position.x = THREE.MathUtils.damp(camera.position.x, _camDesiredPos.x, 4.6, dt);
      camera.position.y = THREE.MathUtils.damp(camera.position.y, _camDesiredPos.y, 4.6, dt);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, _camDesiredPos.z, 4.6, dt);

      _camCurrentLook.x = THREE.MathUtils.damp(_camCurrentLook.x, _camDesiredLook.x, 5.2, dt);
      _camCurrentLook.y = THREE.MathUtils.damp(_camCurrentLook.y, _camDesiredLook.y, 5.2, dt);
      _camCurrentLook.z = THREE.MathUtils.damp(_camCurrentLook.z, _camDesiredLook.z, 5.2, dt);
      camera.lookAt(_camCurrentLook);

      // Update each character's animation: attentive anticipation -> respectful head bow -> medal-wearing victory celebration!
      for (let i = 0; i < rigs.length; i++) {
        const item = rigs[i];
        const isMedalist = item.wornMedal !== null;
        const hasMedal = !isMedalist || awardedRanks.has(item.rank);

        if (item.wornMedal) {
          item.wornMedal.setVisible(hasMedal, true);
          item.wornMedal.update(dt);
        }

        if (hasMedal) {
          if (item.celebrateStartAt === null) {
            item.celebrateStartAt = animElapsed;
          }
          const celebT = Math.max(0, animElapsed - item.celebrateStartAt);
          animateBlockyRunner(item.rig, celebT, item.animMode, item.phaseOffset, dt);
        } else {
          // Waiting politely on podium to receive medal from the VIP presenter
          animateBlockyRunner(item.rig, animElapsed, 'idle', item.phaseOffset, dt);
          item.rig.trophyGroup.visible = false;
          if (ceremonyStage.bowingRank === item.rank && ceremonyStage.bowAmount > 0.005) {
            item.rig.headGroup.rotation.x += ceremonyStage.bowAmount * 0.54;
            item.rig.bodyPivot.rotation.x += ceremonyStage.bowAmount * 0.22;
          }
        }
      }

      // Update confetti physics (bursts softly transition into festive flutter)
      for (let i = 0; i < confettiCount; i++) {
        const p = parts[i];
        p.vy = Math.max(-2.4, p.vy - 4.2 * dt);
        p.vx *= 1 - 0.85 * dt;
        p.vz *= 1 - 0.85 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.rotX += p.rx * dt;
        p.rotY += p.ry * dt;

        if (p.y < 0.16) {
          p.x = wideCenterX + (Math.random() - 0.5) * 12;
          p.y = 6.6 + Math.random() * 1.4;
          p.z = (Math.random() - 0.5) * 6;
          p.vx = (Math.random() - 0.5) * 0.5;
          p.vy = -(1.1 + Math.random() * 1.6);
          p.vz = (Math.random() - 0.5) * 0.4;
        }

        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rotX, p.rotY, 0);
        dummy.updateMatrix();
        confetti.setMatrixAt(i, dummy.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
      if (isSoftwareGl) frameId = afterDraw(renderer, tick);
      else frameId = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObs.disconnect();
      presenter.dispose();
      rigs.forEach((r) => {
        r.wornMedal?.dispose();
        r.rig.dispose();
      });
      disposables.forEach((d) => d.dispose());
      disposeEnv();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [sceneSignature, hasFourth, localIsExtraFinisher]);

  const localEntry = spotlightEntries.find((e) => e.isLocal) ?? null;

  const activeTierColor =
    ceremonyHud.activeTier === 'gold'
      ? '#FACC15'
      : ceremonyHud.activeTier === 'silver'
      ? '#E2E8F0'
      : '#FB923C';

  return (
    <div className={`relative rounded-2xl overflow-hidden border border-white/15 bg-[#07132b] ${className}`}>
      <div ref={mountRef} className="w-full h-full" />

      {/* Top-Left Placement Animation Indicator (solid opaque card, no backdrop-filter over WebGL) */}
      {activeEntry && (
        <div className="pointer-events-none absolute top-3 left-3 max-w-[56%] sm:max-w-xs rounded-xl bg-[#081226]/95 border border-white/15 px-3 py-2 shadow-lg">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: activeMeta.accentHex }} />
            <span className="truncate" style={{ color: activeMeta.accentHex }}>
              {activeEntry.isLocal ? `PERINGKAT ANDA #${activeEntry.rank}` : `PERINGKAT #${activeEntry.rank}`} · {activeMeta.badge}
            </span>
          </div>
          <div className="text-xs sm:text-sm font-display font-bold text-white truncate mt-0.5">
            {activeMeta.title}
          </div>
          <div className="text-[11px] text-slate-300 truncate">
            {activeEntry.playerName} — {activeMeta.subtitle}
          </div>
        </div>
      )}

      {/* Top-Right Live Medal Presentation Ceremony Banner (opaque surface, no backdrop-filter over WebGL) */}
      {ceremonyHud.totalAwards > 0 && (
        <div className="pointer-events-none absolute top-3 right-3 max-w-[40%] sm:max-w-xs rounded-xl bg-[#081226]/95 border border-white/15 px-3 py-2 shadow-lg">
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-bold tracking-wide uppercase">
            <Award
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: ceremonyHud.phase === 'complete' ? '#FACC15' : activeTierColor }}
            />
            <span
              className="truncate"
              style={{ color: ceremonyHud.phase === 'complete' ? '#FACC15' : activeTierColor }}
            >
              {ceremonyHud.phase === 'complete'
                ? 'UPACARA MEDALI SELESAI'
                : ceremonyHud.activeTier
                ? `PENGALUNGAN ${getMedalLabelId(ceremonyHud.activeTier).toUpperCase()}`
                : 'UPACARA MEDALI PODIUM'}
            </span>
          </div>
          <div className="text-[11px] text-slate-200 truncate mt-0.5 font-semibold">
            {ceremonyHud.phase === 'complete'
              ? 'Semua medali juara telah dikalungkan'
              : ceremonyHud.activeRank
              ? `Juara #${ceremonyHud.activeRank} · ${ceremonyHud.activeName}`
              : 'Menyiapkan pengalungan medali...'}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5">
            {rankedList.length >= 3 && (
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                  ceremonyHud.awardedBronze
                    ? 'bg-orange-500/20 text-orange-300 border-orange-400/50'
                    : 'bg-slate-800/90 text-slate-400 border-white/10'
                }`}
              >
                Perunggu
              </span>
            )}
            {rankedList.length >= 2 && (
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                  ceremonyHud.awardedSilver
                    ? 'bg-slate-200/20 text-slate-100 border-slate-300/60'
                    : 'bg-slate-800/90 text-slate-400 border-white/10'
                }`}
              >
                Perak
              </span>
            )}
            {rankedList.length >= 1 && (
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                  ceremonyHud.awardedGold
                    ? 'bg-yellow-400/20 text-yellow-300 border-yellow-400/60'
                    : 'bg-slate-800/90 text-slate-400 border-white/10'
                }`}
              >
                Emas
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bottom Interactive Camera Spotlight & Replay Strip */}
      {spotlightEntries.length > 0 && (
        <div className="absolute bottom-3 inset-x-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="pointer-events-auto inline-flex flex-wrap items-center gap-1 rounded-xl bg-[#081226]/95 border border-white/15 p-1 shadow-lg">
            <button
              type="button"
              onClick={() => setFocusKey('all')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                focusKey === 'all'
                  ? 'bg-[#1D4ED8] text-white'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Podium Lengkap</span>
            </button>

            {localEntry && (
              <button
                type="button"
                onClick={() => setFocusKey(localEntry.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                  focusKey === localEntry.key
                    ? 'bg-[#FF6B1A] text-white'
                    : 'text-amber-200 hover:text-white hover:bg-white/10'
                }`}
              >
                Sorot Karakterku (#{localEntry.rank})
              </button>
            )}

            {spotlightEntries
              .filter((e) => !e.isLocal)
              .map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setFocusKey(entry.key)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                    focusKey === entry.key
                      ? 'bg-slate-200 text-slate-950'
                      : 'text-slate-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
          </div>

          <button
            type="button"
            onClick={() => setReplayNonce((n) => n + 1)}
            className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#081226]/95 border border-white/15 hover:bg-[#12264d] text-[11px] font-semibold text-white cursor-pointer shadow-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#FACC15]" />
            <span>Putar Ulang Upacara Medali</span>
          </button>
        </div>
      )}
    </div>
  );
}

