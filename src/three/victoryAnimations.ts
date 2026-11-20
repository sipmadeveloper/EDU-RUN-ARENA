import * as THREE from 'three';

export type VictoryPlacementTier = 'first' | 'second' | 'third' | 'fourth' | 'finisher';

export type VictoryAnimMode =
  | 'victory_1st'
  | 'victory_2nd'
  | 'victory_3rd'
  | 'victory_4th'
  | 'victory_finisher';

export interface VictoryPlacementMeta {
  tier: VictoryPlacementTier;
  animMode: VictoryAnimMode;
  badge: string;
  title: string;
  subtitle: string;
  accentHex: string;
  ringColor: number;
  confettiIntensity: number;
}

export interface VictoryRigTarget {
  bodyPivot: THREE.Group;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  boostRing: THREE.Mesh;
  penaltyRing: THREE.Mesh;
  trophyGroup: THREE.Group;
}

const PLACEMENT_META: Record<VictoryPlacementTier, VictoryPlacementMeta> = {
  first: {
    tier: 'first',
    animMode: 'victory_1st',
    badge: 'JUARA 1',
    title: 'Selebrasi Juara & Angkat Piala',
    subtitle: 'Angkat piala emas dengan lompatan putar 360° penuh kemenangan',
    accentHex: '#FACC15',
    ringColor: 0xfacc15,
    confettiIntensity: 1.0,
  },
  second: {
    tier: 'second',
    animMode: 'victory_2nd',
    badge: 'JUARA 2',
    title: 'Salute Perak & Fist-Pump',
    subtitle: 'Kepalan tangan bergantian ke langit & sapaan bangga ke tribun',
    accentHex: '#CBD5E1',
    ringColor: 0xe2e8f0,
    confettiIntensity: 0.78,
  },
  third: {
    tier: 'third',
    animMode: 'victory_3rd',
    badge: 'JUARA 3',
    title: 'Gelombang Stadion Perunggu',
    subtitle: 'Lambaian tangan lebar berbentuk V & lompatan ceria berirama',
    accentHex: '#FB923C',
    ringColor: 0xf97316,
    confettiIntensity: 0.65,
  },
  fourth: {
    tier: 'fourth',
    animMode: 'victory_4th',
    badge: 'JUARA 4',
    title: 'Tepuk Tangan Kehormatan',
    subtitle: 'Apresiasi tepuk tangan penuh semangat & kepalan hormat podium',
    accentHex: '#38BDF8',
    ringColor: 0x38bdf8,
    confettiIntensity: 0.5,
  },
  finisher: {
    tier: 'finisher',
    animMode: 'victory_finisher',
    badge: 'FINISHER',
    title: 'Hormat Sportif & Lambaian Penonton',
    subtitle: 'Menarik napas lega lalu melambai hangat & bertepuk tangan untuk penonton',
    accentHex: '#34D399',
    ringColor: 0x34d399,
    confettiIntensity: 0.35,
  },
};

export function getVictoryTierForRank(rank: number | null | undefined): VictoryPlacementTier {
  if (rank === 1) return 'first';
  if (rank === 2) return 'second';
  if (rank === 3) return 'third';
  if (rank === 4) return 'fourth';
  return 'finisher';
}

export function getVictoryAnimModeForRank(rank: number | null | undefined): VictoryAnimMode {
  return PLACEMENT_META[getVictoryTierForRank(rank)].animMode;
}

export function getVictoryMetaForRank(rank: number | null | undefined): VictoryPlacementMeta {
  return PLACEMENT_META[getVictoryTierForRank(rank)];
}

export function isVictoryAnimMode(mode: string): mode is VictoryAnimMode {
  return (
    mode === 'victory_1st' ||
    mode === 'victory_2nd' ||
    mode === 'victory_3rd' ||
    mode === 'victory_4th' ||
    mode === 'victory_finisher'
  );
}

// Reusable pose buffer (zero GC per frame)
interface PoseValues {
  bodyY: number;
  bodyRotX: number;
  bodyRotY: number;
  bodyRotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  headRotX: number;
  headRotY: number;
  headRotZ: number;
  leftArmX: number;
  leftArmZ: number;
  rightArmX: number;
  rightArmZ: number;
  leftLegX: number;
  leftLegZ: number;
  rightLegX: number;
  rightLegZ: number;
  trophyY: number;
  trophyRotY: number;
  trophyRotZ: number;
  ringScale: number;
  snapBodyYaw: boolean;
}

