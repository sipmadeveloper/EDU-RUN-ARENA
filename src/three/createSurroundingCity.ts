import * as THREE from 'three';
import {
  buildOvalRibbonGeometry,
  evaluateStadiumOval,
  type TrackPose,
} from './stadiumAssets';

export interface SurroundingCityOptions {
  straightLen: number;
  midR: number;
  compoundR: number;
  maxAnisotropy: number;
}

export interface SurroundingCityResult {
  group: THREE.Group;
  disposables: Array<{ dispose: () => void }>;
  update: (elapsed: number) => void;
}

/**
 * Procedural urban sidewalk & city-block base pavement texture so no bare dirt/empty land shows anywhere.
 */
function createUrbanBaseTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#64707d';
  ctx.fillRect(0, 0, size, size);

  const tiles = 8;
  const step = size / tiles;
  const tones = ['#7c8794', '#747f8c', '#85909d', '#707b88'];
  for (let r = 0; r < tiles; r++) {
    for (let c = 0; c < tiles; c++) {
      ctx.fillStyle = tones[(r * 7 + c * 13) % tones.length];
      ctx.fillRect(c * step + 2, r * step + 2, step - 4, step - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(c * step + 2, r * step + 2, step - 4, 2);
    }
  }

  for (let i = 0; i < 2400; i++) {
    const x = (i * 89) % size;
    const y = (i * 53) % size;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.08)';
    ctx.fillRect(x, y, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Procedural city asphalt texture with realistic dark aggregate grain.
 */
function createCityAsphaltTexture(maxAnisotropy: number, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1f2631';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 3600; i++) {
    const x = (i * 71) % size;
    const y = (i * 113) % size;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.14)';
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
 * Procedural multi-story architectural facade texture with crisp window grids,
 * spandrels, mullions, and subtle illuminated interior panes for both day & night vibrancy.
 */
function createBuildingFacadeTexture(
  variant: 'glass' | 'office' | 'residential',
  maxAnisotropy: number
): THREE.CanvasTexture {
  const w = 256;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (variant === 'glass') {
    ctx.fillStyle = '#253852';
    ctx.fillRect(0, 0, w, h);
    const floors = 16;
    const cols = 8;
    const fh = h / floors;
    const cw = w / cols;

    for (let f = 0; f < floors; f++) {
      // Spandrel metallic band
      ctx.fillStyle = '#3b5373';
      ctx.fillRect(0, f * fh, w, 5);
      for (let c = 0; c < cols; c++) {
        const hash = (f * 31 + c * 17) % 13;
        if (hash === 0 || hash === 5) {
          ctx.fillStyle = '#fde68a'; // warm lit office
        } else if (hash === 2 || hash === 9) {
          ctx.fillStyle = '#bae6fd'; // cool daylight sky reflection / lit cyan
        } else if (hash === 7) {
          ctx.fillStyle = '#e0f2fe';
        } else {
          ctx.fillStyle = hash % 2 === 0 ? '#1e3a5f' : '#2b4c73';
        }
        ctx.fillRect(c * cw + 3, f * fh + 6, cw - 6, fh - 9);
        // Subtle window glare
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(c * cw + 3, f * fh + 6, (cw - 6) * 0.35, fh - 9);
      }
    }
  } else if (variant === 'office') {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(0, 0, w, h);
    const floors = 14;
    const cols = 6;
    const fh = h / floors;
    const cw = w / cols;

    for (let f = 0; f < floors; f++) {
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(0, f * fh, w, 6);
      for (let c = 0; c < cols; c++) {
        const hash = (f * 23 + c * 19) % 11;
        ctx.fillStyle =
          hash === 1 || hash === 6
            ? '#fef08a'
            : hash === 4
              ? '#bae6fd'
              : hash % 2 === 0
                ? '#1e293b'
                : '#334155';
        ctx.fillRect(c * cw + 5, f * fh + 8, cw - 10, fh - 13);
      }
    }
  } else {
    // Urban mixed-use / apartment / ruko facade
    ctx.fillStyle = '#e2dcd3';
    ctx.fillRect(0, 0, w, h);
    const floors = 12;
    const cols = 6;
    const fh = h / floors;
    const cw = w / cols;

    for (let f = 0; f < floors; f++) {
      ctx.fillStyle = '#b9afa2';
      ctx.fillRect(0, f * fh + fh - 6, w, 6);
      for (let c = 0; c < cols; c++) {
        const hash = (f * 29 + c * 11) % 10;
        ctx.fillStyle =
          hash === 0 || hash === 4
            ? '#fde68a'
            : hash === 7
              ? '#fed7aa'
              : '#1e293b';
        ctx.fillRect(c * cw + 6, f * fh + 7, cw - 12, fh - 16);
        // Balcony railing accent
        ctx.fillStyle = '#475569';
        ctx.fillRect(c * cw + 4, f * fh + fh - 11, cw - 8, 3);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Builds a massive square urban ground plane with an oval cutout matching the stadium fence,
 * using planar world-space UVs so the city pavement tiles cleanly without distortion.
 */
function buildUrbanBaseWithOvalHole(
  halfSpan: number,
  holeR: number,
  straightLen: number,
  uvTileMeters: number
): THREE.BufferGeometry {
  const halfL = straightLen / 2;
  const outer = new THREE.Shape();
  outer.moveTo(-halfSpan, -halfSpan);
  outer.lineTo(halfSpan, -halfSpan);
  outer.lineTo(halfSpan, halfSpan);
  outer.lineTo(-halfSpan, halfSpan);
  outer.lineTo(-halfSpan, -halfSpan);

  const hole = new THREE.Path();
  hole.moveTo(-halfL, holeR);
  hole.absarc(-halfL, 0, holeR, Math.PI / 2, Math.PI * 1.5, false);
  hole.lineTo(halfL, -holeR);
  hole.absarc(halfL, 0, holeR, -Math.PI / 2, Math.PI / 2, false);
  hole.lineTo(-halfL, holeR);
  outer.holes.push(hole);

  const geo = new THREE.ShapeGeometry(outer, 64);
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
 * Builds an oval ring with planar UVs for the 4-lane outer city boulevard highway.
 */
function buildOvalRingPlanar(
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

interface BuildingSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  variant: 0 | 1 | 2;
  colorIdx: number;
  hasSpire: boolean;
  hasBillboard: boolean;
  billboardColorIdx: number;
}

type CityVehicleRoute =
  | {
      kind: 'ring';
      radius: number;
      s0: number;
      speedS: number;
      dir: 1 | -1;
      colorIdx: number;
    }
  | {
      kind: 'linear';
      axis: 'x' | 'z';
      fixedCoord: number;
      minCoord: number;
      maxCoord: number;
      speed: number;
      phase: number;
      dir: 1 | -1;
      colorIdx: number;
    };

type CityPedRoute =
  | {
      kind: 'oval';
      radius: number;
      s0: number;
      speedS: number;
      dir: 1 | -1;
      phase: number;
      scale: number;
    }
  | {
      kind: 'linear';
      x1: number;
      z1: number;
      x2: number;
      z2: number;
      speed: number;
      phase: number;
      dir: 1 | -1;
      scale: number;
    };

export function createSurroundingCity(opts: SurroundingCityOptions): SurroundingCityResult {
  const { straightLen, midR, compoundR, maxAnisotropy } = opts;
  const halfL = straightLen / 2;
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const CITY_GROUND_Y = 0.012;
  const CITY_ROAD_Y = 0.045;
  const CITY_MARKING_Y = 0.088;

  const blvdInnerR = compoundR + 7.0; // 383.0 (7m sidewalk right outside stadium fence)
  const blvdOuterR = blvdInnerR + 38.0; // 421.0 (38m wide 4-lane outer boulevard!)
  const blvdMidR = (blvdInnerR + blvdOuterR) / 2; // 402.0
  const outerSidewalkR = blvdOuterR + 12.0; // 433.0

  // Deterministic pseudo-random helper
  const hash01 = (a: number, b: number, c = 0): number => {
    const n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };

  const ovalDistAt = (x: number, z: number): number => {
    const cx = Math.max(-halfL, Math.min(halfL, x));
    return Math.hypot(x - cx, z);
  };

  // =========================================================================
  // 1. CONTINUOUS PAVED URBAN CITY GROUND (5000m x 5000m, ZERO EMPTY LAND)
  // =========================================================================
  const urbanBaseTex = createUrbanBaseTexture(maxAnisotropy);
  const urbanBaseMat = new THREE.MeshStandardMaterial({
    map: urbanBaseTex,
    roughness: 0.9,
    metalness: 0.04,
  });
  const cityAsphaltTex = createCityAsphaltTexture(maxAnisotropy, 1, 1);
  const cityAsphaltMat = new THREE.MeshStandardMaterial({
    map: cityAsphaltTex,
    roughness: 0.88,
    metalness: 0.05,
  });
  const aveAsphaltTex = createCityAsphaltTexture(maxAnisotropy, 2, 120);
  const aveAsphaltMat = new THREE.MeshStandardMaterial({
    map: aveAsphaltTex,
    roughness: 0.88,
    metalness: 0.05,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: 0xb6c0cc,
    roughness: 0.82,
    metalness: 0.05,
  });
  const medianGrassMat = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.92,
    metalness: 0.0,
  });
  const whitePaintMat = new THREE.MeshBasicMaterial({
    color: 0xf8fafc,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const yellowPaintMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const warmGlowMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
  const tailRedMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const darkMetalMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.42,
    metalness: 0.72,
  });

  disposables.push(
    urbanBaseTex,
    urbanBaseMat,
    cityAsphaltTex,
    cityAsphaltMat,
    aveAsphaltTex,
    aveAsphaltMat,
    sidewalkMat,
    medianGrassMat,
    whitePaintMat,
    yellowPaintMat,
    warmGlowMat,
    tailRedMat,
    darkMetalMat
  );

  const urbanGroundGeo = buildUrbanBaseWithOvalHole(2450, compoundR - 1.0, straightLen, 42.0);
  const urbanGroundMesh = new THREE.Mesh(urbanGroundGeo, urbanBaseMat);
  urbanGroundMesh.position.y = CITY_GROUND_Y;
  group.add(urbanGroundMesh);
  disposables.push(urbanGroundGeo);

  // Outer perimeter sidewalk rings flanking the 4-lane Boulevard
  const innerWalkGeo = buildOvalRibbonGeometry(compoundR + 0.3, blvdInnerR + 0.3, straightLen, 160, 1, midR);
  const innerWalkMesh = new THREE.Mesh(innerWalkGeo, sidewalkMat);
  innerWalkMesh.position.y = CITY_GROUND_Y + 0.015;

  const outerWalkGeo = buildOvalRibbonGeometry(blvdOuterR - 0.3, outerSidewalkR, straightLen, 180, 1, midR);
  const outerWalkMesh = new THREE.Mesh(outerWalkGeo, sidewalkMat);
  outerWalkMesh.position.y = CITY_GROUND_Y + 0.015;

  group.add(innerWalkMesh, outerWalkMesh);
  disposables.push(innerWalkGeo, outerWalkGeo);

  // =========================================================================
  // 2. 4-LANE OUTER RING BOULEVARD + FULL METROPOLITAN AVENUE GRID
  // =========================================================================
  const ringBlvdGeo = buildOvalRingPlanar(blvdInnerR, blvdOuterR, straightLen, 16.0, 84);
  const ringBlvdMesh = new THREE.Mesh(ringBlvdGeo, cityAsphaltMat);
  ringBlvdMesh.position.y = CITY_ROAD_Y;
  group.add(ringBlvdMesh);
  disposables.push(ringBlvdGeo);

  // Boulevard median & edge lines
  const blvdMedianLGeo = buildOvalRibbonGeometry(blvdMidR - 0.65, blvdMidR - 0.22, straightLen, 180, 1, midR);
  const blvdMedianRGeo = buildOvalRibbonGeometry(blvdMidR + 0.22, blvdMidR + 0.65, straightLen, 180, 1, midR);
  const blvdEdgeInGeo = buildOvalRibbonGeometry(blvdInnerR + 0.45, blvdInnerR + 0.9, straightLen, 180, 1, midR);
  const blvdEdgeOutGeo = buildOvalRibbonGeometry(blvdOuterR - 0.9, blvdOuterR - 0.45, straightLen, 180, 1, midR);

  const blvdMedianL = new THREE.Mesh(blvdMedianLGeo, yellowPaintMat);
  blvdMedianL.position.y = CITY_MARKING_Y;
  const blvdMedianR = new THREE.Mesh(blvdMedianRGeo, yellowPaintMat);
  blvdMedianR.position.y = CITY_MARKING_Y;
  const blvdEdgeIn = new THREE.Mesh(blvdEdgeInGeo, whitePaintMat);
  blvdEdgeIn.position.y = CITY_MARKING_Y;
  const blvdEdgeOut = new THREE.Mesh(blvdEdgeOutGeo, whitePaintMat);
  blvdEdgeOut.position.y = CITY_MARKING_Y;
  group.add(blvdMedianL, blvdMedianR, blvdEdgeIn, blvdEdgeOut);
  disposables.push(blvdMedianLGeo, blvdMedianRGeo, blvdEdgeInGeo, blvdEdgeOutGeo);

  const dummy = new THREE.Object3D();

  // Dashed lane lines on the 4-lane Outer Ring Boulevard (2 dashed rings)
  const blvdDashCountPerRing = 210;
  const dashGeo = new THREE.PlaneGeometry(0.42, 7.2);
  dashGeo.rotateX(-Math.PI / 2);
  const blvdDashInst = new THREE.InstancedMesh(dashGeo, whitePaintMat, blvdDashCountPerRing * 2);
  blvdDashInst.frustumCulled = false;
  const blvdLaneDividerRs = [blvdInnerR + 9.5, blvdOuterR - 9.5];
  let bDashIdx = 0;
  for (const rDiv of blvdLaneDividerRs) {
    for (let i = 0; i < blvdDashCountPerRing; i++) {
      const s = i / blvdDashCountPerRing;
      const p = evaluateStadiumOval(s, rDiv, straightLen, midR);
      dummy.position.set(p.x, CITY_MARKING_Y, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      blvdDashInst.setMatrixAt(bDashIdx++, dummy.matrix);
    }
  }
  blvdDashInst.instanceMatrix.needsUpdate = true;
  group.add(blvdDashInst);
  disposables.push(dashGeo);

  // Orthogonal City Avenue Grid (spanning -2350 .. +2350 in all directions outside the Ring Boulevard)
  const aveW = 28.0;
  const fullSpan = 4700;
  const ewFullZs = [-1785, -1495, -1205, -915, -625, -458, 458, 625, 915, 1205, 1495, 1785];
  const nsFullXs = [-1890, -1560, -1230, -900, -645, 645, 900, 1230, 1560, 1890];
  const nsSplitXs = [-310, 0, 310];

  const ewRoadGeo = new THREE.PlaneGeometry(fullSpan, aveW);
  ewRoadGeo.rotateX(-Math.PI / 2);
  const nsRoadGeo = new THREE.PlaneGeometry(aveW, fullSpan);
  nsRoadGeo.rotateX(-Math.PI / 2);
  const ewYellowGeo = new THREE.PlaneGeometry(fullSpan, 0.72);
  ewYellowGeo.rotateX(-Math.PI / 2);
  const nsYellowGeo = new THREE.PlaneGeometry(0.72, fullSpan);
  nsYellowGeo.rotateX(-Math.PI / 2);

  for (const az of ewFullZs) {
    const road = new THREE.Mesh(ewRoadGeo, aveAsphaltMat);
    road.position.set(0, CITY_ROAD_Y - 0.004, az);
    const line = new THREE.Mesh(ewYellowGeo, yellowPaintMat);
    line.position.set(0, CITY_MARKING_Y - 0.004, az);
    group.add(road, line);
  }
  for (const ax of nsFullXs) {
    const road = new THREE.Mesh(nsRoadGeo, aveAsphaltMat);
    road.position.set(ax, CITY_ROAD_Y - 0.002, 0);
    const line = new THREE.Mesh(nsYellowGeo, yellowPaintMat);
    line.position.set(ax, CITY_MARKING_Y - 0.002, 0);
    group.add(road, line);
  }

  // Split North & South avenues connecting straight into the Ring Boulevard (x = -310, 0, +310)
  const splitNsLen = 1940; // covers |z| = 416 .. 2356
  const splitNsMid = 416 + splitNsLen / 2;
  const splitNsRoadGeo = new THREE.PlaneGeometry(aveW, splitNsLen);
  splitNsRoadGeo.rotateX(-Math.PI / 2);
  const splitNsLineGeo = new THREE.PlaneGeometry(0.72, splitNsLen);
  splitNsLineGeo.rotateX(-Math.PI / 2);
  for (const ax of nsSplitXs) {
    for (const sign of [-1, 1] as const) {
      const road = new THREE.Mesh(splitNsRoadGeo, aveAsphaltMat);
      road.position.set(ax, CITY_ROAD_Y - 0.003, sign * splitNsMid);
      const line = new THREE.Mesh(splitNsLineGeo, yellowPaintMat);
      line.position.set(ax, CITY_MARKING_Y - 0.003, sign * splitNsMid);
      group.add(road, line);
    }
  }

  // Split Central East & West boulevards connecting into East/West Ring Boulevard at z = 0
  const splitEwLen = 1740; // covers |x| = 616 .. 2356
  const splitEwMid = 616 + splitEwLen / 2;
  const splitEwRoadGeo = new THREE.PlaneGeometry(splitEwLen, aveW);
  splitEwRoadGeo.rotateX(-Math.PI / 2);
  const splitEwLineGeo = new THREE.PlaneGeometry(splitEwLen, 0.72);
  splitEwLineGeo.rotateX(-Math.PI / 2);
  for (const sign of [-1, 1] as const) {
    const road = new THREE.Mesh(splitEwRoadGeo, aveAsphaltMat);
    road.position.set(sign * splitEwMid, CITY_ROAD_Y - 0.003, 0);
    const line = new THREE.Mesh(splitEwLineGeo, yellowPaintMat);
    line.position.set(sign * splitEwMid, CITY_MARKING_Y - 0.003, 0);
    group.add(road, line);
  }

  disposables.push(
    ewRoadGeo,
    nsRoadGeo,
    ewYellowGeo,
    nsYellowGeo,
    splitNsRoadGeo,
    splitNsLineGeo,
    splitEwRoadGeo,
    splitEwLineGeo
  );

  // =========================================================================
  // 3. DENSE 360° METROPOLITAN SKYLINE & COMMERCIAL BLOCKS (ZERO EMPTY LAND!)
  // =========================================================================
  const xGrid = [-2210, -1890, -1560, -1230, -900, -645, -310, 0, 310, 645, 900, 1230, 1560, 1890, 2210];
  const zGrid = [-2090, -1785, -1495, -1205, -915, -625, -458, 0, 458, 625, 915, 1205, 1495, 1785, 2090];

  const buildingsByVariant: [BuildingSpec[], BuildingSpec[], BuildingSpec[]] = [[], [], []];
  const parkPatches: Array<{ x: number; z: number; w: number; d: number }> = [];

  const ROAD_CLEARANCE = 23.0; // half road width (14) + 9m sidewalk buffer
  const BLVD_CLEARANCE = outerSidewalkR + 5.0; // 438m outside oval spine

  const canPlaceFootprint = (cx: number, cz: number, bw: number, bd: number): boolean => {
    const hw = bw * 0.5;
    const hd = bd * 0.5;
    // Check center + 4 corners against the Stadium Outer Ring Boulevard
    const pts: Array<[number, number]> = [
      [cx, cz],
      [cx - hw, cz - hd],
      [cx + hw, cz - hd],
      [cx - hw, cz + hd],
      [cx + hw, cz + hd],
    ];
    for (const [px, pz] of pts) {
      if (ovalDistAt(px, pz) < BLVD_CLEARANCE) return false;
    }
    return true;
  };

  for (let xi = 0; xi < xGrid.length - 1; xi++) {
    const x0 = xGrid[xi] + ROAD_CLEARANCE;
    const x1 = xGrid[xi + 1] - ROAD_CLEARANCE;
    const blockW = x1 - x0;
    if (blockW < 36) continue;

    for (let zi = 0; zi < zGrid.length - 1; zi++) {
      const z0 = zGrid[zi] + ROAD_CLEARANCE;
      const z1 = zGrid[zi + 1] - ROAD_CLEARANCE;
      const blockD = z1 - z0;
      if (blockD < 36) continue;

      // Subdivide each city block into dense architectural parcels
      const cols = Math.max(1, Math.min(4, Math.floor(blockW / 72)));
      const rows = Math.max(1, Math.min(4, Math.floor(blockD / 72)));
      const cellW = blockW / cols;
      const cellD = blockD / rows;

      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const cx = x0 + (c + 0.5) * cellW;
          const cz = z0 + (r + 0.5) * cellD;
          const rnd1 = hash01(xi * 11 + c, zi * 13 + r, 1);
          const rnd2 = hash01(xi * 17 + c, zi * 19 + r, 2);
          const rnd3 = hash01(xi * 23 + c, zi * 29 + r, 3);

          const bw = cellW * (0.76 + rnd1 * 0.14);
          const bd = cellD * (0.76 + rnd2 * 0.14);

          if (!canPlaceFootprint(cx, cz, bw, bd)) continue;

          const od = ovalDistAt(cx, cz);

          // Occasional landscaped urban mini-park plaza inside distant residential blocks (~7%)
          if (od > 540 && rnd3 < 0.07) {
            parkPatches.push({ x: cx, z: cz, w: bw * 0.92, d: bd * 0.92 });
            continue;
          }

          // Smart height zoning:
          // - Ring 1 (od < 650): 20m..58m mid-rise commercial/hotels so the 360° preview camera (y=110..178) NEVER clips!
          // - Ring 2 (650..1280): dense downtown skyscrapers 36m..138m mixed with mid-rise towers
          // - Ring 3 (1280+): rich continuous skyline 30m..118m fading cleanly into horizon fog
          let h: number;
          if (od < 650) {
            h = 20 + rnd1 * 38;
          } else if (od < 1280) {
            h = rnd3 > 0.62 ? 78 + rnd1 * 62 : 34 + rnd2 * 44;
          } else {
            h = rnd3 > 0.58 ? 64 + rnd1 * 56 : 28 + rnd2 * 40;
          }

          let variant: 0 | 1 | 2;
          if (h > 64) {
            variant = rnd2 > 0.35 ? 0 : 1; // sleek glass or office skyscraper
          } else if (h > 36) {
            variant = rnd2 > 0.5 ? 1 : 2;
          } else {
            variant = 2; // commercial / apartment mid-rise
          }

          buildingsByVariant[variant].push({
            x: cx,
            z: cz,
            w: bw,
            d: bd,
            h,
            variant,
            colorIdx: Math.floor(rnd3 * 8),
            hasSpire: h > 76 && rnd2 > 0.45,
            hasBillboard: od < 820 && rnd1 > 0.48,
            billboardColorIdx: Math.floor(rnd2 * 6),
          });
        }
      }
    }
  }

  // Extra curved-corner commercial pavilions tucked neatly outside NE/NW/SE/SW Ring Boulevard arcs
  const cornerAngles = [
    -Math.PI * 0.38,
    -Math.PI * 0.25,
    -Math.PI * 0.12,
    Math.PI * 0.12,
    Math.PI * 0.25,
    Math.PI * 0.38,
  ];
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < cornerAngles.length; i++) {
      const ang = side === 1 ? cornerAngles[i] : Math.PI - cornerAngles[i];
      const rad = 468 + (i % 2) * 14;
      const cx = side * halfL + Math.cos(ang) * rad;
      const cz = Math.sin(ang) * rad;
      // Skip if overlapping any main orthogonal avenue
      if (Math.abs(cz) < 36 || Math.abs(Math.abs(cz) - 458) < 36 || Math.abs(Math.abs(cx) - 645) < 36) {
        continue;
      }
      if (!canPlaceFootprint(cx, cz, 44, 44)) continue;
      buildingsByVariant[1].push({
        x: cx,
        z: cz,
        w: 42,
        d: 42,
        h: 24 + (i % 3) * 11,
        variant: 1,
        colorIdx: i % 8,
        hasSpire: false,
        hasBillboard: true,
        billboardColorIdx: i % 6,
      });
    }
  }

  const allBuildings = [
    ...buildingsByVariant[0],
    ...buildingsByVariant[1],
    ...buildingsByVariant[2],
  ];

  // Procedural Building Materials (3 distinct facade textures)
  const glassTex = createBuildingFacadeTexture('glass', maxAnisotropy);
  const officeTex = createBuildingFacadeTexture('office', maxAnisotropy);
  const resTex = createBuildingFacadeTexture('residential', maxAnisotropy);

  const glassTowerMat = new THREE.MeshStandardMaterial({
    map: glassTex,
    roughness: 0.26,
    metalness: 0.56,
    emissive: 0x1e3a5f,
    emissiveIntensity: 0.22,
  });
  const officeTowerMat = new THREE.MeshStandardMaterial({
    map: officeTex,
    roughness: 0.58,
    metalness: 0.16,
    emissive: 0x332b1c,
    emissiveIntensity: 0.14,
  });
  const resTowerMat = new THREE.MeshStandardMaterial({
    map: resTex,
    roughness: 0.72,
    metalness: 0.08,
    emissive: 0x2b2217,
    emissiveIntensity: 0.12,
  });
  const podiumMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.74,
    metalness: 0.12,
  });
  const roofCrownMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.7,
    metalness: 0.24,
  });
  const billboardMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

  disposables.push(
    glassTex,
    officeTex,
    resTex,
    glassTowerMat,
    officeTowerMat,
    resTowerMat,
    podiumMat,
    roofCrownMat,
    billboardMat
  );

  const glassTints = [
    new THREE.Color(0xcbdff5),
    new THREE.Color(0xbad7f2),
    new THREE.Color(0xdbeafe),
    new THREE.Color(0xa5c9e8),
    new THREE.Color(0xc7d2fe),
    new THREE.Color(0xbae6fd),
    new THREE.Color(0xd1e5f7),
    new THREE.Color(0xb8d4eb),
  ];
  const officeTints = [
    new THREE.Color(0xe2e8f0),
    new THREE.Color(0xf1f5f9),
    new THREE.Color(0xd6d3d1),
    new THREE.Color(0xe7e5e4),
    new THREE.Color(0xcbd5e1),
    new THREE.Color(0xefe8de),
    new THREE.Color(0xdbe4ee),
    new THREE.Color(0xe5dfd5),
  ];
  const resTints = [
    new THREE.Color(0xf5ebe0),
    new THREE.Color(0xeed7c5),
    new THREE.Color(0xe6ccb2),
    new THREE.Color(0xdce4ed),
    new THREE.Color(0xf3e5d8),
    new THREE.Color(0xd8e2dc),
    new THREE.Color(0xe8d5c4),
    new THREE.Color(0xebe4da),
  ];
  const podiumTints = [
    new THREE.Color(0x334155),
    new THREE.Color(0x475569),
    new THREE.Color(0x1e293b),
    new THREE.Color(0x52525b),
  ];
  const billboardColors = [
    new THREE.Color(0x38bdf8),
    new THREE.Color(0xf97316),
    new THREE.Color(0xfacc15),
    new THREE.Color(0x22c55e),
    new THREE.Color(0xec4899),
    new THREE.Color(0x6366f1),
  ];

  // Unit BoxGeometry scaled per-building for instancing
  const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  const spireGeo = new THREE.CylinderGeometry(0.18, 0.55, 1, 5);
  disposables.push(unitBoxGeo, spireGeo);

  const variantMaterials = [glassTowerMat, officeTowerMat, resTowerMat];
  const variantPalettes = [glassTints, officeTints, resTints];

  for (let v = 0; v < 3; v++) {
    const list = buildingsByVariant[v];
    if (list.length === 0) continue;
    const bodyInst = new THREE.InstancedMesh(unitBoxGeo, variantMaterials[v], list.length);
    bodyInst.frustumCulled = false;
    const palette = variantPalettes[v];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      dummy.position.set(b.x, CITY_GROUND_Y + b.h * 0.5, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      bodyInst.setMatrixAt(i, dummy.matrix);
      bodyInst.setColorAt(i, palette[b.colorIdx % palette.length]);
    }
    bodyInst.instanceMatrix.needsUpdate = true;
    if (bodyInst.instanceColor) bodyInst.instanceColor.needsUpdate = true;
    group.add(bodyInst);
  }

  // Ground-floor Commercial Podium + Stepped Rooftop Crown for EVERY building
  const podiumInst = new THREE.InstancedMesh(unitBoxGeo, podiumMat, allBuildings.length);
  const crownInst = new THREE.InstancedMesh(unitBoxGeo, roofCrownMat, allBuildings.length);
  podiumInst.frustumCulled = false;
  crownInst.frustumCulled = false;

  const spireSpecs: BuildingSpec[] = [];
  const billboardSpecs: BuildingSpec[] = [];

  for (let i = 0; i < allBuildings.length; i++) {
    const b = allBuildings[i];
    const podH = Math.min(8.5, b.h * 0.22);
    dummy.rotation.set(0, 0, 0);

    // Commercial podium base (slightly wider than main shaft)
    dummy.position.set(b.x, CITY_GROUND_Y + podH * 0.5, b.z);
    dummy.scale.set(b.w * 1.07, podH, b.d * 1.07);
    dummy.updateMatrix();
    podiumInst.setMatrixAt(i, dummy.matrix);
    podiumInst.setColorAt(i, podiumTints[i % podiumTints.length]);

    // Rooftop mechanical penthouse / architectural crown
    const crownH = 3.2 + (i % 4) * 1.3;
    dummy.position.set(b.x, CITY_GROUND_Y + b.h + crownH * 0.5, b.z);
    dummy.scale.set(b.w * 0.62, crownH, b.d * 0.62);
    dummy.updateMatrix();
    crownInst.setMatrixAt(i, dummy.matrix);

    if (b.hasSpire) spireSpecs.push(b);
    if (b.hasBillboard) billboardSpecs.push(b);
  }
  podiumInst.instanceMatrix.needsUpdate = true;
  crownInst.instanceMatrix.needsUpdate = true;
  if (podiumInst.instanceColor) podiumInst.instanceColor.needsUpdate = true;
  group.add(podiumInst, crownInst);

  if (spireSpecs.length > 0) {
    const spireInst = new THREE.InstancedMesh(spireGeo, darkMetalMat, spireSpecs.length);
    spireInst.frustumCulled = false;
    for (let i = 0; i < spireSpecs.length; i++) {
      const b = spireSpecs[i];
      const spH = 12 + (i % 5) * 4.5;
      dummy.position.set(b.x, CITY_GROUND_Y + b.h + 5.5 + spH * 0.5, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, spH, 1);
      dummy.updateMatrix();
      spireInst.setMatrixAt(i, dummy.matrix);
    }
    spireInst.instanceMatrix.needsUpdate = true;
    group.add(spireInst);
  }

  if (billboardSpecs.length > 0) {
    const billInst = new THREE.InstancedMesh(unitBoxGeo, billboardMat, billboardSpecs.length);
    billInst.frustumCulled = false;
    for (let i = 0; i < billboardSpecs.length; i++) {
      const b = billboardSpecs[i];
      const faceZ = Math.abs(b.z) > Math.abs(b.x);
      const signX = b.x > 0 ? -1 : 1;
      const signZ = b.z > 0 ? -1 : 1;
      const by = CITY_GROUND_Y + Math.min(11.5, b.h * 0.34);
      if (faceZ) {
        dummy.position.set(b.x, by, b.z + signZ * (b.d * 0.53));
        dummy.scale.set(b.w * 0.66, 3.8, 0.8);
      } else {
        dummy.position.set(b.x + signX * (b.w * 0.53), by, b.z);
        dummy.scale.set(0.8, 3.8, b.d * 0.66);
      }
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      billInst.setMatrixAt(i, dummy.matrix);
      billInst.setColorAt(i, billboardColors[b.billboardColorIdx % billboardColors.length]);
    }
    billInst.instanceMatrix.needsUpdate = true;
    if (billInst.instanceColor) billInst.instanceColor.needsUpdate = true;
    group.add(billInst);
  }

  // Pocket City Parks tucked cleanly inside selected outer blocks
  if (parkPatches.length > 0) {
    const parkInst = new THREE.InstancedMesh(unitBoxGeo, medianGrassMat, parkPatches.length);
    parkInst.frustumCulled = false;
    for (let i = 0; i < parkPatches.length; i++) {
      const pk = parkPatches[i];
      dummy.position.set(pk.x, CITY_GROUND_Y + 0.14, pk.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(pk.w, 0.28, pk.d);
      dummy.updateMatrix();
      parkInst.setMatrixAt(i, dummy.matrix);
    }
    parkInst.instanceMatrix.needsUpdate = true;
    group.add(parkInst);
  }

  // =========================================================================
  // 4. URBAN STREET TREES & BOULEVARD STREETLIGHTS (OUTSIDE STADIUM FENCE)
  // =========================================================================
  const cityTreePos: Array<{ x: number; z: number; scale: number }> = [];

  // Ring of boulevard street trees wrapping 360° along the outer boulevard sidewalk (r = 428)
  const blvdTreeSamples = 110;
  for (let i = 0; i < blvdTreeSamples; i++) {
    const s = i / blvdTreeSamples;
    const p = evaluateStadiumOval(s, blvdOuterR + 7.5, straightLen, midR);
    // Keep intersection openings clear for avenues entering the ring boulevard
    if (Math.abs(p.x) < 22 || Math.abs(Math.abs(p.x) - 310) < 22 || Math.abs(p.z) < 22) continue;
    cityTreePos.push({ x: p.x, z: p.z, scale: 0.92 + (i % 4) * 0.08 });
  }

  // Street trees lining the North & South Grand Avenues (x = ±19.5) and inner East/West frontages
  for (let z = -1150; z <= -485; z += 44) {
    if (Math.abs(z + 625) < 28 || Math.abs(z + 915) < 28) continue;
    cityTreePos.push({ x: -19.5, z, scale: 0.95 });
    cityTreePos.push({ x: 19.5, z, scale: 0.95 });
  }
  for (let z = 485; z <= 1150; z += 44) {
    if (Math.abs(z - 625) < 28 || Math.abs(z - 915) < 28) continue;
    cityTreePos.push({ x: -19.5, z, scale: 0.95 });
    cityTreePos.push({ x: 19.5, z, scale: 0.95 });
  }
  for (const pk of parkPatches) {
    cityTreePos.push(
      { x: pk.x - pk.w * 0.25, z: pk.z - pk.d * 0.25, scale: 1.08 },
      { x: pk.x + pk.w * 0.25, z: pk.z + pk.d * 0.25, scale: 1.02 }
    );
  }

  const cBarkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.92 });
  const cLeafLowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.84 });
  const cLeafTopMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78 });
  const cTrunkGeo = new THREE.CylinderGeometry(0.55, 0.92, 6.8, 6);
  const cCanopyLowGeo = new THREE.IcosahedronGeometry(4.6, 1);
  cCanopyLowGeo.scale(1.18, 0.76, 1.18);
  const cCanopyTopGeo = new THREE.IcosahedronGeometry(3.2, 1);
  cCanopyTopGeo.scale(1.12, 0.74, 1.12);

  const cTrunkInst = new THREE.InstancedMesh(cTrunkGeo, cBarkMat, cityTreePos.length);
  const cCanopyLowInst = new THREE.InstancedMesh(cCanopyLowGeo, cLeafLowMat, cityTreePos.length);
  const cCanopyTopInst = new THREE.InstancedMesh(cCanopyTopGeo, cLeafTopMat, cityTreePos.length);
  cTrunkInst.frustumCulled = false;
  cCanopyLowInst.frustumCulled = false;
  cCanopyTopInst.frustumCulled = false;

  const cGreensLow = [new THREE.Color(0x166534), new THREE.Color(0x15803d), new THREE.Color(0x14532d)];
  const cGreensTop = [new THREE.Color(0x22c55e), new THREE.Color(0x16a34a), new THREE.Color(0x4ade80)];

  for (let i = 0; i < cityTreePos.length; i++) {
    const t = cityTreePos[i];
    const s = t.scale;
    dummy.rotation.set(0, i * 0.73, 0);
    dummy.scale.set(s, s, s);

    dummy.position.set(t.x, CITY_GROUND_Y + 3.4 * s, t.z);
    dummy.updateMatrix();
    cTrunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, CITY_GROUND_Y + 7.4 * s, t.z);
    dummy.updateMatrix();
    cCanopyLowInst.setMatrixAt(i, dummy.matrix);
    cCanopyLowInst.setColorAt(i, cGreensLow[i % cGreensLow.length]);

    dummy.position.set(t.x, CITY_GROUND_Y + 10.1 * s, t.z);
    dummy.updateMatrix();
    cCanopyTopInst.setMatrixAt(i, dummy.matrix);
    cCanopyTopInst.setColorAt(i, cGreensTop[i % cGreensTop.length]);
  }
  cTrunkInst.instanceMatrix.needsUpdate = true;
  cCanopyLowInst.instanceMatrix.needsUpdate = true;
  cCanopyTopInst.instanceMatrix.needsUpdate = true;
  if (cCanopyLowInst.instanceColor) cCanopyLowInst.instanceColor.needsUpdate = true;
  if (cCanopyTopInst.instanceColor) cCanopyTopInst.instanceColor.needsUpdate = true;
  group.add(cTrunkInst, cCanopyLowInst, cCanopyTopInst);
  disposables.push(cBarkMat, cLeafLowMat, cLeafTopMat, cTrunkGeo, cCanopyLowGeo, cCanopyTopGeo);

  // Boulevard Streetlights along the Ring Boulevard median & Grand Avenue
  const lampPts: Array<{ x: number; z: number; yaw: number }> = [];
  const blvdLampCount = 72;
  for (let i = 0; i < blvdLampCount; i++) {
    const s = i / blvdLampCount;
    const p = evaluateStadiumOval(s, blvdMidR, straightLen, midR);
    if (Math.abs(p.x) < 18 && p.z < 0) continue; // clear front gate intersection
    lampPts.push({ x: p.x, z: p.z, yaw: p.yaw });
  }
  for (let z = -1120; z <= -490; z += 70) {
    lampPts.push({ x: -16.5, z, yaw: 0 }, { x: 16.5, z, yaw: 0 });
  }
  const cLampPoleGeo = new THREE.CylinderGeometry(0.22, 0.34, 12.5, 6);
  const cLampHeadGeo = new THREE.BoxGeometry(3.4, 0.45, 0.9);
  const cLampPoleInst = new THREE.InstancedMesh(cLampPoleGeo, darkMetalMat, lampPts.length);
  const cLampHeadInst = new THREE.InstancedMesh(cLampHeadGeo, warmGlowMat, lampPts.length);
  cLampPoleInst.frustumCulled = false;
  cLampHeadInst.frustumCulled = false;
  for (let i = 0; i < lampPts.length; i++) {
    const lp = lampPts[i];
    dummy.rotation.set(0, lp.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(lp.x, CITY_ROAD_Y + 6.25, lp.z);
    dummy.updateMatrix();
    cLampPoleInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lp.x, CITY_ROAD_Y + 12.55, lp.z);
    dummy.updateMatrix();
    cLampHeadInst.setMatrixAt(i, dummy.matrix);
  }
  cLampPoleInst.instanceMatrix.needsUpdate = true;
  cLampHeadInst.instanceMatrix.needsUpdate = true;
  group.add(cLampPoleInst, cLampHeadInst);
  disposables.push(cLampPoleGeo, cLampHeadGeo);

  // =========================================================================
  // 5. BUSTLING ANIMATED CITY TRAFFIC (104 CARS + 18 CITY BUSES)
  // =========================================================================
  const carRoutes: CityVehicleRoute[] = [];
  const busRoutes: CityVehicleRoute[] = [];

  // A) 28 Cars & 8 City Buses cruising 360° around the 4-lane Outer Ring Boulevard
  const ringCarLanes = [blvdInnerR + 4.8, blvdInnerR + 13.8, blvdOuterR - 13.8, blvdOuterR - 4.8];
  for (let i = 0; i < 28; i++) {
    const laneIdx = i % 4;
    const isOuter = laneIdx >= 2;
    carRoutes.push({
      kind: 'ring',
      radius: ringCarLanes[laneIdx],
      s0: i / 28 + (laneIdx * 0.017),
      speedS: (isOuter ? 0.0115 : 0.0102) + (i % 4) * 0.0012,
      dir: isOuter ? 1 : -1,
      colorIdx: (i * 3) % 8,
    });
  }
  for (let i = 0; i < 8; i++) {
    const outer = i % 2 === 0;
    busRoutes.push({
      kind: 'ring',
      radius: outer ? blvdOuterR - 4.8 : blvdInnerR + 4.8,
      s0: i / 8 + 0.04,
      speedS: 0.0076 + (i % 2) * 0.0009,
      dir: outer ? 1 : -1,
      colorIdx: i % 4,
    });
  }

  // B) 76 Cars & 10 City Buses driving along the Major North-South & East-West City Avenues
  const busyEwZs = [-915, -625, -458, 458, 625, 915];
  for (let a = 0; a < busyEwZs.length; a++) {
    const az = busyEwZs[a];
    for (let k = 0; k < 7; k++) {
      const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
      const laneOff = dir === 1 ? 6.5 : -6.5;
      carRoutes.push({
        kind: 'linear',
        axis: 'x',
        fixedCoord: az + laneOff,
        minCoord: -1650,
        maxCoord: 1650,
        speed: 36 + ((a * 5 + k * 7) % 18),
        phase: (k / 7) * 3300 + a * 290,
        dir,
        colorIdx: (a * 3 + k) % 8,
      });
    }
    busRoutes.push({
      kind: 'linear',
      axis: 'x',
      fixedCoord: az + (a % 2 === 0 ? 6.5 : -6.5),
      minCoord: -1650,
      maxCoord: 1650,
      speed: 26 + (a % 3) * 3,
      phase: a * 510,
      dir: a % 2 === 0 ? 1 : -1,
      colorIdx: a % 4,
    });
  }

  const busyNsXs = [-900, -645, 645, 900];
  for (let a = 0; a < busyNsXs.length; a++) {
    const ax = busyNsXs[a];
    for (let k = 0; k < 6; k++) {
      const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
      const laneOff = dir === 1 ? -6.5 : 6.5;
      carRoutes.push({
        kind: 'linear',
        axis: 'z',
        fixedCoord: ax + laneOff,
        minCoord: -1550,
        maxCoord: 1550,
        speed: 34 + ((a * 7 + k * 5) % 16),
        phase: (k / 6) * 3100 + a * 370,
        dir,
        colorIdx: (a * 5 + k * 2) % 8,
      });
    }
    busRoutes.push({
      kind: 'linear',
      axis: 'z',
      fixedCoord: ax + (a % 2 === 0 ? -6.5 : 6.5),
      minCoord: -1550,
      maxCoord: 1550,
      speed: 25 + (a % 2) * 4,
      phase: a * 640,
      dir: a % 2 === 0 ? 1 : -1,
      colorIdx: (a + 2) % 4,
    });
  }

  // North & South Grand Avenues (x = 0) feeding traffic toward/from the Stadium Front Gate
  for (let k = 0; k < 10; k++) {
    const north = k < 5;
    const dir: 1 | -1 = k % 2 === 0 ? 1 : -1;
    const laneOff = dir === 1 ? -6.2 : 6.2;
    carRoutes.push({
      kind: 'linear',
      axis: 'z',
      fixedCoord: laneOff,
      minCoord: north ? -1580 : 435,
      maxCoord: north ? -435 : 1580,
      speed: 32 + (k % 4) * 5,
      phase: (k % 5) * 230,
      dir,
      colorIdx: k % 8,
    });
  }

  const carPaintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0.45 });
  const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.14, metalness: 0.78 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 });
  const busWindowMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.16,
    metalness: 0.75,
    emissive: 0xfde68a,
    emissiveIntensity: 0.28,
  });

  const cCarBodyGeo = new THREE.BoxGeometry(3.9, 1.4, 7.8);
  const cCarCabinGeo = new THREE.BoxGeometry(3.4, 1.15, 4.2);
  const cCarGlassGeo = new THREE.BoxGeometry(3.48, 0.78, 3.7);
  const cCarLightGeo = new THREE.BoxGeometry(3.3, 0.34, 0.18);

  const busBodyGeo = new THREE.BoxGeometry(4.6, 4.1, 14.8);
  const busWinGeo = new THREE.BoxGeometry(4.72, 1.45, 13.4);
  const busAcGeo = new THREE.BoxGeometry(2.8, 0.65, 6.2);
  const busLightGeo = new THREE.BoxGeometry(4.1, 0.44, 0.2);

  disposables.push(
    carPaintMat,
    carGlassMat,
    tireMat,
    busWindowMat,
    cCarBodyGeo,
    cCarCabinGeo,
    cCarGlassGeo,
    cCarLightGeo,
    busBodyGeo,
    busWinGeo,
    busAcGeo,
    busLightGeo
  );

  const cityCarColors = [
    new THREE.Color(0xf8fafc),
    new THREE.Color(0x94a3b8),
    new THREE.Color(0xdc2626),
    new THREE.Color(0x1d4ed8),
    new THREE.Color(0x0f172a),
    new THREE.Color(0xeab308),
    new THREE.Color(0x059669),
    new THREE.Color(0x0284c7),
  ];
  const cityBusColors = [
    new THREE.Color(0x2563eb), // Trans-City Blue
    new THREE.Color(0xf97316), // Express Orange
    new THREE.Color(0x10b981), // Metro Green
    new THREE.Color(0xdc2626), // Red City Bus
  ];

  const cCarCount = carRoutes.length;
  const cCarBodyInst = new THREE.InstancedMesh(cCarBodyGeo, carPaintMat, cCarCount);
  const cCarCabinInst = new THREE.InstancedMesh(cCarCabinGeo, carPaintMat, cCarCount);
  const cCarGlassInst = new THREE.InstancedMesh(cCarGlassGeo, carGlassMat, cCarCount);
  const cCarHeadInst = new THREE.InstancedMesh(cCarLightGeo, warmGlowMat, cCarCount);
  const cCarTailInst = new THREE.InstancedMesh(cCarLightGeo, tailRedMat, cCarCount);

  for (const inst of [cCarBodyInst, cCarCabinInst, cCarGlassInst, cCarHeadInst, cCarTailInst]) {
    inst.frustumCulled = false;
    group.add(inst);
  }
  for (let i = 0; i < cCarCount; i++) {
    const col = cityCarColors[carRoutes[i].colorIdx % cityCarColors.length];
    cCarBodyInst.setColorAt(i, col);
    cCarCabinInst.setColorAt(i, col);
  }
  if (cCarBodyInst.instanceColor) cCarBodyInst.instanceColor.needsUpdate = true;
  if (cCarCabinInst.instanceColor) cCarCabinInst.instanceColor.needsUpdate = true;

  const cBusCount = busRoutes.length;
  const cBusBodyInst = new THREE.InstancedMesh(busBodyGeo, carPaintMat, cBusCount);
  const cBusWinInst = new THREE.InstancedMesh(busWinGeo, busWindowMat, cBusCount);
  const cBusAcInst = new THREE.InstancedMesh(busAcGeo, sidewalkMat, cBusCount);
  const cBusHeadInst = new THREE.InstancedMesh(busLightGeo, warmGlowMat, cBusCount);
  const cBusTailInst = new THREE.InstancedMesh(busLightGeo, tailRedMat, cBusCount);

  for (const inst of [cBusBodyInst, cBusWinInst, cBusAcInst, cBusHeadInst, cBusTailInst]) {
    inst.frustumCulled = false;
    group.add(inst);
  }
  for (let i = 0; i < cBusCount; i++) {
    cBusBodyInst.setColorAt(i, cityBusColors[busRoutes[i].colorIdx % cityBusColors.length]);
  }
  if (cBusBodyInst.instanceColor) cBusBodyInst.instanceColor.needsUpdate = true;

  // =========================================================================
  // 6. BUSTLING CITY SIDEWALK PEDESTRIANS OUTSIDE THE STADIUM FENCE (160 PEOPLE)
  // =========================================================================
  const cityPeds: CityPedRoute[] = [];

  // 52 pedestrians walking right along the Outer Stadium Perimeter Sidewalk (r = 379.5)
  for (let i = 0; i < 52; i++) {
    cityPeds.push({
      kind: 'oval',
      radius: compoundR + 3.2 + (i % 3) * 0.9,
      s0: i / 52,
      speedS: 0.00145 + (i % 5) * 0.00024,
      dir: i % 2 === 0 ? 1 : -1,
      phase: i * 1.31,
      scale: 1.28 + (i % 4) * 0.08,
    });
  }
  // 52 pedestrians walking along the Across-the-Boulevard Commercial Sidewalk (r = 425.5)
  for (let i = 0; i < 52; i++) {
    cityPeds.push({
      kind: 'oval',
      radius: blvdOuterR + 3.8 + (i % 3) * 1.4,
      s0: i / 52 + 0.009,
      speedS: 0.00135 + (i % 4) * 0.00022,
      dir: i % 2 === 0 ? -1 : 1,
      phase: i * 1.73,
      scale: 1.28 + (i % 4) * 0.08,
    });
  }
  // 36 pedestrians streaming along North Grand Avenue sidewalks approaching the Stadium Front Gate
  for (let i = 0; i < 36; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    cityPeds.push({
      kind: 'linear',
      x1: side * (16.5 + (i % 3) * 1.4),
      z1: -880,
      x2: side * (16.5 + (i % 3) * 1.4),
      z2: -425,
      speed: 4.1 + (i % 5) * 0.55,
      phase: i * 14.5,
      dir: i % 4 < 2 ? 1 : -1,
      scale: 1.3 + (i % 3) * 0.08,
    });
  }
  // 20 pedestrians strolling along the North & South city boulevard frontages (z = ±442)
  for (let i = 0; i < 20; i++) {
    const south = i >= 10;
    cityPeds.push({
      kind: 'linear',
      x1: -560,
      z1: south ? 442 : -442,
      x2: 560,
      z2: south ? 442 : -442,
      speed: 3.9 + (i % 4) * 0.5,
      phase: i * 24,
      dir: i % 2 === 0 ? 1 : -1,
      scale: 1.28 + (i % 3) * 0.08,
    });
  }

  const cPedCount = cityPeds.length;
  const cPedMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const cPedTorsoGeo = new THREE.BoxGeometry(0.48, 0.66, 0.28);
  const cPedHeadGeo = new THREE.SphereGeometry(0.22, 6, 5);
  const cPedLegGeo = new THREE.BoxGeometry(0.17, 0.64, 0.18);
  cPedLegGeo.translate(0, -0.32, 0);
  const cPedArmGeo = new THREE.BoxGeometry(0.14, 0.52, 0.15);
  cPedArmGeo.translate(0, -0.24, 0);

  const cPedTorsoInst = new THREE.InstancedMesh(cPedTorsoGeo, cPedMat, cPedCount);
  const cPedHeadInst = new THREE.InstancedMesh(cPedHeadGeo, cPedMat, cPedCount);
  const cPedLegLInst = new THREE.InstancedMesh(cPedLegGeo, cPedMat, cPedCount);
  const cPedLegRInst = new THREE.InstancedMesh(cPedLegGeo, cPedMat, cPedCount);
  const cPedArmLInst = new THREE.InstancedMesh(cPedArmGeo, cPedMat, cPedCount);
  const cPedArmRInst = new THREE.InstancedMesh(cPedArmGeo, cPedMat, cPedCount);

  const cPedInsts = [
    cPedTorsoInst,
    cPedHeadInst,
    cPedLegLInst,
    cPedLegRInst,
    cPedArmLInst,
    cPedArmRInst,
  ];
  const pedShirts = [
    new THREE.Color(0xef4444),
    new THREE.Color(0x2563eb),
    new THREE.Color(0xfacc15),
    new THREE.Color(0xf97316),
    new THREE.Color(0x10b981),
    new THREE.Color(0xf8fafc),
    new THREE.Color(0x8b5cf6),
    new THREE.Color(0x06b6d4),
  ];
  const pedPants = [new THREE.Color(0x0f172a), new THREE.Color(0x1e293b), new THREE.Color(0x1e3a8a)];
  const pedSkins = [new THREE.Color(0xf6c8a5), new THREE.Color(0xe5b089), new THREE.Color(0xd2996c)];

  for (let i = 0; i < cPedCount; i++) {
    const sh = pedShirts[(i * 3) % pedShirts.length];
    const pt = pedPants[(i * 5) % pedPants.length];
    const sk = pedSkins[(i * 7) % pedSkins.length];
    cPedTorsoInst.setColorAt(i, sh);
    cPedArmLInst.setColorAt(i, sh);
    cPedArmRInst.setColorAt(i, sh);
    cPedLegLInst.setColorAt(i, pt);
    cPedLegRInst.setColorAt(i, pt);
    cPedHeadInst.setColorAt(i, sk);
  }
  for (const inst of cPedInsts) {
    inst.frustumCulled = false;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }
  disposables.push(cPedMat, cPedTorsoGeo, cPedHeadGeo, cPedLegGeo, cPedArmGeo);

  // Zero-GC scratch helpers for per-frame city traffic & pedestrian updates
  const _poseTmp: TrackPose = { x: 0, z: 0, yaw: 0, fx: 1, fz: 0 };
  const _vehDummy = new THREE.Object3D();
  const _pedDummy = new THREE.Object3D();
  _pedDummy.rotation.order = 'YXZ';

  const evalVehiclePose = (
    route: CityVehicleRoute,
    elapsed: number,
    out: { x: number; z: number; yaw: number }
  ) => {
    if (route.kind === 'ring') {
      const s = ((route.s0 + elapsed * route.speedS * route.dir) % 1 + 1) % 1;
      const p = evaluateStadiumOval(s, route.radius, straightLen, midR, _poseTmp);
      out.x = p.x;
      out.z = p.z;
      out.yaw = route.dir === 1 ? p.yaw : p.yaw + Math.PI;
    } else {
      const span = route.maxCoord - route.minCoord;
      const raw = ((elapsed * route.speed + route.phase) % span + span) % span;
      const coord = route.dir === 1 ? route.minCoord + raw : route.maxCoord - raw;
      if (route.axis === 'x') {
        out.x = coord;
        out.z = route.fixedCoord;
        out.yaw = route.dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      } else {
        out.x = route.fixedCoord;
        out.z = coord;
        out.yaw = route.dir === 1 ? 0 : Math.PI;
      }
    }
  };

  const _vOut = { x: 0, z: 0, yaw: 0 };

  function update(elapsed: number) {
    // 1. Update 104 City Cars
    _vehDummy.scale.set(1, 1, 1);
    for (let i = 0; i < cCarCount; i++) {
      evalVehiclePose(carRoutes[i], elapsed, _vOut);
      const { x, z, yaw } = _vOut;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      _vehDummy.rotation.set(0, yaw, 0);

      _vehDummy.position.set(x, CITY_ROAD_Y + 0.95, z);
      _vehDummy.updateMatrix();
      cCarBodyInst.setMatrixAt(i, _vehDummy.matrix);

      const cabOff = -0.35;
      _vehDummy.position.set(x + sinY * cabOff, CITY_ROAD_Y + 2.1, z + cosY * cabOff);
      _vehDummy.updateMatrix();
      cCarCabinInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x + sinY * cabOff, CITY_ROAD_Y + 2.04, z + cosY * cabOff);
      _vehDummy.updateMatrix();
      cCarGlassInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x + sinY * 3.92, CITY_ROAD_Y + 1.0, z + cosY * 3.92);
      _vehDummy.updateMatrix();
      cCarHeadInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x - sinY * 3.92, CITY_ROAD_Y + 1.0, z - cosY * 3.92);
      _vehDummy.updateMatrix();
      cCarTailInst.setMatrixAt(i, _vehDummy.matrix);
    }
    cCarBodyInst.instanceMatrix.needsUpdate = true;
    cCarCabinInst.instanceMatrix.needsUpdate = true;
    cCarGlassInst.instanceMatrix.needsUpdate = true;
    cCarHeadInst.instanceMatrix.needsUpdate = true;
    cCarTailInst.instanceMatrix.needsUpdate = true;

    // 2. Update 18 City Transit Buses
    for (let i = 0; i < cBusCount; i++) {
      evalVehiclePose(busRoutes[i], elapsed, _vOut);
      const { x, z, yaw } = _vOut;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      _vehDummy.rotation.set(0, yaw, 0);

      _vehDummy.position.set(x, CITY_ROAD_Y + 2.35, z);
      _vehDummy.updateMatrix();
      cBusBodyInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x, CITY_ROAD_Y + 2.95, z);
      _vehDummy.updateMatrix();
      cBusWinInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x - sinY * 0.8, CITY_ROAD_Y + 4.72, z - cosY * 0.8);
      _vehDummy.updateMatrix();
      cBusAcInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x + sinY * 7.42, CITY_ROAD_Y + 1.2, z + cosY * 7.42);
      _vehDummy.updateMatrix();
      cBusHeadInst.setMatrixAt(i, _vehDummy.matrix);

      _vehDummy.position.set(x - sinY * 7.42, CITY_ROAD_Y + 1.2, z - cosY * 7.42);
      _vehDummy.updateMatrix();
      cBusTailInst.setMatrixAt(i, _vehDummy.matrix);
    }
    cBusBodyInst.instanceMatrix.needsUpdate = true;
    cBusWinInst.instanceMatrix.needsUpdate = true;
    cBusAcInst.instanceMatrix.needsUpdate = true;
    cBusHeadInst.instanceMatrix.needsUpdate = true;
    cBusTailInst.instanceMatrix.needsUpdate = true;

    // 3. Update 160 City Sidewalk Pedestrians
    for (let i = 0; i < cPedCount; i++) {
      const route = cityPeds[i];
      let px = 0;
      let pz = 0;
      let yaw = 0;
      if (route.kind === 'oval') {
        const s = ((route.s0 + elapsed * route.speedS * route.dir) % 1 + 1) % 1;
        const p = evaluateStadiumOval(s, route.radius, straightLen, midR, _poseTmp);
        px = p.x;
        pz = p.z;
        yaw = route.dir === 1 ? p.yaw : p.yaw + Math.PI;
      } else {
        const dx = route.x2 - route.x1;
        const dz = route.z2 - route.z1;
        const dist = Math.hypot(dx, dz) || 1;
        const uRaw = ((elapsed * route.speed + route.phase * 6.0) / dist) % 2;
        const fwd = uRaw < 1;
        const t = fwd ? uRaw : 2 - uRaw;
        const effT = route.dir === 1 ? t : 1 - t;
        px = route.x1 + dx * effT;
        pz = route.z1 + dz * effT;
        const sign = (fwd ? 1 : -1) * route.dir;
        yaw = Math.atan2(dx * sign, dz * sign);
      }

      const sc = route.scale;
      const walkCycle = elapsed * 7.4 + route.phase;
      const swing = Math.sin(walkCycle) * 0.56;
      const bob = Math.abs(Math.cos(walkCycle)) * 0.08 * sc;
      const baseY = CITY_GROUND_Y + 0.03 + bob;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);

      _pedDummy.scale.set(sc, sc, sc);

      _pedDummy.position.set(px, baseY + 0.96 * sc, pz);
      _pedDummy.rotation.set(0.05, yaw, 0);
      _pedDummy.updateMatrix();
      cPedTorsoInst.setMatrixAt(i, _pedDummy.matrix);

      _pedDummy.position.set(px, baseY + 1.52 * sc, pz);
      _pedDummy.rotation.set(0, yaw, 0);
      _pedDummy.updateMatrix();
      cPedHeadInst.setMatrixAt(i, _pedDummy.matrix);

      const legOff = 0.14 * sc;
      _pedDummy.position.set(px - cosY * legOff, baseY + 0.65 * sc, pz + sinY * legOff);
      _pedDummy.rotation.set(swing, yaw, 0);
      _pedDummy.updateMatrix();
      cPedLegLInst.setMatrixAt(i, _pedDummy.matrix);

      _pedDummy.position.set(px + cosY * legOff, baseY + 0.65 * sc, pz - sinY * legOff);
      _pedDummy.rotation.set(-swing, yaw, 0);
      _pedDummy.updateMatrix();
      cPedLegRInst.setMatrixAt(i, _pedDummy.matrix);

      const armOff = 0.32 * sc;
      _pedDummy.position.set(px - cosY * armOff, baseY + 1.22 * sc, pz + sinY * armOff);
      _pedDummy.rotation.set(-swing * 0.85, yaw, 0.08);
      _pedDummy.updateMatrix();
      cPedArmLInst.setMatrixAt(i, _pedDummy.matrix);

      _pedDummy.position.set(px + cosY * armOff, baseY + 1.22 * sc, pz - sinY * armOff);
      _pedDummy.rotation.set(swing * 0.85, yaw, -0.08);
      _pedDummy.updateMatrix();
      cPedArmRInst.setMatrixAt(i, _pedDummy.matrix);
    }

    for (const inst of cPedInsts) {
      inst.instanceMatrix.needsUpdate = true;
    }
  }

  update(0);

  return { group, disposables, update };
}
