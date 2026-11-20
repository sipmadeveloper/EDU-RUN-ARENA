import * as THREE from 'three';

export type MedalTier = 'gold' | 'silver' | 'bronze';

export interface MedalAttachmentHandle {
  group: THREE.Group;
  tier: MedalTier;
  setVisible: (visible: boolean, pop?: boolean) => void;
  update: (dt: number) => void;
  dispose: () => void;
}

export interface FormalPresenterRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  heldMedalAnchor: THREE.Group;
  heldMedals: Record<MedalTier, THREE.Group>;
  setActiveHeldMedal: (tier: MedalTier | null) => void;
  dispose: () => void;
}

export interface CeremonyRecipientTarget {
  rank: 1 | 2 | 3;
  name: string;
  /** Runner world position on top of pedestal (feet position) */
  runnerX: number;
  runnerY: number;
  runnerZ: number;
  /** Presenter standing position on the front step facing the winner */
  standX: number;
  standY: number;
  standZ: number;
}

export interface CeremonyStageState {
  phase: 'idle' | 'walking' | 'presenting' | 'draping' | 'applauding' | 'complete';
  activeRank: 1 | 2 | 3 | null;
  activeTier: MedalTier | null;
  activeName: string;
  awardedRanks: Set<number>;
  newlyAwardedRank: 1 | 2 | 3 | null;
  bowingRank: 1 | 2 | 3 | null;
  bowAmount: number;
  focusPoint: { x: number; y: number; z: number } | null;
  progress01: number;
}

export const MEDAL_SLOT_DURATION = 4.2;

export function getMedalTierForRank(rank: number): MedalTier | null {
  if (rank === 1) return 'gold';
  if (rank === 2) return 'silver';
  if (rank === 3) return 'bronze';
  return null;
}

export function getMedalLabelId(tier: MedalTier): string {
  if (tier === 'gold') return 'Medali Emas';
  if (tier === 'silver') return 'Medali Perak';
  return 'Medali Perunggu';
}

const MEDAL_PALETTES: Record<
  MedalTier,
  {
    metalHex: number;
    emissiveHex: number;
    emissiveIntensity: number;
    roughness: number;
    metalness: number;
    faceBgTop: string;
    faceBgBot: string;
    faceAccent: string;
    ribbonMain: number;
    ribbonTrim: number;
    rankChar: string;
  }
> = {
  gold: {
    metalHex: 0xfacc15,
    emissiveHex: 0x854d0e,
    emissiveIntensity: 0.24,
    roughness: 0.16,
    metalness: 0.92,
    faceBgTop: '#FEF08A',
    faceBgBot: '#CA8A04',
    faceAccent: '#713F12',
    ribbonMain: 0xdc2626,
    ribbonTrim: 0xfacc15,
    rankChar: '1',
  },
  silver: {
    metalHex: 0xe2e8f0,
    emissiveHex: 0x475569,
    emissiveIntensity: 0.16,
    roughness: 0.18,
    metalness: 0.9,
    faceBgTop: '#F8FAFC',
    faceBgBot: '#94A3B8',
    faceAccent: '#1E293B',
    ribbonMain: 0x1d4ed8,
    ribbonTrim: 0xe2e8f0,
    rankChar: '2',
  },
  bronze: {
    metalHex: 0xd97706,
    emissiveHex: 0x7c2d12,
    emissiveIntensity: 0.2,
    roughness: 0.22,
    metalness: 0.86,
    faceBgTop: '#FDBA74',
    faceBgBot: '#9A3412',
    faceAccent: '#431407',
    ribbonMain: 0x0f766e,
    ribbonTrim: 0xfdba74,
    rankChar: '3',
  },
};

