import * as THREE from 'three';
import {
  buildOvalRibbonGeometry,
  buildOvalWallGeometry,
  evaluateStadiumOval,
  type TrackPose,
} from './stadiumAssets';
import { createSurroundingCity } from './createSurroundingCity';
import {
  buildExteriorNavGraph,
  createPathfindingNpcAgents,
  stepPathfindingNpcAgents,
} from './exteriorPathfinding';

export interface StadiumExteriorGroundsOptions {
  straightLen: number;
  innerR: number;
  midR: number;
  extWallR: number;
  maxAnisotropy: number;
}

export interface StadiumExteriorGroundsResult {
  group: THREE.Group;
  disposables: Array<{ dispose: () => void }>;
  update: (elapsed: number) => void;
}

/**
 * Procedural interlocking concrete paving-block ("batako / konblok") texture
 * with staggered courses, mortar joints, bevel highlights, and natural stone variation.
 */
function createBatakoPlazaTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#5c6673';
  ctx.fillRect(0, 0, size, size);

  const cols = 8;
  const rows = 16;
  const cellW = size / cols;
  const cellH = size / rows;
  const gap = 3;

  const blockPalette = ['#9aa4b2', '#8f9aa8', '#a4aebc', '#949fae', '#8b95a3', '#a0aab7'];

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (cellW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const bx = c * cellW + offset + gap * 0.5;
      const by = r * cellH + gap * 0.5;
      const bw = cellW - gap;
      const bh = cellH - gap;

      const hash = Math.abs((r * 37 + (c + 2) * 19) % blockPalette.length);
      ctx.fillStyle = blockPalette[hash];
      ctx.fillRect(bx, by, bw, bh);

      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(bx, by, bw, 2.5);
      ctx.fillRect(bx, by, 2.5, bh);
      ctx.fillStyle = 'rgba(15,23,42,0.16)';
      ctx.fillRect(bx, by + bh - 2.5, bw, 2.5);
      ctx.fillRect(bx + bw - 2.5, by, 2.5, bh);
    }
  }

  for (let i = 0; i < 3200; i++) {
    const gx = ((i * 73) % size) + ((i * 17) % 5) * 0.2;
    const gy = ((i * 139) % size) + ((i * 23) % 5) * 0.2;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.07)';
    ctx.fillRect(gx, gy, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Procedural masonry batako/stone wall texture for the 360-degree perimeter wall.
 */
function createPerimeterWallTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, w, h);

  const rows = 8;
  const cols = 6;
  const rw = w / cols;
  const rh = h / rows;

  const tones = ['#cbd5e1', '#bfc9d6', '#d4dde8', '#b8c3d1'];
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (rw * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * rw + off + 2;
      const y = r * rh + 2;
      ctx.fillStyle = tones[Math.abs((r * 13 + (c + 3) * 7) % tones.length)];
      ctx.fillRect(x, y, rw - 4, rh - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, rw - 4, 2);
    }
  }

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, h - 38, w, 38);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(0, h - 42, w, 4);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Procedural dark asphalt texture with aggregate grain for the ring road and rear parking deck.
 */
function createAsphaltTexture(maxAnisotropy: number, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#222934';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 4200; i++) {
    const x = (i * 97) % size;
    const y = (i * 53) % size;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.13)';
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Procedural canvas signboard for grand front perimeter gate or parking zone pylons.
 */
function createExteriorSignTexture(
  topLine: string,
  mainLine: string,
  accentHex: string,
  maxAnisotropy: number,
  width = 1536,
  height = 256
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, width, 0);
  grad.addColorStop(0, '#07142E');
  grad.addColorStop(0.5, '#12316F');
  grad.addColorStop(1, '#07142E');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = accentHex;
  ctx.fillRect(0, 0, width, Math.round(height * 0.08));
  ctx.fillStyle = '#FACC15';
  ctx.fillRect(0, Math.round(height * 0.92), width, Math.round(height * 0.08));

  ctx.strokeStyle = '#FACC15';
  ctx.lineWidth = Math.max(6, Math.round(height * 0.035));
  ctx.strokeRect(12, Math.round(height * 0.11), width - 24, Math.round(height * 0.78));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FACC15';
  ctx.font = `800 ${Math.round(height * 0.14)}px sans-serif`;
  ctx.fillText(topLine, width / 2, height * 0.31, width - 80);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `900 ${Math.round(height * 0.32)}px sans-serif`;
  ctx.fillText(mainLine, width / 2, height * 0.67, width - 80);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Builds an oval ring ShapeGeometry with planar world-space UVs so batako bricks
 * and asphalt aggregate stay uniform and undistorted along both straightaways and curves.
 */
