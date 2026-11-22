import * as THREE from 'three';
import {
  AVATAR_COLORS,
  type AvatarConfig,
  type AvatarPresetId,
  type RunnerEffectState,
} from '../types/game';
import {
  applyPlacementVictoryAnimation,
  isVictoryAnimMode,
  type VictoryAnimMode,
} from './victoryAnimations';

export type RunnerAnimMode =
  | 'idle'
  | 'walk'
  | RunnerEffectState
  | 'celebration'
  | 'trophy_lift'
  | VictoryAnimMode;

export interface BlockyRunnerRig {
  root: THREE.Group;
  bodyPivot: THREE.Group;
  headGroup: THREE.Group;
  leftArmPivot: THREE.Group;
  rightArmPivot: THREE.Group;
  leftLegPivot: THREE.Group;
  rightLegPivot: THREE.Group;
  boostRing: THREE.Mesh;
  penaltyRing: THREE.Mesh;
  trophyGroup: THREE.Group;
  nameSprite: THREE.Sprite;
  dispose: () => void;
}

function createSculptedTorsoGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.84, 0.9, 0.46, 10, 10, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = x / 0.42;
    const ny = y / 0.45;
    const nz = z / 0.23;

    // Superellipsoid pillow rounding removes all sharp cube edges while keeping UVs crisp
    const p = 3.2;
    const r = Math.pow(
      Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(ny), p) + Math.pow(Math.abs(nz), p),
      1 / p
    );
    const inv = r > 1e-4 ? 1 / r : 1;
    const blend = 0.78;
    let sx = x * (1 - blend + blend * inv);
    const sy = y * (1 - blend + blend * inv);
    let sz = z * (1 - blend + blend * inv);

    // Athletic V-taper: broader rounded shoulders tapering to a fitted waist + contoured chest
    const taperX = ny >= 0 ? 1 + ny * 0.08 : 1 + ny * 0.14;
    const chestCurve = ny >= -0.1 ? 1 + Math.cos((ny - 0.35) * 1.4) * 0.09 : 1 + ny * 0.07;
    sx *= taperX;
    sz *= chestCurve;

    pos.setXYZ(i, sx, sy, sz);
  }
  geo.computeVertexNormals();
  return geo;
}

function createSculptedHeadGeometry(spherify = 0.88): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(0.68, 0.68, 0.66, 12, 12, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = x / 0.34;
    const ny = y / 0.34;
    const nz = z / 0.33;

    const len = Math.hypot(nx, ny, nz) || 1;
    let sx = THREE.MathUtils.lerp(x, (nx / len) * 0.355, spherify);
    let sy = THREE.MathUtils.lerp(y, (ny / len) * 0.365, spherify);
    let sz = THREE.MathUtils.lerp(z, (nz / len) * 0.345, spherify);

    // Subtle stylized jawline & rounded cheeks for organic human silhouette
    if (spherify > 0.5 && sy < 0) {
      const chinT = Math.min(1, -sy / 0.36);
      const jawTaper = 1 - 0.14 * Math.pow(chinT, 1.55);
      sx *= jawTaper;
      sz *= 1 - 0.07 * Math.pow(chinT, 1.5);
    }
    // Gentle forehead/face smoothing so facial expressions read crisply without distortion
    if (spherify > 0.5 && sz > 0.25) {
      sz = 0.25 + (sz - 0.25) * 0.88;
    }

    pos.setXYZ(i, sx, sy, sz);
  }
  geo.computeVertexNormals();
  return geo;
}

function createTeardropHairGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(0.14, 0.08),
    new THREE.Vector2(0.24, 0.28),
    new THREE.Vector2(0.22, 0.56),
    new THREE.Vector2(0.13, 0.82),
    new THREE.Vector2(0.001, 1.0),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.translate(0, -0.5, 0);
  return geo;
}

function createAthleticCalfGeo(topR: number, midR: number, ankleR: number, height: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(ankleR, 0),
    new THREE.Vector2(ankleR * 1.06, height * 0.2),
    new THREE.Vector2(midR, height * 0.58),
    new THREE.Vector2(topR, height * 0.88),
    new THREE.Vector2(topR * 0.94, height),
  ];
  const geo = new THREE.LatheGeometry(pts, 14);
  geo.translate(0, -height / 2, 0);
  return geo;
}

function createSneakerUpperGeo(): THREE.BufferGeometry {
  // Aerodynamic rounded running sneaker silhouette (smooth toe box + ankle heel curve)
  const geo = new THREE.SphereGeometry(0.22, 16, 12);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    // Elongate forward into sneaker profile
    x *= 0.72;
    z *= 1.12;
    if (y < 0) {
      // Flatten underside cleanly onto midsole
      y *= 0.28;
    } else {
      y *= 0.62;
      // Sleek tapered aerodynamic toe slope toward +Z
      if (z > 0.03) {
        const toeT = Math.min(1, (z - 0.03) / 0.22);
        y *= 1 - toeT * 0.34;
        x *= 1 - toeT * 0.14;
      }
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

function createSneakerSoleGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = 0.165;
  const back = -0.21;
  const front = 0.25;
  shape.moveTo(-w * 0.82, back + 0.06);
  shape.quadraticCurveTo(-w * 0.85, back, 0, back);
  shape.quadraticCurveTo(w * 0.85, back, w * 0.82, back + 0.06);
  shape.lineTo(w, front - 0.1);
  shape.quadraticCurveTo(w * 0.9, front, 0, front);
  shape.quadraticCurveTo(-w * 0.9, front, -w, front - 0.1);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.048,
    bevelEnabled: true,
    bevelThickness: 0.014,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 10,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0.028, 0);
  geo.computeVertexNormals();
  return geo;
}

// Shared high-craft sculpted geometries (allocated once, shared by all 30+ runners -> zero lag)
const SHARED_BOX = new THREE.BoxGeometry(1, 1, 1);
const SHARED_CYL = new THREE.CylinderGeometry(1, 1, 1, 14);
const SHARED_SPHERE = new THREE.SphereGeometry(1, 14, 12);
const SHARED_CAPSULE = new THREE.CapsuleGeometry(0.5, 1, 6, 12);
const SHARED_CONE = new THREE.ConeGeometry(1, 1, 12);
const SHARED_TORSO = createSculptedTorsoGeometry();
const SHARED_HEAD_ORGANIC = createSculptedHeadGeometry(0.88);
const SHARED_HEAD_ROUNDED_BOX = createSculptedHeadGeometry(0.28);
const SHARED_NECK = new THREE.CylinderGeometry(0.125, 0.155, 0.18, 14);
const SHARED_WAIST = new THREE.CylinderGeometry(0.36, 0.35, 0.2, 16);
const SHARED_SHOULDER = new THREE.SphereGeometry(0.148, 14, 12);
const SHARED_UPPER_ARM = new THREE.CylinderGeometry(0.132, 0.112, 0.32, 14);
const SHARED_ELBOW = new THREE.SphereGeometry(0.11, 12, 10);
const SHARED_FOREARM = new THREE.CylinderGeometry(0.108, 0.088, 0.34, 14);
const SHARED_HAND = new THREE.SphereGeometry(0.105, 12, 10);
const SHARED_WRISTBAND = new THREE.CylinderGeometry(0.104, 0.104, 0.085, 14);
const SHARED_HIP_CAP = new THREE.SphereGeometry(0.155, 12, 10);
const SHARED_THIGH = new THREE.CylinderGeometry(0.155, 0.13, 0.32, 14);
const SHARED_KNEE = new THREE.SphereGeometry(0.124, 12, 10);
const SHARED_CALF = createAthleticCalfGeo(0.124, 0.132, 0.088, 0.34);
const SHARED_BOOT_SHIN = createAthleticCalfGeo(0.146, 0.142, 0.122, 0.34);
const SHARED_SHOE_UPPER = createSneakerUpperGeo();
const SHARED_SHOE_SOLE = createSneakerSoleGeo();
const SHARED_SHOE_COLLAR = new THREE.CylinderGeometry(0.102, 0.116, 0.08, 12);
const SHARED_HAIR_DOME = new THREE.SphereGeometry(0.368, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56);
const SHARED_HAIR_STRAND = createTeardropHairGeo();
const SHARED_HEADBAND_RING = new THREE.TorusGeometry(0.352, 0.042, 10, 24);
const SHARED_CAP_DOME = new THREE.SphereGeometry(0.365, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
const SHARED_CAP_VISOR = new THREE.CylinderGeometry(0.36, 0.39, 0.045, 16, 1, false, -Math.PI * 0.36, Math.PI * 0.72);
const SHARED_HEADPHONE_ARCH = new THREE.TorusGeometry(0.395, 0.028, 8, 24, Math.PI);
const SHARED_EAR_CUP = new THREE.CylinderGeometry(0.118, 0.118, 0.085, 16);
const SHARED_EAR_PAD = new THREE.TorusGeometry(0.102, 0.026, 8, 16);
const SHARED_BEANIE_CUFF = new THREE.TorusGeometry(0.358, 0.058, 10, 24);
const SHARED_GOGGLE_RING = new THREE.TorusGeometry(0.095, 0.022, 8, 18);
const SHARED_PIRATE_BRIM = new THREE.CylinderGeometry(0.49, 0.45, 0.07, 18);
const SHARED_RING_GEO = new THREE.RingGeometry(0.62, 0.88, 28);
const SHARED_SHADOW_GEO = new THREE.CircleGeometry(0.58, 20);
const SHARED_SHOE_SOLE_MAT = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.48,
  metalness: 0.05,
});
const SHARED_BOOST_MAT = new THREE.MeshBasicMaterial({
  color: 0x06b6d4,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.85,
});
const SHARED_PENALTY_MAT = new THREE.MeshBasicMaterial({
  color: 0xef4444,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.75,
});
const SHARED_SHADOW_MAT = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});
const SHARED_TROPHY_PLINTH = new THREE.CylinderGeometry(0.17, 0.21, 0.1, 16);
const SHARED_TROPHY_COLLAR = new THREE.CylinderGeometry(0.11, 0.13, 0.05, 14);
const SHARED_TROPHY_STEM = new THREE.CylinderGeometry(0.05, 0.08, 0.16, 12);
const SHARED_TROPHY_CUP = new THREE.CylinderGeometry(0.26, 0.11, 0.34, 16);
const SHARED_TROPHY_RIM = new THREE.TorusGeometry(0.26, 0.028, 10, 20);
const SHARED_TROPHY_HANDLE = new THREE.TorusGeometry(0.13, 0.026, 10, 14, Math.PI);
const SHARED_TROPHY_STAR = new THREE.OctahedronGeometry(0.085, 0);
const SHARED_TROPHY_BASE_MAT = new THREE.MeshStandardMaterial({
  color: 0x3b1f0e,
  roughness: 0.45,
  metalness: 0.15,
});
const SHARED_TROPHY_GOLD_MAT = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  roughness: 0.18,
  metalness: 0.88,
  emissive: 0xca8a04,
  emissiveIntensity: 0.28,
});
const SHARED_TROPHY_GLOW_MAT = new THREE.MeshStandardMaterial({
  color: 0xfef08a,
  roughness: 0.12,
  metalness: 0.9,
  emissive: 0xfde047,
  emissiveIntensity: 0.5,
});