const _pose: PoseValues = {
  bodyY: 0,
  bodyRotX: 0,
  bodyRotY: 0,
  bodyRotZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  headRotX: 0,
  headRotY: 0,
  headRotZ: 0,
  leftArmX: 0,
  leftArmZ: 0,
  rightArmX: 0,
  rightArmZ: 0,
  leftLegX: 0,
  leftLegZ: 0,
  rightLegX: 0,
  rightLegZ: 0,
  trophyY: 2.34,
  trophyRotY: 0,
  trophyRotZ: 0,
  ringScale: 1,
  snapBodyYaw: false,
};

function resetPoseBuffer() {
  _pose.bodyY = 0;
  _pose.bodyRotX = 0;
  _pose.bodyRotY = 0;
  _pose.bodyRotZ = 0;
  _pose.scaleX = 1;
  _pose.scaleY = 1;
  _pose.scaleZ = 1;
  _pose.headRotX = 0;
  _pose.headRotY = 0;
  _pose.headRotZ = 0;
  _pose.leftArmX = 0;
  _pose.leftArmZ = 0;
  _pose.rightArmX = 0;
  _pose.rightArmZ = 0;
  _pose.leftLegX = 0;
  _pose.leftLegZ = 0;
  _pose.rightLegX = 0;
  _pose.rightLegZ = 0;
  _pose.trophyY = 2.34;
  _pose.trophyRotY = 0;
  _pose.trophyRotZ = 0;
  _pose.ringScale = 1;
  _pose.snapBodyYaw = false;
}

function easeOutCubic(u: number): number {
  const c = 1 - Math.max(0, Math.min(1, u));
  return 1 - c * c * c;
}