function createMedalEmblemTexture(tier: MedalTier): THREE.CanvasTexture {
  const pal = MEDAL_PALETTES[tier];
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createRadialGradient(104, 96, 16, 128, 128, 124);
  grad.addColorStop(0, pal.faceBgTop);
  grad.addColorStop(0.68, pal.faceBgBot);
  grad.addColorStop(1, pal.faceAccent);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Outer engraved laurel ring
  ctx.strokeStyle = pal.faceAccent;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = pal.faceBgTop;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(128, 128, 96, 0, Math.PI * 2);
  ctx.stroke();

  // Laurel leaf ticks around lower arc
  ctx.fillStyle = pal.faceBgTop;
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    const angle = Math.PI * 0.5 + i * 0.22;
    const lx = 128 + Math.cos(angle) * 84;
    const ly = 128 + Math.sin(angle) * 84;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(angle + Math.PI * 0.5);
    ctx.beginPath();
    ctx.ellipse(0, 0, 9, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Top championship star
  ctx.fillStyle = pal.faceBgTop;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 20 : 9;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const sx = 128 + Math.cos(a) * r;
    const sy = 62 + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();

  // Embossed rank numeral
  ctx.fillStyle = pal.faceAccent;
  ctx.font = '900 108px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pal.rankChar, 130, 146);

  ctx.fillStyle = pal.faceBgTop;
  ctx.fillText(pal.rankChar, 126, 142);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds a 3D sculpted championship medal (medallion + beveled rim + bail + satin ribbon).
 * - mode 'worn': fitted cleanly to runnerRig.bodyPivot around the neck & resting on upper chest.
 * - mode 'held': held open by the VIP presenter between both hands so it slips over the winner's head.
 */
export function createAwardMedalMesh(
  tier: MedalTier,
  mode: 'worn' | 'held'
): { group: THREE.Group; dispose: () => void } {
  const pal = MEDAL_PALETTES[tier];
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const emblemTex = createMedalEmblemTexture(tier);
  const metalMat = new THREE.MeshStandardMaterial({
    color: pal.metalHex,
    roughness: pal.roughness,
    metalness: pal.metalness,
    emissive: pal.emissiveHex,
    emissiveIntensity: pal.emissiveIntensity,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: emblemTex,
    roughness: pal.roughness + 0.04,
    metalness: pal.metalness * 0.85,
    emissive: pal.emissiveHex,
    emissiveIntensity: pal.emissiveIntensity * 0.8,
  });
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: pal.ribbonMain,
    roughness: 0.44,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const ribbonTrimMat = new THREE.MeshStandardMaterial({
    color: pal.ribbonTrim,
    roughness: 0.34,
    metalness: 0.45,
  });

  disposables.push(emblemTex, metalMat, faceMat, ribbonMat, ribbonTrimMat);

  // Medallion sub-assembly (disc + beveled rim + bail clasp)
  const medallionGroup = new THREE.Group();
  const discRadius = mode === 'worn' ? 0.145 : 0.155;
  const discGeo = new THREE.CylinderGeometry(discRadius, discRadius, 0.034, 28);
  discGeo.rotateX(Math.PI / 2);
  const discMesh = new THREE.Mesh(discGeo, [metalMat, faceMat, faceMat]);
  medallionGroup.add(discMesh);

  const rimGeo = new THREE.TorusGeometry(discRadius, 0.022, 10, 28);
  const rimMesh = new THREE.Mesh(rimGeo, metalMat);
  medallionGroup.add(rimMesh);

  const bailGeo = new THREE.TorusGeometry(0.038, 0.012, 8, 16);
  const bailMesh = new THREE.Mesh(bailGeo, metalMat);
  bailMesh.position.set(0, discRadius + 0.028, 0);
  medallionGroup.add(bailMesh);

  const claspGeo = new THREE.BoxGeometry(0.085, 0.032, 0.028);
  const claspMesh = new THREE.Mesh(claspGeo, ribbonTrimMat);
  claspMesh.position.set(0, discRadius + 0.056, 0);
  medallionGroup.add(claspMesh);

  disposables.push(discGeo, rimGeo, bailGeo, claspGeo);

  if (mode === 'worn') {
    // Medallion rests visibly against the runner's chest (bodyPivot local coordinates)
    medallionGroup.position.set(0, 1.22, 0.305);
    medallionGroup.rotation.x = -0.08;
    group.add(medallionGroup);

    // Sculpted satin V-ribbon wrapping smoothly around neck (y=1.64) and down front chest
    const curveLeft = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.02, 1.38, 0.292),
      new THREE.Vector3(-0.125, 1.54, 0.255),
      new THREE.Vector3(-0.185, 1.64, 0.09),
      new THREE.Vector3(-0.14, 1.655, -0.115),
      new THREE.Vector3(0.0, 1.66, -0.175),
    ]);
    const curveRight = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, 1.38, 0.292),
      new THREE.Vector3(0.125, 1.54, 0.255),
      new THREE.Vector3(0.185, 1.64, 0.09),
      new THREE.Vector3(0.14, 1.655, -0.115),
      new THREE.Vector3(0.0, 1.66, -0.175),
    ]);

    const leftTubeGeo = new THREE.TubeGeometry(curveLeft, 18, 0.026, 8, false);
    const rightTubeGeo = new THREE.TubeGeometry(curveRight, 18, 0.026, 8, false);
    const leftRibbon = new THREE.Mesh(leftTubeGeo, ribbonMat);
    const rightRibbon = new THREE.Mesh(rightTubeGeo, ribbonMat);
    group.add(leftRibbon, rightRibbon);

    // Metallic gold/silver/bronze trim accents along the chest V-straps
    const trimGeo = new THREE.BoxGeometry(0.012, 0.24, 0.014);
    const trimL = new THREE.Mesh(trimGeo, ribbonTrimMat);
    trimL.position.set(-0.072, 1.48, 0.285);
    trimL.rotation.z = -0.46;
    trimL.rotation.x = -0.18;
    const trimR = new THREE.Mesh(trimGeo, ribbonTrimMat);
    trimR.position.set(0.072, 1.48, 0.285);
    trimR.rotation.z = 0.46;
    trimR.rotation.x = -0.18;
    group.add(trimL, trimR);

    disposables.push(leftTubeGeo, rightTubeGeo, trimGeo);
  } else {
    // 'held' mode: Presenter holds open satin ribbon loop between left (-0.23) & right (+0.23) hands
    medallionGroup.position.set(0, -0.34, 0.05);
    group.add(medallionGroup);

    const openLoopCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, -0.14, 0.045),
        new THREE.Vector3(-0.22, 0.02, 0.02),
        new THREE.Vector3(-0.18, 0.14, -0.16),
        new THREE.Vector3(0.0, 0.17, -0.24),
        new THREE.Vector3(0.18, 0.14, -0.16),
        new THREE.Vector3(0.22, 0.02, 0.02),
        new THREE.Vector3(0, -0.14, 0.045),
      ],
      false
    );
    const loopGeo = new THREE.TubeGeometry(openLoopCurve, 26, 0.025, 8, false);
    const loopMesh = new THREE.Mesh(loopGeo, ribbonMat);
    group.add(loopMesh);
    disposables.push(loopGeo);
  }

  return {
    group,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/**
 * Attaches a worn 3D medal directly onto a runner's bodyPivot so it rides naturally
 * during jumps, turns, bows, and victory celebrations.
 */
export function attachWornMedalToRunner(
  bodyPivot: THREE.Group,
  tier: MedalTier
): MedalAttachmentHandle {
  const { group, dispose } = createAwardMedalMesh(tier, 'worn');
  group.visible = false;
  bodyPivot.add(group);

  let popTimer = 0;

  return {
    group,
    tier,
    setVisible(visible: boolean, pop = false) {
      const wasVisible = group.visible;
      group.visible = visible;
      if (visible && pop && !wasVisible) {
        popTimer = 0.55;
        group.scale.setScalar(1.32);
      } else if (!visible) {
        popTimer = 0;
        group.scale.setScalar(1);
      }
    },
    update(dt: number) {
      if (popTimer > 0) {
        popTimer = Math.max(0, popTimer - dt);
        const u = popTimer / 0.55;
        const scale = 1 + Math.sin(u * Math.PI) * 0.24 * u;
        group.scale.setScalar(scale);
        if (popTimer === 0) group.scale.setScalar(1);
      }
    },
    dispose() {
      bodyPivot.remove(group);
      dispose();
    },
  };
}

function createFormalSuitFrontTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Tailored dark charcoal-navy formal suit wool base
  const suitGrad = ctx.createLinearGradient(0, 0, 0, 512);
  suitGrad.addColorStop(0, '#172033');
  suitGrad.addColorStop(0.5, '#111827');
  suitGrad.addColorStop(1, '#0b101b');
  ctx.fillStyle = suitGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Subtle fine woven pinstripe texture on jacket
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
  ctx.lineWidth = 2;
  for (let x = 16; x < 512; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // Crisp white formal dress shirt V-opening (baju formal)
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.moveTo(182, 0);
  ctx.lineTo(330, 0);
  ctx.lineTo(256, 286);
  ctx.closePath();
  ctx.fill();

  // Shirt collar shadow & folds
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(192, 6);
  ctx.lineTo(256, 76);
  ctx.lineTo(320, 6);
  ctx.stroke();

  // Royal crimson & gold formal silk necktie
  const tieGrad = ctx.createLinearGradient(236, 30, 276, 265);
  tieGrad.addColorStop(0, '#B91C1C');
  tieGrad.addColorStop(0.55, '#DC2626');
  tieGrad.addColorStop(1, '#7F1D1D');
  ctx.fillStyle = tieGrad;
  // Windsor knot
  ctx.beginPath();
  ctx.moveTo(234, 42);
  ctx.lineTo(278, 42);
  ctx.lineTo(268, 76);
  ctx.lineTo(244, 76);
  ctx.closePath();
  ctx.fill();
  // Tie blade
  ctx.beginPath();
  ctx.moveTo(244, 76);
  ctx.lineTo(268, 76);
  ctx.lineTo(278, 236);
  ctx.lineTo(256, 278);
  ctx.lineTo(234, 236);
  ctx.closePath();
  ctx.fill();

  // Diagonal gold ceremonial stripes on tie
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 4;
  for (let y = 96; y <= 236; y += 34) {
    ctx.beginPath();
    ctx.moveTo(238, y);
    ctx.lineTo(274, y - 16);
    ctx.stroke();
  }

  // Sculpted satin notch lapels (left & right)
  ctx.fillStyle = '#1E293B';
  // Left lapel
  ctx.beginPath();
  ctx.moveTo(182, 0);
  ctx.lineTo(138, 128);
  ctx.lineTo(166, 152);
  ctx.lineTo(148, 178);
  ctx.lineTo(256, 294);
  ctx.lineTo(256, 268);
  ctx.closePath();
  ctx.fill();
  // Right lapel
  ctx.beginPath();
  ctx.moveTo(330, 0);
  ctx.lineTo(374, 128);
  ctx.lineTo(346, 152);
  ctx.lineTo(364, 178);
  ctx.lineTo(256, 294);
  ctx.lineTo(256, 268);
  ctx.closePath();
  ctx.fill();

  // Crisp lapel seam edge highlight
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(182, 0);
  ctx.lineTo(138, 128);
  ctx.lineTo(256, 294);
  ctx.lineTo(374, 128);
  ctx.lineTo(330, 0);
  ctx.stroke();

  // Breast pocket + crisp white/gold folded pocket square on left chest
  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  ctx.moveTo(324, 158);
  ctx.lineTo(356, 132);
  ctx.lineTo(382, 158);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(328, 156);
  ctx.lineTo(356, 135);
  ctx.lineTo(378, 156);
  ctx.stroke();
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(316, 158, 76, 14);

  // Two formal jacket buttons + center seam
  ctx.strokeStyle = '#020617';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(256, 294);
  ctx.lineTo(256, 512);
  ctx.stroke();

  const drawButton = (y: number) => {
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(256, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  };
  drawButton(338);
  drawButton(412);

  // Lower flap pockets
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(92, 384, 98, 18);
  ctx.fillRect(322, 384, 98, 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPresenterFaceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Warm natural skin tone
  const skinGrad = ctx.createRadialGradient(128, 118, 22, 128, 128, 136);
  skinGrad.addColorStop(0, '#F5CBA7');
  skinGrad.addColorStop(1, '#E2A87E');
  ctx.fillStyle = skinGrad;
  ctx.fillRect(0, 0, 256, 256);

  // Gentle rosy cheek warmth
  ctx.fillStyle = 'rgba(239, 108, 108, 0.16)';
  ctx.beginPath();
  ctx.ellipse(72, 152, 22, 12, 0, 0, Math.PI * 2);
  ctx.ellipse(184, 152, 22, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dignified expressive eyebrows
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(64, 98);
  ctx.quadraticCurveTo(88, 90, 108, 97);
  ctx.moveTo(148, 97);
  ctx.quadraticCurveTo(168, 90, 192, 98);
  ctx.stroke();

  // Crisp friendly eyes with specular catchlight
  const drawEye = (cx: number) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(cx, 124, 17, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.arc(cx, 124, 9.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx + 3.5, 120, 3.2, 0, Math.PI * 2);
    ctx.fill();
  };
  drawEye(88);
  drawEye(168);

  // Subtle nose bridge accent
  ctx.strokeStyle = 'rgba(154, 92, 58, 0.45)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(128, 126);
  ctx.lineTo(124, 150);
  ctx.lineTo(132, 152);
  ctx.stroke();

  // Warm proud congratulatory smile
  ctx.strokeStyle = '#7C2D12';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(128, 168, 28, 0.16 * Math.PI, 0.84 * Math.PI);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Builds the smooth, non-boxy 3D Formal VIP Medal Presenter wearing:
 * - Tailored dark navy/charcoal suit jacket (jaz rapi) with lapels, pocket square & gold-accented crimson tie
 * - Crisp white formal dress shirt collar & sleeve cuffs (baju formal)
 * - Tailored black formal trousers (celana hitam) & leather belt
 * - Glossy black formal dress shoes (pantofel)
 */
export function createFormalPresenterRig(castShadow = true): FormalPresenterRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const disposables: Array<{ dispose: () => void }> = [];

  const suitTex = createFormalSuitFrontTexture();
  const faceTex = createPresenterFaceTexture();
  disposables.push(suitTex, faceTex);

  const suitMat = new THREE.MeshStandardMaterial({
    color: 0x131c2e,
    roughness: 0.62,
    metalness: 0.1,
  });
  const suitFrontMat = new THREE.MeshStandardMaterial({
    map: suitTex,
    roughness: 0.56,
    metalness: 0.08,
  });
  const lapelMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.46,
    metalness: 0.14,
  });
  const whiteShirtMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.52,
    metalness: 0.02,
  });
  const tieMat = new THREE.MeshStandardMaterial({
    color: 0xb91c1c,
    roughness: 0.36,
    metalness: 0.18,
  });
  const blackTrouserMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.78,
    metalness: 0.04,
  });
  const dressShoeMat = new THREE.MeshStandardMaterial({
    color: 0x07090e,
    roughness: 0.2,
    metalness: 0.18,
  });
  const beltMat = new THREE.MeshStandardMaterial({
    color: 0x111318,
    roughness: 0.32,
    metalness: 0.15,
  });
  const buckleMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.22,
    metalness: 0.88,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xf0c19d,
    roughness: 0.66,
    metalness: 0.02,
  });
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    roughness: 0.62,
    metalness: 0.02,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x181c24,
    roughness: 0.52,
    metalness: 0.1,
  });
  const silverTempleMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.48,
    metalness: 0.15,
  });

  disposables.push(
    suitMat,
    suitFrontMat,
    lapelMat,
    whiteShirtMat,
    tieMat,
    blackTrouserMat,
    dressShoeMat,
    beltMat,
    buckleMat,
    skinMat,
    faceMat,
    hairMat,
    silverTempleMat
  );

  const registerMesh = (mesh: THREE.Mesh, shadow = castShadow) => {
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    return mesh;
  };

  // Ground contact shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.56, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.015;
  root.add(contactShadow);
  disposables.push(shadowGeo, shadowMat);

  // --- Sculpted Tailored Suit Torso (smooth rounded silhouette, non-boxy) ---
  const torsoGeo = new THREE.CylinderGeometry(0.38, 0.33, 0.86, 20);
  torsoGeo.scale(1.12, 1, 0.68);
  const torsoMesh = registerMesh(new THREE.Mesh(torsoGeo, suitMat));
  torsoMesh.position.set(0, 1.24, 0);
  bodyPivot.add(torsoMesh);

  // Curved chest panel displaying crisp white formal dress shirt, crimson silk tie & suit lapels
  const frontPanelGeo = new THREE.PlaneGeometry(0.68, 0.78);
  const frontPanel = registerMesh(new THREE.Mesh(frontPanelGeo, suitFrontMat), false);
  frontPanel.position.set(0, 1.25, 0.258);
  bodyPivot.add(frontPanel);

  // Sculpted 3D suit shoulder pads & upper chest curve
  const shoulderCapGeo = new THREE.SphereGeometry(0.19, 14, 12);
  shoulderCapGeo.scale(1.1, 0.82, 0.92);
  const leftShoulderCap = registerMesh(new THREE.Mesh(shoulderCapGeo, suitMat));
  leftShoulderCap.position.set(-0.42, 1.62, 0);
  const rightShoulderCap = registerMesh(new THREE.Mesh(shoulderCapGeo, suitMat));
  rightShoulderCap.position.set(0.42, 1.62, 0);
  bodyPivot.add(leftShoulderCap, rightShoulderCap);

  // Tailored jacket lower skirt / hem around hips
  const jacketHemGeo = new THREE.CylinderGeometry(0.35, 0.38, 0.24, 18);
  jacketHemGeo.scale(1.12, 1, 0.7);
  const jacketHem = registerMesh(new THREE.Mesh(jacketHemGeo, suitMat));
  jacketHem.position.set(0, 0.78, -0.01);
  bodyPivot.add(jacketHem);

  // Crisp white formal shirt collar & 3D suit collar lapel roll around neck
  const collarGeo = new THREE.CylinderGeometry(0.175, 0.205, 0.13, 18);
  const collarMesh = registerMesh(new THREE.Mesh(collarGeo, whiteShirtMat), false);
  collarMesh.position.set(0, 1.69, 0.01);
  bodyPivot.add(collarMesh);

  const jacketCollarGeo = new THREE.TorusGeometry(0.205, 0.045, 8, 20, Math.PI * 1.45);
  const jacketCollar = registerMesh(new THREE.Mesh(jacketCollarGeo, lapelMat), false);
  jacketCollar.position.set(0, 1.67, -0.01);
  jacketCollar.rotation.x = Math.PI / 2 + 0.15;
  jacketCollar.rotation.z = -Math.PI * 0.225;
  bodyPivot.add(jacketCollar);

  // 3D Crimson Tie Knot + Sculpted Tie Blade
  const tieKnotGeo = new THREE.SphereGeometry(0.045, 10, 8);
  tieKnotGeo.scale(1.1, 0.95, 0.7);
  const tieKnot = registerMesh(new THREE.Mesh(tieKnotGeo, tieMat), false);
  tieKnot.position.set(0, 1.61, 0.255);
  bodyPivot.add(tieKnot);

  const tieBladeGeo = new THREE.ConeGeometry(0.055, 0.36, 4);
  tieBladeGeo.rotateZ(Math.PI);
  tieBladeGeo.scale(1.0, 1.0, 0.28);
  const tieBlade = registerMesh(new THREE.Mesh(tieBladeGeo, tieMat), false);
  tieBlade.position.set(0, 1.42, 0.268);
  bodyPivot.add(tieBlade);

  // Formal leather belt & gold buckle
  const beltGeo = new THREE.CylinderGeometry(0.355, 0.355, 0.07, 18);
  beltGeo.scale(1.1, 1, 0.71);
  const beltMesh = registerMesh(new THREE.Mesh(beltGeo, beltMat), false);
  beltMesh.position.set(0, 0.87, 0);
  bodyPivot.add(beltMesh);

  const buckleGeo = new THREE.BoxGeometry(0.11, 0.075, 0.035);
  const buckleMesh = registerMesh(new THREE.Mesh(buckleGeo, buckleMat), false);
  buckleMesh.position.set(0, 0.87, 0.255);
  bodyPivot.add(buckleMesh);

  // Pelvis / upper trouser base
  const pelvisGeo = new THREE.SphereGeometry(0.32, 16, 12);
  pelvisGeo.scale(1.08, 0.62, 0.68);
  const pelvisMesh = registerMesh(new THREE.Mesh(pelvisGeo, blackTrouserMat));
  pelvisMesh.position.set(0, 0.74, 0);
  bodyPivot.add(pelvisMesh);

  disposables.push(
    torsoGeo,
    frontPanelGeo,
    shoulderCapGeo,
    jacketHemGeo,
    collarGeo,
    jacketCollarGeo,
    tieKnotGeo,
    tieBladeGeo,
    beltGeo,
    buckleGeo,
    pelvisGeo
  );

  // --- Sculpted Head (Neck + Oval Head + Face + Combed Formal Hair + Ears) ---
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.76, 0);
  bodyPivot.add(headGroup);

  const neckGeo = new THREE.CylinderGeometry(0.125, 0.14, 0.16, 14);
  const neckMesh = registerMesh(new THREE.Mesh(neckGeo, skinMat), false);
  neckMesh.position.set(0, 0.03, 0);
  headGroup.add(neckMesh);

  const craniumGeo = new THREE.SphereGeometry(0.33, 22, 18);
  craniumGeo.scale(0.95, 1.08, 0.96);
  const craniumMesh = registerMesh(new THREE.Mesh(craniumGeo, skinMat));
  craniumMesh.position.set(0, 0.36, 0);
  headGroup.add(craniumMesh);

  // Smooth curved front face decal patch
  const facePatchGeo = new THREE.SphereGeometry(0.334, 20, 16, -Math.PI * 0.34, Math.PI * 0.68, Math.PI * 0.16, Math.PI * 0.68);
  facePatchGeo.scale(0.95, 1.08, 0.96);
  facePatchGeo.rotateY(Math.PI / 2);
  const facePatch = registerMesh(new THREE.Mesh(facePatchGeo, faceMat), false);
  facePatch.position.set(0, 0.36, 0.004);
  headGroup.add(facePatch);

  // Subtle sculpted ears
  const earGeo = new THREE.SphereGeometry(0.068, 10, 8);
  earGeo.scale(0.45, 1.1, 0.85);
  const leftEar = registerMesh(new THREE.Mesh(earGeo, skinMat), false);
  leftEar.position.set(-0.315, 0.35, -0.01);
  const rightEar = registerMesh(new THREE.Mesh(earGeo, skinMat), false);
  rightEar.position.set(0.315, 0.35, -0.01);
  headGroup.add(leftEar, rightEar);

  // Neat combed formal hair cap + styled executive sweep + subtle silver temples
  const hairCapGeo = new THREE.SphereGeometry(0.348, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.58);
  hairCapGeo.scale(0.97, 1.06, 0.99);
  const hairCap = registerMesh(new THREE.Mesh(hairCapGeo, hairMat));
  hairCap.position.set(0, 0.38, -0.025);
  hairCap.rotation.x = -0.22;
  headGroup.add(hairCap);

  const hairQuiffGeo = new THREE.CapsuleGeometry(0.11, 0.24, 8, 12);
  hairQuiffGeo.rotateZ(Math.PI / 2 - 0.12);
  const hairQuiff = registerMesh(new THREE.Mesh(hairQuiffGeo, hairMat));
  hairQuiff.position.set(0.02, 0.65, 0.14);
  headGroup.add(hairQuiff);

  const templeGeo = new THREE.BoxGeometry(0.045, 0.13, 0.12);
  const leftTemple = registerMesh(new THREE.Mesh(templeGeo, silverTempleMat), false);
  leftTemple.position.set(-0.305, 0.44, 0.04);
  const rightTemple = registerMesh(new THREE.Mesh(templeGeo, silverTempleMat), false);
  rightTemple.position.set(0.305, 0.44, 0.04);
  headGroup.add(leftTemple, rightTemple);

  disposables.push(neckGeo, craniumGeo, facePatchGeo, earGeo, hairCapGeo, hairQuiffGeo, templeGeo);

  // --- Articulated Tailored Suit Arms with White Shirt Cuffs & Sculpted Hands ---
  const sleeveGeo = new THREE.CapsuleGeometry(0.115, 0.42, 8, 14);
  const cuffGeo = new THREE.CylinderGeometry(0.098, 0.098, 0.075, 14);
  const handGeo = new THREE.SphereGeometry(0.095, 12, 10);
  handGeo.scale(0.85, 1.05, 1.15);
  disposables.push(sleeveGeo, cuffGeo, handGeo);

  const buildArm = (side: -1 | 1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.49, 1.6, 0);

    const sleeve = registerMesh(new THREE.Mesh(sleeveGeo, suitMat));
    sleeve.position.set(0, -0.32, 0);
    pivot.add(sleeve);

    const cuff = registerMesh(new THREE.Mesh(cuffGeo, whiteShirtMat), false);
    cuff.position.set(0, -0.58, 0);
    pivot.add(cuff);

    const hand = registerMesh(new THREE.Mesh(handGeo, skinMat));
    hand.position.set(0, -0.68, 0.02);
    pivot.add(hand);

    bodyPivot.add(pivot);
    return pivot;
  };

  const leftArmPivot = buildArm(-1);
  const rightArmPivot = buildArm(1);

  // --- Articulated Tailored Black Trousers (Celana Hitam) & Glossy Dress Shoes ---
  const thighGeo = new THREE.CylinderGeometry(0.145, 0.122, 0.62, 16);
  const shoeBodyGeo = new THREE.CapsuleGeometry(0.105, 0.18, 8, 12);
  shoeBodyGeo.rotateX(Math.PI / 2);
  shoeBodyGeo.scale(0.95, 0.72, 1.08);
  const heelGeo = new THREE.BoxGeometry(0.16, 0.055, 0.13);
  disposables.push(thighGeo, shoeBodyGeo, heelGeo);

  const buildLeg = (side: -1 | 1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.19, 0.74, 0);

    const trouser = registerMesh(new THREE.Mesh(thighGeo, blackTrouserMat));
    trouser.position.set(0, -0.32, 0);
    pivot.add(trouser);

    const shoe = registerMesh(new THREE.Mesh(shoeBodyGeo, dressShoeMat));
    shoe.position.set(0, -0.66, 0.075);
    pivot.add(shoe);

    const heel = registerMesh(new THREE.Mesh(heelGeo, dressShoeMat), false);
    heel.position.set(0, -0.71, -0.03);
    pivot.add(heel);

    bodyPivot.add(pivot);
    return pivot;
  };

  const leftLegPivot = buildLeg(-1);
  const rightLegPivot = buildLeg(1);

  // --- Held Medal Anchor positioned cleanly between both raised hands ---
  const heldMedalAnchor = new THREE.Group();
  heldMedalAnchor.position.set(0, 1.5, 0.55);
  bodyPivot.add(heldMedalAnchor);

  const goldHeld = createAwardMedalMesh('gold', 'held');
  const silverHeld = createAwardMedalMesh('silver', 'held');
  const bronzeHeld = createAwardMedalMesh('bronze', 'held');
  goldHeld.group.visible = false;
  silverHeld.group.visible = false;
  bronzeHeld.group.visible = false;
  heldMedalAnchor.add(goldHeld.group, silverHeld.group, bronzeHeld.group);

  const heldMedals: Record<MedalTier, THREE.Group> = {
    gold: goldHeld.group,
    silver: silverHeld.group,
    bronze: bronzeHeld.group,
  };

  const setActiveHeldMedal = (tier: MedalTier | null) => {
    heldMedals.gold.visible = tier === 'gold';
    heldMedals.silver.visible = tier === 'silver';
    heldMedals.bronze.visible = tier === 'bronze';
  };

  return {
    root,
    bodyPivot,
    headGroup,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    heldMedalAnchor,
    heldMedals,
    setActiveHeldMedal,
    dispose: () => {
      goldHeld.dispose();
      silverHeld.dispose();
      bronzeHeld.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}

function lerpAngle(from: number, to: number, t: number): number {
  let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

/**
 * Evaluates & animates the full sequential medal ceremony (Bronze #3 -> Silver #2 -> Gold #1)
 * on a deterministic timeline, positioning the VIP formal presenter, animating their walking gait,
 * stair climb, medal raising & draping around each winner's neck, applause, and VIP finale.
 */
export function evaluateMedalCeremony(params: {
  presenter: FormalPresenterRig;
  ceremonyTime: number;
  targets: CeremonyRecipientTarget[];
  floorY: number;
  walkZ: number;
  startPos: { x: number; z: number };
  exitPos: { x: number; z: number; yaw: number };
  awardedRanks: Set<number>;
}): CeremonyStageState {
  const { presenter, ceremonyTime, targets, floorY, walkZ, startPos, exitPos, awardedRanks } = params;

  // Order recipients strictly Bronze (#3) -> Silver (#2) -> Gold (#1)
  const ordered = [...targets].sort((a, b) => b.rank - a.rank);

  const resetPose = () => {
    presenter.bodyPivot.position.set(0, 0, 0);
    presenter.bodyPivot.rotation.set(0, 0, 0);
    presenter.headGroup.rotation.set(0, 0, 0);
    presenter.leftArmPivot.rotation.set(0, 0, 0.08);
    presenter.rightArmPivot.rotation.set(0, 0, -0.08);
    presenter.leftLegPivot.rotation.set(0, 0, 0);
    presenter.rightLegPivot.rotation.set(0, 0, 0);
  };

  if (ordered.length === 0) {
    resetPose();
    presenter.setActiveHeldMedal(null);
    presenter.root.position.set(exitPos.x, floorY, exitPos.z);
    presenter.root.rotation.y = exitPos.yaw;
    return {
      phase: 'complete',
      activeRank: null,
      activeTier: null,
      activeName: '',
      awardedRanks,
      newlyAwardedRank: null,
      bowingRank: null,
      bowAmount: 0,
      focusPoint: null,
      progress01: 1,
    };
  }

  const totalAwardsDuration = ordered.length * MEDAL_SLOT_DURATION;
  let newlyAwardedRank: 1 | 2 | 3 | null = null;

  // Mark any earlier slots as awarded (in case of large dt jump)
  const completedSlotCount = Math.min(ordered.length, Math.floor(Math.max(0, ceremonyTime) / MEDAL_SLOT_DURATION));
  for (let i = 0; i < completedSlotCount; i++) {
    const r = ordered[i].rank;
    if (!awardedRanks.has(r)) {
      awardedRanks.add(r);
      newlyAwardedRank = r;
    }
  }

  // After all medals have been draped: walk gracefully to VIP side spot and applaud proudly
  if (ceremonyTime >= totalAwardsDuration) {
    const postT = ceremonyTime - totalAwardsDuration;
    const lastTarget = ordered[ordered.length - 1];
    const exitWalkDur = 1.25;

    resetPose();
    presenter.setActiveHeldMedal(null);

    if (postT < exitWalkDur) {
      const u = THREE.MathUtils.smoothstep(postT / exitWalkDur, 0, 1);
      const px = THREE.MathUtils.lerp(lastTarget.standX, exitPos.x, u);
      const pz = THREE.MathUtils.lerp(walkZ, exitPos.z, u);
      presenter.root.position.set(px, floorY, pz);

      const walkYaw = Math.atan2(exitPos.x - lastTarget.standX, exitPos.z - walkZ);
      presenter.root.rotation.y = u < 0.8 ? walkYaw : lerpAngle(walkYaw, exitPos.yaw, (u - 0.8) / 0.2);

      const stride = Math.sin(postT * 9.5);
      presenter.leftLegPivot.rotation.x = stride * 0.45;
      presenter.rightLegPivot.rotation.x = -stride * 0.45;
      presenter.leftArmPivot.rotation.x = -stride * 0.34;
      presenter.rightArmPivot.rotation.x = stride * 0.34;
      presenter.bodyPivot.position.y = Math.abs(Math.cos(postT * 9.5)) * 0.045;
    } else {
      presenter.root.position.set(exitPos.x, floorY, exitPos.z);
      presenter.root.rotation.y = exitPos.yaw;

      // Warm dignified VIP applause facing the audience & winners
      const clapWave = Math.sin(postT * 10.5);
      const clapClosed = 0.5 + 0.5 * clapWave;
      presenter.leftArmPivot.rotation.set(-0.98, 0.36 + clapClosed * 0.24, 0.14);
      presenter.rightArmPivot.rotation.set(-0.98, -(0.36 + clapClosed * 0.24), -0.14);
      presenter.headGroup.rotation.x = Math.sin(postT * 2.6) * 0.07;
      presenter.headGroup.rotation.y = Math.sin(postT * 1.1) * 0.18;
      presenter.bodyPivot.position.y = Math.abs(Math.sin(postT * 2.6)) * 0.025;
    }

    return {
      phase: 'complete',
      activeRank: null,
      activeTier: null,
      activeName: '',
      awardedRanks,
      newlyAwardedRank,
      bowingRank: null,
      bowAmount: 0,
      focusPoint: null,
      progress01: 1,
    };
  }

  // Active recipient slot
  const slotIdx = Math.max(0, Math.min(ordered.length - 1, Math.floor(Math.max(0, ceremonyTime) / MEDAL_SLOT_DURATION)));
  const target = ordered[slotIdx];
  const tier = getMedalTierForRank(target.rank) ?? 'gold';
  const localT = Math.max(0, ceremonyTime - slotIdx * MEDAL_SLOT_DURATION);

  const prevX = slotIdx === 0 ? startPos.x : ordered[slotIdx - 1].standX;
  const prevZ = slotIdx === 0 ? startPos.z : walkZ;

  // Phase timing within the 4.2s slot
  const T_WALK = 1.05;
  const T_STEP_UP = 1.75;
  const T_DRAPE_OVER = 2.25;
  const T_DRAPE_LAND = 2.62;
  const T_RELEASE = 2.98;

  resetPose();

  let phase: CeremonyStageState['phase'] = 'walking';
  let bowAmount = 0;

  if (localT < T_WALK) {
    // 1. Smoothly walk along front red carpet to align directly in front of the recipient
    phase = 'walking';
    const u = THREE.MathUtils.smoothstep(localT / T_WALK, 0, 1);
    const px = THREE.MathUtils.lerp(prevX, target.standX, u);
    const pz = THREE.MathUtils.lerp(prevZ, walkZ, u);
    presenter.root.position.set(px, floorY, pz);

    const dx = target.standX - prevX;
    const dz = walkZ - prevZ;
    const moveDist = Math.hypot(dx, dz);
    const travelYaw = moveDist > 0.1 ? Math.atan2(dx, dz) : Math.PI;
    presenter.root.rotation.y = u < 0.72 ? travelYaw : lerpAngle(travelYaw, Math.PI, (u - 0.72) / 0.28);

    const strideAmp = moveDist > 0.15 ? 0.48 : 0.22;
    const stride = Math.sin(localT * 9.8);
    presenter.leftLegPivot.rotation.x = stride * strideAmp;
    presenter.rightLegPivot.rotation.x = -stride * strideAmp;
    presenter.bodyPivot.position.y = Math.abs(Math.cos(localT * 9.8)) * 0.045;

    // Carry the upcoming medal respectfully in front of chest while approaching
    presenter.leftArmPivot.rotation.set(-0.92, 0.22, 0.12);
    presenter.rightArmPivot.rotation.set(-0.92, -0.22, -0.12);
    presenter.heldMedalAnchor.position.set(0, 1.44, 0.56);
    presenter.heldMedalAnchor.rotation.set(0.15, 0, 0);
    presenter.setActiveHeldMedal(tier);
  } else if (localT < T_STEP_UP) {
    // 2. Climb the front ceremonial steps & raise the gleaming medal clearly into view
    phase = 'presenting';
    const u = THREE.MathUtils.smoothstep((localT - T_WALK) / (T_STEP_UP - T_WALK), 0, 1);
    const py = THREE.MathUtils.lerp(floorY, target.standY, u);
    const pz = THREE.MathUtils.lerp(walkZ, target.standZ, u);
    presenter.root.position.set(target.standX, py, pz);
    presenter.root.rotation.y = Math.PI;

    // Stair-climbing knee lift
    const climbStride = Math.sin(u * Math.PI * 2.5);
    presenter.leftLegPivot.rotation.x = Math.max(-0.55, climbStride * 0.42);
    presenter.rightLegPivot.rotation.x = Math.max(-0.55, -climbStride * 0.42);
    presenter.bodyPivot.position.y = Math.sin(u * Math.PI) * 0.03;

    // Raise both arms gracefully presenting the medal
    const liftPitch = THREE.MathUtils.lerp(-0.95, -1.95, u);
    presenter.leftArmPivot.rotation.set(liftPitch, 0.18, 0.16);
    presenter.rightArmPivot.rotation.set(liftPitch, -0.18, -0.16);
    presenter.heldMedalAnchor.position.set(0, THREE.MathUtils.lerp(1.48, 2.08, u), THREE.MathUtils.lerp(0.56, 0.62, u));
    presenter.heldMedalAnchor.rotation.set(THREE.MathUtils.lerp(0.1, -0.22, u), 0, 0);
    presenter.setActiveHeldMedal(tier);

    // Winner begins bowing slightly in anticipation near end of step-up
    bowAmount = THREE.MathUtils.smoothstep((u - 0.55) / 0.45, 0, 1) * 0.45;
  } else if (localT < T_RELEASE) {
    // 3. Drape medal smoothly over the winner's bowed head onto their neck!
    phase = 'draping';
    presenter.root.position.set(target.standX, target.standY, target.standZ);
    presenter.root.rotation.y = Math.PI;

    const headHeightRel = target.runnerY + 1.85 - target.standY;
    const neckHeightRel = target.runnerY + 1.56 - target.standY;
    const reachZ = Math.max(0.56, Math.abs(target.standZ - target.runnerZ) * 0.92);

    if (localT < T_DRAPE_OVER) {
      // Lift medal up & forward directly above the winner's bowed head
      const u = THREE.MathUtils.smoothstep((localT - T_STEP_UP) / (T_DRAPE_OVER - T_STEP_UP), 0, 1);
      bowAmount = THREE.MathUtils.lerp(0.45, 1.0, u);
      presenter.bodyPivot.rotation.x = u * 0.12;
      presenter.headGroup.rotation.x = 0.08 * u;

      const armPitch = THREE.MathUtils.lerp(-1.95, -2.35, u);
      presenter.leftArmPivot.rotation.set(armPitch, 0.14, 0.22);
      presenter.rightArmPivot.rotation.set(armPitch, -0.14, -0.22);

      presenter.heldMedalAnchor.position.set(
        0,
        THREE.MathUtils.lerp(2.08, headHeightRel + 0.52, u),
        THREE.MathUtils.lerp(0.62, reachZ, u)
      );
      presenter.heldMedalAnchor.rotation.set(THREE.MathUtils.lerp(-0.22, 0.45, u), 0, 0);
      presenter.setActiveHeldMedal(tier);
    } else if (localT < T_DRAPE_LAND) {
      // Lower ribbon gently around the winner's head & settle onto their neck
      const u = THREE.MathUtils.smoothstep((localT - T_DRAPE_OVER) / (T_DRAPE_LAND - T_DRAPE_OVER), 0, 1);
      bowAmount = 1.0;
      presenter.bodyPivot.rotation.x = 0.12 + u * 0.06;
      presenter.headGroup.rotation.x = 0.12;

      const armPitch = THREE.MathUtils.lerp(-2.35, -1.55, u);
      presenter.leftArmPivot.rotation.set(armPitch, 0.16, 0.18);
      presenter.rightArmPivot.rotation.set(armPitch, -0.16, -0.18);

      presenter.heldMedalAnchor.position.set(
        0,
        THREE.MathUtils.lerp(headHeightRel + 0.52, neckHeightRel + 0.12, u),
        reachZ
      );
      presenter.heldMedalAnchor.rotation.set(THREE.MathUtils.lerp(0.45, 0.15, u), 0, 0);
      presenter.setActiveHeldMedal(tier);
    } else {
      // Medal has landed on winner's neck -> transfer to worn medal + presenter gracefully retracts hands!
      if (!awardedRanks.has(target.rank)) {
        awardedRanks.add(target.rank);
        newlyAwardedRank = target.rank;
      }
      const u = THREE.MathUtils.smoothstep((localT - T_DRAPE_LAND) / (T_RELEASE - T_DRAPE_LAND), 0, 1);
      bowAmount = Math.max(0, 1.0 - u * 1.35);
      presenter.bodyPivot.rotation.x = (1 - u) * 0.16;
      presenter.headGroup.rotation.x = (1 - u) * 0.1;

      const armPitch = THREE.MathUtils.lerp(-1.55, -0.55, u);
      presenter.leftArmPivot.rotation.set(armPitch, 0.16 * (1 - u), 0.14);
      presenter.rightArmPivot.rotation.set(armPitch, -0.16 * (1 - u), -0.14);
      presenter.setActiveHeldMedal(null);
    }
  } else {
    // 4. Step cleanly back down off the stairs & applaud the newly-medaled champion!
    phase = 'applauding';
    if (!awardedRanks.has(target.rank)) {
      awardedRanks.add(target.rank);
      newlyAwardedRank = target.rank;
    }
    presenter.setActiveHeldMedal(null);

    const stepDownDur = 0.52;
    const afterT = localT - T_RELEASE;

    if (afterT < stepDownDur) {
      const u = THREE.MathUtils.smoothstep(afterT / stepDownDur, 0, 1);
      presenter.root.position.set(
        target.standX,
        THREE.MathUtils.lerp(target.standY, floorY, u),
        THREE.MathUtils.lerp(target.standZ, walkZ, u)
      );
      presenter.root.rotation.y = Math.PI;
      const stride = Math.sin(u * Math.PI * 2);
      presenter.leftLegPivot.rotation.x = stride * 0.34;
      presenter.rightLegPivot.rotation.x = -stride * 0.34;
      presenter.leftArmPivot.rotation.set(-0.4, 0.12, 0.1);
      presenter.rightArmPivot.rotation.set(-0.4, -0.12, -0.1);
    } else {
      const clapT = afterT - stepDownDur;
      presenter.root.position.set(target.standX, floorY, walkZ);
      // Slight angled respect facing both winner and cameras
      presenter.root.rotation.y = Math.PI - 0.32;
      const clapClosed = 0.5 + 0.5 * Math.sin(clapT * 12.5);
      presenter.leftArmPivot.rotation.set(-1.02, 0.38 + clapClosed * 0.24, 0.12);
      presenter.rightArmPivot.rotation.set(-1.02, -(0.38 + clapClosed * 0.24), -0.12);
      presenter.headGroup.rotation.x = Math.sin(clapT * 5.2) * 0.1;
    }
  }

  return {
    phase,
    activeRank: target.rank,
    activeTier: tier,
    activeName: target.name,
    awardedRanks,
    newlyAwardedRank,
    bowingRank: bowAmount > 0.01 ? target.rank : null,
    bowAmount,
    focusPoint: {
      x: target.runnerX,
      y: target.runnerY + 1.42,
      z: (target.runnerZ + target.standZ) * 0.5,
    },
    progress01: Math.min(1, ceremonyTime / totalAwardsDuration),
  };
}