function getColorHex(colorId: string): string {
  return AVATAR_COLORS.find((c) => c.id === colorId)?.hex || '#2563EB';
}

interface PresetAppearance {
  skinHex: string;
  hairHex: string;
  hairStyle:
    | 'short'
    | 'ponytail'
    | 'spiky_blue'
    | 'long_orange'
    | 'parted_brown'
    | 'green_mohawk'
    | 'fluffy_under_cap'
    | 'long_wavy_brown'
    | 'bacon'
    | 'long_pink'
    | 'messy_black'
    | 'fluffy_brown'
    | 'long_blonde'
    | 'long_dark_bangs'
    | 'orange_bob'
    | 'none';
  hatStyle:
    | 'headband'
    | 'cyber_goggles'
    | 'pirate_tricorn_captain'
    | 'cap_headphones'
    | 'black_beanie'
    | 'pink_neko'
    | 'forehead_shades'
    | 'skater_cap'
    | 'knight_helm'
    | 'cardboard_antenna'
    | 'hard_hat'
    | 'pirate_tricorn_girl'
    | 'none';
  faceKind:
    | 'classic'
    | 'female_classic'
    | 'cyber_mask'
    | 'happy_eyes'
    | 'shades'
    | 'open_grin'
    | 'smirk'
    | 'knight_visor'
    | 'cardboard_face'
    | 'noob_face';
  sleeveUpperHex: string;
  sleeveLowerHex: string;
  gloveHex?: string;
  stripedSleeves?: boolean;
  cardboardRibs?: boolean;
  puffedShouldersHex?: string;
  shortsHex: string;
  shinHex: string;
  shoeHex: string;
  bootHeight?: 'short' | 'tall';
  pantsStripeHex?: string;
  shoeStripeHex?: string;
  backpackHex?: string;
  handProp?: 'none' | 'flashlight' | 'gold_sword' | 'hammer' | 'cutlass';
  metalness?: number;
}

const PRESET_SPECS: Record<Exclude<AvatarPresetId, 'custom'>, PresetAppearance> = {
  cyber_racer: {
    skinHex: '#E5B089',
    hairHex: '#8B6B4A',
    hairStyle: 'ponytail',
    hatStyle: 'cyber_goggles',
    faceKind: 'cyber_mask',
    sleeveUpperHex: '#F8FAFC',
    sleeveLowerHex: '#DC2626',
    gloveHex: '#F8FAFC',
    shortsHex: '#1E293B',
    shinHex: '#DC2626',
    shoeHex: '#DC2626',
    shoeStripeHex: '#F8FAFC',
    bootHeight: 'tall',
    metalness: 0.28,
  },
  striker_blue_red: {
    skinHex: '#D2996C',
    hairHex: '#1D4ED8',
    hairStyle: 'spiky_blue',
    hatStyle: 'none',
    faceKind: 'classic',
    sleeveUpperHex: '#1D4ED8',
    sleeveLowerHex: '#D2996C',
    shortsHex: '#1D4ED8',
    shinHex: '#DC2626',
    shoeHex: '#DC2626',
    shoeStripeHex: '#FFFFFF',
  },
  pirate_captain: {
    skinHex: '#F6C8A5',
    hairHex: '#EA580C',
    hairStyle: 'long_orange',
    hatStyle: 'pirate_tricorn_captain',
    faceKind: 'smirk',
    sleeveUpperHex: '#1E293B',
    sleeveLowerHex: '#1E293B',
    gloveHex: '#5C3A21',
    shortsHex: '#1E293B',
    shinHex: '#78350F',
    shoeHex: '#78350F',
    bootHeight: 'tall',
  },
  explorer_flashlight: {
    skinHex: '#D89C70',
    hairHex: '#291911',
    hairStyle: 'parted_brown',
    hatStyle: 'none',
    faceKind: 'open_grin',
    sleeveUpperHex: '#3B82F6',
    sleeveLowerHex: '#D89C70',
    shortsHex: '#1E3A5F',
    shinHex: '#1E3A5F',
    shoeHex: '#64748B',
    shoeStripeHex: '#FFFFFF',
    backpackHex: '#1E293B',
    handProp: 'flashlight',
  },
  punk_mohawk: {
    skinHex: '#D89C70',
    hairHex: '#0D9488',
    hairStyle: 'green_mohawk',
    hatStyle: 'none',
    faceKind: 'smirk',
    sleeveUpperHex: '#111827',
    sleeveLowerHex: '#111827',
    gloveHex: '#1F2937',
    shortsHex: '#334155',
    shinHex: '#334155',
    shoeHex: '#292524',
    bootHeight: 'short',
  },
  street_cap_white: {
    skinHex: '#F6C8A5',
    hairHex: '#3B2314',
    hairStyle: 'fluffy_under_cap',
    hatStyle: 'cap_headphones',
    faceKind: 'classic',
    sleeveUpperHex: '#E2E8F0',
    sleeveLowerHex: '#E2E8F0',
    gloveHex: '#F6C8A5',
    shortsHex: '#CBD5E1',
    shinHex: '#CBD5E1',
    shoeHex: '#FFFFFF',
  },
  alt_beanie_girl: {
    skinHex: '#F6C8A5',
    hairHex: '#3B2314',
    hairStyle: 'long_wavy_brown',
    hatStyle: 'black_beanie',
    faceKind: 'happy_eyes',
    sleeveUpperHex: '#111827',
    sleeveLowerHex: '#111827',
    stripedSleeves: true,
    shortsHex: '#111827',
    shinHex: '#334155',
    shoeHex: '#FFFFFF',
  },
  bacon_classic: {
    skinHex: '#F6C8A5',
    hairHex: '#9A5B25',
    hairStyle: 'bacon',
    hatStyle: 'none',
    faceKind: 'classic',
    sleeveUpperHex: '#111827',
    sleeveLowerHex: '#111827',
    gloveHex: '#F6C8A5',
    shortsHex: '#2F3E34',
    shinHex: '#2F3E34',
    shoeHex: '#111827',
    shoeStripeHex: '#FFFFFF',
  },
  pink_neko_girl: {
    skinHex: '#FDE2D2',
    hairHex: '#F9A8D4',
    hairStyle: 'long_pink',
    hatStyle: 'pink_neko',
    faceKind: 'happy_eyes',
    sleeveUpperHex: '#FBCFE8',
    sleeveLowerHex: '#FBCFE8',
    gloveHex: '#FDE2D2',
    shortsHex: '#FBCFE8',
    shinHex: '#FBCFE8',
    shoeHex: '#FFFFFF',
  },
  shades_goth_boy: {
    skinHex: '#F6C8A5',
    hairHex: '#0F172A',
    hairStyle: 'messy_black',
    hatStyle: 'forehead_shades',
    faceKind: 'shades',
    sleeveUpperHex: '#111827',
    sleeveLowerHex: '#111827',
    gloveHex: '#F6C8A5',
    shortsHex: '#0F172A',
    shinHex: '#0F172A',
    shoeHex: '#111827',
    shoeStripeHex: '#CBD5E1',
  },
  red_hoodie_boy: {
    skinHex: '#F6C8A5',
    hairHex: '#0F172A',
    hairStyle: 'messy_black',
    hatStyle: 'none',
    faceKind: 'open_grin',
    sleeveUpperHex: '#DC2626',
    sleeveLowerHex: '#DC2626',
    gloveHex: '#F6C8A5',
    shortsHex: '#111827',
    shinHex: '#111827',
    shoeHex: '#FFFFFF',
  },
  black_jacket_boy: {
    skinHex: '#F6C8A5',
    hairHex: '#6B3E26',
    hairStyle: 'fluffy_brown',
    hatStyle: 'none',
    faceKind: 'classic',
    sleeveUpperHex: '#111827',
    sleeveLowerHex: '#111827',
    gloveHex: '#F6C8A5',
    shortsHex: '#1E293B',
    shinHex: '#1E293B',
    pantsStripeHex: '#FFFFFF',
    shoeHex: '#FFFFFF',
  },
  blonde_cozy_girl: {
    skinHex: '#FDE2D2',
    hairHex: '#FDE047',
    hairStyle: 'long_blonde',
    hatStyle: 'none',
    faceKind: 'happy_eyes',
    sleeveUpperHex: '#FEF3C7',
    sleeveLowerHex: '#FEF3C7',
    gloveHex: '#FDE2D2',
    shortsHex: '#D6C29F',
    shinHex: '#D6C29F',
    shoeHex: '#FFFFFF',
  },
  skater_cap_girl: {
    skinHex: '#F6C8A5',
    hairHex: '#1F1714',
    hairStyle: 'long_dark_bangs',
    hatStyle: 'skater_cap',
    faceKind: 'happy_eyes',
    sleeveUpperHex: '#111827',
    sleeveLowerHex: '#111827',
    gloveHex: '#F6C8A5',
    shortsHex: '#334155',
    shinHex: '#334155',
    shoeHex: '#111827',
    shoeStripeHex: '#FFFFFF',
  },
  gold_knight: {
    skinHex: '#FACC15',
    hairHex: '#DC2626',
    hairStyle: 'none',
    hatStyle: 'knight_helm',
    faceKind: 'knight_visor',
    sleeveUpperHex: '#DC2626',
    sleeveLowerHex: '#FACC15',
    gloveHex: '#FACC15',
    shortsHex: '#DC2626',
    shinHex: '#FACC15',
    shoeHex: '#FACC15',
    bootHeight: 'tall',
    handProp: 'gold_sword',
    metalness: 0.55,
  },
  cardboard_bot: {
    skinHex: '#C28E5C',
    hairHex: '#C28E5C',
    hairStyle: 'none',
    hatStyle: 'cardboard_antenna',
    faceKind: 'cardboard_face',
    sleeveUpperHex: '#94A3B8',
    sleeveLowerHex: '#94A3B8',
    gloveHex: '#111827',
    cardboardRibs: true,
    shortsHex: '#94A3B8',
    shinHex: '#94A3B8',
    shoeHex: '#DC2626',
    shoeStripeHex: '#FFFFFF',
  },
  builder_man: {
    skinHex: '#F9D5B8',
    hairHex: '#4B5563',
    hairStyle: 'none',
    hatStyle: 'hard_hat',
    faceKind: 'classic',
    sleeveUpperHex: '#4B5563',
    sleeveLowerHex: '#4B5563',
    gloveHex: '#F9D5B8',
    shortsHex: '#1E40AF',
    shinHex: '#1E40AF',
    shoeHex: '#111827',
    shoeStripeHex: '#FFFFFF',
    handProp: 'hammer',
  },
  red_pirate_girl: {
    skinHex: '#F6C8A5',
    hairHex: '#EA580C',
    hairStyle: 'orange_bob',
    hatStyle: 'pirate_tricorn_girl',
    faceKind: 'female_classic',
    sleeveUpperHex: '#FFFFFF',
    sleeveLowerHex: '#FFFFFF',
    gloveHex: '#F6C8A5',
    puffedShouldersHex: '#1D4ED8',
    shortsHex: '#1D4ED8',
    shinHex: '#78350F',
    shoeHex: '#78350F',
    bootHeight: 'tall',
    handProp: 'cutlass',
  },
  classic_noob: {
    skinHex: '#FACC15',
    hairHex: '#FACC15',
    hairStyle: 'none',
    hatStyle: 'none',
    faceKind: 'noob_face',
    sleeveUpperHex: '#FACC15',
    sleeveLowerHex: '#FACC15',
    gloveHex: '#FACC15',
    shortsHex: '#65A30D',
    shinHex: '#65A30D',
    shoeHex: '#65A30D',
  },
};