function easeInOutQuad(u: number): number {
  const x = Math.max(0, Math.min(1, u));
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function evaluateFirstPlace(t: number) {
  // 4.6s champion loop:
  // [0.00 - 2.30]: Regal trophy hoist with power bounces & crowd gaze
  // [2.30 - 2.65]: Crouch anticipation before championship jump
  // [2.65 - 3.65]: High celebratory jump + full 360° victory spin hoisting trophy
  // [3.65 - 4.60]: Soft squash landing -> two emphatic double trophy thrusts
  const cycle = ((t % 4.6) + 4.6) % 4.6;

  if (cycle < 2.3) {
    const hoist = Math.sin(cycle * 5.2);
    const bounce = Math.abs(Math.sin(cycle * 4.4)) * 0.14;
    _pose.bodyY = bounce;
    _pose.bodyRotX = -0.07 - Math.max(0, hoist) * 0.04;
    _pose.bodyRotY = Math.sin(cycle * 2.1) * 0.18;
    _pose.bodyRotZ = Math.sin(cycle * 2.6) * 0.04;
    _pose.scaleX = 1 - bounce * 0.12;
    _pose.scaleY = 1 + bounce * 0.18;
    _pose.scaleZ = 1 - bounce * 0.12;
    _pose.leftArmX = -2.9 + hoist * 0.14;
    _pose.rightArmX = -2.9 + hoist * 0.14;
    // Inward grip onto the golden cup handles
    _pose.leftArmZ = 0.3;
    _pose.rightArmZ = -0.3;
    _pose.leftLegX = Math.sin(cycle * 4.4) * 0.08;
    _pose.rightLegX = -Math.sin(cycle * 4.4) * 0.08;
    _pose.headRotX = -0.14;
    _pose.headRotY = Math.sin(cycle * 2.5) * 0.24;
    _pose.trophyY = 2.38 + hoist * 0.1 + bounce * 0.25;
    _pose.trophyRotY = Math.sin(cycle * 2.4) * 0.28;
    _pose.ringScale = 1.06 + Math.sin(cycle * 7) * 0.14;
  } else if (cycle < 2.65) {
    // Spring crouch anticipation
    const u = (cycle - 2.3) / 0.35;
    const dip = Math.sin(u * Math.PI);
    _pose.bodyY = -0.04 * dip;
    _pose.bodyRotX = 0.12 * dip;
    _pose.scaleX = 1 + 0.1 * dip;
    _pose.scaleY = 1 - 0.13 * dip;
    _pose.scaleZ = 1 + 0.1 * dip;
    _pose.leftArmX = -2.55 + 0.2 * dip;
    _pose.rightArmX = -2.55 + 0.2 * dip;
    _pose.leftArmZ = 0.32;
    _pose.rightArmZ = -0.32;
    _pose.leftLegX = -0.22 * dip;
    _pose.rightLegX = 0.18 * dip;
    _pose.headRotX = -0.05;
    _pose.trophyY = 2.26 - 0.08 * dip;
    _pose.ringScale = 1.22;
  } else if (cycle < 3.65) {
    // High champion jump + 360° celebratory spin
    const u = (cycle - 2.65) / 1.0;
    const arc = Math.sin(u * Math.PI);
    const spin = easeInOutQuad(u) * Math.PI * 2;
    _pose.bodyY = arc * 0.62;
    _pose.bodyRotX = -0.1 * arc;
    _pose.bodyRotY = spin;
    _pose.snapBodyYaw = true;
    _pose.scaleX = 1 - 0.07 * arc;
    _pose.scaleY = 1 + 0.1 * arc;
    _pose.scaleZ = 1 - 0.07 * arc;
    _pose.leftArmX = -3.02;
    _pose.rightArmX = -3.02;
    _pose.leftArmZ = 0.26;
    _pose.rightArmZ = -0.26;
    _pose.leftLegX = 0.42 * arc;
    _pose.rightLegX = -0.36 * arc;
    _pose.leftLegZ = -0.1 * arc;
    _pose.rightLegZ = 0.1 * arc;
    _pose.headRotX = -0.2 * arc;
    _pose.trophyY = 2.46 + arc * 0.16;
    _pose.trophyRotY = spin * 0.5;
    _pose.ringScale = 1.15 + arc * 0.32;
  } else {
    // Squash landing + triumphant double trophy thrust
    const u = (cycle - 3.65) / 0.95;
    const landingSquash = u < 0.25 ? Math.sin((u / 0.25) * Math.PI) : 0;
    const thrust = Math.abs(Math.sin(u * Math.PI * 2));
    _pose.bodyY = thrust * 0.18 - landingSquash * 0.03;
    _pose.bodyRotX = -0.08 * thrust;
    _pose.bodyRotY = 0;
    _pose.scaleX = 1 + landingSquash * 0.12 - thrust * 0.04;
    _pose.scaleY = 1 - landingSquash * 0.14 + thrust * 0.06;
    _pose.scaleZ = 1 + landingSquash * 0.12 - thrust * 0.04;
    _pose.leftArmX = -2.75 - thrust * 0.28;
    _pose.rightArmX = -2.75 - thrust * 0.28;
    _pose.leftArmZ = 0.28;
    _pose.rightArmZ = -0.28;
    _pose.headRotX = -0.14 * thrust;
    _pose.headRotY = Math.sin(u * Math.PI * 2) * 0.16;
    _pose.trophyY = 2.34 + thrust * 0.22;
    _pose.trophyRotZ = Math.sin(u * Math.PI * 4) * 0.08;
    _pose.ringScale = 1.05 + thrust * 0.2;
  }
}

function evaluateSecondPlace(t: number) {
  // 3.8s silver medal celebration:
  // [0.00 - 2.10]: Energetic alternating skyward fist-pumps + upbeat rhythmic hops
  // [2.10 - 3.80]: Proud double fist-pump & left-right crowd salute
  const cycle = ((t % 3.8) + 3.8) % 3.8;

  if (cycle < 2.1) {
    const beat = cycle * 5.8;
    const alt = Math.sin(beat);
    const hop = Math.abs(Math.sin(beat)) * 0.24;
    const leftUp = alt > 0 ? alt : 0;
    const rightUp = alt < 0 ? -alt : 0;

    _pose.bodyY = hop;
    _pose.bodyRotX = -0.05;
    _pose.bodyRotY = -alt * 0.26;
    _pose.bodyRotZ = -alt * 0.07;
    _pose.scaleX = 1 - hop * 0.14;
    _pose.scaleY = 1 + hop * 0.22;
    _pose.scaleZ = 1 - hop * 0.14;

    // Alternating high fist punch & athletic guard
    _pose.leftArmX = -1.15 - leftUp * 1.85;
    _pose.leftArmZ = -0.16 - leftUp * 0.22;
    _pose.rightArmX = -1.15 - rightUp * 1.85;
    _pose.rightArmZ = 0.16 + rightUp * 0.22;

    _pose.leftLegX = alt * 0.22;
    _pose.rightLegX = -alt * 0.22;
    _pose.headRotY = alt * 0.2;
    _pose.headRotX = -0.08 - hop * 0.2;
    _pose.ringScale = 1.0 + hop * 0.5;
  } else {
    const u = (cycle - 2.1) / 1.7;
    const saluteSweep = Math.sin(u * Math.PI * 2);
    const doublePump = Math.pow(Math.abs(Math.sin(u * Math.PI * 2)), 0.7);
    const jump = Math.sin(u * Math.PI) * 0.18;

    _pose.bodyY = jump;
    _pose.bodyRotX = -0.09 * doublePump;
    _pose.bodyRotY = saluteSweep * 0.34;
    _pose.scaleX = 1 - jump * 0.12;
    _pose.scaleY = 1 + jump * 0.16;
    _pose.scaleZ = 1 - jump * 0.12;

    // Both fists raised high & wide in proud silver salute
    _pose.leftArmX = -2.45 - doublePump * 0.45;
    _pose.leftArmZ = -0.42 - doublePump * 0.16;
    _pose.rightArmX = -2.45 - doublePump * 0.45;
    _pose.rightArmZ = 0.42 + doublePump * 0.16;

    _pose.leftLegZ = -0.09;
    _pose.rightLegZ = 0.09;
    _pose.headRotY = saluteSweep * 0.26;
    _pose.headRotX = -0.12;
    _pose.ringScale = 1.04 + doublePump * 0.14;
  }
}

function evaluateThirdPlace(t: number) {
  // 3.2s bronze stadium wave & playful double-hop cheer:
  // Wide V-arms swaying overhead like a joyful stadium wave + upbeat double-hop heel kicks
  const cycle = ((t % 3.2) + 3.2) % 3.2;
  const wave = Math.sin(cycle * 5.2);

  // Double-hop accent in the second half of the cycle
  let hop = Math.abs(Math.sin(cycle * 3.9)) * 0.14;
  let kick = 0;
  if (cycle > 1.8 && cycle < 2.8) {
    const hu = (cycle - 1.8) / 1.0;
    hop = Math.abs(Math.sin(hu * Math.PI * 2)) * 0.34;
    kick = Math.sin(hu * Math.PI * 2);
  }

  _pose.bodyY = hop;
  _pose.bodyRotX = -0.04;
  _pose.bodyRotY = wave * 0.16;
  _pose.bodyRotZ = wave * 0.12;
  _pose.scaleX = 1 - hop * 0.15;
  _pose.scaleY = 1 + hop * 0.22;
  _pose.scaleZ = 1 - hop * 0.15;

  // Wide joyful V-arms overhead waving side-to-side in unison
  _pose.leftArmX = -2.84 + Math.sin(cycle * 5.2 + 0.5) * 0.14;
  _pose.rightArmX = -2.84 - Math.sin(cycle * 5.2 + 0.5) * 0.14;
  _pose.leftArmZ = -0.52 + wave * 0.34;
  _pose.rightArmZ = 0.52 + wave * 0.34;

  _pose.leftLegX = kick * 0.35 + wave * 0.1;
  _pose.rightLegX = -kick * 0.35 - wave * 0.1;
  _pose.headRotZ = -wave * 0.16;
  _pose.headRotY = wave * 0.18;
  _pose.headRotX = -0.08;
  _pose.ringScale = 0.98 + hop * 0.45;
}

function evaluateFourthPlace(t: number) {
  // 3.5s 4th-place podium honor celebration:
  // [0.00 - 2.00]: Enthusiastic forward applause claps + proud rhythmic bounce
  // [2.00 - 3.50]: Spirited right-arm victory pump + celebratory hop
  const cycle = ((t % 3.5) + 3.5) % 3.5;

  if (cycle < 2.0) {
    const clapWave = Math.abs(Math.sin(cycle * 9.4)); // crisp double-time clapping rhythm
    const bounce = Math.abs(Math.sin(cycle * 4.7)) * 0.11;

    _pose.bodyY = bounce;
    _pose.bodyRotX = 0.03;
    _pose.bodyRotY = Math.sin(cycle * 2.4) * 0.22;
    _pose.scaleX = 1 - bounce * 0.1;
    _pose.scaleY = 1 + bounce * 0.14;
    _pose.scaleZ = 1 - bounce * 0.1;

    // Arms held forward in front of chest clapping inward & outward cleanly
    _pose.leftArmX = -1.38 - clapWave * 0.08;
    _pose.rightArmX = -1.38 - clapWave * 0.08;
    _pose.leftArmZ = 0.18 + clapWave * 0.4;
    _pose.rightArmZ = -0.18 - clapWave * 0.4;

    _pose.leftLegX = Math.sin(cycle * 4.7) * 0.08;
    _pose.rightLegX = -Math.sin(cycle * 4.7) * 0.08;
    _pose.headRotX = Math.sin(cycle * 9.4) * 0.08;
    _pose.headRotY = Math.sin(cycle * 2.4) * 0.2;
    _pose.ringScale = 0.96 + clapWave * 0.12;
  } else {
    const u = (cycle - 2.0) / 1.5;
    const hop = Math.sin(u * Math.PI) * 0.26;
    const pump = Math.sin(u * Math.PI * 2);

    _pose.bodyY = hop;
    _pose.bodyRotX = -0.06;
    _pose.bodyRotY = -0.22 * Math.sin(u * Math.PI);
    _pose.bodyRotZ = -0.07 * Math.sin(u * Math.PI);
    _pose.scaleX = 1 - hop * 0.14;
    _pose.scaleY = 1 + hop * 0.2;
    _pose.scaleZ = 1 - hop * 0.14;

    // Right arm shoots diagonally skyward; left rests confidently at side/hip
    _pose.rightArmX = -2.75 - Math.max(0, pump) * 0.25;
    _pose.rightArmZ = 0.34 + pump * 0.14;
    _pose.leftArmX = 0.18;
    _pose.leftArmZ = -0.28;

    _pose.leftLegX = -0.18 * Math.sin(u * Math.PI);
    _pose.rightLegX = 0.22 * Math.sin(u * Math.PI);
    _pose.headRotX = -0.12;
    _pose.headRotY = 0.18 * Math.sin(u * Math.PI);
    _pose.ringScale = 1.0 + hop * 0.35;
  }
}

function evaluateFinisher(t: number) {
  // 5.0s dignified sportsmanship finish animation (5th+ placement):
  // [0.00 - 1.45]: Athletic catch-breath sway (hands near hips, proud determined nod)
  // [1.45 - 3.45]: Straightens up & gives a warm high right-hand wave to the crowd
  // [3.45 - 5.00]: Sportsmanlike applause cheering for the race & champions
  const cycle = ((t % 5.0) + 5.0) % 5.0;

  if (cycle < 1.45) {
    const u = cycle / 1.45;
    const breath = Math.sin(u * Math.PI * 2);
    const leanBlend = Math.sin(u * Math.PI);

    _pose.bodyY = Math.max(0, breath) * 0.03;
    _pose.bodyRotX = 0.13 * leanBlend;
    _pose.scaleX = 1 + breath * 0.03;
    _pose.scaleY = 1 - breath * 0.03;
    _pose.scaleZ = 1 + breath * 0.03;

    // Athletic hands-on-hips recovery stance
    _pose.leftArmX = 0.14;
    _pose.leftArmZ = -0.34;
    _pose.rightArmX = 0.14;
    _pose.rightArmZ = 0.34;

    _pose.leftLegZ = -0.07;
    _pose.rightLegZ = 0.07;
    _pose.headRotX = 0.1 * leanBlend + breath * 0.06;
    _pose.headRotY = Math.sin(u * Math.PI) * 0.14;
    _pose.ringScale = 0.92 + breath * 0.05;
  } else if (cycle < 3.45) {
    const u = (cycle - 1.45) / 2.0;
    const raise = easeOutCubic(Math.min(1, u * 3.5));
    const wave = Math.sin(cycle * 9.2);
    const bounce = Math.abs(Math.sin(cycle * 3.8)) * 0.09;

    _pose.bodyY = bounce;
    _pose.bodyRotX = -0.03;
    _pose.bodyRotY = Math.sin(u * Math.PI * 1.5) * 0.24;
    _pose.bodyRotZ = -0.05 * raise;

    // Warm high right-hand wave to fans & camera
    _pose.rightArmX = THREE.MathUtils.lerp(0.1, -2.74, raise);
    _pose.rightArmZ = THREE.MathUtils.lerp(0.3, 0.52 + wave * 0.32, raise);
    _pose.leftArmX = 0.06;
    _pose.leftArmZ = -0.18;

    _pose.headRotX = -0.06;
    _pose.headRotY = Math.sin(u * Math.PI * 2) * 0.22;
    _pose.headRotZ = 0.08 * raise;
    _pose.ringScale = 0.96 + Math.abs(wave) * 0.08;
  } else {
    const u = (cycle - 3.45) / 1.55;
    const clap = Math.abs(Math.sin(u * Math.PI * 5.0));
    const bounce = Math.abs(Math.sin(u * Math.PI * 2.5)) * 0.08;

    _pose.bodyY = bounce;
    _pose.bodyRotX = 0.02;
    _pose.bodyRotY = Math.sin(u * Math.PI * 2) * 0.14;

    _pose.leftArmX = -1.32;
    _pose.rightArmX = -1.32;
    _pose.leftArmZ = 0.16 + clap * 0.38;
    _pose.rightArmZ = -0.16 - clap * 0.38;

    _pose.headRotX = Math.sin(u * Math.PI * 5) * 0.07;
    _pose.headRotY = Math.sin(u * Math.PI) * 0.15;
    _pose.ringScale = 0.94 + clap * 0.1;
  }
}

export function applyPlacementVictoryAnimation(
  rig: VictoryRigTarget,
  elapsed: number,
  mode: VictoryAnimMode,
  phaseOffset = 0,
  dt?: number
) {
  const t = Math.max(0, elapsed + phaseOffset);
  resetPoseBuffer();

  let ringColor = 0x34d399;
  const showTrophy = mode === 'victory_1st';

  switch (mode) {
    case 'victory_1st':
      evaluateFirstPlace(t);
      ringColor = PLACEMENT_META.first.ringColor;
      break;
    case 'victory_2nd':
      evaluateSecondPlace(t);
      ringColor = PLACEMENT_META.second.ringColor;
      break;
    case 'victory_3rd':
      evaluateThirdPlace(t);
      ringColor = PLACEMENT_META.third.ringColor;
      break;
    case 'victory_4th':
      evaluateFourthPlace(t);
      ringColor = PLACEMENT_META.fourth.ringColor;
      break;
    case 'victory_finisher':
      evaluateFinisher(t);
      ringColor = PLACEMENT_META.finisher.ringColor;
      break;
  }

  // Ground halo ring colored by placement tier
  rig.penaltyRing.visible = false;
  rig.boostRing.visible = true;
  const ringMat = rig.boostRing.material as THREE.MeshBasicMaterial;
  if (ringMat && ringMat.color) {
    ringMat.color.setHex(ringColor);
  }
  rig.boostRing.scale.set(_pose.ringScale, _pose.ringScale, 1);

  // Trophy visibility (exclusive to 1st place champion)
  rig.trophyGroup.visible = showTrophy;

  const useDamp = typeof dt === 'number' && dt > 0 && dt < 0.2;
  const blend = 14;

  if (useDamp) {
    const d = dt as number;
    rig.bodyPivot.position.y = THREE.MathUtils.damp(rig.bodyPivot.position.y, _pose.bodyY, blend, d);
    rig.bodyPivot.rotation.x = THREE.MathUtils.damp(rig.bodyPivot.rotation.x, _pose.bodyRotX, blend, d);
    rig.bodyPivot.rotation.y = _pose.snapBodyYaw
      ? _pose.bodyRotY
      : THREE.MathUtils.damp(rig.bodyPivot.rotation.y, _pose.bodyRotY, blend, d);
    rig.bodyPivot.rotation.z = THREE.MathUtils.damp(rig.bodyPivot.rotation.z, _pose.bodyRotZ, blend, d);
    rig.bodyPivot.scale.set(
      THREE.MathUtils.damp(rig.bodyPivot.scale.x, _pose.scaleX, blend, d),
      THREE.MathUtils.damp(rig.bodyPivot.scale.y, _pose.scaleY, blend, d),
      THREE.MathUtils.damp(rig.bodyPivot.scale.z, _pose.scaleZ, blend, d)
    );

    rig.headGroup.rotation.x = THREE.MathUtils.damp(rig.headGroup.rotation.x, _pose.headRotX, blend, d);
    rig.headGroup.rotation.y = THREE.MathUtils.damp(rig.headGroup.rotation.y, _pose.headRotY, blend, d);
    rig.headGroup.rotation.z = THREE.MathUtils.damp(rig.headGroup.rotation.z, _pose.headRotZ, blend, d);

    rig.leftArmPivot.rotation.x = THREE.MathUtils.damp(rig.leftArmPivot.rotation.x, _pose.leftArmX, blend, d);
    rig.leftArmPivot.rotation.z = THREE.MathUtils.damp(rig.leftArmPivot.rotation.z, _pose.leftArmZ, blend, d);
    rig.rightArmPivot.rotation.x = THREE.MathUtils.damp(rig.rightArmPivot.rotation.x, _pose.rightArmX, blend, d);
    rig.rightArmPivot.rotation.z = THREE.MathUtils.damp(rig.rightArmPivot.rotation.z, _pose.rightArmZ, blend, d);

    rig.leftLegPivot.rotation.x = THREE.MathUtils.damp(rig.leftLegPivot.rotation.x, _pose.leftLegX, blend, d);
    rig.leftLegPivot.rotation.z = THREE.MathUtils.damp(rig.leftLegPivot.rotation.z, _pose.leftLegZ, blend, d);
    rig.rightLegPivot.rotation.x = THREE.MathUtils.damp(rig.rightLegPivot.rotation.x, _pose.rightLegX, blend, d);
    rig.rightLegPivot.rotation.z = THREE.MathUtils.damp(rig.rightLegPivot.rotation.z, _pose.rightLegZ, blend, d);

    if (showTrophy) {
      rig.trophyGroup.position.y = THREE.MathUtils.damp(rig.trophyGroup.position.y, _pose.trophyY, blend, d);
      rig.trophyGroup.rotation.y = _pose.snapBodyYaw
        ? _pose.trophyRotY
        : THREE.MathUtils.damp(rig.trophyGroup.rotation.y, _pose.trophyRotY, blend, d);
      rig.trophyGroup.rotation.z = THREE.MathUtils.damp(rig.trophyGroup.rotation.z, _pose.trophyRotZ, blend, d);
    }
  } else {
    rig.bodyPivot.position.y = _pose.bodyY;
    rig.bodyPivot.rotation.set(_pose.bodyRotX, _pose.bodyRotY, _pose.bodyRotZ);
    rig.bodyPivot.scale.set(_pose.scaleX, _pose.scaleY, _pose.scaleZ);

    rig.headGroup.rotation.set(_pose.headRotX, _pose.headRotY, _pose.headRotZ);

    rig.leftArmPivot.rotation.x = _pose.leftArmX;
    rig.leftArmPivot.rotation.z = _pose.leftArmZ;
    rig.rightArmPivot.rotation.x = _pose.rightArmX;
    rig.rightArmPivot.rotation.z = _pose.rightArmZ;

    rig.leftLegPivot.rotation.x = _pose.leftLegX;
    rig.leftLegPivot.rotation.z = _pose.leftLegZ;
    rig.rightLegPivot.rotation.x = _pose.rightLegX;
    rig.rightLegPivot.rotation.z = _pose.rightLegZ;

    if (showTrophy) {
      rig.trophyGroup.position.y = _pose.trophyY;
      rig.trophyGroup.rotation.y = _pose.trophyRotY;
      rig.trophyGroup.rotation.z = _pose.trophyRotZ;
    }
  }
}