function buildOvalRingPlanarGeometry(
  innerR: number,
  outerR: number,
  straightLen: number,
  uvTileMeters: number,
  curveSegments = 72
): THREE.BufferGeometry {
  const halfL = straightLen / 2;
  const outerShape = new THREE.Shape();
  outerShape.moveTo(-halfL, outerR);
  outerShape.lineTo(halfL, outerR);
  outerShape.absarc(halfL, 0, outerR, Math.PI / 2, -Math.PI / 2, true);
  outerShape.lineTo(-halfL, -outerR);
  outerShape.absarc(-halfL, 0, outerR, -Math.PI / 2, -Math.PI * 1.5, true);

  const innerHole = new THREE.Path();
  innerHole.moveTo(-halfL, innerR);
  innerHole.absarc(-halfL, 0, innerR, Math.PI / 2, Math.PI * 1.5, false);
  innerHole.lineTo(halfL, -innerR);
  innerHole.absarc(halfL, 0, innerR, -Math.PI / 2, Math.PI / 2, false);
  innerHole.lineTo(-halfL, innerR);
  outerShape.holes.push(innerHole);

  const geo = new THREE.ShapeGeometry(outerShape, curveSegments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = pos.getX(i) / uvTileMeters;
    uvs[i * 2 + 1] = pos.getZ(i) / uvTileMeters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

/**
 * Builds a planar curved annular sector on the East (+halfL) or West (-halfL) stadium end-cap
 * with undistorted world-space planar UVs (for expanded left/right side parking decks & curbs).
 */
function buildCapSectorPlanarGeometry(
  centerX: number,
  innerR: number,
  outerR: number,
  startPhi: number,
  endPhi: number,
  uvTileMeters: number,
  segments = 36
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Note: after rotateX(-PI/2), shape (x, y) maps to world (x, 0, -y), so use y = -sin(phi)
  const sxOut = centerX + Math.cos(startPhi) * outerR;
  const syOut = -Math.sin(startPhi) * outerR;
  shape.moveTo(sxOut, syOut);
  for (let i = 1; i <= segments; i++) {
    const phi = startPhi + (i / segments) * (endPhi - startPhi);
    shape.lineTo(centerX + Math.cos(phi) * outerR, -Math.sin(phi) * outerR);
  }
  for (let i = segments; i >= 0; i--) {
    const phi = startPhi + (i / segments) * (endPhi - startPhi);
    shape.lineTo(centerX + Math.cos(phi) * innerR, -Math.sin(phi) * innerR);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = pos.getX(i) / uvTileMeters;
    uvs[i * 2 + 1] = pos.getZ(i) / uvTileMeters;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

type PedestrianRoute =
  | {
      kind: 'linear';
      x1: number;
      z1: number;
      x2: number;
      z2: number;
      speed: number; // world units / sec
      phase: number;
      scale: number;
      dirSign: 1 | -1;
    }
  | {
      kind: 'oval';
      radius: number;
      speedS: number; // fraction of oval / sec
      s0: number;
      dirSign: 1 | -1;
      phase: number;
      scale: number;
    };

export function createStadiumExteriorGrounds(
  opts: StadiumExteriorGroundsOptions
): StadiumExteriorGroundsResult {
  const { straightLen, innerR, midR, extWallR, maxAnisotropy } = opts;
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const compoundR = 376.0; // Full oval compound perimeter radius
  const roadInnerR = 355.5; // 16m-wide 2-lane asphalt ring road wrapping 360° around stadium
  const roadOuterR = 371.5;
  const roadMidR = (roadInnerR + roadOuterR) / 2; // 363.5

  const PLAZA_Y = 0.045; // Cleanly above apronMesh (0.015) and extFloor (-0.06)
  const ASPHALT_Y = 0.085; // Cleanly above batako plaza
  const MARKING_Y = 0.125;

  // Shared architectural exterior materials
  const batakoTex = createBatakoPlazaTexture(maxAnisotropy);
  const batakoMat = new THREE.MeshStandardMaterial({
    map: batakoTex,
    roughness: 0.88,
    metalness: 0.04,
  });
  const wallTex = createPerimeterWallTexture(maxAnisotropy);
  const wallMat = new THREE.MeshStandardMaterial({
    map: wallTex,
    roughness: 0.82,
    metalness: 0.06,
  });
  const copingMat = new THREE.MeshStandardMaterial({
    color: 0xdbe3ee,
    roughness: 0.65,
    metalness: 0.08,
  });
  const navyStoneMat = new THREE.MeshStandardMaterial({
    color: 0x0f2552,
    roughness: 0.44,
    metalness: 0.42,
  });
  const ironFenceMat = new THREE.MeshStandardMaterial({
    color: 0x182230,
    roughness: 0.34,
    metalness: 0.84,
  });
  const goldAccentMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.24,
    metalness: 0.86,
  });
  const warmGlowMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
  const orangeGlowMat = new THREE.MeshBasicMaterial({ color: 0xff6b1a });
  const promenadeMat = new THREE.MeshStandardMaterial({
    color: 0x7c2d12,
    roughness: 0.82,
    metalness: 0.06,
  });
  const promenadeBorderMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.72,
    metalness: 0.08,
  });
  const planterCurbMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.74,
    metalness: 0.06,
  });
  const planterGrassMat = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.92,
    metalness: 0.0,
  });
  const roadAsphaltTex = createAsphaltTexture(maxAnisotropy, 1, 1);
  const roadAsphaltMat = new THREE.MeshStandardMaterial({
    map: roadAsphaltTex,
    roughness: 0.88,
    metalness: 0.04,
  });
  const parkingAsphaltTex = createAsphaltTexture(maxAnisotropy, 28, 12);
  const parkingAsphaltMat = new THREE.MeshStandardMaterial({
    map: parkingAsphaltTex,
    roughness: 0.9,
    metalness: 0.04,
  });
  const paintWhiteMat = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const paintYellowMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  disposables.push(
    batakoTex,
    batakoMat,
    wallTex,
    wallMat,
    copingMat,
    navyStoneMat,
    ironFenceMat,
    goldAccentMat,
    warmGlowMat,
    orangeGlowMat,
    promenadeMat,
    promenadeBorderMat,
    planterCurbMat,
    planterGrassMat,
    roadAsphaltTex,
    roadAsphaltMat,
    parkingAsphaltTex,
    parkingAsphaltMat,
    paintWhiteMat,
    paintYellowMat
  );

  const dummy = new THREE.Object3D();

  // =========================================================================
  // 1. FULL BATAKO / INTERLOCKING PAVING-BLOCK COMPOUND PLAZA
  // =========================================================================
  const batakoGeo = buildOvalRingPlanarGeometry(extWallR - 1.5, compoundR + 2.5, straightLen, 8.0, 72);
  const batakoMesh = new THREE.Mesh(batakoGeo, batakoMat);
  batakoMesh.position.y = PLAZA_Y;
  batakoMesh.receiveShadow = false;
  group.add(batakoMesh);
  disposables.push(batakoGeo);

  // Decorative perimeter sidewalk border right inside the compound wall
  const innerCurbRingGeo = buildOvalRibbonGeometry(
    roadOuterR + 0.2,
    compoundR + 0.6,
    straightLen,
    180,
    1,
    midR
  );
  const innerCurbRing = new THREE.Mesh(innerCurbRingGeo, promenadeBorderMat);
  innerCurbRing.position.y = PLAZA_Y + 0.015;
  group.add(innerCurbRing);
  disposables.push(innerCurbRingGeo);

  // Ceremonial paved pedestrian promenade from the ring road inner curb (z=-355) up to Stadium Main Gate (z=-254)
  const frontPromenadeLen = 101;
  const frontPromenadeMidZ = -304.5;
  const frontBoulevardGeo = new THREE.BoxGeometry(28.0, 0.04, frontPromenadeLen);
  const frontBoulevard = new THREE.Mesh(frontBoulevardGeo, promenadeMat);
  frontBoulevard.position.set(0, PLAZA_Y + 0.02, frontPromenadeMidZ);

  const boulevardBorderGeo = new THREE.BoxGeometry(2.0, 0.045, frontPromenadeLen);
  const bBorderL = new THREE.Mesh(boulevardBorderGeo, promenadeBorderMat);
  bBorderL.position.set(-15.0, PLAZA_Y + 0.022, frontPromenadeMidZ);
  const bBorderR = new THREE.Mesh(boulevardBorderGeo, promenadeBorderMat);
  bBorderR.position.set(15.0, PLAZA_Y + 0.022, frontPromenadeMidZ);

  const boulevardCenterStripeGeo = new THREE.BoxGeometry(0.95, 0.05, frontPromenadeLen - 6);
  const bCenterStripe = new THREE.Mesh(boulevardCenterStripeGeo, goldAccentMat);
  bCenterStripe.position.set(0, PLAZA_Y + 0.024, frontPromenadeMidZ);

  group.add(frontBoulevard, bBorderL, bBorderR, bCenterStripe);
  disposables.push(frontBoulevardGeo, boulevardBorderGeo, boulevardCenterStripeGeo);

  // =========================================================================
  // 1B. 360° ASPHALT RING ROAD WRAPPING AROUND STADIUM FROM FRONT GATE TO REAR PARKING
  // =========================================================================
  const ringRoadGeo = buildOvalRingPlanarGeometry(roadInnerR, roadOuterR, straightLen, 14.0, 84);
  const ringRoadMesh = new THREE.Mesh(ringRoadGeo, roadAsphaltMat);
  ringRoadMesh.position.y = ASPHALT_Y;
  group.add(ringRoadMesh);
  disposables.push(ringRoadGeo);

  // Outer & inner concrete road curbs + continuous crisp white road edge lines
  const roadEdgeInGeo = buildOvalRibbonGeometry(roadInnerR + 0.35, roadInnerR + 0.72, straightLen, 200, 1, midR);
  const roadEdgeOutGeo = buildOvalRibbonGeometry(roadOuterR - 0.72, roadOuterR - 0.35, straightLen, 200, 1, midR);
  const roadCurbInGeo = buildOvalRibbonGeometry(roadInnerR - 0.45, roadInnerR + 0.05, straightLen, 180, 1, midR);
  const roadCurbOutGeo = buildOvalRibbonGeometry(roadOuterR - 0.05, roadOuterR + 0.45, straightLen, 180, 1, midR);

  const roadEdgeIn = new THREE.Mesh(roadEdgeInGeo, paintWhiteMat);
  roadEdgeIn.position.y = MARKING_Y;
  const roadEdgeOut = new THREE.Mesh(roadEdgeOutGeo, paintWhiteMat);
  roadEdgeOut.position.y = MARKING_Y;
  const roadCurbIn = new THREE.Mesh(roadCurbInGeo, planterCurbMat);
  roadCurbIn.position.y = ASPHALT_Y + 0.02;
  const roadCurbOut = new THREE.Mesh(roadCurbOutGeo, planterCurbMat);
  roadCurbOut.position.y = ASPHALT_Y + 0.02;
  group.add(roadEdgeIn, roadEdgeOut, roadCurbIn, roadCurbOut);
  disposables.push(roadEdgeInGeo, roadEdgeOutGeo, roadCurbInGeo, roadCurbOutGeo);

  // Dashed yellow centerline markings wrapping 360° along the center of the 2-lane ring road
  const roadDashCount = 190;
  const roadDashGeo = new THREE.PlaneGeometry(0.42, 6.2);
  roadDashGeo.rotateX(-Math.PI / 2);
  const roadDashInst = new THREE.InstancedMesh(roadDashGeo, paintYellowMat, roadDashCount);
  roadDashInst.frustumCulled = false;
  for (let i = 0; i < roadDashCount; i++) {
    const s = i / roadDashCount;
    const rp = evaluateStadiumOval(s, roadMidR, straightLen, midR);
    dummy.position.set(rp.x, MARKING_Y, rp.z);
    dummy.rotation.set(0, rp.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    roadDashInst.setMatrixAt(i, dummy.matrix);
  }
  roadDashInst.instanceMatrix.needsUpdate = true;
  group.add(roadDashInst);
  disposables.push(roadDashGeo);

  // Front Main Gate Asphalt Entry/Exit Access Road (connects outer street z=-445 through Front Gate z=-376 into Ring Road z=-355.5)
  const frontRoadLen = 92; // z = -447.5 .. -355.5
  const frontRoadMidZ = -401.5;
  const frontAccessRoadGeo = new THREE.BoxGeometry(24.0, 0.05, frontRoadLen);
  const frontAccessRoad = new THREE.Mesh(frontAccessRoadGeo, parkingAsphaltMat);
  frontAccessRoad.position.set(0, ASPHALT_Y - 0.005, frontRoadMidZ);

  const frontRoadCenterGeo = new THREE.PlaneGeometry(0.48, frontRoadLen - 16);
  frontRoadCenterGeo.rotateX(-Math.PI / 2);
  const frontRoadCenterL = new THREE.Mesh(frontRoadCenterGeo, paintYellowMat);
  frontRoadCenterL.position.set(-0.4, MARKING_Y, frontRoadMidZ - 6);
  const frontRoadCenterR = new THREE.Mesh(frontRoadCenterGeo, paintYellowMat);
  frontRoadCenterR.position.set(0.4, MARKING_Y, frontRoadMidZ - 6);

  const frontRoadEdgeGeo = new THREE.PlaneGeometry(0.36, frontRoadLen - 14);
  frontRoadEdgeGeo.rotateX(-Math.PI / 2);
  const frontRoadEdgeL = new THREE.Mesh(frontRoadEdgeGeo, paintWhiteMat);
  frontRoadEdgeL.position.set(-11.2, MARKING_Y, frontRoadMidZ - 5);
  const frontRoadEdgeR = new THREE.Mesh(frontRoadEdgeGeo, paintWhiteMat);
  frontRoadEdgeR.position.set(11.2, MARKING_Y, frontRoadMidZ - 5);

  // Pedestrian Zebra Crosswalk across the North Ring Road connecting Front Gate & Central Promenade
  const zebraGeo = new THREE.PlaneGeometry(1.1, 4.4);
  zebraGeo.rotateX(-Math.PI / 2);
  const zebraCount = 9;
  const zebraInst = new THREE.InstancedMesh(zebraGeo, paintWhiteMat, zebraCount);
  zebraInst.frustumCulled = false;
  for (let i = 0; i < zebraCount; i++) {
    const zx = -9.6 + i * 2.4;
    dummy.position.set(zx, MARKING_Y + 0.005, -358.2);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    zebraInst.setMatrixAt(i, dummy.matrix);
  }
  zebraInst.instanceMatrix.needsUpdate = true;

  group.add(
    frontAccessRoad,
    frontRoadCenterL,
    frontRoadCenterR,
    frontRoadEdgeL,
    frontRoadEdgeR,
    zebraInst
  );
  disposables.push(frontAccessRoadGeo, frontRoadCenterGeo, frontRoadEdgeGeo, zebraGeo);

  // =========================================================================
  // 2. 360° PERIMETER BOUNDARY WALL + IRON FENCE WRAPPING AROUND STADIUM
  // =========================================================================
  const FRONT_GATE_HALF_W = 28.5;

  // Rear perimeter gate removed: only the Grand Front Entrance Gate opens through the perimeter wall
  const isPerimeterGateGap = (_sMid: number, pMid: TrackPose): boolean => {
    if (pMid.z < -innerR && Math.abs(pMid.x) < FRONT_GATE_HALF_W) return true;
    return false;
  };

  const wallSegments = 260;
  const wallH = 2.9;
  const wallThick = 0.72;

  const wallInnerGeo = buildOvalWallGeometry(
    compoundR - wallThick / 2,
    0,
    wallH,
    straightLen,
    midR,
    wallSegments,
    130,
    true,
    isPerimeterGateGap
  );
  const wallOuterGeo = buildOvalWallGeometry(
    compoundR + wallThick / 2,
    0,
    wallH,
    straightLen,
    midR,
    wallSegments,
    130,
    false,
    isPerimeterGateGap
  );

  const fenceBotRailGeo = buildOvalWallGeometry(
    compoundR,
    wallH + 0.25,
    wallH + 0.44,
    straightLen,
    midR,
    wallSegments,
    1,
    false,
    isPerimeterGateGap
  );
  const fenceBotRailInGeo = buildOvalWallGeometry(
    compoundR,
    wallH + 0.25,
    wallH + 0.44,
    straightLen,
    midR,
    wallSegments,
    1,
    true,
    isPerimeterGateGap
  );
  const fenceTopRailGeo = buildOvalWallGeometry(
    compoundR,
    wallH + 2.15,
    wallH + 2.36,
    straightLen,
    midR,
    wallSegments,
    1,
    false,
    isPerimeterGateGap
  );
  const fenceTopRailInGeo = buildOvalWallGeometry(
    compoundR,
    wallH + 2.15,
    wallH + 2.36,
    straightLen,
    midR,
    wallSegments,
    1,
    true,
    isPerimeterGateGap
  );
  const wallCapGeo = buildOvalWallGeometry(
    compoundR + wallThick * 0.56,
    wallH - 0.14,
    wallH + 0.16,
    straightLen,
    midR,
    wallSegments,
    1,
    false,
    isPerimeterGateGap
  );
  const wallCapInGeo = buildOvalWallGeometry(
    compoundR - wallThick * 0.56,
    wallH - 0.14,
    wallH + 0.16,
    straightLen,
    midR,
    wallSegments,
    1,
    true,
    isPerimeterGateGap
  );

  group.add(
    new THREE.Mesh(wallInnerGeo, wallMat),
    new THREE.Mesh(wallOuterGeo, wallMat),
    new THREE.Mesh(wallCapGeo, copingMat),
    new THREE.Mesh(wallCapInGeo, copingMat),
    new THREE.Mesh(fenceBotRailGeo, ironFenceMat),
    new THREE.Mesh(fenceBotRailInGeo, ironFenceMat),
    new THREE.Mesh(fenceTopRailGeo, ironFenceMat),
    new THREE.Mesh(fenceTopRailInGeo, ironFenceMat)
  );
  disposables.push(
    wallInnerGeo,
    wallOuterGeo,
    wallCapGeo,
    wallCapInGeo,
    fenceBotRailGeo,
    fenceBotRailInGeo,
    fenceTopRailGeo,
    fenceTopRailInGeo
  );

  // Instanced Masonry Pilasters & Vertical Iron Fence Pickets around 360° perimeter
  const pilasterSlots: TrackPose[] = [];
  const pilasterCountTotal = 188;
  for (let i = 0; i < pilasterCountTotal; i++) {
    const s = i / pilasterCountTotal;
    const p = evaluateStadiumOval(s, compoundR, straightLen, midR);
    if (isPerimeterGateGap(s, p)) continue;
    pilasterSlots.push(p);
  }

  const pilasterBodyGeo = new THREE.BoxGeometry(1.18, wallH + 2.65, 1.18);
  const pilasterCapGeo = new THREE.BoxGeometry(1.42, 0.34, 1.42);
  const pilasterFinialGeo = new THREE.ConeGeometry(0.42, 0.72, 4);
  const pilasterBodyInst = new THREE.InstancedMesh(pilasterBodyGeo, wallMat, pilasterSlots.length);
  const pilasterCapInst = new THREE.InstancedMesh(pilasterCapGeo, copingMat, pilasterSlots.length);
  const pilasterFinialInst = new THREE.InstancedMesh(pilasterFinialGeo, goldAccentMat, pilasterSlots.length);
  pilasterBodyInst.frustumCulled = false;
  pilasterCapInst.frustumCulled = false;
  pilasterFinialInst.frustumCulled = false;

  for (let i = 0; i < pilasterSlots.length; i++) {
    const p = pilasterSlots[i];
    const radialYaw = Math.atan2(-p.fz, p.fx);
    dummy.rotation.set(0, radialYaw, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(p.x, (wallH + 2.65) / 2, p.z);
    dummy.updateMatrix();
    pilasterBodyInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, wallH + 2.75, p.z);
    dummy.updateMatrix();
    pilasterCapInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, wallH + 3.25, p.z);
    dummy.updateMatrix();
    pilasterFinialInst.setMatrixAt(i, dummy.matrix);
  }
  pilasterBodyInst.instanceMatrix.needsUpdate = true;
  pilasterCapInst.instanceMatrix.needsUpdate = true;
  pilasterFinialInst.instanceMatrix.needsUpdate = true;
  group.add(pilasterBodyInst, pilasterCapInst, pilasterFinialInst);
  disposables.push(pilasterBodyGeo, pilasterCapGeo, pilasterFinialGeo);

  const picketSlots: TrackPose[] = [];
  const picketSamples = 1120;
  for (let i = 0; i < picketSamples; i++) {
    const s = i / picketSamples;
    const p = evaluateStadiumOval(s, compoundR, straightLen, midR);
    if (isPerimeterGateGap(s, p)) continue;
    picketSlots.push(p);
  }

  const perimPicketGeo = new THREE.BoxGeometry(0.14, 2.35, 0.14);
  const perimTipGeo = new THREE.ConeGeometry(0.14, 0.34, 4);
  const perimPicketInst = new THREE.InstancedMesh(perimPicketGeo, ironFenceMat, picketSlots.length);
  const perimTipInst = new THREE.InstancedMesh(perimTipGeo, goldAccentMat, picketSlots.length);
  perimPicketInst.frustumCulled = false;
  perimTipInst.frustumCulled = false;

  for (let i = 0; i < picketSlots.length; i++) {
    const p = picketSlots[i];
    const radialYaw = Math.atan2(-p.fz, p.fx);
    dummy.rotation.set(0, radialYaw, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(p.x, wallH + 1.25, p.z);
    dummy.updateMatrix();
    perimPicketInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, wallH + 2.55, p.z);
    dummy.updateMatrix();
    perimTipInst.setMatrixAt(i, dummy.matrix);
  }
  perimPicketInst.instanceMatrix.needsUpdate = true;
  perimTipInst.instanceMatrix.needsUpdate = true;
  group.add(perimPicketInst, perimTipInst);
  disposables.push(perimPicketGeo, perimTipGeo);

  // =========================================================================
  // 3. GRAND MONUMENTAL FRONT PERIMETER FENCE & ENTRANCE GATE ("PAGAR MEGAH DEPAN")
  // =========================================================================
  const frontGateGrp = new THREE.Group();
  frontGateGrp.position.set(0, 0, -compoundR);
  frontGateGrp.rotation.y = Math.PI;

  const frontSignTex = createExteriorSignTexture(
    'KOMPLEK STADION INTERNASIONAL · EDU RUN ARENA 3D',
    'GERBANG UTAMA STADION',
    '#FF6B1A',
    maxAnisotropy
  );
  const frontSignMat = new THREE.MeshStandardMaterial({
    map: frontSignTex,
    roughness: 0.26,
    emissive: 0x0f2554,
    emissiveIntensity: 0.45,
  });
  disposables.push(frontSignTex, frontSignMat);

  const innerTowerPlinthGeo = new THREE.BoxGeometry(6.0, 3.2, 6.4);
  const innerTowerShaftGeo = new THREE.BoxGeometry(4.8, 13.6, 5.2);
  const innerTowerCrownGeo = new THREE.BoxGeometry(5.8, 1.4, 6.2);
  const innerTowerSpireGeo = new THREE.ConeGeometry(2.1, 3.4, 4);
  const towerGoldRibGeo = new THREE.BoxGeometry(0.45, 13.2, 5.45);
  const towerLedStripGeo = new THREE.BoxGeometry(0.32, 12.6, 0.32);

  const outerTowerPlinthGeo = new THREE.BoxGeometry(4.6, 2.8, 5.0);
  const outerTowerShaftGeo = new THREE.BoxGeometry(3.8, 9.2, 4.2);
  const outerTowerCrownGeo = new THREE.BoxGeometry(4.6, 1.1, 4.9);
  const lanternGlobeGeo = new THREE.SphereGeometry(0.85, 12, 10);

  disposables.push(
    innerTowerPlinthGeo,
    innerTowerShaftGeo,
    innerTowerCrownGeo,
    innerTowerSpireGeo,
    towerGoldRibGeo,
    towerLedStripGeo,
    outerTowerPlinthGeo,
    outerTowerShaftGeo,
    outerTowerCrownGeo,
    lanternGlobeGeo
  );

  for (const side of [-1, 1] as const) {
    const ix = side * 15.2;
    const iPlinth = new THREE.Mesh(innerTowerPlinthGeo, copingMat);
    iPlinth.position.set(ix, 1.6, 0);
    const iShaft = new THREE.Mesh(innerTowerShaftGeo, navyStoneMat);
    iShaft.position.set(ix, 9.8, 0);
    const iCrown = new THREE.Mesh(innerTowerCrownGeo, copingMat);
    iCrown.position.set(ix, 17.1, 0);
    const iSpire = new THREE.Mesh(innerTowerSpireGeo, goldAccentMat);
    iSpire.rotation.y = Math.PI / 4;
    iSpire.position.set(ix, 19.4, 0);
    const iRib1 = new THREE.Mesh(towerGoldRibGeo, goldAccentMat);
    iRib1.position.set(ix - 1.6, 9.8, 0);
    const iRib2 = new THREE.Mesh(towerGoldRibGeo, goldAccentMat);
    iRib2.position.set(ix + 1.6, 9.8, 0);
    const iLedOut = new THREE.Mesh(towerLedStripGeo, orangeGlowMat);
    iLedOut.position.set(ix, 9.8, 2.66);
    const iLedIn = new THREE.Mesh(towerLedStripGeo, orangeGlowMat);
    iLedIn.position.set(ix, 9.8, -2.66);
    frontGateGrp.add(iPlinth, iShaft, iCrown, iSpire, iRib1, iRib2, iLedOut, iLedIn);

    const ox = side * 28.4;
    const oPlinth = new THREE.Mesh(outerTowerPlinthGeo, copingMat);
    oPlinth.position.set(ox, 1.4, 0);
    const oShaft = new THREE.Mesh(outerTowerShaftGeo, navyStoneMat);
    oShaft.position.set(ox, 7.2, 0);
    const oCrown = new THREE.Mesh(outerTowerCrownGeo, copingMat);
    oCrown.position.set(ox, 12.1, 0);
    const oLantern = new THREE.Mesh(lanternGlobeGeo, warmGlowMat);
    oLantern.position.set(ox, 13.45, 0);
    frontGateGrp.add(oPlinth, oShaft, oCrown, oLantern);
  }

  const archBeamGeo = new THREE.BoxGeometry(36.8, 3.8, 5.4);
  const archBeam = new THREE.Mesh(archBeamGeo, navyStoneMat);
  archBeam.position.set(0, 14.5, 0);

  const archCorniceGeo = new THREE.BoxGeometry(38.4, 0.72, 6.2);
  const archCorniceTop = new THREE.Mesh(archCorniceGeo, copingMat);
  archCorniceTop.position.set(0, 16.7, 0);
  const archCorniceBot = new THREE.Mesh(archCorniceGeo, goldAccentMat);
  archCorniceBot.position.set(0, 12.4, 0);

  const crestBaseGeo = new THREE.BoxGeometry(16.0, 1.8, 3.4);
  const crestBase = new THREE.Mesh(crestBaseGeo, navyStoneMat);
  crestBase.position.set(0, 17.9, 0);
  const crestArchGeo = new THREE.TorusGeometry(4.4, 0.42, 10, 24, Math.PI);
  const crestArch = new THREE.Mesh(crestArchGeo, goldAccentMat);
  crestArch.position.set(0, 17.4, 0);
  const crestStarGeo = new THREE.OctahedronGeometry(1.35, 0);
  const crestStar = new THREE.Mesh(crestStarGeo, goldAccentMat);
  crestStar.position.set(0, 20.1, 0);

  const frontSignGeo = new THREE.PlaneGeometry(29.0, 3.1);
  const frontSignOut = new THREE.Mesh(frontSignGeo, frontSignMat);
  frontSignOut.position.set(0, 14.5, 2.76);
  const frontSignIn = new THREE.Mesh(frontSignGeo, frontSignMat);
  frontSignIn.position.set(0, 14.5, -2.76);
  frontSignIn.rotation.y = Math.PI;

  frontGateGrp.add(
    archBeam,
    archCorniceTop,
    archCorniceBot,
    crestBase,
    crestArch,
    crestStar,
    frontSignOut,
    frontSignIn
  );
  disposables.push(
    archBeamGeo,
    archCorniceGeo,
    crestBaseGeo,
    crestArchGeo,
    crestStarGeo,
    frontSignGeo
  );

  // Ornate Grand Front Iron Fence Wings between inner (±15.2) and outer (±28.4) towers
  const grandWingPlinthGeo = new THREE.BoxGeometry(9.6, 2.4, 1.25);
  const grandWingCapGeo = new THREE.BoxGeometry(9.8, 0.32, 1.48);
  const grandWingRailGeo = new THREE.BoxGeometry(9.4, 0.24, 0.24);
  const grandWingBarGeo = new THREE.BoxGeometry(0.16, 5.4, 0.16);
  const grandWingTipGeo = new THREE.ConeGeometry(0.18, 0.48, 4);
  const grandWingRingGeo = new THREE.TorusGeometry(0.42, 0.08, 8, 16);
  disposables.push(
    grandWingPlinthGeo,
    grandWingCapGeo,
    grandWingRailGeo,
    grandWingBarGeo,
    grandWingTipGeo,
    grandWingRingGeo
  );

  for (const side of [-1, 1] as const) {
    const wx = side * 21.8;
    const plinth = new THREE.Mesh(grandWingPlinthGeo, wallMat);
    plinth.position.set(wx, 1.2, 0);
    const cap = new THREE.Mesh(grandWingCapGeo, copingMat);
    cap.position.set(wx, 2.55, 0);
    const r1 = new THREE.Mesh(grandWingRailGeo, ironFenceMat);
    r1.position.set(wx, 3.2, 0);
    const r2 = new THREE.Mesh(grandWingRailGeo, ironFenceMat);
    r2.position.set(wx, 5.6, 0);
    const r3 = new THREE.Mesh(grandWingRailGeo, ironFenceMat);
    r3.position.set(wx, 7.6, 0);
    const rGold = new THREE.Mesh(grandWingRailGeo, goldAccentMat);
    rGold.position.set(wx, 7.0, 0);
    frontGateGrp.add(plinth, cap, r1, r2, r3, rGold);

    for (let b = 0; b < 11; b++) {
      const bx = wx - 4.25 + b * 0.85;
      const bar = new THREE.Mesh(grandWingBarGeo, ironFenceMat);
      bar.position.set(bx, 5.3, 0);
      const tip = new THREE.Mesh(grandWingTipGeo, goldAccentMat);
      tip.position.set(bx, 8.2, 0);
      frontGateGrp.add(bar, tip);

      if (b % 2 === 1) {
        const ring = new THREE.Mesh(grandWingRingGeo, goldAccentMat);
        ring.position.set(bx, 6.3, 0);
        frontGateGrp.add(ring);
      }
    }
  }

  // Monumental Double Swinging Wrought-Iron Entrance Gate Doors (swung WIDE OPEN for cars & visitors)
  const grandLeafVGeo = new THREE.BoxGeometry(0.32, 8.2, 0.32);
  const grandLeafHGeo = new THREE.BoxGeometry(12.2, 0.3, 0.28);
  const grandLeafPicketGeo = new THREE.BoxGeometry(0.16, 7.8, 0.16);
  const grandLeafCrestGeo = new THREE.TorusGeometry(1.45, 0.16, 8, 20);
  disposables.push(grandLeafVGeo, grandLeafHGeo, grandLeafPicketGeo, grandLeafCrestGeo);

  const buildMonumentalFrontGateLeaf = (side: -1 | 1) => {
    const leaf = new THREE.Group();
    leaf.position.set(side * 12.6, 0.2, 0);
    // Swing both wrought-iron gate leaves wide open (~84 deg) along the road edges so vehicles pass freely
    leaf.rotation.y = side === -1 ? -1.46 : 1.46;
    const dir = -side;
    const leafW = 12.2;
    const midX = dir * (leafW / 2);

    const hingeV = new THREE.Mesh(grandLeafVGeo, ironFenceMat);
    hingeV.position.set(dir * 0.16, 4.1, 0);
    const centerV = new THREE.Mesh(grandLeafVGeo, ironFenceMat);
    centerV.position.set(dir * (leafW - 0.16), 4.1, 0);

    const botH = new THREE.Mesh(grandLeafHGeo, ironFenceMat);
    botH.position.set(midX, 0.45, 0);
    const midH = new THREE.Mesh(grandLeafHGeo, ironFenceMat);
    midH.position.set(midX, 4.15, 0);
    const topH = new THREE.Mesh(grandLeafHGeo, ironFenceMat);
    topH.position.set(midX, 7.95, 0);
    const goldBand = new THREE.Mesh(grandLeafHGeo, goldAccentMat);
    goldBand.scale.set(0.98, 0.6, 1.15);
    goldBand.position.set(midX, 7.25, 0);

    const crestMedallion = new THREE.Mesh(grandLeafCrestGeo, goldAccentMat);
    crestMedallion.position.set(midX, 4.15, 0);
    leaf.add(hingeV, centerV, botH, midH, topH, goldBand, crestMedallion);

    for (let k = 1; k <= 13; k++) {
      const px = dir * (k * (leafW / 14));
      const pHeightScale = 0.86 + Math.sin((k / 14) * Math.PI) * 0.22;
      const picket = new THREE.Mesh(grandLeafPicketGeo, ironFenceMat);
      picket.scale.set(1, pHeightScale, 1);
      picket.position.set(px, 4.1 * pHeightScale, 0);
      const tip = new THREE.Mesh(grandWingTipGeo, goldAccentMat);
      tip.position.set(px, 8.2 * pHeightScale, 0);
      leaf.add(picket, tip);
    }
    return leaf;
  };
  frontGateGrp.add(buildMonumentalFrontGateLeaf(-1), buildMonumentalFrontGateLeaf(1));

  // Security Guardhouse ("Pos Jaga") tucked cleanly on the outer sidewalk (clear of the 16m ring road!)
  const guardBaseGeo = new THREE.BoxGeometry(6.4, 4.0, 3.6);
  const guardRoofGeo = new THREE.BoxGeometry(7.6, 0.65, 4.6);
  const guardGlassGeo = new THREE.BoxGeometry(5.6, 1.75, 3.8);
  const guardGlassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.14,
    metalness: 0.72,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.22,
  });
  const guardBase = new THREE.Mesh(guardBaseGeo, copingMat);
  guardBase.position.set(-22.0, 2.0, -2.6);
  const guardGlass = new THREE.Mesh(guardGlassGeo, guardGlassMat);
  guardGlass.position.set(-22.0, 2.55, -2.6);
  const guardRoof = new THREE.Mesh(guardRoofGeo, navyStoneMat);
  guardRoof.position.set(-22.0, 4.32, -2.6);
  frontGateGrp.add(guardBase, guardGlass, guardRoof);
  disposables.push(guardBaseGeo, guardRoofGeo, guardGlassGeo, guardGlassMat);

  // Raised (open) entry & exit boom barriers flanking the wide-open Front Gate vehicle lanes
  const barrierBoxGeo = new THREE.BoxGeometry(0.75, 1.45, 0.75);
  const barrierArmGeo = new THREE.BoxGeometry(5.6, 0.16, 0.16);
  const barrierStripeGeo = new THREE.BoxGeometry(0.75, 0.18, 0.18);
  const barrierRedMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4, metalness: 0.2 });
  const barrierWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.15 });
  disposables.push(barrierBoxGeo, barrierArmGeo, barrierStripeGeo, barrierRedMat, barrierWhiteMat);

  for (const side of [-1, 1] as const) {
    const barrierUnit = new THREE.Group();
    barrierUnit.position.set(side * 11.4, 0.1, -2.2);
    const housing = new THREE.Mesh(barrierBoxGeo, goldAccentMat);
    housing.position.y = 0.72;
    barrierUnit.add(housing);

    const armPivot = new THREE.Group();
    armPivot.position.set(0, 1.28, 0);
    // Raised open at ~78 degrees so inbound & outbound vehicles pass cleanly underneath
    armPivot.rotation.z = side === -1 ? 1.36 : -1.36;
    const armDir = -side;
    const armBar = new THREE.Mesh(barrierArmGeo, barrierWhiteMat);
    armBar.position.set(armDir * 2.8, 0, 0);
    armPivot.add(armBar);
    for (let st = 0; st < 4; st++) {
      const stripe = new THREE.Mesh(barrierStripeGeo, barrierRedMat);
      stripe.position.set(armDir * (0.9 + st * 1.25), 0, 0);
      armPivot.add(stripe);
    }
    barrierUnit.add(armPivot);
    frontGateGrp.add(barrierUnit);
  }

  group.add(frontGateGrp);

  // =========================================================================
  // 4. FRONT COURTYARD + LEFT & RIGHT FLANK LANDSCAPING: NEATLY LINED LUSH SHADE TREES
  // =========================================================================
  const halfL = straightLen / 2;
  const treeCoords: Array<{ x: number; z: number; scale: number; yaw: number; hasRoundPlanter?: boolean }> = [];
  const treeXCols = [46, 74, 102, 130, 158, 186];
  const treeZRows = [-276, -309, -342]; // Clean 9.3m batako sidewalk clearance from the asphalt ring road (-355.5)

  const planterStripLen = 154;
  const planterStripW = 8.4;
  const planterCurbGeo = new THREE.BoxGeometry(planterStripLen, 0.56, planterStripW);
  const planterGrassGeo = new THREE.BoxGeometry(planterStripLen - 1.2, 0.14, planterStripW - 1.2);
  disposables.push(planterCurbGeo, planterGrassGeo);

  for (const side of [-1, 1] as const) {
    const stripCenterX = side * 116;
    for (const tz of treeZRows) {
      const curb = new THREE.Mesh(planterCurbGeo, planterCurbMat);
      curb.position.set(stripCenterX, PLAZA_Y + 0.28, tz);
      const turf = new THREE.Mesh(planterGrassGeo, planterGrassMat);
      turf.position.set(stripCenterX, PLAZA_Y + 0.56, tz);
      group.add(curb, turf);
    }

    for (let r = 0; r < treeZRows.length; r++) {
      for (let c = 0; c < treeXCols.length; c++) {
        const seed = (r * 13 + c * 7 + (side > 0 ? 5 : 1)) % 11;
        treeCoords.push({
          x: side * treeXCols[c],
          z: treeZRows[r],
          scale: 0.92 + (seed / 10) * 0.22,
          yaw: seed * 0.58,
        });
      }
    }

    // A) North-East & North-West Curved Shoulder Tree Groves (continuing the 3 neat front tree rows around both flanks)
    const shoulderRadii = [276, 309, 340];
    const shoulderPhis = [-0.455 * Math.PI, -0.39 * Math.PI, -0.325 * Math.PI];
    for (let ri = 0; ri < shoulderRadii.length; ri++) {
      const rVal = shoulderRadii[ri];
      for (let pi = 0; pi < shoulderPhis.length; pi++) {
        const phi = side === 1 ? shoulderPhis[pi] : Math.PI - shoulderPhis[pi];
        const seed = (ri * 11 + pi * 7 + (side > 0 ? 3 : 2)) % 11;
        treeCoords.push({
          x: side * halfL + Math.cos(phi) * rVal,
          z: Math.sin(phi) * rVal,
          scale: 0.94 + (seed / 10) * 0.2,
          yaw: seed * 0.64,
          hasRoundPlanter: true,
        });
      }
    }

    // B) Full Left (West) & Right (East) Side Flank Lined Shade Tree Avenues wrapping along the stadium exterior
    const flankTreeCount = 13;
    const flankStartPhi = -0.255 * Math.PI;
    const flankEndPhi = 0.455 * Math.PI;
    for (let i = 0; i < flankTreeCount; i++) {
      const t = i / (flankTreeCount - 1);
      const basePhi = flankStartPhi + t * (flankEndPhi - flankStartPhi);
      const phi = side === 1 ? basePhi : Math.PI - basePhi;
      const seed = (i * 9 + (side > 0 ? 4 : 1)) % 11;
      // Primary lush shade tree avenue along the stadium concourse (r = 276, cleanly inside side parking curb r = 294)
      treeCoords.push({
        x: side * halfL + Math.cos(phi) * 276,
        z: Math.sin(phi) * 276,
        scale: 0.96 + (seed / 10) * 0.2,
        yaw: seed * 0.71,
        hasRoundPlanter: true,
      });
    }
  }

  // Raised circular landscaped planters under every curved flank & shoulder shade tree
  const roundPlanterTrees = treeCoords.filter((tc) => tc.hasRoundPlanter);
  if (roundPlanterTrees.length > 0) {
    const rCurbGeo = new THREE.CylinderGeometry(4.4, 4.7, 0.56, 12);
    const rTurfGeo = new THREE.CylinderGeometry(3.85, 3.85, 0.14, 12);
    const rCurbInst = new THREE.InstancedMesh(rCurbGeo, planterCurbMat, roundPlanterTrees.length);
    const rTurfInst = new THREE.InstancedMesh(rTurfGeo, planterGrassMat, roundPlanterTrees.length);
    rCurbInst.frustumCulled = false;
    rTurfInst.frustumCulled = false;
    for (let i = 0; i < roundPlanterTrees.length; i++) {
      const rt = roundPlanterTrees[i];
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(rt.x, PLAZA_Y + 0.28, rt.z);
      dummy.updateMatrix();
      rCurbInst.setMatrixAt(i, dummy.matrix);
      dummy.position.set(rt.x, PLAZA_Y + 0.56, rt.z);
      dummy.updateMatrix();
      rTurfInst.setMatrixAt(i, dummy.matrix);
    }
    rCurbInst.instanceMatrix.needsUpdate = true;
    rTurfInst.instanceMatrix.needsUpdate = true;
    group.add(rCurbInst, rTurfInst);
    disposables.push(rCurbGeo, rTurfGeo);
  }

  const treeCount = treeCoords.length; // 82 lush shade trees (Front + NW/NE Shoulders + Full Left & Right Flanks)
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.92, metalness: 0.02 });
  const canopyDeepMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.02 });
  const canopyMidMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.02 });
  const canopyTopMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.02 });

  const treeTrunkGeo = new THREE.CylinderGeometry(0.68, 1.12, 8.6, 8);
  const treeBranchGeo = new THREE.CylinderGeometry(0.28, 0.52, 4.8, 6);
  const canopyMainGeo = new THREE.IcosahedronGeometry(5.6, 1);
  canopyMainGeo.scale(1.22, 0.72, 1.22);
  const canopyLobeGeo = new THREE.IcosahedronGeometry(4.1, 1);
  canopyLobeGeo.scale(1.15, 0.78, 1.15);
  const canopyCrownGeo = new THREE.IcosahedronGeometry(3.8, 1);
  canopyCrownGeo.scale(1.18, 0.72, 1.18);

  const trunkInst = new THREE.InstancedMesh(treeTrunkGeo, barkMat, treeCount);
  const branchInst = new THREE.InstancedMesh(treeBranchGeo, barkMat, treeCount * 3);
  const canopyMainInst = new THREE.InstancedMesh(canopyMainGeo, canopyDeepMat, treeCount);
  const canopyLobeInst = new THREE.InstancedMesh(canopyLobeGeo, canopyMidMat, treeCount * 3);
  const canopyCrownInst = new THREE.InstancedMesh(canopyCrownGeo, canopyTopMat, treeCount);
  trunkInst.frustumCulled = false;
  branchInst.frustumCulled = false;
  canopyMainInst.frustumCulled = false;
  canopyLobeInst.frustumCulled = false;
  canopyCrownInst.frustumCulled = false;

  const deepGreens = [new THREE.Color(0x14532d), new THREE.Color(0x166534), new THREE.Color(0x155e33)];
  const midGreens = [new THREE.Color(0x15803d), new THREE.Color(0x16a34a), new THREE.Color(0x1e8e3e)];
  const topGreens = [new THREE.Color(0x22c55e), new THREE.Color(0x4ade80), new THREE.Color(0x2eb85c)];

  for (let i = 0; i < treeCount; i++) {
    const tc = treeCoords[i];
    const baseY = PLAZA_Y + 0.52;
    const s = tc.scale;

    dummy.position.set(tc.x, baseY + 4.3 * s, tc.z);
    dummy.rotation.set(0, tc.yaw, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(tc.x, baseY + 9.4 * s, tc.z);
    dummy.rotation.set(0, tc.yaw, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    canopyMainInst.setMatrixAt(i, dummy.matrix);
    canopyMainInst.setColorAt(i, deepGreens[i % deepGreens.length]);

    dummy.position.set(tc.x, baseY + 12.6 * s, tc.z);
    dummy.rotation.set(0.1, tc.yaw + 0.8, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    canopyCrownInst.setMatrixAt(i, dummy.matrix);
    canopyCrownInst.setColorAt(i, topGreens[i % topGreens.length]);

    for (let b = 0; b < 3; b++) {
      const ang = tc.yaw + (b * Math.PI * 2) / 3;
      const bIdx = i * 3 + b;

      dummy.position.set(
        tc.x + Math.cos(ang) * 1.45 * s,
        baseY + 7.2 * s,
        tc.z + Math.sin(ang) * 1.45 * s
      );
      dummy.rotation.set(Math.sin(ang) * 0.55, 0, -Math.cos(ang) * 0.55);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      branchInst.setMatrixAt(bIdx, dummy.matrix);

      dummy.position.set(
        tc.x + Math.cos(ang) * 3.8 * s,
        baseY + (9.6 + (b % 2) * 0.8) * s,
        tc.z + Math.sin(ang) * 3.8 * s
      );
      dummy.rotation.set(0, ang + 0.4, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      canopyLobeInst.setMatrixAt(bIdx, dummy.matrix);
      canopyLobeInst.setColorAt(bIdx, midGreens[(i + b) % midGreens.length]);
    }
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  branchInst.instanceMatrix.needsUpdate = true;
  canopyMainInst.instanceMatrix.needsUpdate = true;
  canopyLobeInst.instanceMatrix.needsUpdate = true;
  canopyCrownInst.instanceMatrix.needsUpdate = true;
  if (canopyMainInst.instanceColor) canopyMainInst.instanceColor.needsUpdate = true;
  if (canopyLobeInst.instanceColor) canopyLobeInst.instanceColor.needsUpdate = true;
  if (canopyCrownInst.instanceColor) canopyCrownInst.instanceColor.needsUpdate = true;
  group.add(trunkInst, branchInst, canopyMainInst, canopyLobeInst, canopyCrownInst);
  disposables.push(
    barkMat,
    canopyDeepMat,
    canopyMidMat,
    canopyTopMat,
    treeTrunkGeo,
    treeBranchGeo,
    canopyMainGeo,
    canopyLobeGeo,
    canopyCrownGeo
  );

  // Double-Arm Boulevard Street Lamps flanking the front promenade
  const lampZs = [-272, -294, -316, -338];
  const lampPositions: Array<[number, number]> = [];
  for (const lz of lampZs) {
    lampPositions.push([-19.5, lz], [19.5, lz]);
  }
  const lampPoleGeo = new THREE.CylinderGeometry(0.18, 0.28, 9.5, 8);
  const lampArmGeo = new THREE.BoxGeometry(2.8, 0.16, 0.16);
  const lampHeadGeo = new THREE.SphereGeometry(0.45, 8, 8);
  const lampPoleInst = new THREE.InstancedMesh(lampPoleGeo, ironFenceMat, lampPositions.length);
  const lampArmInst = new THREE.InstancedMesh(lampArmGeo, ironFenceMat, lampPositions.length);
  const lampHeadInst = new THREE.InstancedMesh(lampHeadGeo, warmGlowMat, lampPositions.length * 2);
  lampPoleInst.frustumCulled = false;
  lampArmInst.frustumCulled = false;
  lampHeadInst.frustumCulled = false;

  for (let i = 0; i < lampPositions.length; i++) {
    const [lx, lz] = lampPositions[i];
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(lx, PLAZA_Y + 4.75, lz);
    dummy.updateMatrix();
    lampPoleInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lx, PLAZA_Y + 9.45, lz);
    dummy.updateMatrix();
    lampArmInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lx - 1.3, PLAZA_Y + 9.25, lz);
    dummy.updateMatrix();
    lampHeadInst.setMatrixAt(i * 2, dummy.matrix);

    dummy.position.set(lx + 1.3, PLAZA_Y + 9.25, lz);
    dummy.updateMatrix();
    lampHeadInst.setMatrixAt(i * 2 + 1, dummy.matrix);
  }
  lampPoleInst.instanceMatrix.needsUpdate = true;
  lampArmInst.instanceMatrix.needsUpdate = true;
  lampHeadInst.instanceMatrix.needsUpdate = true;
  group.add(lampPoleInst, lampArmInst, lampHeadInst);
  disposables.push(lampPoleGeo, lampArmGeo, lampHeadGeo);

  // =========================================================================
  // 4B. EXTERIOR STADIUM CANTEEN / FOOD COURT PAVILIONS (WEST & EAST PLAZAS)
  //     Destination hubs for dynamic pathfinding NPCs walking from parking & tribunes
  // =========================================================================
  const navGraph = buildExteriorNavGraph(straightLen);

  const canteenWallMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.78, metalness: 0.04 });
  const canteenBaseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.82, metalness: 0.08 });
  const canteenCounterMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.52, metalness: 0.14 });
  const canteenAwningRedMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.45, metalness: 0.1 });
  const canteenAwningCreamMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.55, metalness: 0.04 });
  const canteenWindowGlowMat = new THREE.MeshBasicMaterial({ color: 0xfde68a });
  const canteenPatioMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.84, metalness: 0.04 });
  const umbrellaMats = [
    new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.55, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.55, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.55, metalness: 0.05 }),
    new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.55, metalness: 0.05 }),
  ];

  const canteenPatioGeo = new THREE.BoxGeometry(24.0, 0.24, 18.0);
  const canteenBodyGeo = new THREE.BoxGeometry(16.0, 4.4, 7.0);
  const canteenPlinthGeo = new THREE.BoxGeometry(16.4, 1.0, 7.4);
  const canteenWindowGeo = new THREE.BoxGeometry(13.2, 1.9, 0.22);
  const canteenCounterGeo = new THREE.BoxGeometry(13.8, 1.2, 1.4);
  const canteenRoofGeo = new THREE.BoxGeometry(18.6, 0.55, 10.6);
  const canteenStripeGeo = new THREE.BoxGeometry(1.55, 0.52, 2.4);
  const canteenBoardGeo = new THREE.BoxGeometry(14.8, 2.4, 0.36);
  const canteenSignGeo = new THREE.PlaneGeometry(14.2, 2.1);
  const cafePoleGeo = new THREE.CylinderGeometry(0.09, 0.11, 2.85, 7);
  const cafeTableGeo = new THREE.CylinderGeometry(1.15, 1.15, 0.14, 10);
  const cafeStoolGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.62, 8);
  const cafeUmbrellaGeo = new THREE.ConeGeometry(2.1, 0.72, 8);

  disposables.push(
    canteenWallMat,
    canteenBaseMat,
    canteenCounterMat,
    canteenAwningRedMat,
    canteenAwningCreamMat,
    canteenWindowGlowMat,
    canteenPatioMat,
    ...umbrellaMats,
    canteenPatioGeo,
    canteenBodyGeo,
    canteenPlinthGeo,
    canteenWindowGeo,
    canteenCounterGeo,
    canteenRoofGeo,
    canteenStripeGeo,
    canteenBoardGeo,
    canteenSignGeo,
    cafePoleGeo,
    cafeTableGeo,
    cafeStoolGeo,
    cafeUmbrellaGeo
  );

  const buildCanteenPavilion = (
    pos: { x: number; z: number; yaw: number },
    title: string,
    accentHex: string
  ) => {
    const cGrp = new THREE.Group();
    cGrp.position.set(pos.x, PLAZA_Y, pos.z);
    cGrp.rotation.y = pos.yaw;

    const patio = new THREE.Mesh(canteenPatioGeo, canteenPatioMat);
    patio.position.set(0, 0.12, 2.2);
    cGrp.add(patio);

    const plinth = new THREE.Mesh(canteenPlinthGeo, canteenBaseMat);
    plinth.position.set(0, 0.62, -2.4);
    const body = new THREE.Mesh(canteenBodyGeo, canteenWallMat);
    body.position.set(0, 2.42, -2.4);
    const winGlow = new THREE.Mesh(canteenWindowGeo, canteenWindowGlowMat);
    winGlow.position.set(0, 2.75, 1.12);
    const counter = new THREE.Mesh(canteenCounterGeo, canteenCounterMat);
    counter.position.set(0, 0.82, 1.65);
    const roof = new THREE.Mesh(canteenRoofGeo, navyStoneMat);
    roof.position.set(0, 4.88, -1.2);
    cGrp.add(plinth, body, winGlow, counter, roof);

    // Striped festive food-court awning canopy projecting over serving counter
    for (let s = 0; s < 11; s++) {
      const stripe = new THREE.Mesh(
        canteenStripeGeo,
        s % 2 === 0 ? canteenAwningRedMat : canteenAwningCreamMat
      );
      stripe.position.set(-7.75 + s * 1.55, 4.25, 2.8);
      stripe.rotation.x = 0.26;
      cGrp.add(stripe);
    }

    // Glowing overhead Canteen Signboard
    const signTex = createExteriorSignTexture(
      'AREA KULINER & ISTIRAHAT PENONTON',
      title,
      accentHex,
      maxAnisotropy,
      1024,
      200
    );
    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      roughness: 0.25,
      emissive: 0x1e293b,
      emissiveIntensity: 0.45,
    });
    disposables.push(signTex, signMat);

    const signBoard = new THREE.Mesh(canteenBoardGeo, navyStoneMat);
    signBoard.position.set(0, 6.25, 1.6);
    const signFaceF = new THREE.Mesh(canteenSignGeo, signMat);
    signFaceF.position.set(0, 6.25, 1.8);
    const signFaceB = new THREE.Mesh(canteenSignGeo, signMat);
    signFaceB.position.set(0, 6.25, 1.4);
    signFaceB.rotation.y = Math.PI;
    cGrp.add(signBoard, signFaceF, signFaceB);

    // 4 Outdoor Café Tables with Colorful Umbrellas & Stools on the front patio
    const tableOffsets: Array<[number, number]> = [
      [-7.4, 5.6],
      [-2.5, 7.4],
      [2.5, 7.4],
      [7.4, 5.6],
    ];
    for (let t = 0; t < tableOffsets.length; t++) {
      const [tx, tz] = tableOffsets[t];
      const pole = new THREE.Mesh(cafePoleGeo, ironFenceMat);
      pole.position.set(tx, 1.65, tz);
      const top = new THREE.Mesh(cafeTableGeo, copingMat);
      top.position.set(tx, 1.12, tz);
      const umbrella = new THREE.Mesh(cafeUmbrellaGeo, umbrellaMats[t % umbrellaMats.length]);
      umbrella.position.set(tx, 3.18, tz);
      cGrp.add(pole, top, umbrella);

      for (let st = 0; st < 3; st++) {
        const ang = (st / 3) * Math.PI * 2 + 0.4;
        const stool = new THREE.Mesh(cafeStoolGeo, canteenCounterMat);
        stool.position.set(tx + Math.cos(ang) * 1.45, 0.52, tz + Math.sin(ang) * 1.45);
        cGrp.add(stool);
      }
    }

    group.add(cGrp);
  };

  buildCanteenPavilion(navGraph.canteenPositions.west, 'KANTIN STADION BARAT', '#EA580C');
  buildCanteenPavilion(navGraph.canteenPositions.east, 'KANTIN STADION TIMUR', '#0284C7');

  // =========================================================================
  // 5. EXPANDED WRAP-AROUND CAR & MOTORCYCLE PARKING (REAR + LEFT & RIGHT SIDES OF STADIUM)
  //    Seamlessly connected to the 360° Asphalt Ring Road (NO rear perimeter gate!)
  // =========================================================================
  const parkingW = 408; // x = -204 .. +204 (joins cleanly with East & West curved side parking wings!)
  const parkingD = 88; // z = +266 .. +354 (connects right into ring road at +355.5!)
  const parkingCenterZ = 310;

  const parkingDeckGeo = new THREE.BoxGeometry(parkingW, 0.05, parkingD);
  const parkingDeck = new THREE.Mesh(parkingDeckGeo, parkingAsphaltMat);
  parkingDeck.position.set(0, ASPHALT_Y - 0.005, parkingCenterZ);

  // Wide asphalt aprons seamlessly linking the Rear Parking Lot directly into the 360° Asphalt Ring Road
  const parkConnectGeo = new THREE.BoxGeometry(parkingW, 0.05, 8.0);
  const parkConnect = new THREE.Mesh(parkConnectGeo, parkingAsphaltMat);
  parkConnect.position.set(0, ASPHALT_Y - 0.006, 355.0);

  // Expanded Curved Asphalt Side Parking Wings on BOTH West (Left) & East (Right) Flanks!
  // Spanning from slightly north of midline (phi = -0.24*PI) all the way around into the Rear Parking Lot (phi = +0.50*PI)
  const sideParkInnerR = 293.0;
  const sideParkOuterR = 356.2;
  const sideParkStartPhi = -0.24 * Math.PI;
  const sideParkEndPhi = 0.5 * Math.PI;

  const eastSideParkGeo = buildCapSectorPlanarGeometry(
    halfL,
    sideParkInnerR,
    sideParkOuterR,
    sideParkStartPhi,
    sideParkEndPhi,
    14.0,
    40
  );
  const westSideParkGeo = buildCapSectorPlanarGeometry(
    -halfL,
    sideParkInnerR,
    sideParkOuterR,
    Math.PI - sideParkEndPhi,
    Math.PI - sideParkStartPhi,
    14.0,
    40
  );
  const eastSideParkMesh = new THREE.Mesh(eastSideParkGeo, roadAsphaltMat);
  eastSideParkMesh.position.y = ASPHALT_Y - 0.006;
  const westSideParkMesh = new THREE.Mesh(westSideParkGeo, roadAsphaltMat);
  westSideParkMesh.position.y = ASPHALT_Y - 0.006;

  // Inner curved planter curbs separating the stadium side tree avenue (r=276) from the side parking decks (r=293)
  const eastSideCurbGeo = buildCapSectorPlanarGeometry(
    halfL,
    sideParkInnerR - 1.2,
    sideParkInnerR + 0.2,
    sideParkStartPhi,
    sideParkEndPhi,
    10.0,
    36
  );
  const westSideCurbGeo = buildCapSectorPlanarGeometry(
    -halfL,
    sideParkInnerR - 1.2,
    sideParkInnerR + 0.2,
    Math.PI - sideParkEndPhi,
    Math.PI - sideParkStartPhi,
    10.0,
    36
  );
  const eastSideCurb = new THREE.Mesh(eastSideCurbGeo, planterCurbMat);
  eastSideCurb.position.y = ASPHALT_Y + 0.08;
  const westSideCurb = new THREE.Mesh(westSideCurbGeo, planterCurbMat);
  westSideCurb.position.y = ASPHALT_Y + 0.08;

  // Curved yellow parking-aisle guide stripes inside East & West side parking wings (r = 315.5)
  const eastAisleStripeGeo = buildCapSectorPlanarGeometry(
    halfL,
    315.2,
    315.8,
    sideParkStartPhi + 0.03,
    sideParkEndPhi - 0.02,
    10.0,
    32
  );
  const westAisleStripeGeo = buildCapSectorPlanarGeometry(
    -halfL,
    315.2,
    315.8,
    Math.PI - sideParkEndPhi + 0.02,
    Math.PI - sideParkStartPhi - 0.03,
    10.0,
    32
  );
  const eastAisleStripe = new THREE.Mesh(eastAisleStripeGeo, paintYellowMat);
  eastAisleStripe.position.y = MARKING_Y;
  const westAisleStripe = new THREE.Mesh(westAisleStripeGeo, paintYellowMat);
  westAisleStripe.position.y = MARKING_Y;

  const curbLongGeo = new THREE.BoxGeometry(parkingW + 1.6, 0.34, 0.8);
  const curbNorth = new THREE.Mesh(curbLongGeo, planterCurbMat);
  curbNorth.position.set(0, ASPHALT_Y + 0.17, parkingCenterZ - parkingD / 2);

  const dividerIslandGeo = new THREE.BoxGeometry(5.6, 0.38, 70.0);
  const dividerIsland = new THREE.Mesh(dividerIslandGeo, planterCurbMat);
  dividerIsland.position.set(43.0, ASPHALT_Y + 0.19, 305.0);
  const dividerGrassGeo = new THREE.BoxGeometry(4.4, 0.12, 68.4);
  const dividerGrass = new THREE.Mesh(dividerGrassGeo, planterGrassMat);
  dividerGrass.position.set(43.0, ASPHALT_Y + 0.4, 305.0);

  group.add(
    parkingDeck,
    parkConnect,
    eastSideParkMesh,
    westSideParkMesh,
    eastSideCurb,
    westSideCurb,
    eastAisleStripe,
    westAisleStripe,
    curbNorth,
    dividerIsland,
    dividerGrass
  );
  disposables.push(
    parkingDeckGeo,
    parkConnectGeo,
    eastSideParkGeo,
    westSideParkGeo,
    eastSideCurbGeo,
    westSideCurbGeo,
    eastAisleStripeGeo,
    westAisleStripeGeo,
    curbLongGeo,
    dividerIslandGeo,
    dividerGrassGeo
  );

  // Parking Zone Sign Pylons (Rear + West Side + East Side)
  const buildParkingPylon = (x: number, z: number, yaw: number, sub: string, title: string, accent: string) => {
    const pylonGrp = new THREE.Group();
    pylonGrp.position.set(x, 0, z);
    pylonGrp.rotation.y = yaw;
    const postGeo = new THREE.CylinderGeometry(0.24, 0.28, 7.2, 8);
    const boardGeo = new THREE.BoxGeometry(14.5, 3.0, 0.35);
    const signTex = createExteriorSignTexture(sub, title, accent, maxAnisotropy, 1024, 224);
    const signMat = new THREE.MeshStandardMaterial({
      map: signTex,
      roughness: 0.28,
      emissive: 0x0f2554,
      emissiveIntensity: 0.4,
    });
    const signFaceGeo = new THREE.PlaneGeometry(14.0, 2.7);
    const pL = new THREE.Mesh(postGeo, ironFenceMat);
    pL.position.set(-4.8, ASPHALT_Y + 3.6, 0);
    const pR = new THREE.Mesh(postGeo, ironFenceMat);
    pR.position.set(4.8, ASPHALT_Y + 3.6, 0);
    const board = new THREE.Mesh(boardGeo, navyStoneMat);
    board.position.set(0, ASPHALT_Y + 6.8, 0);
    const faceA = new THREE.Mesh(signFaceGeo, signMat);
    faceA.position.set(0, ASPHALT_Y + 6.8, 0.2);
    const faceB = new THREE.Mesh(signFaceGeo, signMat);
    faceB.position.set(0, ASPHALT_Y + 6.8, -0.2);
    faceB.rotation.y = Math.PI;
    pylonGrp.add(pL, pR, board, faceA, faceB);
    group.add(pylonGrp);
    disposables.push(postGeo, boardGeo, signTex, signMat, signFaceGeo);
  };
  buildParkingPylon(-74, 349, 0, 'ZONA A · BELAKANG STADION', 'P · PARKIR MOBIL', '#2563EB');
  buildParkingPylon(122, 349, 0, 'ZONA B · KANOPI TEDUH', 'P · PARKIR MOTOR', '#10B981');
  buildParkingPylon(-halfL - 350, -30, Math.PI / 2, 'ZONA C · SISI KIRI STADION', 'P · PARKIR SAMPING', '#2563EB');
  buildParkingPylon(halfL + 350, -30, -Math.PI / 2, 'ZONA D · SISI KANAN STADION', 'P · PARKIR SAMPING', '#2563EB');

  // ---- 5A. CAR PARKING ZONE (Rear 4 rows + Expanded Curved Left & Right Side Flank Bays) ----
  const carRowZs = [276, 291, 317, 332];
  const carStallSpacing = 11.2;
  const carStallsPerRow = 18;
  const carStartX = -178;

  const carLinePositions: Array<{ x: number; z: number; yaw: number }> = [];
  const carWheelStopPositions: Array<{ x: number; z: number; yaw: number }> = [];
  const parkedCars: Array<{ x: number; z: number; yaw: number; colorIdx: number }> = [];

  for (let r = 0; r < carRowZs.length; r++) {
    const rz = carRowZs[r];
    const facingSouth = r % 2 === 1;
    for (let c = 0; c <= carStallsPerRow; c++) {
      const lx = carStartX + c * carStallSpacing - carStallSpacing / 2;
      carLinePositions.push({ x: lx, z: rz, yaw: 0 });
      if (c < carStallsPerRow) {
        const sx = carStartX + c * carStallSpacing;
        carWheelStopPositions.push({ x: sx, z: rz + (facingSouth ? -4.2 : 4.2), yaw: 0 });
        const occupancyHash = (r * 23 + c * 11) % 9;
        if (occupancyHash !== 2 && occupancyHash !== 6) {
          parkedCars.push({
            x: sx,
            z: rz,
            yaw: facingSouth ? 0 : Math.PI,
            colorIdx: (r * 5 + c * 3) % 8,
          });
        }
      }
    }
  }

  // Curved Side-Flank Car Parking Bays on BOTH West (-1) & East (+1) Wings!
  // 3 concentric curved stall rings (inner r=303, mid-in r=328, mid-out r=340) separated by spacious aisles
  const sideCarRings: Array<{ r: number; faceOut: boolean; wheelOffset: number }> = [
    { r: 303.0, faceOut: true, wheelOffset: -4.1 },
    { r: 328.0, faceOut: false, wheelOffset: 4.1 },
    { r: 340.5, faceOut: true, wheelOffset: -4.1 },
  ];

  for (const side of [-1, 1] as const) {
    const cx = side * halfL;
    for (let ri = 0; ri < sideCarRings.length; ri++) {
      const ring = sideCarRings[ri];
      // Leave room on East outer-south quadrant (ri === 0, phi > 0.16*PI) for extra East motorcycle canopies!
      const phiStart = sideParkStartPhi + 0.04;
      const phiEnd = side === 1 && ri === 0 ? 0.14 * Math.PI : sideParkEndPhi - 0.05;
      const arcLen = (phiEnd - phiStart) * ring.r;
      const stallCount = Math.max(8, Math.floor(arcLen / 10.6));
      const dPhi = (phiEnd - phiStart) / stallCount;

      for (let s = 0; s <= stallCount; s++) {
        const lineBasePhi = phiStart + s * dPhi;
        const linePhi = side === 1 ? lineBasePhi : Math.PI - lineBasePhi;
        const radialYaw = Math.atan2(Math.cos(linePhi), Math.sin(linePhi));
        carLinePositions.push({
          x: cx + Math.cos(linePhi) * ring.r,
          z: Math.sin(linePhi) * ring.r,
          yaw: radialYaw,
        });

        if (s < stallCount) {
          const midBasePhi = phiStart + (s + 0.5) * dPhi;
          const midPhi = side === 1 ? midBasePhi : Math.PI - midBasePhi;
          const cosP = Math.cos(midPhi);
          const sinP = Math.sin(midPhi);
          const carRadialYaw = Math.atan2(cosP, sinP);

          carWheelStopPositions.push({
            x: cx + cosP * (ring.r + ring.wheelOffset),
            z: sinP * (ring.r + ring.wheelOffset),
            yaw: carRadialYaw,
          });

          const occ = (ri * 19 + s * 7 + (side > 0 ? 4 : 1)) % 10;
          if (occ !== 2 && occ !== 7) {
            parkedCars.push({
              x: cx + cosP * ring.r,
              z: sinP * ring.r,
              yaw: ring.faceOut ? carRadialYaw : carRadialYaw + Math.PI,
              colorIdx: (ri * 3 + s * 5 + (side > 0 ? 2 : 0)) % 8,
            });
          }
        }
      }
    }
  }

  const stallLineGeo = new THREE.PlaneGeometry(0.24, 10.2);
  stallLineGeo.rotateX(-Math.PI / 2);
  const stallLineInst = new THREE.InstancedMesh(stallLineGeo, paintWhiteMat, carLinePositions.length);
  stallLineInst.frustumCulled = false;
  for (let i = 0; i < carLinePositions.length; i++) {
    const lp = carLinePositions[i];
    dummy.position.set(lp.x, MARKING_Y, lp.z);
    dummy.rotation.set(0, lp.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    stallLineInst.setMatrixAt(i, dummy.matrix);
  }
  stallLineInst.instanceMatrix.needsUpdate = true;

  const wheelStopGeo = new THREE.BoxGeometry(4.2, 0.28, 0.42);
  const wheelStopInst = new THREE.InstancedMesh(wheelStopGeo, paintYellowMat, carWheelStopPositions.length);
  wheelStopInst.frustumCulled = false;
  for (let i = 0; i < carWheelStopPositions.length; i++) {
    const wp = carWheelStopPositions[i];
    dummy.position.set(wp.x, ASPHALT_Y + 0.14, wp.z);
    dummy.rotation.set(0, wp.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    wheelStopInst.setMatrixAt(i, dummy.matrix);
  }
  wheelStopInst.instanceMatrix.needsUpdate = true;

  const aisleStripeGeo = new THREE.PlaneGeometry(206, 0.32);
  aisleStripeGeo.rotateX(-Math.PI / 2);
  const aisleLine1 = new THREE.Mesh(aisleStripeGeo, paintYellowMat);
  aisleLine1.position.set(-77, MARKING_Y, 304);
  const aisleLine2 = new THREE.Mesh(aisleStripeGeo, paintWhiteMat);
  aisleLine2.position.set(-77, MARKING_Y, 283.5);
  const aisleLine3 = new THREE.Mesh(aisleStripeGeo, paintWhiteMat);
  aisleLine3.position.set(-77, MARKING_Y, 324.5);

  group.add(stallLineInst, wheelStopInst, aisleLine1, aisleLine2, aisleLine3);
  disposables.push(stallLineGeo, wheelStopGeo, aisleStripeGeo);

  // Multi-Part Composite 3D Cars (shared materials/geometries for parked + cruising road cars)
  const carPaintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.48 });
  const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.12, metalness: 0.8 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9, metalness: 0.05 });
  const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

  const carBodyGeo = new THREE.BoxGeometry(3.8, 1.35, 7.6);
  const carCabinGeo = new THREE.BoxGeometry(3.35, 1.15, 4.1);
  const carGlassGeo = new THREE.BoxGeometry(3.42, 0.78, 3.65);
  const carWheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.48, 10);
  carWheelGeo.rotateZ(Math.PI / 2);
  const carLightGeo = new THREE.BoxGeometry(3.2, 0.32, 0.16);

  const carColors = [
    new THREE.Color(0xf8fafc),
    new THREE.Color(0x94a3b8),
    new THREE.Color(0x1e3a8a),
    new THREE.Color(0xdc2626),
    new THREE.Color(0x1e293b),
    new THREE.Color(0x047857),
    new THREE.Color(0xd97706),
    new THREE.Color(0x0284c7),
  ];

  const wheelLocalOffsets: Array<[number, number]> = [
    [-1.82, 2.25],
    [1.82, 2.25],
    [-1.82, -2.25],
    [1.82, -2.25],
  ];

  // Static parked cars
  const carCount = parkedCars.length;
  const carBodyInst = new THREE.InstancedMesh(carBodyGeo, carPaintMat, carCount);
  const carCabinInst = new THREE.InstancedMesh(carCabinGeo, carPaintMat, carCount);
  const carGlassInst = new THREE.InstancedMesh(carGlassGeo, carGlassMat, carCount);
  const carWheelInst = new THREE.InstancedMesh(carWheelGeo, tireMat, carCount * 4);
  const carHeadInst = new THREE.InstancedMesh(carLightGeo, warmGlowMat, carCount);
  const carTailInst = new THREE.InstancedMesh(carLightGeo, tailLightMat, carCount);
  carBodyInst.frustumCulled = false;
  carCabinInst.frustumCulled = false;
  carGlassInst.frustumCulled = false;
  carWheelInst.frustumCulled = false;
  carHeadInst.frustumCulled = false;
  carTailInst.frustumCulled = false;

  const setCarTransform = (
    bodyInst: THREE.InstancedMesh,
    cabinInst: THREE.InstancedMesh,
    glassInst: THREE.InstancedMesh,
    wheelInst: THREE.InstancedMesh,
    headInst: THREE.InstancedMesh,
    tailInst: THREE.InstancedMesh,
    idx: number,
    cx: number,
    cz: number,
    yaw: number,
    tint?: THREE.Color
  ) => {
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    dummy.rotation.set(0, yaw, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(cx, ASPHALT_Y + 1.12, cz);
    dummy.updateMatrix();
    bodyInst.setMatrixAt(idx, dummy.matrix);
    if (tint) bodyInst.setColorAt(idx, tint);

    const cabOffZ = -0.35;
    dummy.position.set(cx + sinY * cabOffZ, ASPHALT_Y + 2.28, cz + cosY * cabOffZ);
    dummy.updateMatrix();
    cabinInst.setMatrixAt(idx, dummy.matrix);
    if (tint) cabinInst.setColorAt(idx, tint);

    dummy.position.set(cx + sinY * cabOffZ, ASPHALT_Y + 2.22, cz + cosY * cabOffZ);
    dummy.updateMatrix();
    glassInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(cx + sinY * 3.82, ASPHALT_Y + 1.18, cz + cosY * 3.82);
    dummy.updateMatrix();
    headInst.setMatrixAt(idx, dummy.matrix);

    dummy.position.set(cx - sinY * 3.82, ASPHALT_Y + 1.18, cz - cosY * 3.82);
    dummy.updateMatrix();
    tailInst.setMatrixAt(idx, dummy.matrix);

    for (let w = 0; w < 4; w++) {
      const [wx, wz] = wheelLocalOffsets[w];
      const worldX = cx + cosY * wx + sinY * wz;
      const worldZ = cz - sinY * wx + cosY * wz;
      dummy.position.set(worldX, ASPHALT_Y + 0.62, worldZ);
      dummy.updateMatrix();
      wheelInst.setMatrixAt(idx * 4 + w, dummy.matrix);
    }
  };

  for (let i = 0; i < carCount; i++) {
    const car = parkedCars[i];
    setCarTransform(
      carBodyInst,
      carCabinInst,
      carGlassInst,
      carWheelInst,
      carHeadInst,
      carTailInst,
      i,
      car.x,
      car.z,
      car.yaw,
      carColors[car.colorIdx]
    );
  }
  carBodyInst.instanceMatrix.needsUpdate = true;
  carCabinInst.instanceMatrix.needsUpdate = true;
  carGlassInst.instanceMatrix.needsUpdate = true;
  carWheelInst.instanceMatrix.needsUpdate = true;
  carHeadInst.instanceMatrix.needsUpdate = true;
  carTailInst.instanceMatrix.needsUpdate = true;
  if (carBodyInst.instanceColor) carBodyInst.instanceColor.needsUpdate = true;
  if (carCabinInst.instanceColor) carCabinInst.instanceColor.needsUpdate = true;
  group.add(carBodyInst, carCabinInst, carGlassInst, carWheelInst, carHeadInst, carTailInst);

  // ---- 5A-2. ANIMATED CRUISING CARS ON RING ROAD + VEHICLES DRIVING IN & OUT THROUGH THE OPEN FRONT GATE ----
  // 8 inner-lane ring road cruisers + 18 gate-entry/exit vehicles flowing continuously from City Avenue -> Open Front Gate -> Stadium Ring Road -> Open Front Gate -> City Avenue!
  const ringRoadCarCount = 8;
  const gateTrafficCarCount = 18;
  const totalRoadCarCount = ringRoadCarCount + gateTrafficCarCount;

  const roadCars: Array<{ radius: number; s0: number; speedS: number; dir: 1 | -1; colorIdx: number }> = [];
  for (let i = 0; i < ringRoadCarCount; i++) {
    roadCars.push({
      radius: 359.5, // inner lane (clockwise, dir = -1) — zero conflicts with gate-entry traffic on outer lane!
      s0: i / ringRoadCarCount + 0.04,
      speedS: 0.0098 + (i % 3) * 0.001,
      dir: -1,
      colorIdx: (i * 3 + 1) % carColors.length,
    });
  }

  // Smooth non-crossing CatmullRomCurve3 connecting North City Avenue -> Open Front Gate Entry Lane (x=-5.6) ->
  // Outer Ring Road (r=367.5, CCW around West Parking -> Rear Parking -> East Parking) -> Open Front Gate Exit Lane (x=+5.6) -> North City Avenue
  const gateTrafficWaypoints: THREE.Vector3[] = [
    // Approach straight South down North City Grand Avenue & through Wide-Open Front Gate (Entry Lane x = -5.6)
    new THREE.Vector3(-5.6, 0, -720),
    new THREE.Vector3(-5.6, 0, -560),
    new THREE.Vector3(-5.6, 0, -440),
    new THREE.Vector3(-5.6, 0, -396),
    new THREE.Vector3(-5.6, 0, -376), // Passes directly through Open Front Gate!
    new THREE.Vector3(-8.2, 0, -369.5),
    new THREE.Vector3(-34, 0, -367.5),
    new THREE.Vector3(-halfL * 0.55, 0, -367.5),
    new THREE.Vector3(-halfL, 0, -367.5),
  ];
  // West curved flank around West Side Parking (r = 367.5, heading South)
  for (let k = 1; k <= 7; k++) {
    const theta = -Math.PI / 2 - (k / 8) * Math.PI;
    gateTrafficWaypoints.push(
      new THREE.Vector3(-halfL + Math.cos(theta) * 367.5, 0, Math.sin(theta) * 367.5)
    );
  }
  // South Rear Parking straightaway (heading East)
  gateTrafficWaypoints.push(
    new THREE.Vector3(-halfL, 0, 367.5),
    new THREE.Vector3(-halfL * 0.35, 0, 367.5),
    new THREE.Vector3(halfL * 0.35, 0, 367.5),
    new THREE.Vector3(halfL, 0, 367.5)
  );
  // East curved flank around East Side Parking (r = 367.5, heading North)
  for (let k = 1; k <= 7; k++) {
    const theta = Math.PI / 2 - (k / 8) * Math.PI;
    gateTrafficWaypoints.push(
      new THREE.Vector3(halfL + Math.cos(theta) * 367.5, 0, Math.sin(theta) * 367.5)
    );
  }
  // Return along North Ring Road & exit straight North through Wide-Open Front Gate (Exit Lane x = +5.6)
  gateTrafficWaypoints.push(
    new THREE.Vector3(halfL, 0, -367.5),
    new THREE.Vector3(halfL * 0.55, 0, -367.5),
    new THREE.Vector3(34, 0, -367.5),
    new THREE.Vector3(8.2, 0, -369.5),
    new THREE.Vector3(5.6, 0, -376), // Exits directly through Open Front Gate!
    new THREE.Vector3(5.6, 0, -396),
    new THREE.Vector3(5.6, 0, -440),
    new THREE.Vector3(5.6, 0, -560),
    new THREE.Vector3(5.6, 0, -720)
  );

  const gateTrafficCurve = new THREE.CatmullRomCurve3(gateTrafficWaypoints, false, 'centripetal', 0.25);
  const gateTrafficCars: Array<{ u0: number; speedU: number; colorIdx: number }> = [];
  for (let i = 0; i < gateTrafficCarCount; i++) {
    gateTrafficCars.push({
      u0: i / gateTrafficCarCount,
      speedU: 0.0086, // uniform convoy speed (~33 m/s) so cars maintain clean spacing & never overlap
      colorIdx: (i * 5 + 2) % carColors.length,
    });
  }

  const roadCarBodyInst = new THREE.InstancedMesh(carBodyGeo, carPaintMat, totalRoadCarCount);
  const roadCarCabinInst = new THREE.InstancedMesh(carCabinGeo, carPaintMat, totalRoadCarCount);
  const roadCarGlassInst = new THREE.InstancedMesh(carGlassGeo, carGlassMat, totalRoadCarCount);
  const roadCarWheelInst = new THREE.InstancedMesh(carWheelGeo, tireMat, totalRoadCarCount * 4);
  const roadCarHeadInst = new THREE.InstancedMesh(carLightGeo, warmGlowMat, totalRoadCarCount);
  const roadCarTailInst = new THREE.InstancedMesh(carLightGeo, tailLightMat, totalRoadCarCount);
  roadCarBodyInst.frustumCulled = false;
  roadCarCabinInst.frustumCulled = false;
  roadCarGlassInst.frustumCulled = false;
  roadCarWheelInst.frustumCulled = false;
  roadCarHeadInst.frustumCulled = false;
  roadCarTailInst.frustumCulled = false;
  for (let i = 0; i < ringRoadCarCount; i++) {
    const tint = carColors[roadCars[i].colorIdx];
    roadCarBodyInst.setColorAt(i, tint);
    roadCarCabinInst.setColorAt(i, tint);
  }
  for (let i = 0; i < gateTrafficCarCount; i++) {
    const tint = carColors[gateTrafficCars[i].colorIdx];
    const instIdx = ringRoadCarCount + i;
    roadCarBodyInst.setColorAt(instIdx, tint);
    roadCarCabinInst.setColorAt(instIdx, tint);
  }
  if (roadCarBodyInst.instanceColor) roadCarBodyInst.instanceColor.needsUpdate = true;
  if (roadCarCabinInst.instanceColor) roadCarCabinInst.instanceColor.needsUpdate = true;
  group.add(
    roadCarBodyInst,
    roadCarCabinInst,
    roadCarGlassInst,
    roadCarWheelInst,
    roadCarHeadInst,
    roadCarTailInst
  );

  disposables.push(
    carPaintMat,
    carGlassMat,
    tireMat,
    tailLightMat,
    carBodyGeo,
    carCabinGeo,
    carGlassGeo,
    carWheelGeo,
    carLightGeo
  );

  // ---- 5B. MOTORCYCLE PARKING ZONE (3 Shaded Canopy Shelters + Parked Motorcycles) ----
  const motoCanopyZs = [278, 305, 332];
  const canopyLen = 122;
  const canopyCenterX = 121;
  const canopyW = 13.2;

  const canopyRoofMat = new THREE.MeshStandardMaterial({
    color: 0x1d4ed8,
    roughness: 0.36,
    metalness: 0.45,
  });
  const canopyRoofGeo = new THREE.BoxGeometry(canopyLen, 0.32, canopyW);
  const canopyTrimGeo = new THREE.BoxGeometry(canopyLen + 0.4, 0.44, 0.45);
  const canopyPostGeo = new THREE.CylinderGeometry(0.24, 0.28, 4.8, 8);
  const motoBayLineGeo = new THREE.PlaneGeometry(canopyLen - 4, 0.22);
  motoBayLineGeo.rotateX(-Math.PI / 2);
  disposables.push(canopyRoofMat, canopyRoofGeo, canopyTrimGeo, canopyPostGeo, motoBayLineGeo);

  for (const cz of motoCanopyZs) {
    const roof = new THREE.Mesh(canopyRoofGeo, canopyRoofMat);
    roof.position.set(canopyCenterX, ASPHALT_Y + 4.95, cz);
    roof.rotation.x = 0.06;
    const trimF = new THREE.Mesh(canopyTrimGeo, copingMat);
    trimF.position.set(canopyCenterX, ASPHALT_Y + 4.55, cz + canopyW / 2);
    const trimB = new THREE.Mesh(canopyTrimGeo, copingMat);
    trimB.position.set(canopyCenterX, ASPHALT_Y + 5.35, cz - canopyW / 2);
    const bayLine = new THREE.Mesh(motoBayLineGeo, paintWhiteMat);
    bayLine.position.set(canopyCenterX, MARKING_Y, cz);
    group.add(roof, trimF, trimB, bayLine);

    for (let px = 66; px <= 176; px += 22) {
      const post = new THREE.Mesh(canopyPostGeo, ironFenceMat);
      post.position.set(px, ASPHALT_Y + 2.4, cz);
      group.add(post);
    }
  }

  // Extra Shaded Motorcycle Canopy Shelters curving neatly along the South-East Side Parking Wing!
  const sideMotoPhis = [0.22 * Math.PI, 0.34 * Math.PI];
  const sideCanopyLen = 46;
  const sideCanopyRoofGeo = new THREE.BoxGeometry(sideCanopyLen, 0.32, canopyW);
  const sideCanopyTrimGeo = new THREE.BoxGeometry(sideCanopyLen + 0.4, 0.44, 0.45);
  disposables.push(sideCanopyRoofGeo, sideCanopyTrimGeo);

  const parkedMotos: Array<{ x: number; z: number; yaw: number; colorIdx: number }> = [];
  for (let sIdx = 0; sIdx < sideMotoPhis.length; sIdx++) {
    const phi = sideMotoPhis[sIdx];
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const mx = halfL + cosP * 303.5;
    const mz = sinP * 303.5;
    const tangYaw = Math.atan2(-sinP, cosP);

    const sCanopyGrp = new THREE.Group();
    sCanopyGrp.position.set(mx, 0, mz);
    sCanopyGrp.rotation.y = tangYaw;

    const roof = new THREE.Mesh(sideCanopyRoofGeo, canopyRoofMat);
    roof.position.set(0, ASPHALT_Y + 4.95, 0);
    roof.rotation.x = 0.06;
    const trimF = new THREE.Mesh(sideCanopyTrimGeo, copingMat);
    trimF.position.set(0, ASPHALT_Y + 4.55, canopyW / 2);
    const trimB = new THREE.Mesh(sideCanopyTrimGeo, copingMat);
    trimB.position.set(0, ASPHALT_Y + 5.35, -canopyW / 2);
    sCanopyGrp.add(roof, trimF, trimB);

    for (let px = -18; px <= 18; px += 18) {
      const post = new THREE.Mesh(canopyPostGeo, ironFenceMat);
      post.position.set(px, ASPHALT_Y + 2.4, 0);
      sCanopyGrp.add(post);
    }
    group.add(sCanopyGrp);

    // Populate parked motorcycles neatly under each curved side canopy
    const cosT = Math.cos(tangYaw);
    const sinT = Math.sin(tangYaw);
    for (const rowSide of [-1, 1] as const) {
      for (let m = 0; m < 7; m++) {
        if ((sIdx * 11 + m * 3 + (rowSide > 0 ? 2 : 0)) % 8 === 0) continue;
        const localX = -18 + m * 6.0;
        const localZ = rowSide * 3.1;
        parkedMotos.push({
          x: mx + cosT * localX + sinT * localZ,
          z: mz - sinT * localX + cosT * localZ,
          yaw: tangYaw + (rowSide === -1 ? Math.PI : 0),
          colorIdx: (sIdx * 5 + m * 2 + (rowSide > 0 ? 1 : 0)) % 8,
        });
      }
    }
  }

  for (let cIdx = 0; cIdx < motoCanopyZs.length; cIdx++) {
    const cz = motoCanopyZs[cIdx];
    for (const rowSide of [-1, 1] as const) {
      const mz = cz + rowSide * 3.1;
      for (let m = 0; m < 20; m++) {
        if ((cIdx * 17 + m * 5 + (rowSide > 0 ? 3 : 0)) % 7 === 0) continue;
        parkedMotos.push({
          x: 66 + m * 5.75,
          z: mz,
          yaw: rowSide === -1 ? Math.PI : 0,
          colorIdx: (cIdx * 4 + m * 3 + (rowSide > 0 ? 1 : 0)) % 8,
        });
      }
    }
  }

  const motoCount = parkedMotos.length;
  const motoBodyGeo = new THREE.BoxGeometry(1.05, 0.95, 3.1);
  const motoSeatGeo = new THREE.BoxGeometry(0.92, 0.32, 1.55);
  const motoHandleGeo = new THREE.BoxGeometry(1.55, 0.22, 0.24);
  const motoShieldGeo = new THREE.BoxGeometry(0.92, 0.85, 0.22);
  const motoWheelGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.32, 8);
  motoWheelGeo.rotateZ(Math.PI / 2);

  const motoBodyInst = new THREE.InstancedMesh(motoBodyGeo, carPaintMat, motoCount);
  const motoSeatInst = new THREE.InstancedMesh(motoSeatGeo, tireMat, motoCount);
  const motoHandleInst = new THREE.InstancedMesh(motoHandleGeo, ironFenceMat, motoCount);
  const motoShieldInst = new THREE.InstancedMesh(motoShieldGeo, carGlassMat, motoCount);
  const motoWheelInst = new THREE.InstancedMesh(motoWheelGeo, tireMat, motoCount * 2);
  motoBodyInst.frustumCulled = false;
  motoSeatInst.frustumCulled = false;
  motoHandleInst.frustumCulled = false;
  motoShieldInst.frustumCulled = false;
  motoWheelInst.frustumCulled = false;

  for (let i = 0; i < motoCount; i++) {
    const moto = parkedMotos[i];
    const tint = carColors[moto.colorIdx];
    const cosY = Math.cos(moto.yaw);
    const sinY = Math.sin(moto.yaw);

    dummy.rotation.set(0, moto.yaw, 0);
    dummy.scale.set(1, 1, 1);

    dummy.position.set(moto.x, ASPHALT_Y + 0.95, moto.z);
    dummy.updateMatrix();
    motoBodyInst.setMatrixAt(i, dummy.matrix);
    motoBodyInst.setColorAt(i, tint);

    dummy.position.set(moto.x - sinY * 0.42, ASPHALT_Y + 1.48, moto.z - cosY * 0.42);
    dummy.updateMatrix();
    motoSeatInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(moto.x + sinY * 1.05, ASPHALT_Y + 1.82, moto.z + cosY * 1.05);
    dummy.updateMatrix();
    motoHandleInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(moto.x + sinY * 1.28, ASPHALT_Y + 1.65, moto.z + cosY * 1.28);
    dummy.updateMatrix();
    motoShieldInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(moto.x + sinY * 1.15, ASPHALT_Y + 0.52, moto.z + cosY * 1.15);
    dummy.updateMatrix();
    motoWheelInst.setMatrixAt(i * 2, dummy.matrix);

    dummy.position.set(moto.x - sinY * 1.15, ASPHALT_Y + 0.52, moto.z - cosY * 1.15);
    dummy.updateMatrix();
    motoWheelInst.setMatrixAt(i * 2 + 1, dummy.matrix);
  }
  motoBodyInst.instanceMatrix.needsUpdate = true;
  motoSeatInst.instanceMatrix.needsUpdate = true;
  motoHandleInst.instanceMatrix.needsUpdate = true;
  motoShieldInst.instanceMatrix.needsUpdate = true;
  motoWheelInst.instanceMatrix.needsUpdate = true;
  if (motoBodyInst.instanceColor) motoBodyInst.instanceColor.needsUpdate = true;
  group.add(motoBodyInst, motoSeatInst, motoHandleInst, motoShieldInst, motoWheelInst);
  disposables.push(motoBodyGeo, motoSeatGeo, motoHandleGeo, motoShieldGeo, motoWheelGeo);

  // Parking-Lot Tall Floodlight Poles (Rear + Expanded Left & Right Side Parking Wings)
  const parkLightCoords: Array<[number, number]> = [
    [-160, 268],
    [-80, 268],
    [0, 268],
    [100, 268],
    [168, 268],
    [-160, 351],
    [-80, 351],
    [0, 351],
    [100, 351],
    [168, 351],
  ];
  for (const side of [-1, 1] as const) {
    for (const pAngle of [-0.18 * Math.PI, 0.04 * Math.PI, 0.26 * Math.PI]) {
      const phi = side === 1 ? pAngle : Math.PI - pAngle;
      parkLightCoords.push(
        [side * halfL + Math.cos(phi) * 296, Math.sin(phi) * 296],
        [side * halfL + Math.cos(phi) * 351, Math.sin(phi) * 351]
      );
    }
  }
  const pLampPoleGeo = new THREE.CylinderGeometry(0.22, 0.34, 14.0, 8);
  const pLampHeadGeo = new THREE.BoxGeometry(2.6, 0.55, 1.1);
  const pLampPoleInst = new THREE.InstancedMesh(pLampPoleGeo, ironFenceMat, parkLightCoords.length);
  const pLampHeadInst = new THREE.InstancedMesh(pLampHeadGeo, warmGlowMat, parkLightCoords.length);
  pLampPoleInst.frustumCulled = false;
  pLampHeadInst.frustumCulled = false;
  for (let i = 0; i < parkLightCoords.length; i++) {
    const [px, pz] = parkLightCoords[i];
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(px, ASPHALT_Y + 7.0, pz);
    dummy.updateMatrix();
    pLampPoleInst.setMatrixAt(i, dummy.matrix);
    dummy.position.set(px, ASPHALT_Y + 14.1, pz);
    dummy.updateMatrix();
    pLampHeadInst.setMatrixAt(i, dummy.matrix);
  }
  pLampPoleInst.instanceMatrix.needsUpdate = true;
  pLampHeadInst.instanceMatrix.needsUpdate = true;
  group.add(pLampPoleInst, pLampHeadInst);
  disposables.push(pLampPoleGeo, pLampHeadGeo);

  // =========================================================================
  // 6. BUSTLING ANIMATED EXTERIOR PEDESTRIANS WALKING IN & OUT OF THE STADIUM (~180 PEOPLE)
  // =========================================================================
  const pedRoutes: PedestrianRoute[] = [];

  // A) 76 visitors streaming IN & OUT along the central front promenade between Front Gate & Stadium Main Gate
  for (let i = 0; i < 76; i++) {
    const dirSign: 1 | -1 = i % 2 === 0 ? 1 : -1;
    const laneX = ((i * 7) % 23) - 11.0 + ((i % 3) - 1) * 0.45;
    pedRoutes.push({
      kind: 'linear',
      x1: laneX,
      z1: -412, // outside grand front gate
      x2: laneX * 0.72,
      z2: -246, // right inside attached stadium main gate
      speed: 4.2 + (i % 6) * 0.62,
      phase: (i / 76) * 100 + (i % 5) * 1.7,
      scale: 1.25 + (i % 4) * 0.08,
      dirSign,
    });
  }

  // B) 44 visitors strolling along shaded left & right front yard walkways between the lined tree rows
  const frontWalkwayZs = [-261, -292, -325, -350];
  for (let i = 0; i < 44; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const wz = frontWalkwayZs[i % frontWalkwayZs.length] + ((i % 3) - 1) * 1.4;
    pedRoutes.push({
      kind: 'linear',
      x1: side * 19,
      z1: wz,
      x2: side * 190,
      z2: wz,
      speed: 3.6 + (i % 5) * 0.52,
      phase: (i / 44) * 90 + (i % 7) * 2.1,
      scale: 1.24 + (i % 4) * 0.08,
      dirSign: i % 4 < 2 ? 1 : -1,
    });
  }

  // C) 48 visitors walking around the stadium batako concourse (cleanly clear of flank trees & expanded side parking)
  const concourseRadii = [260.5, 264.0, 267.5, 285.5, 289.0];
  for (let i = 0; i < 48; i++) {
    const concourseR = concourseRadii[i % concourseRadii.length];
    pedRoutes.push({
      kind: 'oval',
      radius: concourseR,
      speedS: 0.002 + (i % 5) * 0.00038,
      s0: i / 48 + (i % 3) * 0.012,
      dirSign: i % 2 === 0 ? 1 : -1,
      phase: i * 1.37,
      scale: 1.26 + (i % 4) * 0.08,
    });
  }

  // D) 22 visitors walking between the rear Car & Motorcycle Parking Lot and the rear stadium concourse
  for (let i = 0; i < 22; i++) {
    const px = -165 + i * 15.8;
    pedRoutes.push({
      kind: 'linear',
      x1: px,
      z1: 260,
      x2: px,
      z2: 348,
      speed: 3.5 + (i % 4) * 0.55,
      phase: i * 5.2,
      scale: 1.25 + (i % 3) * 0.08,
      dirSign: i % 2 === 0 ? 1 : -1,
    });
  }

  // E) 96 Dynamic A* Pathfinding NPCs navigating dynamically between Parking Entrances -> Canteens -> Tribune Entrances!
  const pathAgents = createPathfindingNpcAgents(navGraph, 96);
  const staticPedCount = pedRoutes.length;
  const pedCount = staticPedCount + pathAgents.length; // 286 animated exterior pedestrians (zero extra draw calls!)
  const pedMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const pedTorsoGeo = new THREE.BoxGeometry(0.46, 0.64, 0.26);
  const pedHeadGeo = new THREE.SphereGeometry(0.21, 7, 5);
  const pedHairGeo = new THREE.SphereGeometry(0.222, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const pedLegGeo = new THREE.BoxGeometry(0.16, 0.62, 0.17);
  pedLegGeo.translate(0, -0.31, 0);
  const pedArmGeo = new THREE.BoxGeometry(0.13, 0.52, 0.14);
  pedArmGeo.translate(0, -0.24, 0);

  const pedTorsoInst = new THREE.InstancedMesh(pedTorsoGeo, pedMat, pedCount);
  const pedHeadInst = new THREE.InstancedMesh(pedHeadGeo, pedMat, pedCount);
  const pedHairInst = new THREE.InstancedMesh(pedHairGeo, pedMat, pedCount);
  const pedLegLInst = new THREE.InstancedMesh(pedLegGeo, pedMat, pedCount);
  const pedLegRInst = new THREE.InstancedMesh(pedLegGeo, pedMat, pedCount);
  const pedArmLInst = new THREE.InstancedMesh(pedArmGeo, pedMat, pedCount);
  const pedArmRInst = new THREE.InstancedMesh(pedArmGeo, pedMat, pedCount);

  const pedInsts = [
    pedTorsoInst,
    pedHeadInst,
    pedHairInst,
    pedLegLInst,
    pedLegRInst,
    pedArmLInst,
    pedArmRInst,
  ];
  for (const inst of pedInsts) {
    inst.frustumCulled = false;
  }

  const pedShirtColors = [
    new THREE.Color(0xef4444),
    new THREE.Color(0x2563eb),
    new THREE.Color(0xfacc15),
    new THREE.Color(0xf97316),
    new THREE.Color(0x10b981),
    new THREE.Color(0xf8fafc),
    new THREE.Color(0x8b5cf6),
    new THREE.Color(0x06b6d4),
    new THREE.Color(0xec4899),
  ];
  const pedPantsColors = [
    new THREE.Color(0x0f172a),
    new THREE.Color(0x1e293b),
    new THREE.Color(0x1e3a8a),
    new THREE.Color(0x334155),
  ];
  const pedSkinColors = [
    new THREE.Color(0xf6c8a5),
    new THREE.Color(0xe5b089),
    new THREE.Color(0xd2996c),
    new THREE.Color(0xfad4b8),
  ];
  const pedHairColors = [
    new THREE.Color(0x111827),
    new THREE.Color(0x3b2314),
    new THREE.Color(0x78350f),
    new THREE.Color(0x1f2937),
  ];

  for (let i = 0; i < pedCount; i++) {
    const shirt = pedShirtColors[(i * 3) % pedShirtColors.length];
    const pants = pedPantsColors[(i * 5) % pedPantsColors.length];
    const skin = pedSkinColors[(i * 7) % pedSkinColors.length];
    const hair = pedHairColors[(i * 11) % pedHairColors.length];
    pedTorsoInst.setColorAt(i, shirt);
    pedArmLInst.setColorAt(i, shirt);
    pedArmRInst.setColorAt(i, shirt);
    pedLegLInst.setColorAt(i, pants);
    pedLegRInst.setColorAt(i, pants);
    pedHeadInst.setColorAt(i, skin);
    pedHairInst.setColorAt(i, hair);
  }
  for (const inst of pedInsts) {
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }
  disposables.push(pedMat, pedTorsoGeo, pedHeadGeo, pedHairGeo, pedLegGeo, pedArmGeo);

  // =========================================================================
  // 7. BUSTLING SURROUNDING CITY & ROAD NETWORK OUTSIDE THE STADIUM FENCE
  // =========================================================================
  const surroundingCity = createSurroundingCity({
    straightLen,
    midR,
    compoundR,
    maxAnisotropy,
  });
  group.add(surroundingCity.group);
  disposables.push(...surroundingCity.disposables);

  // Reusable zero-GC scratch objects for per-frame pedestrian, pathfinding & gate vehicle updates
  const _poseTmp: TrackPose = { x: 0, z: 0, yaw: 0, fx: 1, fz: 0 };
  const _curvePosTmp = new THREE.Vector3();
  const _curveTanTmp = new THREE.Vector3();
  const _pedDummy = new THREE.Object3D();
  _pedDummy.rotation.order = 'YXZ';
  let lastElapsed = -1;

  const writePedestrianPose = (
    idx: number,
    px: number,
    pz: number,
    yaw: number,
    sc: number,
    walkCycle: number,
    isMoving: boolean
  ) => {
    const swing = isMoving ? Math.sin(walkCycle) * 0.58 : 0;
    const bob = isMoving ? Math.abs(Math.cos(walkCycle)) * 0.08 * sc : 0;
    const baseY = PLAZA_Y + bob;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);

    _pedDummy.scale.set(sc, sc, sc);

    // Torso
    _pedDummy.position.set(px, baseY + 0.94 * sc, pz);
    _pedDummy.rotation.set(isMoving ? 0.05 : 0, yaw, 0);
    _pedDummy.updateMatrix();
    pedTorsoInst.setMatrixAt(idx, _pedDummy.matrix);

    // Head & Hair
    _pedDummy.position.set(px, baseY + 1.48 * sc, pz);
    _pedDummy.rotation.set(0, yaw, 0);
    _pedDummy.updateMatrix();
    pedHeadInst.setMatrixAt(idx, _pedDummy.matrix);

    _pedDummy.position.set(px, baseY + 1.51 * sc, pz);
    _pedDummy.updateMatrix();
    pedHairInst.setMatrixAt(idx, _pedDummy.matrix);

    // Left & Right Legs swinging in realistic walking stride
    const legOffX = 0.13 * sc;
    _pedDummy.position.set(px - cosY * legOffX, baseY + 0.64 * sc, pz + sinY * legOffX);
    _pedDummy.rotation.set(swing, yaw, 0);
    _pedDummy.updateMatrix();
    pedLegLInst.setMatrixAt(idx, _pedDummy.matrix);

    _pedDummy.position.set(px + cosY * legOffX, baseY + 0.64 * sc, pz - sinY * legOffX);
    _pedDummy.rotation.set(-swing, yaw, 0);
    _pedDummy.updateMatrix();
    pedLegRInst.setMatrixAt(idx, _pedDummy.matrix);

    // Left & Right Arms swinging counter-phase to legs
    const armOffX = 0.31 * sc;
    _pedDummy.position.set(px - cosY * armOffX, baseY + 1.2 * sc, pz + sinY * armOffX);
    _pedDummy.rotation.set(-swing * 0.85, yaw, 0.08);
    _pedDummy.updateMatrix();
    pedArmLInst.setMatrixAt(idx, _pedDummy.matrix);

    _pedDummy.position.set(px + cosY * armOffX, baseY + 1.2 * sc, pz - sinY * armOffX);
    _pedDummy.rotation.set(swing * 0.85, yaw, -0.08);
    _pedDummy.updateMatrix();
    pedArmRInst.setMatrixAt(idx, _pedDummy.matrix);
  };

  function update(elapsed: number) {
    const dt = lastElapsed < 0 ? 0 : Math.min(Math.max(elapsed - lastElapsed, 0), 0.12);
    lastElapsed = elapsed;

    // 0. Update bustling surrounding city traffic (cars, city buses & city sidewalk pedestrians)
    surroundingCity.update(elapsed);

    // 1A. Update 8 animated cruising cars on the inner 360° Asphalt Ring Road
    for (let i = 0; i < ringRoadCarCount; i++) {
      const rc = roadCars[i];
      const s = ((rc.s0 + elapsed * rc.speedS * rc.dir) % 1 + 1) % 1;
      const p = evaluateStadiumOval(s, rc.radius, straightLen, midR, _poseTmp);
      const yaw = rc.dir === 1 ? p.yaw : p.yaw + Math.PI;
      setCarTransform(
        roadCarBodyInst,
        roadCarCabinInst,
        roadCarGlassInst,
        roadCarWheelInst,
        roadCarHeadInst,
        roadCarTailInst,
        i,
        p.x,
        p.z,
        yaw
      );
    }

    // 1B. Update 18 animated vehicles actively driving IN & OUT through the Wide-Open Front Gate
    for (let i = 0; i < gateTrafficCarCount; i++) {
      const gc = gateTrafficCars[i];
      const u = ((gc.u0 + elapsed * gc.speedU) % 1 + 1) % 1;
      gateTrafficCurve.getPointAt(u, _curvePosTmp);
      gateTrafficCurve.getTangentAt(u, _curveTanTmp);
      const yaw = Math.atan2(_curveTanTmp.x, _curveTanTmp.z);
      setCarTransform(
        roadCarBodyInst,
        roadCarCabinInst,
        roadCarGlassInst,
        roadCarWheelInst,
        roadCarHeadInst,
        roadCarTailInst,
        ringRoadCarCount + i,
        _curvePosTmp.x,
        _curvePosTmp.z,
        yaw
      );
    }

    roadCarBodyInst.instanceMatrix.needsUpdate = true;
    roadCarCabinInst.instanceMatrix.needsUpdate = true;
    roadCarGlassInst.instanceMatrix.needsUpdate = true;
    roadCarWheelInst.instanceMatrix.needsUpdate = true;
    roadCarHeadInst.instanceMatrix.needsUpdate = true;
    roadCarTailInst.instanceMatrix.needsUpdate = true;

    // 2A. Update static-loop exterior pedestrians walking around the front plaza & concourses
    for (let i = 0; i < staticPedCount; i++) {
      const route = pedRoutes[i];
      let px = 0;
      let pz = 0;
      let yaw = 0;
      let strideFreq = 7.2;

      if (route.kind === 'linear') {
        const dx = route.x2 - route.x1;
        const dz = route.z2 - route.z1;
        const dist = Math.hypot(dx, dz) || 1;
        const uRaw = ((elapsed * route.speed + route.phase * 7.5) / dist) % 2;
        const goingForward = uRaw < 1;
        const t = goingForward ? uRaw : 2 - uRaw;
        const effT = route.dirSign === 1 ? t : 1 - t;
        px = route.x1 + dx * effT;
        pz = route.z1 + dz * effT;
        const fwd = (goingForward ? 1 : -1) * route.dirSign;
        yaw = Math.atan2(dx * fwd, dz * fwd);
        strideFreq = route.speed * 1.75;
      } else {
        const s = ((route.s0 + elapsed * route.speedS * route.dirSign) % 1 + 1) % 1;
        const p = evaluateStadiumOval(s, route.radius, straightLen, midR, _poseTmp);
        px = p.x;
        pz = p.z;
        yaw = route.dirSign === 1 ? p.yaw : p.yaw + Math.PI;
        strideFreq = 7.4;
      }

      writePedestrianPose(i, px, pz, yaw, route.scale, elapsed * strideFreq + route.phase, true);
    }

    // 2B. Step & render 96 Dynamic A* Pathfinding NPCs navigating Parking <-> Canteens <-> Tribunes
    stepPathfindingNpcAgents(navGraph, pathAgents, dt);
    for (let i = 0; i < pathAgents.length; i++) {
      const ag = pathAgents[i];
      writePedestrianPose(
        staticPedCount + i,
        ag.x,
        ag.z,
        ag.yaw,
        ag.scale,
        elapsed * (ag.speed * 1.72) + ag.stridePhase,
        ag.isMoving
      );
    }

    for (const inst of pedInsts) {
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  // Initialize initial frame transforms immediately so frame 0 is populated cleanly
  update(0);

  return { group, disposables, update };
}