function createJerseyTexture(
  primaryHex: string,
  outfit: string,
  bibNumber: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, 256, 256);

  if (outfit === 'varsity') {
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, 256, 36);
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(0, 36, 256, 10);
    ctx.fillRect(0, 224, 256, 14);
  } else if (outfit === 'pro') {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(0, 120);
    ctx.lineTo(256, 40);
    ctx.lineTo(256, 85);
    ctx.lineTo(0, 165);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#06B6D4';
    ctx.fillRect(0, 232, 256, 24);
  } else if (outfit === 'champion') {
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(0, 0, 256, 22);
    ctx.fillRect(0, 234, 256, 22);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
    ctx.fillRect(108, 0, 40, 256);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, 220, 256, 36);
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(58, 72, 140, 108);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 6;
  ctx.strokeRect(58, 72, 140, 108);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(bibNumber).padStart(2, '0'), 128, 128);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createPresetTorsoTexture(presetId: Exclude<AvatarPresetId, 'custom'>): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  switch (presetId) {
    case 'cyber_racer': {
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, 256, 256);
      // White upper collar & red chest armor plates
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(0, 0, 256, 30);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(22, 38, 98, 76);
      ctx.fillRect(136, 38, 98, 76);
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(18, 128, 220, 14);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(26, 152, 204, 62);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 224, 256, 32);
      break;
    }
    case 'striker_blue_red': {
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#DC2626' : '#1D4ED8';
        ctx.fillRect(i * (256 / 6), 0, 256 / 6 + 1, 256);
      }
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 0, 256, 18);
      break;
    }
    case 'pirate_captain': {
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, 256, 256);
      // Red pirate vest
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(64, 28, 128, 170);
      // Grey/blue scarf neck
      ctx.fillStyle = '#475569';
      ctx.fillRect(42, 0, 172, 48);
      // Gold button
      ctx.fillStyle = '#FACC15';
      ctx.beginPath();
      ctx.arc(154, 132, 14, 0, Math.PI * 2);
      ctx.fill();
      // Wide black belt & silver buckle
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 194, 256, 48);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(92, 190, 72, 54);
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(108, 204, 40, 26);
      break;
    }
    case 'explorer_flashlight': {
      ctx.fillStyle = '#3B82F6';
      ctx.fillRect(0, 0, 256, 256);
      // Dark backpack straps
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(32, 0, 26, 220);
      ctx.fillRect(198, 0, 26, 220);
      // Red circular emblem on chest
      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.arc(128, 108, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(128, 108, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(114, 102, 28, 12);
      // Belt
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 206, 256, 42);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(98, 204, 60, 44);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(112, 214, 32, 24);
      break;
    }
    case 'punk_mohawk': {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 256, 256);
      // Biker jacket lapels
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(72, 12, 112, 190);
      // Diagonal silver chest strap
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(220, 0);
      ctx.lineTo(36, 220);
      ctx.stroke();
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(108, 96, 36, 28);
      // Belt
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 204, 256, 44);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(102, 206, 52, 40);
      break;
    }
    case 'street_cap_white': {
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(74, 24, 108, 232);
      // Hoodie zipper & backpack straps
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(124, 24, 8, 232);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(28, 0, 22, 256);
      ctx.fillRect(206, 0, 22, 256);
      break;
    }
    case 'alt_beanie_girl': {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 256, 256);
      // Skin chest neckline
      ctx.fillStyle = '#F6C8A5';
      ctx.fillRect(64, 0, 128, 44);
      // White star emblem on chest
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 92px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', 128, 128);
      // Belt trim
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(0, 222, 256, 16);
      break;
    }
    case 'bacon_classic': {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 256, 256);
      // Bright cyan-blue graphic tee inside open black jacket
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(66, 0, 124, 256);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(96, 86, 64, 64);
      ctx.fillStyle = '#38BDF8';
      ctx.fillRect(110, 100, 36, 36);
      break;
    }
    case 'pink_neko_girl': {
      ctx.fillStyle = '#FBCFE8';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(76, 14, 104, 242);
      ctx.fillStyle = '#F472B6';
      ctx.fillRect(76, 14, 10, 242);
      ctx.fillRect(170, 14, 10, 242);
      ctx.fillStyle = '#F9A8D4';
      ctx.fillRect(98, 72, 60, 88);
      break;
    }
    case 'shades_goth_boy': {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#E2E8F0';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(64, 90);
      ctx.lineTo(192, 90);
      ctx.moveTo(128, 52);
      ctx.lineTo(128, 178);
      ctx.moveTo(82, 134);
      ctx.lineTo(174, 134);
      ctx.stroke();
      break;
    }
    case 'red_hoodie_boy': {
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(0, 0, 256, 256);
      // Black backpack straps + silver waist buckle
      ctx.fillStyle = '#111827';
      ctx.fillRect(36, 0, 28, 256);
      ctx.fillRect(192, 0, 28, 256);
      ctx.fillRect(124, 0, 8, 200);
      ctx.fillRect(0, 198, 256, 34);
      ctx.fillStyle = '#E2E8F0';
      ctx.fillRect(102, 196, 52, 38);
      break;
    }
    case 'black_jacket_boy': {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 256, 256);
      // White inner t-shirt
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(74, 0, 108, 256);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(112, 48, 32, 38);
      break;
    }
    case 'blonde_cozy_girl': {
      ctx.fillStyle = '#FEF3C7';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#E7D3B5';
      ctx.fillRect(74, 0, 108, 256);
      ctx.fillStyle = '#92400E';
      ctx.fillRect(116, 40, 24, 14);
      ctx.fillStyle = '#D97706';
      ctx.fillRect(116, 110, 24, 14);
      break;
    }
    case 'skater_cap_girl': {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(68, 0, 120, 256);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(96, 86, 64, 52);
      // Diagonal crossbody strap
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 20;
      ctx.beginPath();
      ctx.moveTo(40, 0);
      ctx.lineTo(220, 230);
      ctx.stroke();
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(0, 218, 256, 38);
      break;
    }
    case 'gold_knight': {
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#DC2626';
      ctx.fillRect(24, 24, 208, 176);
      ctx.strokeStyle = '#FACC15';
      ctx.lineWidth = 14;
      ctx.strokeRect(24, 24, 208, 176);
      // Gold chest crest
      ctx.fillStyle = '#FACC15';
      ctx.fillRect(116, 24, 24, 176);
      ctx.fillRect(24, 96, 208, 24);
      // Red waist sash
      ctx.fillStyle = '#991B1B';
      ctx.fillRect(0, 202, 256, 54);
      break;
    }
    case 'cardboard_bot': {
      ctx.fillStyle = '#C28E5C';
      ctx.fillRect(0, 0, 256, 256);
      // Cardboard corrugation lines
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      for (let x = 0; x < 256; x += 12) ctx.fillRect(x, 0, 4, 256);
      ctx.strokeStyle = '#7C532E';
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, 236, 236);
      // 4 black buttons
      ctx.fillStyle = '#111827';
      [68, 106, 148, 186].forEach((bx) => {
        ctx.beginPath();
        ctx.arc(bx, 58, 12, 0, Math.PI * 2);
        ctx.fill();
      });
      // White semi-circle dial gauge + "AOD" marker label
      ctx.fillStyle = '#F8FAFC';
      ctx.beginPath();
      ctx.arc(128, 142, 48, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(128, 142);
      ctx.lineTo(156, 114);
      ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AOD', 128, 204);
      break;
    }
    case 'builder_man': {
      ctx.fillStyle = '#4B5563';
      ctx.fillRect(0, 0, 256, 256);
      // Red inner collar
      ctx.fillStyle = '#DC2626';
      ctx.beginPath();
      ctx.moveTo(86, 0);
      ctx.lineTo(170, 0);
      ctx.lineTo(128, 66);
      ctx.closePath();
      ctx.fill();
      // Hoodie zipper & pockets
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(124, 66, 8, 190);
      ctx.fillStyle = '#374151';
      ctx.fillRect(24, 174, 82, 58);
      ctx.fillRect(150, 174, 82, 58);
      break;
    }
    case 'red_pirate_girl': {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 256, 256);
      // Dark pirate vest sides
      ctx.fillStyle = '#1E293B';
      ctx.fillRect(0, 0, 62, 200);
      ctx.fillRect(194, 0, 62, 200);
      // Polka-dot neck scarf
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(58, 0, 140, 56);
      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(70 + i * 22, 16 + (i % 2) * 18, 8, 8);
      }
      // Diagonal brown leather sash & big silver buckle
      ctx.strokeStyle = '#78350F';
      ctx.lineWidth = 28;
      ctx.beginPath();
      ctx.moveTo(220, 0);
      ctx.lineTo(40, 210);
      ctx.stroke();
      ctx.fillStyle = '#78350F';
      ctx.fillRect(0, 196, 256, 48);
      ctx.fillStyle = '#CBD5E1';
      ctx.fillRect(92, 192, 72, 54);
      ctx.fillStyle = '#78350F';
      ctx.fillRect(108, 206, 40, 26);
      break;
    }
    case 'classic_noob': {
      ctx.fillStyle = '#0284C7';
      ctx.fillRect(0, 0, 256, 256);
      break;
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function drawStylizedNose(
  ctx: CanvasRenderingContext2D,
  style: 'standard' | 'marker' | 'noob' = 'standard'
) {
  ctx.save();
  if (style === 'marker') {
    // Crisp marker-drawn nose for cardboard robot
    ctx.fillStyle = '#5C3A1E';
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(128, 124);
    ctx.lineTo(116, 150);
    ctx.lineTo(140, 150);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'noob') {
    // Playful bold cartoon nose for classic noob
    ctx.fillStyle = 'rgba(180, 118, 22, 0.34)';
    ctx.beginPath();
    ctx.ellipse(128, 134, 11, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#78350F';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 132, 9, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else {
    // Soft warm bridge highlight + clear curved nose contour & subtle nostrils
    ctx.fillStyle = 'rgba(130, 68, 36, 0.24)';
    ctx.beginPath();
    ctx.ellipse(128, 137, 11, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(104, 52, 26, 0.82)';
    ctx.lineWidth = 5.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(128, 121);
    ctx.quadraticCurveTo(134, 132, 128, 139);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(128, 134, 9.5, 0.22 * Math.PI, 0.78 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = 'rgba(92, 44, 20, 0.65)';
    ctx.beginPath();
    ctx.arc(122.5, 140.5, 2.2, 0, Math.PI * 2);
    ctx.arc(133.5, 140.5, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawExpressiveEyes(ctx: CanvasRenderingContext2D, centerY = 108, irisHex = '#3B82F6') {
  // Eyebrows
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(62, centerY - 34);
  ctx.quadraticCurveTo(84, centerY - 44, 104, centerY - 36);
  ctx.moveTo(194, centerY - 34);
  ctx.quadraticCurveTo(172, centerY - 44, 152, centerY - 36);
  ctx.stroke();

  for (const ex of [84, 172]) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.ellipse(ex, centerY, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.ellipse(ex, centerY, 14, 19, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = irisHex;
    ctx.beginPath();
    ctx.arc(ex, centerY + 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex - 5, centerY - 8, 5.2, 0, Math.PI * 2);
    ctx.arc(ex + 5, centerY + 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function createPresetFaceTexture(
  skinHex: string,
  faceKind: PresetAppearance['faceKind']
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = skinHex;
  ctx.fillRect(0, 0, 256, 256);

  if (faceKind === 'knight_visor') {
    // Royal open-faced golden knight helm framing clear eyes, nose, and heroic smile
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(10, 14, 236, 228);
    // Face opening cutout showing warm skin
    ctx.fillStyle = '#F3C5A2';
    ctx.beginPath();
    ctx.roundRect(30, 52, 196, 166, 28);
    ctx.fill();
    // Golden helmet brow guard & nose-guard crown trim (above eyes)
    ctx.fillStyle = '#FACC15';
    ctx.fillRect(10, 0, 236, 56);
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.roundRect(30, 52, 196, 166, 28);
    ctx.stroke();

    // Eyes, nose, and confident knight smile clearly visible
    drawExpressiveEyes(ctx, 108, '#2563EB');
    drawStylizedNose(ctx, 'standard');

    ctx.strokeStyle = '#7C2D12';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 162, 28, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  if (faceKind === 'cardboard_face') {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let x = 0; x < 256; x += 14) ctx.fillRect(x, 0, 4, 256);
    ctx.strokeStyle = '#7C532E';
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 248);
    // Marker-drawn expressive eyes with crisp catchlights
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.roundRect(58, 70, 44, 54, 8);
    ctx.roundRect(154, 70, 44, 54, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(68, 80, 12, 12);
    ctx.fillRect(164, 80, 12, 12);

    // Clear marker-drawn nose
    drawStylizedNose(ctx, 'marker');

    // Marker-drawn smiling robot mouth
    ctx.fillStyle = '#FEF3C7';
    ctx.fillRect(72, 170, 112, 30);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 7;
    ctx.strokeRect(72, 170, 112, 30);
    ctx.beginPath();
    ctx.moveTo(72, 185);
    ctx.lineTo(184, 185);
    ctx.moveTo(100, 170);
    ctx.lineTo(100, 200);
    ctx.moveTo(128, 170);
    ctx.lineTo(128, 200);
    ctx.moveTo(156, 170);
    ctx.lineTo(156, 200);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  if (faceKind === 'noob_face') {
    // Raised eyebrows, clear oval eyes, cute nose, and classic playful mouth
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(54, 72);
    ctx.lineTo(98, 60);
    ctx.moveTo(202, 72);
    ctx.lineTo(158, 60);
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.ellipse(82, 102, 15, 22, 0, 0, Math.PI * 2);
    ctx.ellipse(174, 102, 15, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(77, 94, 4.5, 0, Math.PI * 2);
    ctx.arc(169, 94, 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Clear stylized nose
    drawStylizedNose(ctx, 'noob');

    ctx.fillStyle = '#7F1D1D';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(64, 186);
    ctx.quadraticCurveTo(96, 152, 128, 172);
    ctx.quadraticCurveTo(160, 152, 192, 186);
    ctx.quadraticCurveTo(128, 202, 64, 186);
    ctx.fill();
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  if (faceKind === 'cyber_mask') {
    // Expressive cyber-racer face with glowing eyes, visible nose & smile, plus sleek chin/cheek tech accents
    drawExpressiveEyes(ctx, 106, '#06B6D4');
    drawStylizedNose(ctx, 'standard');

    // Confident athletic smile clearly visible above the tech chin guard
    ctx.strokeStyle = '#7C2D12';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 160, 28, 0.16 * Math.PI, 0.84 * Math.PI);
    ctx.stroke();

    // Sleek cyber-racer cheek strips & chin collar guard (never obscures eyes, nose, or mouth)
    ctx.fillStyle = '#111827';
    ctx.fillRect(14, 150, 26, 42);
    ctx.fillRect(216, 150, 26, 42);
    ctx.fillRect(46, 212, 164, 44);
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(20, 158, 14, 10);
    ctx.fillRect(222, 158, 14, 10);
    ctx.fillRect(72, 224, 112, 12);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // Soft radial cheek blush for warm stylized 3D portrait look
  const blushAlpha = faceKind === 'happy_eyes' || faceKind === 'female_classic' ? 0.38 : 0.22;
  for (const bx of [58, 198]) {
    const blushGrad = ctx.createRadialGradient(bx, 152, 4, bx, 152, 28);
    blushGrad.addColorStop(0, `rgba(244, 114, 182, ${blushAlpha})`);
    blushGrad.addColorStop(1, 'rgba(244, 114, 182, 0)');
    ctx.fillStyle = blushGrad;
    ctx.beginPath();
    ctx.arc(bx, 152, 28, 0, Math.PI * 2);
    ctx.fill();
  }

  if (faceKind === 'happy_eyes') {
    // Expressive eyebrows
    ctx.strokeStyle = '#3B2314';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(82, 84, 20, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(174, 84, 20, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();

    // Cheerful smiling eyes
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(82, 118, 22, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(174, 118, 22, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();

    // Clear stylized nose
    drawStylizedNose(ctx, 'standard');

    // Cheerful open mouth
    ctx.fillStyle = '#991B1B';
    ctx.beginPath();
    ctx.arc(128, 162, 30, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = '#F87171';
    ctx.beginPath();
    ctx.arc(128, 178, 16, Math.PI, 0);
    ctx.fill();
  } else if (faceKind === 'shades') {
    // Draw expressive eyes FIRST so they remain clearly visible through semi-transparent sports lenses
    drawExpressiveEyes(ctx, 108, '#38BDF8');

    // Semi-transparent tinted sports sunglasses with crisp rim
    ctx.fillStyle = 'rgba(15, 23, 42, 0.36)';
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(38, 84, 80, 48, 16);
    ctx.roundRect(138, 84, 80, 48, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(116, 98, 24, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.26)';
    ctx.beginPath();
    ctx.roundRect(48, 90, 24, 8, 4);
    ctx.roundRect(148, 90, 24, 8, 4);
    ctx.fill();

    // Clear stylized nose
    drawStylizedNose(ctx, 'standard');

    // Confident smile
    ctx.strokeStyle = '#7C2D12';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 162, 32, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  } else {
    drawExpressiveEyes(ctx, 110, '#3B82F6');

    if (faceKind === 'female_classic') {
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(62, 96);
      ctx.lineTo(74, 86);
      ctx.moveTo(194, 96);
      ctx.lineTo(182, 86);
      ctx.stroke();
    }

    // Clear stylized nose on every classic / female / grin / smirk face
    drawStylizedNose(ctx, 'standard');

    if (faceKind === 'open_grin') {
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(128, 160, 32, 0, Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 6;
      ctx.stroke();
    } else if (faceKind === 'smirk') {
      ctx.strokeStyle = '#7C2D12';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(96, 178);
      ctx.quadraticCurveTo(138, 186, 168, 162);
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#7C2D12';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(128, 160, 30, 0.16 * Math.PI, 0.84 * Math.PI);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createStripedArmTexture(c1: string, c2: string, bands: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const h = 128 / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = i % 2 === 0 ? c1 : c2;
    ctx.fillRect(0, i * h, 64, h + 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createSideStripePantTexture(baseHex: string, stripeHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = stripeHex;
  ctx.fillRect(52, 0, 24, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNameplateSprite(name: string, colorHex: string, isLocalPlayer: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 512, 128);
  const label = name.slice(0, 18);

  ctx.fillStyle = isLocalPlayer ? 'rgba(255, 107, 26, 0.94)' : 'rgba(8, 18, 38, 0.84)';
  ctx.beginPath();
  ctx.roundRect(32, 22, 448, 84, 24);
  ctx.fill();

  ctx.strokeStyle = isLocalPlayer ? '#FACC15' : colorHex;
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 42px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(isLocalPlayer ? `★ ${label}` : label, 256, 65);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.5, 0.62, 1);
  sprite.position.set(0, 2.85, 0);
  return sprite;
}

export function createBlockyRunner(
  avatar: AvatarConfig,
  name: string,
  bibNumber: number,
  isLocalPlayer = false,
  includeNameplate = true,
  castShadows = true
): BlockyRunnerRig {
  const root = new THREE.Group();
  const bodyPivot = new THREE.Group();
  root.add(bodyPivot);

  const presetId = avatar.presetId && avatar.presetId !== 'custom' ? avatar.presetId : null;
  const preset = presetId ? PRESET_SPECS[presetId] : null;

  const primaryHex = getColorHex(avatar.color);
  const disposables: Array<{ dispose: () => void }> = [];

  const skinColor = preset ? preset.skinHex : '#F6C8A5';
  const hairColor = preset ? preset.hairHex : avatar.gender === 'female' ? '#2B1B17' : '#1E293B';

  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: preset?.metalness ? 0.35 : 0.65,
    metalness: preset?.metalness ?? 0.02,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: hairColor,
    roughness: 0.78,
    metalness: 0.05,
  });

  const jerseyTex = presetId
    ? createPresetTorsoTexture(presetId)
    : createJerseyTexture(primaryHex, avatar.outfit, bibNumber);
  const jerseyMat = new THREE.MeshStandardMaterial({
    map: jerseyTex,
    roughness: preset?.metalness ? 0.32 : avatar.outfit === 'pro' ? 0.35 : 0.6,
    metalness: preset?.metalness ?? (avatar.outfit === 'champion' ? 0.25 : 0.05),
  });

  const sleeveUpperMat = new THREE.MeshStandardMaterial({
    color: preset ? preset.sleeveUpperHex : primaryHex,
    roughness: 0.55,
    metalness: preset?.metalness ?? 0.05,
  });

  let forearmMat: THREE.MeshStandardMaterial;
  if (preset?.stripedSleeves) {
    const armTex = createStripedArmTexture('#111827', '#FFFFFF', 8);
    disposables.push(armTex);
    forearmMat = new THREE.MeshStandardMaterial({ map: armTex, roughness: 0.6 });
  } else if (preset?.cardboardRibs) {
    const ribTex = createStripedArmTexture('#94A3B8', '#475569', 10);
    disposables.push(ribTex);
    forearmMat = new THREE.MeshStandardMaterial({ map: ribTex, roughness: 0.4, metalness: 0.5 });
  } else {
    forearmMat = new THREE.MeshStandardMaterial({
      color: preset ? preset.sleeveLowerHex : skinColor,
      roughness: 0.55,
      metalness: preset?.metalness ?? 0.04,
    });
  }

  const gloveMat = new THREE.MeshStandardMaterial({
    color: preset?.gloveHex || (preset ? preset.sleeveLowerHex : primaryHex),
    roughness: 0.55,
  });

  let shortsMat: THREE.MeshStandardMaterial;
  if (preset?.pantsStripeHex) {
    const pantTex = createSideStripePantTexture(preset.shortsHex, preset.pantsStripeHex);
    disposables.push(pantTex);
    shortsMat = new THREE.MeshStandardMaterial({ map: pantTex, roughness: 0.7 });
  } else if (preset?.cardboardRibs) {
    shortsMat = forearmMat;
  } else {
    shortsMat = new THREE.MeshStandardMaterial({
      color: preset ? preset.shortsHex : avatar.color === 'black' ? '#334155' : '#0F172A',
      roughness: 0.72,
      metalness: preset?.metalness ?? 0.04,
    });
  }

  const shinMat = new THREE.MeshStandardMaterial({
    color: preset ? preset.shinHex : skinColor,
    roughness: 0.6,
    metalness: preset?.metalness ?? 0.04,
  });

  let shoeMat: THREE.MeshStandardMaterial;
  if (preset?.shoeStripeHex) {
    const sTex = createStripedArmTexture(preset.shoeHex, preset.shoeStripeHex, 4);
    disposables.push(sTex);
    shoeMat = new THREE.MeshStandardMaterial({ map: sTex, roughness: 0.4 });
  } else {
    shoeMat = new THREE.MeshStandardMaterial({
      color: preset ? preset.shoeHex : avatar.outfit === 'champion' ? '#FACC15' : '#FFFFFF',
      roughness: 0.38,
      metalness: preset?.metalness ?? 0.12,
    });
  }

  const headbandMat = new THREE.MeshStandardMaterial({
    color: avatar.color === 'white' ? 0x2563eb : primaryHex,
    roughness: 0.5,
  });

  const faceTex = preset
    ? createPresetFaceTexture(skinColor, preset.faceKind)
    : createPresetFaceTexture('#F6C8A5', avatar.gender === 'female' ? 'female_classic' : 'classic');
  const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6 });

  const makeMat = (color: number | string, roughness = 0.55, metalness = 0.05) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    disposables.push(m);
    return m;
  };

  disposables.push(
    skinMat,
    hairMat,
    jerseyTex,
    jerseyMat,
    sleeveUpperMat,
    forearmMat,
    gloveMat,
    shortsMat,
    shinMat,
    shoeMat,
    headbandMat,
    faceTex,
    faceMat
  );

  // 1. Sculpted Athletic Torso + Smooth Collar Neck + Rounded Waist/Pelvis
  const torso = new THREE.Mesh(SHARED_TORSO, jerseyMat);
  torso.position.set(0, 1.25, 0);
  torso.castShadow = castShadows;
  torso.receiveShadow = false;
  bodyPivot.add(torso);

  const neck = new THREE.Mesh(SHARED_NECK, skinMat);
  neck.position.set(0, 1.72, 0);
  bodyPivot.add(neck);

  // Smooth rounded waist/hip block connecting torso & legs organically
  const waist = new THREE.Mesh(SHARED_WAIST, shortsMat);
  waist.scale.set(1.06, 1.0, 0.64);
  waist.position.set(0, 0.8, 0);
  bodyPivot.add(waist);

  // Optional Rounded Backpack (Explorer) or Cardboard Collar Flaps (Cardboard Bot)
  if (preset?.backpackHex) {
    const packMat = makeMat(preset.backpackHex, 0.72);
    const pack = new THREE.Mesh(SHARED_CAPSULE, packMat);
    pack.scale.set(0.56, 0.34, 0.28);
    pack.position.set(0, 1.28, -0.3);
    bodyPivot.add(pack);
  }
  if (presetId === 'cardboard_bot') {
    const flapMat = makeMat('#C28E5C', 0.82);
    const flapL = new THREE.Mesh(SHARED_BOX, flapMat);
    flapL.scale.set(0.26, 0.055, 0.42);
    flapL.position.set(-0.44, 1.7, 0);
    flapL.rotation.z = -0.35;
    const flapR = new THREE.Mesh(SHARED_BOX, flapMat);
    flapR.scale.set(0.26, 0.055, 0.42);
    flapR.position.set(0.44, 1.7, 0);
    flapR.rotation.z = 0.35;
    bodyPivot.add(flapL, flapR);
  }

  // 2. Smooth Sculpted Head Group (organic stylized head + ears + subtle nose)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.74, 0);
  bodyPivot.add(headGroup);

  const isBoxyBot = presetId === 'cardboard_bot';
  const isHelmeted = preset?.faceKind === 'knight_visor' || isBoxyBot;
  const headTopMat = presetId === 'classic_noob' || isBoxyBot ? skinMat : hairMat;
  const headMaterials = [skinMat, skinMat, headTopMat, skinMat, faceMat, headTopMat];
  const head = new THREE.Mesh(isBoxyBot ? SHARED_HEAD_ROUNDED_BOX : SHARED_HEAD_ORGANIC, headMaterials);
  head.position.set(0, 0.35, 0);
  head.castShadow = castShadows;
  headGroup.add(head);

  if (!isHelmeted) {
    // Sculpted side ears
    const earL = new THREE.Mesh(SHARED_SPHERE, skinMat);
    earL.scale.set(0.058, 0.095, 0.072);
    earL.position.set(-0.34, 0.34, -0.02);
    const earR = new THREE.Mesh(SHARED_SPHERE, skinMat);
    earR.scale.set(0.058, 0.095, 0.072);
    earR.position.set(0.34, 0.34, -0.02);
    headGroup.add(earL, earR);
  }

  // Sculpted 3D nose guaranteed on EVERY character (all presets + custom avatars)
  const noseBaseColor = new THREE.Color(
    preset?.faceKind === 'knight_visor'
      ? '#F3C5A2'
      : isBoxyBot
      ? '#B78451'
      : skinColor
  ).multiplyScalar(0.92);
  const noseMat = makeMat(noseBaseColor.getHex(), 0.62, 0.03);
  const nose = new THREE.Mesh(SHARED_SPHERE, noseMat);
  nose.scale.set(0.048, 0.04, 0.052);
  nose.position.set(0, 0.32, isBoxyBot ? 0.365 : 0.348);
  headGroup.add(nose);

  // --- ORGANIC SCULPTED HAIR SILHOUETTES ---
  const hairStyle = preset ? preset.hairStyle : avatar.gender === 'female' ? 'ponytail' : 'short';
  const addHairDome = (scaleY = 1.0, offsetY = 0.36) => {
    const dome = new THREE.Mesh(SHARED_HAIR_DOME, hairMat);
    dome.scale.set(1.01, scaleY, 1.0);
    dome.position.set(0, offsetY, -0.01);
    headGroup.add(dome);
  };

  if (hairStyle === 'short') {
    addHairDome(0.98, 0.37);
    // Dynamic soft athletic front hair sweeps
    for (let i = -2; i <= 2; i++) {
      const tuft = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
      tuft.scale.set(0.42, 0.24, 0.42);
      tuft.position.set(i * 0.1, 0.62 - Math.abs(i) * 0.02, 0.26 - Math.abs(i) * 0.03);
      tuft.rotation.set(1.05, 0, -i * 0.22);
      headGroup.add(tuft);
    }
  } else if (hairStyle === 'ponytail') {
    addHairDome(1.0, 0.37);
    for (const side of [-1, 1] as const) {
      const lock = new THREE.Mesh(SHARED_CAPSULE, hairMat);
      lock.scale.set(0.14, 0.28, 0.18);
      lock.position.set(side * 0.32, 0.33, -0.06);
      lock.rotation.z = side * 0.12;
      headGroup.add(lock);
    }
    const tieMat = makeMat(primaryHex, 0.45);
    const tie = new THREE.Mesh(SHARED_GOGGLE_RING, tieMat);
    tie.scale.set(0.85, 0.85, 0.85);
    tie.position.set(0, 0.44, -0.36);
    const tail = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
    tail.scale.set(0.76, 0.56, 0.72);
    tail.position.set(0, 0.28, -0.46);
    tail.rotation.x = -2.72;
    headGroup.add(tie, tail);
  } else if (hairStyle === 'spiky_blue') {
    addHairDome(1.02, 0.37);
    for (let i = -2; i <= 2; i++) {
      const spike = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
      spike.scale.set(0.46, 0.36, 0.52);
      spike.position.set(i * 0.12, 0.72 - Math.abs(i) * 0.03, 0.16 - Math.abs(i) * 0.05);
      spike.rotation.set(0.58, 0, -i * 0.26);
      headGroup.add(spike);
    }
    const backSpikeL = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
    backSpikeL.scale.set(0.44, 0.32, 0.44);
    backSpikeL.position.set(-0.18, 0.66, -0.2);
    backSpikeL.rotation.set(-0.65, 0, 0.35);
    const backSpikeR = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
    backSpikeR.scale.set(0.44, 0.32, 0.44);
    backSpikeR.position.set(0.18, 0.66, -0.2);
    backSpikeR.rotation.set(-0.65, 0, -0.35);
    headGroup.add(backSpikeL, backSpikeR);
  } else if (
    hairStyle === 'long_orange' ||
    hairStyle === 'long_wavy_brown' ||
    hairStyle === 'long_pink' ||
    hairStyle === 'long_blonde' ||
    hairStyle === 'long_dark_bangs'
  ) {
    addHairDome(1.0, 0.37);
    for (const side of [-1, 1] as const) {
      const sideFlow = new THREE.Mesh(SHARED_CAPSULE, hairMat);
      sideFlow.scale.set(0.18, 0.48, 0.22);
      sideFlow.position.set(side * 0.33, 0.22, -0.05);
      sideFlow.rotation.z = side * 0.08;
      headGroup.add(sideFlow);
    }
    // Rounded back flowing curtain
    for (let i = -1; i <= 1; i++) {
      const backStrand = new THREE.Mesh(SHARED_CAPSULE, hairMat);
      backStrand.scale.set(0.28, 0.54, 0.2);
      backStrand.position.set(i * 0.18, 0.18, -0.32 + Math.abs(i) * 0.04);
      headGroup.add(backStrand);
    }
    // Soft swept front bangs
    for (let i = -1; i <= 1; i++) {
      const bang = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
      bang.scale.set(0.55, 0.24, 0.36);
      bang.position.set(i * 0.14, 0.59, 0.28 - Math.abs(i) * 0.03);
      bang.rotation.set(1.25, 0, -i * 0.25);
      headGroup.add(bang);
    }
  } else if (hairStyle === 'parted_brown' || hairStyle === 'bacon') {
    addHairDome(1.0, 0.37);
    for (const side of [-1, 1] as const) {
      const sideSweep = new THREE.Mesh(SHARED_CAPSULE, hairMat);
      sideSweep.scale.set(0.15, 0.3, 0.22);
      sideSweep.position.set(side * 0.33, 0.38, -0.05);
      const bang = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
      bang.scale.set(0.54, 0.28, 0.36);
      bang.position.set(side * 0.16, 0.6, 0.28);
      bang.rotation.set(1.1, 0, -side * 0.48);
      headGroup.add(sideSweep, bang);
    }
  } else if (hairStyle === 'green_mohawk') {
    for (let i = 0; i < 5; i++) {
      const u = i / 4;
      const fin = new THREE.Mesh(SHARED_HAIR_STRAND, hairMat);
      fin.scale.set(0.34, 0.38 - Math.abs(u - 0.5) * 0.12, 0.46);
      fin.position.set(0, 0.74 - Math.abs(u - 0.5) * 0.1, 0.24 - u * 0.52);
      fin.rotation.x = 0.28 - u * 0.6;
      headGroup.add(fin);
    }
  } else if (hairStyle === 'fluffy_under_cap' || hairStyle === 'messy_black' || hairStyle === 'fluffy_brown') {
    addHairDome(1.02, 0.37);
    const puffOffsets: Array<[number, number, number, number]> = [
      [-0.22, 0.62, 0.2, 0.13],
      [0, 0.65, 0.24, 0.14],
      [0.22, 0.62, 0.2, 0.13],
      [-0.32, 0.5, 0.04, 0.12],
      [0.32, 0.5, 0.04, 0.12],
      [-0.18, 0.68, -0.1, 0.14],
      [0.18, 0.68, -0.1, 0.14],
    ];
    for (const [px, py, pz, pr] of puffOffsets) {
      const puff = new THREE.Mesh(SHARED_SPHERE, hairMat);
      puff.scale.set(pr * 1.15, pr * 0.9, pr * 1.1);
      puff.position.set(px, py, pz);
      headGroup.add(puff);
    }
  } else if (hairStyle === 'orange_bob') {
    addHairDome(1.0, 0.37);
    for (const side of [-1, 1] as const) {
      const bobSide = new THREE.Mesh(SHARED_CAPSULE, hairMat);
      bobSide.scale.set(0.17, 0.34, 0.24);
      bobSide.position.set(side * 0.33, 0.34, -0.04);
      bobSide.rotation.z = -side * 0.12;
      headGroup.add(bobSide);
    }
    const backBob = new THREE.Mesh(SHARED_SPHERE, hairMat);
    backBob.scale.set(0.36, 0.34, 0.18);
    backBob.position.set(0, 0.34, -0.28);
    headGroup.add(backBob);
  }

  // --- SCULPTED HEADGEAR / HATS / HELMETS / HEADPHONES ---
  const hatStyle = preset ? preset.hatStyle : 'headband';
  if (hatStyle === 'headband') {
    const headband = new THREE.Mesh(SHARED_HEADBAND_RING, headbandMat);
    headband.rotation.x = Math.PI / 2;
    headband.position.set(0, 0.54, 0);
    // Trailing athletic headband tails behind head
    const tailL = new THREE.Mesh(SHARED_CAPSULE, headbandMat);
    tailL.scale.set(0.06, 0.18, 0.03);
    tailL.position.set(-0.07, 0.44, -0.39);
    tailL.rotation.set(0.38, 0, -0.28);
    const tailR = new THREE.Mesh(SHARED_CAPSULE, headbandMat);
    tailR.scale.set(0.06, 0.2, 0.03);
    tailR.position.set(0.07, 0.42, -0.4);
    tailR.rotation.set(0.45, 0, 0.28);
    headGroup.add(headband, tailL, tailR);
  } else if (hatStyle === 'cyber_goggles') {
    const redShellMat = makeMat('#DC2626', 0.28, 0.35);
    const cyanLensMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    disposables.push(cyanLensMat);
    const band = new THREE.Mesh(SHARED_HEADBAND_RING, redShellMat);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1.04, 1.04, 1.4);
    band.position.set(0, 0.58, 0);
    for (const sx of [-0.14, 0.14]) {
      const rim = new THREE.Mesh(SHARED_GOGGLE_RING, redShellMat);
      rim.position.set(sx, 0.58, 0.35);
      const lens = new THREE.Mesh(SHARED_CYL, cyanLensMat);
      lens.rotation.x = Math.PI / 2;
      lens.scale.set(0.085, 0.04, 0.085);
      lens.position.set(sx, 0.58, 0.355);
      headGroup.add(rim, lens);
    }
    headGroup.add(band);
  } else if (hatStyle === 'pirate_tricorn_captain') {
    const hatBrown = makeMat('#7C2D12', 0.68);
    const pinkTrim = makeMat('#F472B6', 0.52);
    const goldMat = makeMat('#FACC15', 0.28, 0.6);
    const crown = new THREE.Mesh(SHARED_CAP_DOME, hatBrown);
    crown.scale.set(1.04, 0.92, 1.04);
    crown.position.set(0, 0.46, 0);
    const brim = new THREE.Mesh(SHARED_PIRATE_BRIM, pinkTrim);
    brim.position.set(0, 0.62, 0.02);
    const goldEdge = new THREE.Mesh(SHARED_HEADBAND_RING, goldMat);
    goldEdge.rotation.x = Math.PI / 2;
    goldEdge.scale.set(1.36, 1.36, 0.72);
    goldEdge.position.set(0, 0.65, 0.02);
    headGroup.add(crown, brim, goldEdge);
  } else if (hatStyle === 'pirate_tricorn_girl') {
    const hatNavy = makeMat('#334155', 0.68);
    const hatRed = makeMat('#7F1D1D', 0.62);
    const whiteMat = makeMat('#FFFFFF', 0.45);
    const crown = new THREE.Mesh(SHARED_CAP_DOME, hatNavy);
    crown.scale.set(1.02, 0.88, 1.02);
    crown.position.set(0, 0.46, 0);
    const brim = new THREE.Mesh(SHARED_PIRATE_BRIM, hatRed);
    brim.position.set(0, 0.62, 0.02);
    for (const sx of [-0.18, 0, 0.18]) {
      const emblem = new THREE.Mesh(SHARED_SPHERE, whiteMat);
      emblem.scale.set(0.045, 0.045, 0.035);
      emblem.position.set(sx, 0.63, 0.46);
      headGroup.add(emblem);
    }
    headGroup.add(crown, brim);
  } else if (hatStyle === 'cap_headphones') {
    const capMat = makeMat('#E2E8F0', 0.6);
    const phoneMat = makeMat('#111827', 0.3, 0.35);
    const padMat = makeMat('#334155', 0.75);
    const cap = new THREE.Mesh(SHARED_CAP_DOME, capMat);
    cap.scale.set(1.03, 0.9, 1.03);
    cap.position.set(0, 0.44, 0);
    const visor = new THREE.Mesh(SHARED_CAP_VISOR, capMat);
    visor.position.set(0, 0.58, 0.24);
    visor.rotation.x = 0.08;
    const arch = new THREE.Mesh(SHARED_HEADPHONE_ARCH, phoneMat);
    arch.position.set(0, 0.38, 0);
    for (const side of [-1, 1] as const) {
      const cup = new THREE.Mesh(SHARED_EAR_CUP, phoneMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.39, 0.36, 0);
      const pad = new THREE.Mesh(SHARED_EAR_PAD, padMat);
      pad.rotation.y = Math.PI / 2;
      pad.position.set(side * 0.355, 0.36, 0);
      headGroup.add(cup, pad);
    }
    headGroup.add(cap, visor, arch);
  } else if (hatStyle === 'black_beanie') {
    const beanieMat = makeMat('#111827', 0.88);
    const dome = new THREE.Mesh(SHARED_CAP_DOME, beanieMat);
    dome.scale.set(1.04, 1.02, 1.04);
    dome.position.set(0, 0.46, -0.02);
    const cuff = new THREE.Mesh(SHARED_BEANIE_CUFF, beanieMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.56, -0.01);
    headGroup.add(dome, cuff);
  } else if (hatStyle === 'pink_neko') {
    const whiteMat = makeMat('#FFFFFF', 0.32, 0.15);
    const pinkMat = makeMat('#F9A8D4', 0.45);
    const arch = new THREE.Mesh(SHARED_HEADPHONE_ARCH, whiteMat);
    arch.position.set(0, 0.38, 0);
    for (const side of [-1, 1] as const) {
      const earOuter = new THREE.Mesh(SHARED_CONE, whiteMat);
      earOuter.scale.set(0.095, 0.2, 0.085);
      earOuter.position.set(side * 0.23, 0.8, 0);
      earOuter.rotation.z = -side * 0.26;
      const earInner = new THREE.Mesh(SHARED_CONE, pinkMat);
      earInner.scale.set(0.055, 0.13, 0.06);
      earInner.position.set(side * 0.23, 0.79, 0.025);
      earInner.rotation.z = -side * 0.26;
      const cup = new THREE.Mesh(SHARED_EAR_CUP, whiteMat);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(side * 0.39, 0.36, 0);
      const pad = new THREE.Mesh(SHARED_EAR_PAD, pinkMat);
      pad.rotation.y = Math.PI / 2;
      pad.position.set(side * 0.355, 0.36, 0);
      headGroup.add(earOuter, earInner, cup, pad);
    }
    headGroup.add(arch);
  } else if (hatStyle === 'forehead_shades') {
    const shadeMat = makeMat('#111827', 0.18, 0.6);
    for (const sx of [-0.14, 0.14]) {
      const lens = new THREE.Mesh(SHARED_CYL, shadeMat);
      lens.rotation.x = Math.PI / 2;
      lens.scale.set(0.105, 0.045, 0.075);
      lens.position.set(sx, 0.62, 0.33);
      headGroup.add(lens);
    }
    const bridge = new THREE.Mesh(SHARED_CAPSULE, shadeMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.scale.set(0.03, 0.1, 0.03);
    bridge.position.set(0, 0.63, 0.34);
    headGroup.add(bridge);
  } else if (hatStyle === 'skater_cap') {
    const whiteCap = makeMat('#FFFFFF', 0.6);
    const blackBrim = makeMat('#111827', 0.6);
    const dome = new THREE.Mesh(SHARED_CAP_DOME, whiteCap);
    dome.scale.set(1.03, 0.9, 1.03);
    dome.position.set(0, 0.44, 0);
    const visor = new THREE.Mesh(SHARED_CAP_VISOR, blackBrim);
    visor.position.set(0, 0.58, 0.24);
    visor.rotation.x = 0.08;
    const band = new THREE.Mesh(SHARED_HEADBAND_RING, blackBrim);
    band.rotation.x = Math.PI / 2;
    band.scale.set(1.03, 1.03, 0.65);
    band.position.set(0, 0.56, 0);
    headGroup.add(dome, visor, band);
  } else if (hatStyle === 'knight_helm') {
    const goldMat = makeMat('#FACC15', 0.22, 0.78);
    const redMat = makeMat('#DC2626', 0.35, 0.45);
    const dome = new THREE.Mesh(SHARED_CAP_DOME, goldMat);
    dome.scale.set(1.06, 0.96, 1.06);
    dome.position.set(0, 0.44, 0);
    const brow = new THREE.Mesh(SHARED_HEADBAND_RING, redMat);
    brow.rotation.x = Math.PI / 2;
    brow.scale.set(1.06, 1.06, 1.15);
    brow.position.set(0, 0.58, 0);
    for (let i = 0; i < 4; i++) {
      const plume = new THREE.Mesh(SHARED_HAIR_STRAND, redMat);
      plume.scale.set(0.28, 0.32, 0.42);
      plume.position.set(0, 0.84 - i * 0.04, 0.14 - i * 0.16);
      plume.rotation.x = -0.35 - i * 0.22;
      headGroup.add(plume);
    }
    headGroup.add(dome, brow);
  } else if (hatStyle === 'cardboard_antenna') {
    const knobMat = makeMat('#8B5E34', 0.8);
    const wireMat = makeMat('#1E293B', 0.35, 0.65);
    const silverMat = makeMat('#E2E8F0', 0.2, 0.85);
    const knobL = new THREE.Mesh(SHARED_CYL, knobMat);
    knobL.rotation.z = Math.PI / 2;
    knobL.scale.set(0.13, 0.1, 0.13);
    knobL.position.set(-0.37, 0.35, 0);
    const knobR = new THREE.Mesh(SHARED_CYL, knobMat);
    knobR.rotation.z = Math.PI / 2;
    knobR.scale.set(0.13, 0.1, 0.13);
    knobR.position.set(0.37, 0.35, 0);
    const stalk = new THREE.Mesh(SHARED_CYL, wireMat);
    stalk.scale.set(0.022, 0.38, 0.022);
    stalk.position.set(0, 0.84, 0);
    const ball = new THREE.Mesh(SHARED_SPHERE, silverMat);
    ball.scale.set(0.075, 0.075, 0.075);
    ball.position.set(0, 1.04, 0);
    headGroup.add(knobL, knobR, stalk, ball);
  } else if (hatStyle === 'hard_hat') {
    const yellowMat = makeMat('#FACC15', 0.26, 0.2);
    const shell = new THREE.Mesh(SHARED_CAP_DOME, yellowMat);
    shell.scale.set(1.08, 0.96, 1.08);
    shell.position.set(0, 0.45, 0);
    const ridge = new THREE.Mesh(SHARED_CAPSULE, yellowMat);
    ridge.rotation.x = Math.PI / 2;
    ridge.scale.set(0.16, 0.36, 0.12);
    ridge.position.set(0, 0.78, 0);
    const brim = new THREE.Mesh(SHARED_CAP_VISOR, yellowMat);
    brim.scale.set(1.08, 1.0, 1.08);
    brim.position.set(0, 0.58, 0.23);
    headGroup.add(shell, ridge, brim);
  }

  // 3. Smooth Articulated Arms (rounded shoulder + tapered upper/forearm + elbow + rounded hand)
  function buildArm(side: -1 | 1): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.54, 1.58, 0);

    if (preset?.puffedShouldersHex) {
      const puffMat = makeMat(preset.puffedShouldersHex, 0.55);
      const puff = new THREE.Mesh(SHARED_SPHERE, puffMat);
      puff.scale.set(0.19, 0.17, 0.19);
      puff.position.set(0, -0.06, 0);
      pivot.add(puff);
    }

    const shoulder = new THREE.Mesh(SHARED_SHOULDER, sleeveUpperMat);
    shoulder.position.set(0, -0.04, 0);
    pivot.add(shoulder);

    const sleeve = new THREE.Mesh(SHARED_UPPER_ARM, sleeveUpperMat);
    sleeve.position.set(0, -0.19, 0);
    pivot.add(sleeve);

    const elbow = new THREE.Mesh(SHARED_ELBOW, forearmMat);
    elbow.position.set(0, -0.35, 0);
    pivot.add(elbow);

    const forearm = new THREE.Mesh(SHARED_FOREARM, forearmMat);
    forearm.position.set(0, -0.52, 0);
    pivot.add(forearm);

    const hand = new THREE.Mesh(SHARED_HAND, gloveMat);
    hand.scale.set(0.95, 1.05, 1.12);
    hand.position.set(0, -0.73, 0.01);
    pivot.add(hand);

    if (!preset) {
      const wristband = new THREE.Mesh(SHARED_WRISTBAND, headbandMat);
      wristband.position.set(0, -0.61, 0);
      pivot.add(wristband);
    }

    // Compact signature hand props (staying neatly inside lane bounds)
    if (side === 1 && preset?.handProp === 'flashlight') {
      const bodyMat = makeMat('#64748B', 0.3, 0.65);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
      disposables.push(glowMat);
      const tube = new THREE.Mesh(SHARED_CYL, bodyMat);
      tube.rotation.x = Math.PI / 2;
      tube.scale.set(0.07, 0.4, 0.07);
      tube.position.set(0, -0.74, 0.2);
      const lens = new THREE.Mesh(SHARED_CYL, glowMat);
      lens.rotation.x = Math.PI / 2;
      lens.scale.set(0.09, 0.05, 0.09);
      lens.position.set(0, -0.74, 0.41);
      pivot.add(tube, lens);
    } else if (side === 1 && preset?.handProp === 'gold_sword') {
      const bladeMat = makeMat('#FACC15', 0.18, 0.8);
      const gripMat = makeMat('#78350F', 0.65);
      const grip = new THREE.Mesh(SHARED_CYL, gripMat);
      grip.scale.set(0.04, 0.24, 0.04);
      grip.position.set(0, -0.76, 0.12);
      grip.rotation.x = Math.PI / 2.3;
      const blade = new THREE.Mesh(SHARED_CONE, bladeMat);
      blade.scale.set(0.06, 0.78, 0.025);
      blade.position.set(0, -0.64, 0.46);
      blade.rotation.x = Math.PI / 2.3;
      pivot.add(grip, blade);
    } else if (side === 1 && preset?.handProp === 'hammer') {
      const woodMat = makeMat('#B45309', 0.72);
      const steelMat = makeMat('#94A3B8', 0.26, 0.75);
      const handle = new THREE.Mesh(SHARED_CYL, woodMat);
      handle.scale.set(0.036, 0.44, 0.036);
      handle.position.set(0, -0.7, 0.22);
      handle.rotation.x = Math.PI / 2.4;
      const headPart = new THREE.Mesh(SHARED_CAPSULE, steelMat);
      headPart.scale.set(0.14, 0.18, 0.14);
      headPart.position.set(0, -0.58, 0.38);
      headPart.rotation.set(Math.PI / 2.4, 0, Math.PI / 2);
      pivot.add(handle, headPart);
    } else if (side === -1 && preset?.handProp === 'cutlass') {
      const silverMat = makeMat('#E2E8F0', 0.2, 0.82);
      const goldGuardMat = makeMat('#FACC15', 0.28, 0.65);
      const guard = new THREE.Mesh(SHARED_GOGGLE_RING, goldGuardMat);
      guard.scale.set(0.7, 0.9, 0.7);
      guard.position.set(0, -0.76, 0.14);
      const blade = new THREE.Mesh(SHARED_CONE, silverMat);
      blade.scale.set(0.055, 0.76, 0.022);
      blade.position.set(0, -0.64, 0.45);
      blade.rotation.x = Math.PI / 2.3;
      pivot.add(guard, blade);
    }

    return pivot;
  }

  const leftArmPivot = buildArm(-1);
  const rightArmPivot = buildArm(1);
  bodyPivot.add(leftArmPivot, rightArmPivot);

  // 4. Sculpted Athletic Legs + Contoured Running Sneakers (pivoted at hips, soles flush at y=0)
  function buildLeg(side: -1 | 1): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.21, 0.72, 0);

    const hipCap = new THREE.Mesh(SHARED_HIP_CAP, shortsMat);
    hipCap.position.set(0, -0.02, 0);
    pivot.add(hipCap);

    const thigh = new THREE.Mesh(SHARED_THIGH, shortsMat);
    thigh.position.set(0, -0.17, 0);
    pivot.add(thigh);

    const knee = new THREE.Mesh(SHARED_KNEE, preset?.bootHeight === 'tall' ? shinMat : skinMat);
    knee.position.set(0, -0.33, 0.01);
    pivot.add(knee);

    const shin = new THREE.Mesh(preset?.bootHeight === 'tall' ? SHARED_BOOT_SHIN : SHARED_CALF, shinMat);
    shin.position.set(0, -0.49, 0);
    pivot.add(shin);

    // Sculpted 3-part athletic running sneaker (collar + contoured upper + cushioned midsole, flush at y=0)
    const collar = new THREE.Mesh(SHARED_SHOE_COLLAR, shoeMat);
    collar.position.set(0, -0.595, 0);
    const shoeUpper = new THREE.Mesh(SHARED_SHOE_UPPER, shoeMat);
    shoeUpper.position.set(0, -0.635, 0.05);
    const shoeSole = new THREE.Mesh(SHARED_SHOE_SOLE, SHARED_SHOE_SOLE_MAT);
    shoeSole.position.set(0, -0.686, 0.045);
    pivot.add(collar, shoeUpper, shoeSole);

    return pivot;
  }

  const leftLegPivot = buildLeg(-1);
  const rightLegPivot = buildLeg(1);
  bodyPivot.add(leftLegPivot, rightLegPivot);

  // 5. Speed Boost & Penalty Ground Rings (shared GPU geometry + material across all runners)
  const boostRing = new THREE.Mesh(SHARED_RING_GEO, SHARED_BOOST_MAT);
  boostRing.rotation.x = -Math.PI / 2;
  boostRing.position.y = 0.05;
  boostRing.visible = false;
  root.add(boostRing);

  const penaltyRing = new THREE.Mesh(SHARED_RING_GEO, SHARED_PENALTY_MAT);
  penaltyRing.rotation.x = -Math.PI / 2;
  penaltyRing.position.y = 0.05;
  penaltyRing.visible = false;
  root.add(penaltyRing);

  // 6. Contact shadow disc (shared GPU geometry + material)
  const contactShadow = new THREE.Mesh(SHARED_SHADOW_GEO, SHARED_SHADOW_MAT);
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // 6b. Championship Golden Trophy (shown when Juara 1 raises the cup on podium)
  const trophyGroup = new THREE.Group();
  trophyGroup.position.set(0, 2.34, 0.22);
  trophyGroup.visible = false;

  const plinth = new THREE.Mesh(SHARED_TROPHY_PLINTH, SHARED_TROPHY_BASE_MAT);
  plinth.position.y = -0.22;
  const collar = new THREE.Mesh(SHARED_TROPHY_COLLAR, SHARED_TROPHY_GOLD_MAT);
  collar.position.y = -0.15;
  const stem = new THREE.Mesh(SHARED_TROPHY_STEM, SHARED_TROPHY_GOLD_MAT);
  stem.position.y = -0.05;
  const cup = new THREE.Mesh(SHARED_TROPHY_CUP, SHARED_TROPHY_GOLD_MAT);
  cup.position.y = 0.18;
  const rim = new THREE.Mesh(SHARED_TROPHY_RIM, SHARED_TROPHY_GLOW_MAT);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.35;

  const handleL = new THREE.Mesh(SHARED_TROPHY_HANDLE, SHARED_TROPHY_GOLD_MAT);
  handleL.position.set(-0.22, 0.2, 0);
  handleL.rotation.z = Math.PI / 2;
  const handleR = new THREE.Mesh(SHARED_TROPHY_HANDLE, SHARED_TROPHY_GOLD_MAT);
  handleR.position.set(0.22, 0.2, 0);
  handleR.rotation.z = -Math.PI / 2;

  const topStar = new THREE.Mesh(SHARED_TROPHY_STAR, SHARED_TROPHY_GLOW_MAT);
  topStar.position.y = 0.44;
  topStar.rotation.y = Math.PI / 4;

  trophyGroup.add(plinth, collar, stem, cup, rim, handleL, handleR, topStar);
  bodyPivot.add(trophyGroup);

  // 7. Nameplate
  const nameSprite = createNameplateSprite(name, primaryHex, isLocalPlayer);
  nameSprite.visible = includeNameplate;
  root.add(nameSprite);

  disposables.push(nameSprite.material);
  if (nameSprite.material.map) disposables.push(nameSprite.material.map);

  return {
    root,
    bodyPivot,
    headGroup,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    boostRing,
    penaltyRing,
    trophyGroup,
    nameSprite,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function animateBlockyRunner(
  rig: BlockyRunnerRig,
  elapsed: number,
  mode: RunnerAnimMode,
  phaseOffset = 0,
  dt?: number
) {
  if (mode === 'trophy_lift') {
    applyPlacementVictoryAnimation(rig, elapsed, 'victory_1st', phaseOffset, dt);
    return;
  }

  if (isVictoryAnimMode(mode)) {
    applyPlacementVictoryAnimation(rig, elapsed, mode, phaseOffset, dt);
    return;
  }

  const t = elapsed + phaseOffset;

  // Restore secondary pose channels cleanly when leaving victory choreography
  rig.bodyPivot.rotation.y = 0;
  rig.bodyPivot.rotation.z = 0;
  rig.bodyPivot.scale.set(1, 1, 1);
  rig.headGroup.rotation.x = 0;
  rig.headGroup.rotation.z = 0;
  rig.leftLegPivot.rotation.z = 0;
  rig.rightLegPivot.rotation.z = 0;
  rig.leftArmPivot.rotation.z = 0;
  rig.rightArmPivot.rotation.z = 0;

  rig.boostRing.visible = mode === 'boost';
  rig.penaltyRing.visible = mode === 'penalty';
  rig.trophyGroup.visible = false;

  if (mode === 'boost') {
    const boostMat = rig.boostRing.material as THREE.MeshBasicMaterial;
    if (boostMat && boostMat.color) {
      boostMat.color.setHex(0x06b6d4);
    }
    const s = 1 + Math.sin(t * 14) * 0.14;
    rig.boostRing.scale.set(s, s, 1);
  }

  if (mode === 'idle') {
    rig.bodyPivot.position.y = Math.sin(t * 2.5) * 0.025;
    rig.bodyPivot.rotation.x = 0;
    rig.leftArmPivot.rotation.x = Math.sin(t * 2.5) * 0.08;
    rig.rightArmPivot.rotation.x = -Math.sin(t * 2.5) * 0.08;
    rig.leftLegPivot.rotation.x = 0;
    rig.rightLegPivot.rotation.x = 0;
    rig.headGroup.rotation.y = Math.sin(t * 1.4) * 0.1;
    return;
  }

  if (mode === 'finished' || mode === 'celebration') {
    const jump = Math.abs(Math.sin(t * 5.2)) * 0.35;
    rig.bodyPivot.position.y = jump;
    rig.bodyPivot.rotation.x = -0.05;
    rig.leftArmPivot.rotation.x = -2.6 + Math.sin(t * 10) * 0.25;
    rig.rightArmPivot.rotation.x = -2.6 - Math.sin(t * 10) * 0.25;
    rig.leftLegPivot.rotation.x = Math.sin(t * 5.2) * 0.2;
    rig.rightLegPivot.rotation.x = -Math.sin(t * 5.2) * 0.2;
    rig.headGroup.rotation.y = Math.sin(t * 3) * 0.18;
    return;
  }

  if (mode === 'walk' || mode === 'penalty') {
    // Relaxed casual walking gait (used for entrance walk-in AND wrong-answer penalty)
    const freq = mode === 'penalty' ? 4.8 : 5.8;
    const amp = mode === 'penalty' ? 0.5 : 0.54;
    const swing = Math.sin(t * freq) * amp;
    rig.bodyPivot.position.y = Math.abs(Math.sin(t * freq)) * (mode === 'penalty' ? 0.026 : 0.032);
    rig.bodyPivot.rotation.x = mode === 'penalty' ? 0.035 : 0.045;
    rig.leftLegPivot.rotation.x = swing;
    rig.rightLegPivot.rotation.x = -swing;
    rig.leftArmPivot.rotation.x = -swing * (mode === 'penalty' ? 0.68 : 0.72);
    rig.rightArmPivot.rotation.x = swing * (mode === 'penalty' ? 0.68 : 0.72);
    rig.headGroup.rotation.y = Math.sin(t * (mode === 'penalty' ? 1.35 : 1.55)) * (mode === 'penalty' ? 0.08 : 0.14);
    return;
  }

  // 'normal' = relaxed steady jog; 'boost' = energetic fast sprint
  const isBoost = mode === 'boost';
  const freq = isBoost ? 16.5 : 7.4;
  const amp = isBoost ? 1.08 : 0.62;
  const lean = isBoost ? 0.28 : 0.09;
  const bounce = isBoost ? 0.12 : 0.045;
  const armRatio = isBoost ? 0.95 : 0.84;

  const swing = Math.sin(t * freq) * amp;
  rig.bodyPivot.position.y = Math.abs(Math.sin(t * freq)) * bounce;
  rig.bodyPivot.rotation.x = lean;

  rig.leftLegPivot.rotation.x = swing;
  rig.rightLegPivot.rotation.x = -swing;
  rig.leftArmPivot.rotation.x = -swing * armRatio;
  rig.rightArmPivot.rotation.x = swing * armRatio;
  rig.headGroup.rotation.y = 0;
}
