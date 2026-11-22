import * as THREE from 'three';
import type { RaceVenueId } from '../types/game';
import {
  ENVIRONMENT_THEMES,
  blendThemeColor,
  weightsForVenue,
  type ThemeWeights,
} from './environmentThemes';
import { calcGatesPerLap, calcTotalLaps } from '../utils/matchScaling';
import {
  evaluateStadiumOval,
  buildOvalRibbonGeometry,
  buildSlopedOvalRibbonGeometry,
  buildOvalWallGeometry,
  buildSteppedBowlGeometry,
  buildOvalShape,
  createTrackTexture,
  createInfieldPitchTexture,
  createGoalNetTexture,
  createStartFinishBannerTexture,
  createCheckeredLineTexture,
  createGateGroundLineTexture,
  createStadiumSeatTierTexture,
  createRoofMembraneTexture,
  createVipFacadeTexture,
  type TrackPose,
} from './stadiumAssets';
import { createPerimeterLedController } from './perimeterLedController';
import { getCachedStadiumLedConfig, type StadiumLedConfig } from '../services/stadiumLedStore';

export type { TrackPose };

export interface PodiumTarget {
  rank: 1 | 2 | 3 | 4;
  x: number;
  y: number;
  z: number;
  stepZ: number;
  sideEntryX: number;
  sideStairTopX: number;
  sideDir: -1 | 1;
}

export interface PodiumWinnerSummary {
  rank: number;
  name: string;
  score: number;
}

export interface JumbotronRunnerEntry {
  rank: number;
  name: string;
  className?: string;
  colorHex: string;
  progress: number;
  score: number;
  effectState: 'normal' | 'boost' | 'penalty' | 'finished';
  finishRank?: number | null;
  isLocal?: boolean;
}

export interface JumbotronUpdatePayload {
  title: string;
  subtitle: string;
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  runners: JumbotronRunnerEntry[];
  totalPlayers: number;
  localRunner?: JumbotronRunnerEntry | null;
}

export interface StadiumEntrancePose {
  startX: number;
  startZ: number;
  exitZ: number;
}

export interface StadiumController {
  group: THREE.Group;
  trackWidth: number;
  laneWidth: number;
  totalLaps: number;
  updateSpectators: (elapsed: number, cheering: boolean) => void;
  updateJumbotron: (payload: JumbotronUpdatePayload) => void;
  applyThemeWeights: (weights: ThemeWeights) => void;
  triggerConfetti: (x: number, z: number) => void;
  updateConfetti: (dt: number) => void;
  getTrackPose: (progress: number, lane: number, maxLanes?: number, out?: TrackPose) => TrackPose;
  getFinishPose: () => TrackPose;
  getEntrancePose: (lane: number, maxLanes?: number) => StadiumEntrancePose;
  getPodiumTargets: () => PodiumTarget[];
  updatePodiumCeremony: (active: boolean, riseT: number, winners?: PodiumWinnerSummary[]) => void;
  updatePerimeterLed: (dt: number) => void;
  setPerimeterLedConfig: (cfg: StadiumLedConfig) => void;
  setSpectatorsVisible: (visible: boolean) => void;
  dispose: () => void;
}

export function createStadium(
  questionCount: number,
  maxAnisotropy: number,
  laneCount = 30,
  venue: RaceVenueId = 'stadium_day'
): StadiumController {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const totalLaps = calcTotalLaps(questionCount);
  const initialPreset = ENVIRONMENT_THEMES[venue];

  // Mega-stadium 30-lane athletic oval (~1,800 units per 5-gate lap -> ~2 min per gate at 3 u/s)
  const straightLen = 400;
  const innerR = 120;
  const laneWidth = 1.45;
  const trackWidth = laneCount * laneWidth; // 43.5 units wide for 30 lanes
  const outerR = innerR + trackWidth; // 163.5
  const midR = innerR + trackWidth / 2; // 141.75

  // 1. Exterior stadium plaza / surrounding meadow ground
  const extGeo = new THREE.PlaneGeometry(3600, 3600);
  const extMat = new THREE.MeshStandardMaterial({
    color: initialPreset.extGroundColor.clone(),
    roughness: 0.95,
  });
  const extFloor = new THREE.Mesh(extGeo, extMat);
  extFloor.rotation.x = -Math.PI / 2;
  extFloor.position.y = -0.06;
  extFloor.receiveShadow = false;
  group.add(extFloor);
  disposables.push(extGeo, extMat);

  // 2. Central Green Stadium Field (Infield Rumput Hijau)
  const infieldShape = buildOvalShape(innerR + 0.6, straightLen);
  const infieldGeo = new THREE.ShapeGeometry(infieldShape, 72);
  infieldGeo.rotateX(-Math.PI / 2);
  const posAttr = infieldGeo.attributes.position;
  const uvArr = new Float32Array(posAttr.count * 2);
  const totalW = straightLen + 2 * innerR;
  const totalH = 2 * innerR;
  for (let i = 0; i < posAttr.count; i++) {
    const px = posAttr.getX(i);
    const pz = posAttr.getZ(i);
    uvArr[i * 2] = (px + totalW / 2) / totalW;
    uvArr[i * 2 + 1] = 1 - (pz + totalH / 2) / totalH;
  }
  infieldGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

  const pitchTex = createInfieldPitchTexture();
  pitchTex.anisotropy = maxAnisotropy;
  const infieldMat = new THREE.MeshStandardMaterial({
    map: pitchTex,
    roughness: 0.9,
    metalness: 0.0,
  });
  const infieldMesh = new THREE.Mesh(infieldGeo, infieldMat);
  infieldMesh.position.y = 0.01;
  infieldMesh.receiveShadow = true;
  group.add(infieldMesh);
  disposables.push(infieldGeo, infieldMat, pitchTex);

  // 2b. Football Goals at Both Ends of the Central Soccer Pitch (with Posts, Crossbar & Nets)
  const goalWidth = 18.0;
  const goalHeight = 5.4;
  const goalDepth = 4.6;
  const goalLineX = (914 / 1024 - 0.5) * totalW;

  const goalPostMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.15 });
  const goalNetTex = createGoalNetTexture();
  const goalNetMat = new THREE.MeshBasicMaterial({
    map: goalNetTex,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const uprightGeo = new THREE.CylinderGeometry(0.22, 0.22, goalHeight, 10);
  const crossbarGeo = new THREE.CylinderGeometry(0.22, 0.22, goalWidth + 0.44, 10);
  const sideBarGeo = new THREE.CylinderGeometry(0.16, 0.16, goalDepth, 8);
  const backStanchionGeo = new THREE.CylinderGeometry(0.14, 0.14, goalHeight, 8);
  const backNetGeo = new THREE.PlaneGeometry(goalWidth, goalHeight);
  const sideNetGeo = new THREE.PlaneGeometry(goalDepth, goalHeight);
  const topNetGeo = new THREE.PlaneGeometry(goalDepth, goalWidth);

  disposables.push(
    goalPostMat,
    goalNetTex,
    goalNetMat,
    uprightGeo,
    crossbarGeo,
    sideBarGeo,
    backStanchionGeo,
    backNetGeo,
    sideNetGeo,
    topNetGeo
  );

  for (const dir of [-1, 1] as const) {
    const goalGrp = new THREE.Group();
    const frontX = dir * goalLineX;
    const backX = dir * (goalLineX + goalDepth);
    const midX = (frontX + backX) / 2;

    const postL = new THREE.Mesh(uprightGeo, goalPostMat);
    postL.position.set(frontX, goalHeight / 2, -goalWidth / 2);
    postL.castShadow = true;
    const postR = new THREE.Mesh(uprightGeo, goalPostMat);
    postR.position.set(frontX, goalHeight / 2, goalWidth / 2);
    postR.castShadow = true;
    const crossbar = new THREE.Mesh(crossbarGeo, goalPostMat);
    crossbar.rotation.x = Math.PI / 2;
    crossbar.position.set(frontX, goalHeight, 0);
    crossbar.castShadow = true;

    const rearPostL = new THREE.Mesh(backStanchionGeo, goalPostMat);
    rearPostL.position.set(backX, goalHeight / 2, -goalWidth / 2);
    const rearPostR = new THREE.Mesh(backStanchionGeo, goalPostMat);
    rearPostR.position.set(backX, goalHeight / 2, goalWidth / 2);
    const rearGroundBar = new THREE.Mesh(crossbarGeo, goalPostMat);
    rearGroundBar.rotation.x = Math.PI / 2;
    rearGroundBar.position.set(backX, 0.12, 0);
    const rearTopBar = new THREE.Mesh(crossbarGeo, goalPostMat);
    rearTopBar.rotation.x = Math.PI / 2;
    rearTopBar.position.set(backX, goalHeight, 0);

    for (const zSide of [-goalWidth / 2, goalWidth / 2]) {
      const topSide = new THREE.Mesh(sideBarGeo, goalPostMat);
      topSide.rotation.z = Math.PI / 2;
      topSide.position.set(midX, goalHeight, zSide);
      const botSide = new THREE.Mesh(sideBarGeo, goalPostMat);
      botSide.rotation.z = Math.PI / 2;
      botSide.position.set(midX, 0.12, zSide);
      goalGrp.add(topSide, botSide);
    }

    const backNet = new THREE.Mesh(backNetGeo, goalNetMat);
    backNet.position.set(backX, goalHeight / 2, 0);
    backNet.rotation.y = Math.PI / 2;
    const sideNetL = new THREE.Mesh(sideNetGeo, goalNetMat);
    sideNetL.position.set(midX, goalHeight / 2, -goalWidth / 2);
    const sideNetR = new THREE.Mesh(sideNetGeo, goalNetMat);
    sideNetR.position.set(midX, goalHeight / 2, goalWidth / 2);
    const topNet = new THREE.Mesh(topNetGeo, goalNetMat);
    topNet.position.set(midX, goalHeight, 0);
    topNet.rotation.x = -Math.PI / 2;

    goalGrp.add(
      postL,
      postR,
      crossbar,
      rearPostL,
      rearPostR,
      rearGroundBar,
      rearTopBar,
      backNet,
      sideNetL,
      sideNetR,
      topNet
    );
    group.add(goalGrp);
  }

  // 2c. Pitch Corner Flags (4 FIFA-style yellow/orange flags at pitch corners)
  const pitchEdgeX = (914 / 1024 - 0.5) * totalW;
  const pitchEdgeZ = (446 / 512 - 0.5) * totalH;
  const cFlagPoleGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6);
  const cFlagClothGeo = new THREE.BoxGeometry(0.9, 0.55, 0.06);
  const cFlagMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.45 });
  disposables.push(cFlagPoleGeo, cFlagClothGeo, cFlagMat);
  for (const cx of [-pitchEdgeX, pitchEdgeX]) {
    for (const cz of [-pitchEdgeZ, pitchEdgeZ]) {
      const pole = new THREE.Mesh(cFlagPoleGeo, goalPostMat);
      pole.position.set(cx, 1.1, cz);
      const cloth = new THREE.Mesh(cFlagClothGeo, cFlagMat);
      cloth.position.set(cx + (cx > 0 ? -0.45 : 0.45), 1.9, cz);
      group.add(pole, cloth);
    }
  }

  // 3. Red Tartan Oval Running Track (30 lanes with crisp white dividing lines)
  const trackTex = createTrackTexture(laneCount);
  trackTex.anisotropy = maxAnisotropy;
  const trackGeo = buildOvalRibbonGeometry(innerR, outerR, straightLen, 320, 120);
  const trackMat = new THREE.MeshStandardMaterial({
    map: trackTex,
    roughness: 0.86,
    metalness: 0.02,
  });
  const trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.position.y = 0.03;
  trackMesh.receiveShadow = true;
  group.add(trackMesh);
  disposables.push(trackGeo, trackMat, trackTex);

  // Inner & Outer White Concrete Curbs
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 });
  const innerCurbGeo = buildOvalRibbonGeometry(innerR - 0.9, innerR, straightLen, 260, 1);
  const outerCurbGeo = buildOvalRibbonGeometry(outerR, outerR + 1.0, straightLen, 260, 1);
  const innerCurb = new THREE.Mesh(innerCurbGeo, curbMat);
  innerCurb.position.y = 0.05;
  const outerCurb = new THREE.Mesh(outerCurbGeo, curbMat);
  outerCurb.position.y = 0.05;
  group.add(innerCurb, outerCurb);
  disposables.push(curbMat, innerCurbGeo, outerCurbGeo);

  // Outer Concourse / Stadium Plaza Apron
  const apronGeo = buildOvalRibbonGeometry(outerR + 1.0, outerR + 115, straightLen, 260, 1);
  const apronMat = new THREE.MeshStandardMaterial({
    color: initialPreset.apronColor.clone(),
    roughness: 0.88,
  });
  const apronMesh = new THREE.Mesh(apronGeo, apronMat);
  apronMesh.position.y = 0.015;
  apronMesh.receiveShadow = false;
  group.add(apronMesh);
  disposables.push(apronGeo, apronMat);

  // 4. INTERNATIONAL START / FINISH CHAMPIONSHIP GANTRY (at s = 0, home straight)
  const sfIn = evaluateStadiumOval(0, innerR - 1.8, straightLen, midR);
  const sfOut = evaluateStadiumOval(0, outerR + 1.8, straightLen, midR);
  const sfCenter = evaluateStadiumOval(0, midR, straightLen, midR);
  const sfDx = sfOut.x - sfIn.x;
  const sfDz = sfOut.z - sfIn.z;
  const sfCrossYaw = Math.atan2(-sfDz, sfDx);
  const sfSpan = Math.hypot(sfDx, sfDz);

  const gantrySteelMat = new THREE.MeshStandardMaterial({ color: 0x0f2957, metalness: 0.72, roughness: 0.25 });
  const gantryGoldMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    metalness: 0.78,
    roughness: 0.24,
    emissive: 0xca8a04,
    emissiveIntensity: 0.22,
  });
  const pillarGeo = new THREE.BoxGeometry(1.75, 14.5, 1.75);
  const pillarCapGeo = new THREE.BoxGeometry(2.3, 1.0, 2.3);
  const pIn = new THREE.Mesh(pillarGeo, gantrySteelMat);
  pIn.position.set(sfIn.x, 7.25, sfIn.z);
  pIn.castShadow = true;
  const pOut = new THREE.Mesh(pillarGeo, gantrySteelMat);
  pOut.position.set(sfOut.x, 7.25, sfOut.z);
  pOut.castShadow = true;
  const pInCap = new THREE.Mesh(pillarCapGeo, gantryGoldMat);
  pInCap.position.set(sfIn.x, 14.8, sfIn.z);
  const pOutCap = new THREE.Mesh(pillarCapGeo, gantryGoldMat);
  pOutCap.position.set(sfOut.x, 14.8, sfOut.z);

  const sfBannerTex = createStartFinishBannerTexture();
  sfBannerTex.anisotropy = maxAnisotropy;
  // Depth 1.92 > pillar depth 1.75 so gantry pillars never poke through or clip the banner faces
  const sfBannerGeo = new THREE.BoxGeometry(sfSpan + 2.2, 5.0, 1.92);
  const sfBannerMat = new THREE.MeshStandardMaterial({
    map: sfBannerTex,
    roughness: 0.3,
    emissive: 0x102247,
    emissiveIntensity: 0.32,
  });
  // Apply banner texture only to front (+Z) and back (-Z) faces; keep sides/top/bottom clean gantry steel
  const sfBanner = new THREE.Mesh(sfBannerGeo, [
    gantrySteelMat,
    gantrySteelMat,
    gantrySteelMat,
    gantrySteelMat,
    sfBannerMat,
    sfBannerMat,
  ]);
  sfBanner.position.set(sfCenter.x, 12.6, sfCenter.z);
  sfBanner.rotation.y = sfCrossYaw;

  const sfLineTex = createCheckeredLineTexture();
  sfLineTex.anisotropy = maxAnisotropy;
  const sfLineGeo = new THREE.BoxGeometry(trackWidth, 0.03, 2.8);
  const sfLineMat = new THREE.MeshBasicMaterial({ map: sfLineTex });
  const sfLine = new THREE.Mesh(sfLineGeo, sfLineMat);
  sfLine.position.set(sfCenter.x, 0.045, sfCenter.z);
  sfLine.rotation.y = sfCrossYaw;

  group.add(pIn, pOut, pInCap, pOutCap, sfBanner, sfLine);
  disposables.push(
    gantrySteelMat,
    gantryGoldMat,
    pillarGeo,
    pillarCapGeo,
    sfBannerTex,
    sfBannerGeo,
    sfBannerMat,
    sfLineTex,
    sfLineGeo,
    sfLineMat
  );

  // 4b. STADIUM ATHLETE ENTRANCE TUNNEL PORTAL ("PINTU MASUK ATLET") — behind Start Line on outer grandstand side
  const entranceCenterX = -12.0;
  const entranceBackZ = outerR + 4.88; // 168.38 (cleanly in front of lowerLedMesh at 168.62)
  const entranceDepth = 3.0;
  const entranceMidZ = entranceBackZ - entranceDepth / 2; // 166.88
  const entranceFrontZ = entranceBackZ - entranceDepth; // 165.38

  const entranceGroup = new THREE.Group();
  entranceGroup.position.set(entranceCenterX, 0, entranceMidZ);

  const entranceConcreteMat = new THREE.MeshStandardMaterial({
    color: 0x0d2147,
    roughness: 0.56,
    metalness: 0.32,
  });
  const entranceInteriorMat = new THREE.MeshStandardMaterial({
    color: 0x030712,
    roughness: 0.94,
    metalness: 0.04,
  });
  const entranceRoofMat = new THREE.MeshStandardMaterial({
    color: 0x162c56,
    roughness: 0.34,
    metalness: 0.62,
  });
  const entranceLightMat = new THREE.MeshBasicMaterial({ color: 0xe0f2fe });
  const entranceCarpetMat = new THREE.MeshStandardMaterial({
    color: 0x1d4ed8,
    roughness: 0.86,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const entranceCarpetTrimMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.42,
    metalness: 0.48,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const entranceSignCanvas = document.createElement('canvas');
  entranceSignCanvas.width = 1024;
  entranceSignCanvas.height = 160;
  const eCtx = entranceSignCanvas.getContext('2d')!;
  const eGrad = eCtx.createLinearGradient(0, 0, 1024, 0);
  eGrad.addColorStop(0, '#07142E');
  eGrad.addColorStop(0.5, '#102B63');
  eGrad.addColorStop(1, '#07142E');
  eCtx.fillStyle = eGrad;
  eCtx.fillRect(0, 0, 1024, 160);
  eCtx.fillStyle = '#FF6B1A';
  eCtx.fillRect(0, 0, 1024, 16);
  eCtx.strokeStyle = '#FACC15';
  eCtx.lineWidth = 8;
  eCtx.strokeRect(8, 20, 1008, 132);
  eCtx.textAlign = 'center';
  eCtx.textBaseline = 'middle';
  eCtx.fillStyle = '#FACC15';
  eCtx.font = '800 22px sans-serif';
  eCtx.fillText('EDU RUN ARENA 3D · ATHLETE TUNNEL', 512, 48);
  eCtx.fillStyle = '#FFFFFF';
  eCtx.font = '900 58px sans-serif';
  eCtx.fillText('PINTU MASUK ATLET', 512, 108, 920);
  const entranceSignTex = new THREE.CanvasTexture(entranceSignCanvas);
  entranceSignTex.colorSpace = THREE.SRGBColorSpace;
  entranceSignTex.anisotropy = maxAnisotropy;
  const entranceSignMat = new THREE.MeshStandardMaterial({
    map: entranceSignTex,
    roughness: 0.28,
    emissive: 0x0f2554,
    emissiveIntensity: 0.45,
  });

  // Recessed dark tunnel opening back wall
  const tunnelBackGeo = new THREE.BoxGeometry(8.8, 4.65, 0.25);
  const tunnelBack = new THREE.Mesh(tunnelBackGeo, entranceInteriorMat);
  tunnelBack.position.set(0, 2.325, entranceDepth / 2 - 0.12);

  // Left & right structural tunnel piers (flush at y = 0)
  const tunnelPierGeo = new THREE.BoxGeometry(1.5, 5.2, entranceDepth);
  const pierL = new THREE.Mesh(tunnelPierGeo, entranceConcreteMat);
  pierL.position.set(-4.95, 2.6, 0);
  const pierR = new THREE.Mesh(tunnelPierGeo, entranceConcreteMat);
  pierR.position.set(4.95, 2.6, 0);

  // Inner dark tunnel sidewalls
  const tunnelInnerSideGeo = new THREE.BoxGeometry(0.18, 4.65, entranceDepth - 0.2);
  const sideL = new THREE.Mesh(tunnelInnerSideGeo, entranceInteriorMat);
  sideL.position.set(-4.12, 2.325, 0.05);
  const sideR = new THREE.Mesh(tunnelInnerSideGeo, entranceInteriorMat);
  sideR.position.set(4.12, 2.325, 0.05);

  // Gold accent trim pillars on front face
  const trimColGeo = new THREE.BoxGeometry(0.36, 5.1, 0.36);
  const entranceTrimL = new THREE.Mesh(trimColGeo, gantryGoldMat);
  entranceTrimL.position.set(-4.45, 2.55, -entranceDepth / 2 - 0.06);
  const entranceTrimR = new THREE.Mesh(trimColGeo, gantryGoldMat);
  entranceTrimR.position.set(4.45, 2.55, -entranceDepth / 2 - 0.06);

  // Vaulted canopy roof + top parapet
  const tunnelRoofGeo = new THREE.BoxGeometry(11.6, 1.35, entranceDepth + 0.5);
  const tunnelRoof = new THREE.Mesh(tunnelRoofGeo, entranceRoofMat);
  tunnelRoof.position.set(0, 5.25, -0.1);

  // Overhead recessed tunnel LED ceiling strips illuminating emerging athletes
  const tunnelLightGeo = new THREE.BoxGeometry(7.6, 0.08, 0.38);
  const tunnelLight1 = new THREE.Mesh(tunnelLightGeo, entranceLightMat);
  tunnelLight1.position.set(0, 4.55, -0.75);
  const tunnelLight2 = new THREE.Mesh(tunnelLightGeo, entranceLightMat);
  tunnelLight2.position.set(0, 4.55, 0.45);

  // Front illuminated fascia sign facing -Z toward the track & cameras
  const entranceSignGeo = new THREE.PlaneGeometry(9.6, 1.45);
  const entranceSign = new THREE.Mesh(entranceSignGeo, entranceSignMat);
  entranceSign.position.set(0, 5.25, -(entranceDepth + 0.5) / 2 - 0.12);
  entranceSign.rotation.y = Math.PI;

  // Athlete entry carpet runner from inside the tunnel out to the outer track curb
  const carpetLen = entranceBackZ - (outerR + 0.45); // ~4.43m
  const carpetCenterLocalZ = entranceBackZ - carpetLen / 2 - entranceMidZ;
  const entranceCarpetGeo = new THREE.BoxGeometry(7.2, 0.03, carpetLen);
  const entranceCarpetMesh = new THREE.Mesh(entranceCarpetGeo, entranceCarpetMat);
  entranceCarpetMesh.position.set(0, 0.05, carpetCenterLocalZ);
  const entranceCarpetTrimGeo = new THREE.BoxGeometry(0.28, 0.032, carpetLen);
  const carpetTrimL = new THREE.Mesh(entranceCarpetTrimGeo, entranceCarpetTrimMat);
  carpetTrimL.position.set(-3.72, 0.052, carpetCenterLocalZ);
  const carpetTrimR = new THREE.Mesh(entranceCarpetTrimGeo, entranceCarpetTrimMat);
  carpetTrimR.position.set(3.72, 0.052, carpetCenterLocalZ);

  // Flanking metallic stanchion bollards along the entry apron
  const bollardGeo = new THREE.CylinderGeometry(0.11, 0.14, 0.95, 10);
  const bollardCapGeo = new THREE.SphereGeometry(0.14, 10, 8);
  const bollardPositions: Array<[number, number]> = [
    [-4.1, entranceFrontZ - 0.55 - entranceMidZ],
    [-4.1, entranceFrontZ - 1.45 - entranceMidZ],
    [4.1, entranceFrontZ - 0.55 - entranceMidZ],
    [4.1, entranceFrontZ - 1.45 - entranceMidZ],
  ];
  for (const [bx, bz] of bollardPositions) {
    const post = new THREE.Mesh(bollardGeo, gantrySteelMat);
    post.position.set(bx, 0.475, bz);
    const cap = new THREE.Mesh(bollardCapGeo, gantryGoldMat);
    cap.position.set(bx, 0.98, bz);
    entranceGroup.add(post, cap);
  }

  entranceGroup.add(
    tunnelBack,
    pierL,
    pierR,
    sideL,
    sideR,
    entranceTrimL,
    entranceTrimR,
    tunnelRoof,
    tunnelLight1,
    tunnelLight2,
    entranceSign,
    entranceCarpetMesh,
    carpetTrimL,
    carpetTrimR
  );
  group.add(entranceGroup);
  disposables.push(
    entranceConcreteMat,
    entranceInteriorMat,
    entranceRoofMat,
    entranceLightMat,
    entranceCarpetMat,
    entranceCarpetTrimMat,
    entranceSignTex,
    entranceSignMat,
    tunnelBackGeo,
    tunnelPierGeo,
    tunnelInnerSideGeo,
    trimColGeo,
    tunnelRoofGeo,
    tunnelLightGeo,
    entranceSignGeo,
    entranceCarpetGeo,
    entranceCarpetTrimGeo,
    bollardGeo,
    bollardCapGeo
  );

  // 5. QUESTION GATE LINES PER LAP (flat across all 30 lanes)
  const gatesOnLap = calcGatesPerLap(questionCount);
  const gateFractions = Array.from({ length: gatesOnLap }, (_, idx) => (idx + 1) / (gatesOnLap + 1));
  const gateLineGeo = new THREE.BoxGeometry(trackWidth, 0.03, 2.8);
  disposables.push(gateLineGeo);

  gateFractions.forEach((frac, idx) => {
    const gIn = evaluateStadiumOval(frac, innerR, straightLen, midR);
    const gOut = evaluateStadiumOval(frac, outerR, straightLen, midR);
    const gCenter = evaluateStadiumOval(frac, midR, straightLen, midR);
    const crossYaw = Math.atan2(-(gOut.z - gIn.z), gOut.x - gIn.x);

    const gTex = createGateGroundLineTexture(idx + 1);
    gTex.anisotropy = maxAnisotropy;
    const gMat = new THREE.MeshBasicMaterial({ map: gTex });
    const gLine = new THREE.Mesh(gateLineGeo, gMat);
    gLine.position.set(gCenter.x, 0.045, gCenter.z);
    gLine.rotation.y = crossYaw;
    group.add(gLine);
    disposables.push(gTex, gMat);
  });

  // 6. Scoreboard / Giant Upper-Side Digital LED Jumbotron (Live Runner Ranking Board)
  // Render at 0.6x physical resolution (768x288) for 2.8x faster GPU texture uploads while keeping 1280x480 layout coords
  const JUMBO_W = 1280;
  const JUMBO_H = 480;
  const JUMBO_SCALE = 0.6;
  const jumboCanvas = document.createElement('canvas');
  jumboCanvas.width = Math.round(JUMBO_W * JUMBO_SCALE);
  jumboCanvas.height = Math.round(JUMBO_H * JUMBO_SCALE);
  const jumboCtx = jumboCanvas.getContext('2d')!;
  const jumboTex = new THREE.CanvasTexture(jumboCanvas);
  jumboTex.colorSpace = THREE.SRGBColorSpace;
  jumboTex.anisotropy = Math.min(4, maxAnisotropy);
  disposables.push(jumboTex);

  const stadiumGroup = new THREE.Group();
  const nightExtrasGroup = new THREE.Group();
  const openFieldGroup = new THREE.Group();
  const dayCloudsGroup = new THREE.Group();
  group.add(stadiumGroup, nightExtrasGroup, openFieldGroup, dayCloudsGroup);

  function fillRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
    ctx.fill();
  }

  function strokeRoundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
    ctx.stroke();
  }

  function updateJumbotron(payload: JumbotronUpdatePayload) {
    const ctx = jumboCtx;
    ctx.setTransform(JUMBO_SCALE, 0, 0, JUMBO_SCALE, 0, 0);
    const { title, subtitle, status, runners, totalPlayers, localRunner } = payload;

    // Deep broadcast stadium LED backdrop
    const bgGrad = ctx.createLinearGradient(0, 0, 0, JUMBO_H);
    bgGrad.addColorStop(0, '#07142E');
    bgGrad.addColorStop(0.5, '#0B1D42');
    bgGrad.addColorStop(1, '#061026');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, JUMBO_W, JUMBO_H);

    // Outer illuminated broadcast frame
    ctx.strokeStyle = status === 'finished' ? '#FACC15' : '#38BDF8';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, JUMBO_W - 16, JUMBO_H - 16);

    // Top Broadcast Header Bar
    const headerGrad = ctx.createLinearGradient(20, 20, JUMBO_W - 20, 20);
    headerGrad.addColorStop(0, '#0F2957');
    headerGrad.addColorStop(0.55, '#1D4ED8');
    headerGrad.addColorStop(1, '#FF6B1A');
    ctx.fillStyle = headerGrad;
    fillRoundRect(ctx, 22, 20, JUMBO_W - 44, 68, 12);

    // Live status pill on left of header
    const badgeColor =
      status === 'playing'
        ? '#10B981'
        : status === 'finished'
        ? '#FACC15'
        : status === 'countdown'
        ? '#F97316'
        : '#38BDF8';
    const badgeText =
      status === 'playing'
        ? 'LIVE BALAP'
        : status === 'finished'
        ? 'HASIL AKHIR'
        : status === 'countdown'
        ? 'BERSIAP'
        : 'GARIS START';
    ctx.fillStyle = badgeColor;
    fillRoundRect(ctx, 36, 33, 178, 42, 8);
    ctx.fillStyle = '#07132B';
    ctx.font = '900 22px Outfit, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, 36 + 89, 55);

    // Room title + subtitle
    ctx.textAlign = 'left';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 30px Outfit, system-ui, sans-serif';
    ctx.fillText(title.toUpperCase().slice(0, 30), 232, 46);
    ctx.fillStyle = '#DBEAFE';
    ctx.font = '700 18px system-ui, sans-serif';
    ctx.fillText(subtitle.toUpperCase().slice(0, 56), 232, 72);

    // Right header title: KLASEMEN URUTAN PEMBALAP
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 24px Outfit, system-ui, sans-serif';
    ctx.fillText('URUTAN PEMBALAP', JUMBO_W - 40, 46);
    ctx.fillStyle = '#FEF08A';
    ctx.font = '800 18px monospace';
    ctx.fillText(`${totalPlayers} PESERTA AKTIF`, JUMBO_W - 40, 72);

    // Main Leaderboard Body (2 columns x 4 rows = Top 8 Live Rankings)
    const bodyTop = 104;
    const bodyBottom = JUMBO_H - 56;
    const bodyH = bodyBottom - bodyTop;

    if (runners.length === 0) {
      ctx.fillStyle = 'rgba(15, 41, 87, 0.72)';
      fillRoundRect(ctx, 26, bodyTop + 14, JUMBO_W - 52, bodyH - 28, 16);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 3;
      strokeRoundRect(ctx, 26, bodyTop + 14, JUMBO_W - 52, bodyH - 28, 16);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#FACC15';
      ctx.font = '900 44px Outfit, system-ui, sans-serif';
      ctx.fillText('MENUNGGU PEMBALAP MASUK LINTASAN', JUMBO_W / 2, bodyTop + bodyH * 0.42);
      ctx.fillStyle = '#93C5FD';
      ctx.font = '700 24px system-ui, sans-serif';
      ctx.fillText(
        'KLASEMEN URUTAN LARI AKAN TAMPIL REAL-TIME DI LAYAR INI',
        JUMBO_W / 2,
        bodyTop + bodyH * 0.66
      );
    } else {
      const topList = runners.slice(0, 8);
      const colGap = 22;
      const sidePad = 24;
      const colW = (JUMBO_W - sidePad * 2 - colGap) / 2;
      const rowGap = 10;
      const rowH = Math.floor((bodyH - rowGap * 3) / 4);

      for (let idx = 0; idx < 8; idx++) {
        const col = idx < 4 ? 0 : 1;
        const row = idx % 4;
        const rx = sidePad + col * (colW + colGap);
        const ry = bodyTop + row * (rowH + rowGap);
        const entry = topList[idx];

        if (!entry) {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
          fillRoundRect(ctx, rx, ry, colW, rowH, 10);
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
          ctx.lineWidth = 2;
          strokeRoundRect(ctx, rx, ry, colW, rowH, 10);
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
          ctx.font = '800 22px monospace';
          ctx.fillText(`#${idx + 1}  ---`, rx + 18, ry + rowH / 2 + 1);
          continue;
        }

        const rank = entry.rank;
        const isTop1 = rank === 1;
        const isTop2 = rank === 2;
        const isTop3 = rank === 3;
        const rankBg = isTop1
          ? '#FACC15'
          : isTop2
          ? '#E2E8F0'
          : isTop3
          ? '#FB923C'
          : rank === 4
          ? '#38BDF8'
          : '#1E3A8A';
        const rankFg = rank <= 4 ? '#07132B' : '#F8FAFC';

        // Row card background (highlight #1 and local player)
        ctx.fillStyle = entry.isLocal
          ? 'rgba(30, 64, 175, 0.72)'
          : isTop1
          ? 'rgba(250, 204, 21, 0.16)'
          : 'rgba(15, 41, 87, 0.78)';
        fillRoundRect(ctx, rx, ry, colW, rowH, 10);

        ctx.strokeStyle = entry.isLocal
          ? '#FACC15'
          : isTop1
          ? 'rgba(250, 204, 21, 0.85)'
          : entry.effectState === 'boost'
          ? 'rgba(34, 211, 238, 0.85)'
          : 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = entry.isLocal || isTop1 ? 3 : 1.5;
        strokeRoundRect(ctx, rx, ry, colW, rowH, 10);

        // Rank Badge
        const badgeW = 52;
        ctx.fillStyle = rankBg;
        fillRoundRect(ctx, rx + 8, ry + 8, badgeW, rowH - 16, 8);
        ctx.textAlign = 'center';
        ctx.fillStyle = rankFg;
        ctx.font = '900 28px monospace';
        ctx.fillText(`${rank}`, rx + 8 + badgeW / 2, ry + rowH / 2 + 1);

        // Jersey color vertical indicator bar
        ctx.fillStyle = entry.colorHex || '#3B82F6';
        fillRoundRect(ctx, rx + 68, ry + 10, 8, rowH - 20, 4);

        // Runner Name
        const nameX = rx + 86;
        const pct = Math.max(0, Math.min(100, Math.round(entry.progress * 100)));
        const rightStatW = 148;
        const barAreaW = colW - (nameX - rx) - rightStatW - 12;

        ctx.textAlign = 'left';
        ctx.fillStyle = isTop1 ? '#FEF08A' : '#FFFFFF';
        ctx.font = '900 24px Outfit, system-ui, sans-serif';
        const displayName = entry.name.toUpperCase();
        const clipped = displayName.length > 15 ? `${displayName.slice(0, 14)}…` : displayName;
        ctx.fillText(clipped, nameX, ry + 25, barAreaW);

        // Mini Track Progress Bar under runner name
        const barY = ry + rowH - 21;
        const barH = 11;
        ctx.fillStyle = 'rgba(7, 19, 43, 0.9)';
        fillRoundRect(ctx, nameX, barY, barAreaW, barH, 5);

        const fillW = Math.max(10, Math.round((barAreaW * Math.max(2, pct)) / 100));
        ctx.fillStyle =
          entry.finishRank != null || entry.effectState === 'finished'
            ? '#10B981'
            : entry.effectState === 'boost'
            ? '#22D3EE'
            : entry.effectState === 'penalty'
            ? '#FB7185'
            : isTop1
            ? '#FACC15'
            : '#3B82F6';
        fillRoundRect(ctx, nameX, barY, Math.min(barAreaW, fillW), barH, 5);

        // Right-side status / percentage & score readout
        const rightX = rx + colW - 14;
        ctx.textAlign = 'right';
        const statusTag =
          entry.finishRank != null || entry.effectState === 'finished'
            ? 'FINISH'
            : entry.effectState === 'boost'
            ? `BOOST ${pct}%`
            : entry.effectState === 'penalty'
            ? `PELAN ${pct}%`
            : `${pct}%`;
        ctx.fillStyle =
          entry.finishRank != null || entry.effectState === 'finished'
            ? '#34D399'
            : entry.effectState === 'boost'
            ? '#67E8F9'
            : entry.effectState === 'penalty'
            ? '#FDA4AF'
            : '#93C5FD';
        ctx.font = '800 18px monospace';
        ctx.fillText(statusTag, rightX, ry + 24);

        ctx.fillStyle = '#FACC15';
        ctx.font = '900 21px monospace';
        ctx.fillText(`${Math.round(entry.score * 10) / 10} PT`, rightX, ry + rowH - 17);
      }
    }

    // Bottom Broadcast Ticker Footer
    ctx.fillStyle = 'rgba(7, 19, 43, 0.92)';
    fillRoundRect(ctx, 22, JUMBO_H - 46, JUMBO_W - 44, 30, 6);
    ctx.textAlign = 'left';
    ctx.font = '700 16px monospace';
    if (localRunner) {
      const myPct = Math.max(0, Math.min(100, Math.round(localRunner.progress * 100)));
      ctx.fillStyle = '#FACC15';
      ctx.fillText(
        `POSISI ANDA: #${localRunner.rank} ${localRunner.name.toUpperCase().slice(0, 18)}  ·  ${myPct}% LINTASAN  ·  ${Math.round(localRunner.score * 10) / 10} POIN`,
        38,
        JUMBO_H - 30
      );
    } else if (runners.length > 0) {
      const leader = runners[0];
      ctx.fillStyle = '#FACC15';
      ctx.fillText(
        `PEMIMPIN SAAT INI: #1 ${leader.name.toUpperCase().slice(0, 22)} (${Math.round(leader.progress * 100)}% · ${Math.round(leader.score * 10) / 10} POIN)`,
        38,
        JUMBO_H - 30
      );
    } else {
      ctx.fillStyle = '#93C5FD';
      ctx.fillText('EDU RUN ARENA 3D · PAPAN KLASEMEN DIGITAL LIVE STADION', 38, JUMBO_H - 30);
    }

    ctx.textAlign = 'right';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(
      totalPlayers > 8 ? `MENAMPILKAN TOP 8 DARI ${totalPlayers} PEMBALAP` : 'LIVE TELEMETRI LINTASAN',
      JUMBO_W - 38,
      JUMBO_H - 30
    );

    // Subtle LED matrix scanline texture for authentic giant stadium jumbotron feel
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < JUMBO_H; y += 6) {
      ctx.fillRect(0, y, JUMBO_W, 1.5);
    }

    jumboTex.needsUpdate = true;
  }

  updateJumbotron({
    title: 'EDU RUN ARENA 3D',
    subtitle: `${questionCount} SOAL · ${totalLaps} PUTARAN · LINTASAN OVAL 30 LAJUR`,
    status: 'waiting',
    runners: [],
    totalPlayers: 0,
  });

  // ==================== A. GRAND INTERNATIONAL STADIUM ARCHITECTURE ====================
  const tierMat = new THREE.MeshStandardMaterial({
    color: initialPreset.standTierColor.clone(),
    roughness: 0.84,
  });
  const stepFrontMat = new THREE.MeshStandardMaterial({
    color: initialPreset.standStepColor.clone(),
    roughness: 0.72,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: initialPreset.canopyColor.clone(),
    metalness: 0.32,
    roughness: 0.36,
  });
  const seatTex = createStadiumSeatTierTexture();
  seatTex.anisotropy = maxAnisotropy;
  seatTex.repeat.set(1, 1);
  const seatBowlMat = new THREE.MeshStandardMaterial({
    map: seatTex,
    roughness: 0.78,
    metalness: 0.08,
  });
  const perimeterLed = createPerimeterLedController(getCachedStadiumLedConfig());
  perimeterLed.texture.anisotropy = maxAnisotropy;
  const ledBezelMat = new THREE.MeshStandardMaterial({
    color: 0x0b1526,
    metalness: 0.65,
    roughness: 0.38,
  });
  const vipTex = createVipFacadeTexture();
  vipTex.anisotropy = maxAnisotropy;
  const vipWallMat = new THREE.MeshStandardMaterial({
    map: vipTex,
    emissiveMap: vipTex,
    emissive: 0xffffff,
    emissiveIntensity: venue === 'stadium_night' ? 0.65 : 0.2,
    roughness: 0.22,
    metalness: 0.38,
  });
  const roofMembraneTex = createRoofMembraneTexture();
  roofMembraneTex.anisotropy = maxAnisotropy;
  const roofTopMat = new THREE.MeshStandardMaterial({
    map: roofMembraneTex,
    color: 0xf8fafc,
    roughness: 0.42,
    metalness: 0.12,
  });
  const roofSoffitMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.65,
    metalness: 0.55,
  });
  const exoSteelMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.72,
    roughness: 0.28,
  });
  const darkTrussMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.76,
    roughness: 0.32,
  });
  const facadeAccentMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: new THREE.Color(0x38bdf8),
    emissiveIntensity: venue === 'stadium_night' ? 1.5 : 0.28,
    roughness: 0.25,
  });
  disposables.push(
    tierMat,
    stepFrontMat,
    canopyMat,
    seatTex,
    seatBowlMat,
    perimeterLed,
    ledBezelMat,
    vipTex,
    vipWallMat,
    roofMembraneTex,
    roofTopMat,
    roofSoffitMat,
    exoSteelMat,
    darkTrussMat,
    facadeAccentMat
  );

  // 1) Lower Grandstand Bowl + Full 360° Dynamic Perimeter LED Ribbon Screen along Lower Barrier
  const lowerBaseR = outerR + 5.4; // 168.9
  const lowerBaseY = 2.4;
  const lowerTierCount = 6;
  const lowerTierDepth = 4.8;
  const lowerTierStepH = 1.8;
  const lowerEndR = lowerBaseR + lowerTierCount * lowerTierDepth; // 197.7
  const lowerEndY = lowerBaseY + lowerTierCount * lowerTierStepH; // 13.2

  // Dark metallic LED cabinet frame wrapping 360° along the bottom grandstand barrier
  const lowerWallGeo = buildOvalWallGeometry(lowerBaseR, 0.0, lowerBaseY, straightLen, midR, 240, 1, true);
  const lowerWall = new THREE.Mesh(lowerWallGeo, ledBezelMat);

  // Full 360° HD Lower-Tribune LED Perimeter Screen (Running Text & Rotating Sponsor Images)
  const lowerLedGeo = buildOvalWallGeometry(lowerBaseR - 0.28, 0.22, lowerBaseY - 0.16, straightLen, midR, 240, 1, true);
  const lowerLedMesh = new THREE.Mesh(lowerLedGeo, perimeterLed.material);

  const lowerBowlGeo = buildSteppedBowlGeometry(
    lowerBaseR,
    lowerBaseY,
    lowerTierCount,
    lowerTierDepth,
    lowerTierStepH,
    straightLen,
    midR,
    240,
    72
  );
  const lowerBowl = new THREE.Mesh(lowerBowlGeo, seatBowlMat);
  lowerBowl.receiveShadow = false;
  stadiumGroup.add(lowerWall, lowerLedMesh, lowerBowl);
  disposables.push(lowerWallGeo, lowerLedGeo, lowerBowlGeo);

  // 2) VIP Hospitality Suites & Broadcast Skybox Ring (between Lower & Upper Bowl)
  const vipR = lowerEndR + 0.4; // 198.1
  const vipTopY = 20.6;
  const vipWallGeo = buildOvalWallGeometry(vipR, lowerEndY, vipTopY, straightLen, midR, 240, 56, true);
  const vipWall = new THREE.Mesh(vipWallGeo, vipWallMat);

  const upperBaseR = 206.5;
  const vipDeckGeo = buildOvalRibbonGeometry(vipR, upperBaseR + 0.6, straightLen, 240, 1, midR);
  const vipDeck = new THREE.Mesh(vipDeckGeo, tierMat);
  vipDeck.position.y = vipTopY;

  // 360° Mid-Tier Illuminated LED Fascia Ribbon synced live with the lower perimeter LED playlist
  const midLedGeo = buildOvalWallGeometry(205.5, 19.6, 21.6, straightLen, midR, 240, 1, true);
  const midLedMesh = new THREE.Mesh(midLedGeo, perimeterLed.material);
  stadiumGroup.add(vipWall, vipDeck, midLedMesh);
  disposables.push(vipWallGeo, vipDeckGeo, midLedGeo);

  // 4) Upper Grandstand Bowl (7 dramatic steep international tiers)
  const upperTierCount = 7;
  const upperTierDepth = 5.3;
  const upperTierStepH = 2.55;
  const upperBaseY = 21.5;
  const upperEndR = upperBaseR + upperTierCount * upperTierDepth; // 243.6
  const upperEndY = upperBaseY + upperTierCount * upperTierStepH; // 39.35

  const upperBowlGeo = buildSteppedBowlGeometry(
    upperBaseR,
    upperBaseY,
    upperTierCount,
    upperTierDepth,
    upperTierStepH,
    straightLen,
    midR,
    240,
    80
  );
  const upperBowl = new THREE.Mesh(upperBowlGeo, seatBowlMat);
  upperBowl.receiveShadow = false;
  stadiumGroup.add(upperBowl);
  disposables.push(upperBowlGeo);

  // 5) Monumental Exterior Facade Wall + Glazed Upper Concourse Shell (encloses bowl solidly)
  const extWallR = upperEndR + 0.5; // 244.1
  const extLowerWallGeo = buildOvalWallGeometry(extWallR, 0.0, 18.0, straightLen, midR, 240, 40, false);
  const extLowerWall = new THREE.Mesh(extLowerWallGeo, tierMat);
  const extUpperGlassGeo = buildOvalWallGeometry(extWallR, 18.0, 42.5, straightLen, midR, 240, 64, false);
  const extUpperGlass = new THREE.Mesh(extUpperGlassGeo, vipWallMat);
  const extTopWalkGeo = buildOvalRibbonGeometry(upperEndR - 0.5, extWallR + 2.5, straightLen, 240, 1, midR);
  const extTopWalk = new THREE.Mesh(extTopWalkGeo, stepFrontMat);
  extTopWalk.position.y = upperEndY;
  const facadeGlowBandGeo = buildOvalWallGeometry(extWallR + 0.35, 41.2, 42.6, straightLen, midR, 240, 1, false);
  const facadeGlowBand = new THREE.Mesh(facadeGlowBandGeo, facadeAccentMat);
  stadiumGroup.add(extLowerWall, extUpperGlass, extTopWalk, facadeGlowBand);
  disposables.push(extLowerWallGeo, extUpperGlassGeo, extTopWalkGeo, facadeGlowBandGeo);

  // 6) 52 Exterior Diagrid Steel Exoskeleton Buttresses & Illuminated Ribs (InstancedMesh)
  const ribCount = 52;
  const buttressGeo = new THREE.BoxGeometry(2.4, 48.5, 3.8);
  const plinthGeo = new THREE.BoxGeometry(4.4, 3.2, 5.8);
  const ribStripGeo = new THREE.BoxGeometry(0.65, 47.2, 0.75);
  const buttressInst = new THREE.InstancedMesh(buttressGeo, exoSteelMat, ribCount);
  const plinthInst = new THREE.InstancedMesh(plinthGeo, stepFrontMat, ribCount);
  const ribStripInst = new THREE.InstancedMesh(ribStripGeo, facadeAccentMat, ribCount);
  buttressInst.castShadow = false;
  buttressInst.frustumCulled = false;
  plinthInst.frustumCulled = false;
  ribStripInst.frustumCulled = false;

  const archDummy = new THREE.Object3D();
  archDummy.rotation.order = 'YXZ';
  for (let i = 0; i < ribCount; i++) {
    const s = i / ribCount;
    const pBase = evaluateStadiumOval(s, extWallR + 9.5, straightLen, midR);
    const pMid = evaluateStadiumOval(s, extWallR + 4.8, straightLen, midR);
    const radialYaw = Math.atan2(-pMid.fz, pMid.fx);

    archDummy.position.set(pBase.x, 1.6, pBase.z);
    archDummy.rotation.set(0, radialYaw, 0);
    archDummy.scale.set(1, 1, 1);
    archDummy.updateMatrix();
    plinthInst.setMatrixAt(i, archDummy.matrix);

    // Lean top inward (-local Z) cleanly from outer plinth up toward roof compression eaves
    archDummy.position.set(pMid.x, 23.6, pMid.z);
    archDummy.rotation.set(-0.19, radialYaw, 0);
    archDummy.updateMatrix();
    buttressInst.setMatrixAt(i, archDummy.matrix);

    const pStrip = evaluateStadiumOval(s, extWallR + 6.9, straightLen, midR);
    archDummy.position.set(pStrip.x, 23.6, pStrip.z);
    archDummy.rotation.set(-0.19, radialYaw, 0);
    archDummy.updateMatrix();
    ribStripInst.setMatrixAt(i, archDummy.matrix);
  }
  buttressInst.instanceMatrix.needsUpdate = true;
  plinthInst.instanceMatrix.needsUpdate = true;
  ribStripInst.instanceMatrix.needsUpdate = true;
  stadiumGroup.add(plinthInst, buttressInst, ribStripInst);
  disposables.push(buttressGeo, plinthGeo, ribStripGeo);

  // 7) 4 Monumental Stadium Entrance Gate Pavilions (South, East, North, West)
  const gatePillarGeo = new THREE.BoxGeometry(3.8, 17.5, 4.4);
  const gateHeaderGeo = new THREE.BoxGeometry(34, 4.2, 5.2);
  const gateStepGeo = new THREE.BoxGeometry(36, 1.4, 8.0);
  const gateLogoGeo = new THREE.BoxGeometry(28, 2.0, 0.6);
  disposables.push(gatePillarGeo, gateHeaderGeo, gateStepGeo, gateLogoGeo);

  [0, 0.25, 0.5, 0.75].forEach((s) => {
    const p = evaluateStadiumOval(s, extWallR + 14.0, straightLen, midR);
    const radialYaw = Math.atan2(-p.fz, p.fx);
    const gateGrp = new THREE.Group();
    gateGrp.position.set(p.x, 0, p.z);
    gateGrp.rotation.y = radialYaw;

    const colL = new THREE.Mesh(gatePillarGeo, exoSteelMat);
    colL.position.set(-14.5, 8.75, 0);
    const colR = new THREE.Mesh(gatePillarGeo, exoSteelMat);
    colR.position.set(14.5, 8.75, 0);
    const header = new THREE.Mesh(gateHeaderGeo, canopyMat);
    header.position.set(0, 17.5, 0);
    const glowBar = new THREE.Mesh(gateLogoGeo, facadeAccentMat);
    glowBar.position.set(0, 17.5, 2.5);
    const steps = new THREE.Mesh(gateStepGeo, stepFrontMat);
    steps.position.set(0, 0.7, 3.2);
    gateGrp.add(colL, colR, header, glowBar, steps);
    stadiumGroup.add(gateGrp);
  });

  // 8) Sweeping Cantilever PTFE Architectural Membrane Roof & Steel Truss Ring
  const roofInnerR = 171.0;
  const roofOuterR = 250.5;
  const roofInnerY = 54.0;
  const roofOuterY = 45.6;

  const roofTopGeo = buildSlopedOvalRibbonGeometry(
    roofInnerR,
    roofInnerY,
    roofOuterR,
    roofOuterY,
    straightLen,
    midR,
    240,
    1,
    52,
    false
  );
  const roofTop = new THREE.Mesh(roofTopGeo, roofTopMat);
  const roofSoffitGeo = buildSlopedOvalRibbonGeometry(
    roofInnerR,
    roofInnerY - 1.0,
    roofOuterR,
    roofOuterY - 1.0,
    straightLen,
    midR,
    240,
    1,
    1,
    true
  );
  const roofSoffit = new THREE.Mesh(roofSoffitGeo, roofSoffitMat);

  // Inner Oculus Steel Tension Ring & Outer Eaves Accent Trim
  const oculusWallGeo = buildOvalWallGeometry(roofInnerR, roofInnerY - 1.2, roofInnerY + 0.35, straightLen, midR, 240, 1, true);
  const oculusWall = new THREE.Mesh(oculusWallGeo, canopyMat);
  const eavesWallGeo = buildOvalWallGeometry(roofOuterR, roofOuterY - 1.3, roofOuterY + 0.25, straightLen, midR, 240, 1, false);
  const eavesWall = new THREE.Mesh(eavesWallGeo, canopyMat);
  const oculusGlowGeo = buildOvalWallGeometry(roofInnerR - 0.15, roofInnerY - 0.8, roofInnerY - 0.15, straightLen, midR, 240, 1, true);
  const oculusGlow = new THREE.Mesh(oculusGlowGeo, facadeAccentMat);
  stadiumGroup.add(roofTop, roofSoffit, oculusWall, eavesWall, oculusGlow);
  disposables.push(roofTopGeo, roofSoffitGeo, oculusWallGeo, eavesWallGeo, oculusGlowGeo);

  // 52 Radial Cantilever Truss Beams underneath the roof
  const trussLen = roofOuterR - roofInnerR - 2;
  const radialTrussGeo = new THREE.BoxGeometry(1.4, 1.5, trussLen);
  const radialTrussInst = new THREE.InstancedMesh(radialTrussGeo, darkTrussMat, ribCount);
  radialTrussInst.frustumCulled = false;
  const roofSlopeAngle = Math.atan2(roofInnerY - roofOuterY, roofOuterR - roofInnerR);
  for (let i = 0; i < ribCount; i++) {
    const s = i / ribCount;
    const pMid = evaluateStadiumOval(s, (roofInnerR + roofOuterR) / 2, straightLen, midR);
    const radialYaw = Math.atan2(-pMid.fz, pMid.fx);
    archDummy.position.set(pMid.x, (roofInnerY + roofOuterY) / 2 - 1.35, pMid.z);
    archDummy.rotation.set(roofSlopeAngle, radialYaw, 0);
    archDummy.scale.set(1, 1, 1);
    archDummy.updateMatrix();
    radialTrussInst.setMatrixAt(i, archDummy.matrix);
  }
  radialTrussInst.instanceMatrix.needsUpdate = true;
  stadiumGroup.add(radialTrussInst);
  disposables.push(radialTrussGeo);

  // 9) Twin Suspended Giant 4K LED Jumbotrons (North & South upper inner roof edges facing track & field)
  const jumboFrameGeo = new THREE.BoxGeometry(78, 28.5, 2.8);
  const jumboFrameMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.78,
    roughness: 0.25,
  });
  const jumboScreenGeo = new THREE.PlaneGeometry(74, 25.6);
  const jumboScreenMat = new THREE.MeshBasicMaterial({ map: jumboTex });
  const jumboStrutGeo = new THREE.CylinderGeometry(0.45, 0.45, 13.0, 8);
  disposables.push(jumboFrameGeo, jumboFrameMat, jumboScreenGeo, jumboScreenMat, jumboStrutGeo);

  for (const side of [1, -1] as const) {
    const jGroup = new THREE.Group();
    jGroup.position.set(0, 42.5, side * 174.5);
    // Tilt gently downward toward the running track for crisp readability from ground & broadcast cameras
    jGroup.rotation.x = side * 0.09;

    const jFrame = new THREE.Mesh(jumboFrameGeo, jumboFrameMat);
    const jScreen = new THREE.Mesh(jumboScreenGeo, jumboScreenMat);
    jScreen.position.set(0, 0, -side * 1.48);
    if (side === 1) jScreen.rotation.y = Math.PI;
    jGroup.add(jFrame, jScreen);

    const strutL = new THREE.Mesh(jumboStrutGeo, darkTrussMat);
    strutL.position.set(-25, 51.0, side * 174.5);
    const strutR = new THREE.Mesh(jumboStrutGeo, darkTrussMat);
    strutR.position.set(25, 51.0, side * 174.5);
    stadiumGroup.add(jGroup, strutL, strutR);
  }

  // 10) 36 Integrated Roof-Rim LED Floodlight Banks lining the inner roof canopy (no external corner towers)
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.25,
    roughness: 0.2,
    emissive: new THREE.Color(0xfef9c3),
    emissiveIntensity: venue === 'stadium_night' ? 2.1 : 0,
  });
  disposables.push(lampMat);

  // 36 Recessed LED light banks lining the inner roof oculus
  const oculusLampCount = 36;
  const oculusHousingGeo = new THREE.BoxGeometry(7.2, 1.5, 1.6);
  const oculusLampGeo = new THREE.BoxGeometry(6.4, 0.95, 0.4);
  const oculusHousingInst = new THREE.InstancedMesh(oculusHousingGeo, darkTrussMat, oculusLampCount);
  const oculusLampInst = new THREE.InstancedMesh(oculusLampGeo, lampMat, oculusLampCount);
  oculusHousingInst.frustumCulled = false;
  oculusLampInst.frustumCulled = false;

  for (let i = 0; i < oculusLampCount; i++) {
    const s = i / oculusLampCount;
    const p = evaluateStadiumOval(s, roofInnerR + 0.8, straightLen, midR);
    archDummy.position.set(p.x, roofInnerY - 1.55, p.z);
    archDummy.lookAt(0, 0, 0);
    archDummy.scale.set(1, 1, 1);
    archDummy.updateMatrix();
    oculusHousingInst.setMatrixAt(i, archDummy.matrix);

    const pFace = evaluateStadiumOval(s, roofInnerR - 0.15, straightLen, midR);
    archDummy.position.set(pFace.x, roofInnerY - 1.75, pFace.z);
    archDummy.lookAt(0, 0, 0);
    archDummy.updateMatrix();
    oculusLampInst.setMatrixAt(i, archDummy.matrix);
  }
  oculusHousingInst.instanceMatrix.needsUpdate = true;
  oculusLampInst.instanceMatrix.needsUpdate = true;
  stadiumGroup.add(oculusHousingInst, oculusLampInst);
  disposables.push(oculusHousingGeo, oculusLampGeo);

  // 11) Olympic Championship Torch Cauldron Monument (East curve upper crown)
  const cauldronPose = evaluateStadiumOval(0.25, vipR + 3.2, straightLen, midR);
  const cauldronPedGeo = new THREE.CylinderGeometry(2.6, 4.0, 15.0, 12);
  const cauldronBowlGeo = new THREE.CylinderGeometry(5.6, 2.2, 4.4, 16);
  const cauldronRimGeo = new THREE.TorusGeometry(5.6, 0.45, 8, 24);
  const flameOuterGeo = new THREE.ConeGeometry(3.4, 9.2, 10);
  const flameInnerGeo = new THREE.ConeGeometry(2.0, 6.2, 10);
  const flameOuterMat = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.9,
  });
  const flameInnerMat = new THREE.MeshBasicMaterial({
    color: 0xfef08a,
    transparent: true,
    opacity: 0.95,
  });

  const cauldronGrp = new THREE.Group();
  cauldronGrp.position.set(cauldronPose.x, 20.6, cauldronPose.z);
  const cPed = new THREE.Mesh(cauldronPedGeo, exoSteelMat);
  cPed.position.y = 7.5;
  const cBowl = new THREE.Mesh(cauldronBowlGeo, gantryGoldMat);
  cBowl.position.y = 16.5;
  const cRim = new THREE.Mesh(cauldronRimGeo, exoSteelMat);
  cRim.rotation.x = Math.PI / 2;
  cRim.position.y = 18.7;

  const flameGroup = new THREE.Group();
  flameGroup.position.y = 18.8;
  const flameOuter = new THREE.Mesh(flameOuterGeo, flameOuterMat);
  flameOuter.position.y = 4.2;
  const flameInner = new THREE.Mesh(flameInnerGeo, flameInnerMat);
  flameInner.position.y = 3.0;
  flameGroup.add(flameOuter, flameInner);

  cauldronGrp.add(cPed, cBowl, cRim, flameGroup);
  stadiumGroup.add(cauldronGrp);
  disposables.push(
    cauldronPedGeo,
    cauldronBowlGeo,
    cauldronRimGeo,
    flameOuterGeo,
    flameInnerGeo,
    flameOuterMat,
    flameInnerMat
  );

  // 12) 28 International Stadium Rim Flags crowning the roof eaves (InstancedMesh -> 2 draw calls)
  const roofFlagCount = 28;
  const rFlagPoleGeo = new THREE.CylinderGeometry(0.16, 0.2, 9.0, 6);
  const rFlagClothGeo = new THREE.BoxGeometry(0.14, 2.2, 3.6);
  rFlagClothGeo.translate(0, 0, 1.8);
  const flagColors = [0xff6b1a, 0xfacc15, 0x3b82f6, 0xef4444, 0x10b981, 0xffffff];
  const flagColorObjs = flagColors.map((c) => new THREE.Color(c));
  const instFlagMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const fPoleMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.55, roughness: 0.35 });
  disposables.push(rFlagPoleGeo, rFlagClothGeo, fPoleMat, instFlagMat);

  const roofPoleInst = new THREE.InstancedMesh(rFlagPoleGeo, fPoleMat, roofFlagCount);
  const roofClothInst = new THREE.InstancedMesh(rFlagClothGeo, instFlagMat, roofFlagCount);
  roofPoleInst.frustumCulled = false;
  roofClothInst.frustumCulled = false;
  for (let i = 0; i < roofFlagCount; i++) {
    const s = i / roofFlagCount;
    const fp = evaluateStadiumOval(s, roofOuterR - 1.5, straightLen, midR);
    archDummy.position.set(fp.x, roofOuterY + 4.5, fp.z);
    archDummy.rotation.set(0, fp.yaw, 0);
    archDummy.scale.set(1, 1, 1);
    archDummy.updateMatrix();
    roofPoleInst.setMatrixAt(i, archDummy.matrix);

    archDummy.position.set(fp.x, roofOuterY + 7.6, fp.z);
    archDummy.updateMatrix();
    roofClothInst.setMatrixAt(i, archDummy.matrix);
    roofClothInst.setColorAt(i, flagColorObjs[i % flagColorObjs.length]);
  }
  roofPoleInst.instanceMatrix.needsUpdate = true;
  roofClothInst.instanceMatrix.needsUpdate = true;
  if (roofClothInst.instanceColor) roofClothInst.instanceColor.needsUpdate = true;
  stadiumGroup.add(roofPoleInst, roofClothInst);

  // ==================== B. NIGHT SKY DOME ====================
  const moonGeo = new THREE.SphereGeometry(18, 16, 12);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xfef3c7,
    transparent: true,
    opacity: venue === 'stadium_night' ? 1 : 0,
  });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.set(-340, 260, -440);
  nightExtrasGroup.add(moon);
  disposables.push(moonGeo, moonMat);

  const starPos = new Float32Array(560 * 3);
  for (let i = 0; i < 560; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.42;
    const r = 680;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = 85 + r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 3.6,
    transparent: true,
    opacity: venue === 'stadium_night' ? 1 : 0,
    depthWrite: false,
  });
  nightExtrasGroup.add(new THREE.Points(starGeo, starMat));
  disposables.push(starGeo, starMat);

  // ==================== C. OPEN FIELD SETTING (Park Scoreboard, Fence, Trees, Hills) ====================
  const postGeo = new THREE.BoxGeometry(1.1, 14, 1.1);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
  const p1 = new THREE.Mesh(postGeo, postMat);
  p1.position.set(-18, 7, outerR + 18);
  const p2 = new THREE.Mesh(postGeo, postMat);
  p2.position.set(18, 7, outerR + 18);
  const boardFrameGeo = new THREE.BoxGeometry(40, 14.5, 1.6);
  const boardFrameMat = new THREE.MeshStandardMaterial({ color: 0x0f2957, roughness: 0.45 });
  const boardFrame = new THREE.Mesh(boardFrameGeo, boardFrameMat);
  boardFrame.position.set(0, 14.5, outerR + 18);
  const boardScreenGeo = new THREE.PlaneGeometry(37.5, 12.8);
  const boardScreenMat = new THREE.MeshBasicMaterial({ map: jumboTex });
  const boardScreen = new THREE.Mesh(boardScreenGeo, boardScreenMat);
  boardScreen.position.set(0, 14.5, outerR + 17.1);
  boardScreen.rotation.y = Math.PI;
  openFieldGroup.add(p1, p2, boardFrame, boardScreen);
  disposables.push(postGeo, postMat, boardFrameGeo, boardFrameMat, boardScreenGeo, boardScreenMat);

  const fencePostGeo = new THREE.BoxGeometry(0.42, 1.75, 0.42);
  const fenceRailGeo = new THREE.BoxGeometry(10.5, 0.22, 0.16);
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.55 });
  const flagPoleGeo = new THREE.CylinderGeometry(0.12, 0.15, 6.8, 6);
  const flagClothGeo = new THREE.BoxGeometry(2.2, 1.3, 0.1);
  disposables.push(fencePostGeo, fenceRailGeo, fenceMat, flagPoleGeo, flagClothGeo);

  // Instanced Open-Field Perimeter Fence & Flags (replaces 360+ separate meshes with 4 GPU draw calls)
  const fenceCount = 160;
  const fieldFlagCount = Math.ceil(fenceCount / 8);
  const fencePostInst = new THREE.InstancedMesh(fencePostGeo, fenceMat, fenceCount);
  const fenceRailInst = new THREE.InstancedMesh(fenceRailGeo, fenceMat, fenceCount);
  const fieldFlagPoleInst = new THREE.InstancedMesh(flagPoleGeo, fPoleMat, fieldFlagCount);
  const fieldFlagClothInst = new THREE.InstancedMesh(flagClothGeo, instFlagMat, fieldFlagCount);
  fencePostInst.frustumCulled = false;
  fenceRailInst.frustumCulled = false;
  fieldFlagPoleInst.frustumCulled = false;
  fieldFlagClothInst.frustumCulled = false;

  let fieldFlagIdx = 0;
  for (let i = 0; i < fenceCount; i++) {
    const s = i / fenceCount;
    const p = evaluateStadiumOval(s, outerR + 2.5, straightLen, midR);
    archDummy.position.set(p.x, 0.88, p.z);
    archDummy.rotation.set(0, p.yaw + Math.PI / 2, 0);
    archDummy.scale.set(1, 1, 1);
    archDummy.updateMatrix();
    fencePostInst.setMatrixAt(i, archDummy.matrix);

    archDummy.position.set(p.x, 1.38, p.z);
    archDummy.updateMatrix();
    fenceRailInst.setMatrixAt(i, archDummy.matrix);

    if (i % 8 === 0 && fieldFlagIdx < fieldFlagCount) {
      const fp = evaluateStadiumOval(s, outerR + 3.4, straightLen, midR);
      archDummy.position.set(fp.x, 3.4, fp.z);
      archDummy.rotation.set(0, fp.yaw, 0);
      archDummy.updateMatrix();
      fieldFlagPoleInst.setMatrixAt(fieldFlagIdx, archDummy.matrix);

      archDummy.position.set(fp.x, 6.0, fp.z);
      archDummy.updateMatrix();
      fieldFlagClothInst.setMatrixAt(fieldFlagIdx, archDummy.matrix);
      fieldFlagClothInst.setColorAt(fieldFlagIdx, flagColorObjs[fieldFlagIdx % flagColorObjs.length]);
      fieldFlagIdx++;
    }
  }
  fencePostInst.instanceMatrix.needsUpdate = true;
  fenceRailInst.instanceMatrix.needsUpdate = true;
  fieldFlagPoleInst.instanceMatrix.needsUpdate = true;
  fieldFlagClothInst.instanceMatrix.needsUpdate = true;
  if (fieldFlagClothInst.instanceColor) fieldFlagClothInst.instanceColor.needsUpdate = true;
  openFieldGroup.add(fencePostInst, fenceRailInst, fieldFlagPoleInst, fieldFlagClothInst);

  const trunkGeo = new THREE.BoxGeometry(1.4, 5.5, 1.4);
  const leafGeo = new THREE.BoxGeometry(5.2, 5.4, 5.2);
  const topLeafGeo = new THREE.BoxGeometry(3.4, 2.8, 3.4);
  const bushGeo = new THREE.BoxGeometry(3.8, 2.5, 3.8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
  const leafMatA = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.85 });
  const leafMatB = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.85 });
  disposables.push(trunkGeo, leafGeo, topLeafGeo, bushGeo, trunkMat, leafMatA, leafMatB);

  const treeRingCount = 96;
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeRingCount);
  const leafInst = new THREE.InstancedMesh(leafGeo, leafMatA, treeRingCount);
  const topLeafInst = new THREE.InstancedMesh(topLeafGeo, leafMatB, treeRingCount);
  const bushCount = Math.ceil(treeRingCount / 2);
  const bushInst = new THREE.InstancedMesh(bushGeo, leafMatA, bushCount);
  const treeDummy = new THREE.Object3D();
  const leafTintA = new THREE.Color(0x15803d);
  const leafTintB = new THREE.Color(0x22c55e);

  let bushIdx = 0;
  for (let i = 0; i < treeRingCount; i++) {
    const s = i / treeRingCount + (i % 3) * 0.003;
    const distR = outerR + 24 + (i % 5) * 24 + Math.random() * 10;
    const tp = evaluateStadiumOval(s, distR, straightLen, midR);
    const scale = 1.4 + (i % 4) * 0.4;
    const tint = i % 2 === 0 ? leafTintA : leafTintB;

    treeDummy.position.set(tp.x, 2.75 * scale, tp.z);
    treeDummy.rotation.set(0, 0, 0);
    treeDummy.scale.setScalar(scale);
    treeDummy.updateMatrix();
    trunkInst.setMatrixAt(i, treeDummy.matrix);

    treeDummy.position.set(tp.x, 6.8 * scale, tp.z);
    treeDummy.updateMatrix();
    leafInst.setMatrixAt(i, treeDummy.matrix);
    leafInst.setColorAt(i, tint);

    treeDummy.position.set(tp.x, 10.2 * scale, tp.z);
    treeDummy.updateMatrix();
    topLeafInst.setMatrixAt(i, treeDummy.matrix);
    topLeafInst.setColorAt(i, tint);

    if (i % 2 === 0 && bushIdx < bushCount) {
      const bp = evaluateStadiumOval(s + 0.005, outerR + 13 + (i % 3) * 6, straightLen, midR);
      treeDummy.position.set(bp.x, 1.25, bp.z);
      treeDummy.scale.setScalar(1);
      treeDummy.updateMatrix();
      bushInst.setMatrixAt(bushIdx, treeDummy.matrix);
      bushInst.setColorAt(bushIdx, i % 4 === 0 ? leafTintB : leafTintA);
      bushIdx++;
    }
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  leafInst.instanceMatrix.needsUpdate = true;
  topLeafInst.instanceMatrix.needsUpdate = true;
  bushInst.instanceMatrix.needsUpdate = true;
  if (leafInst.instanceColor) leafInst.instanceColor.needsUpdate = true;
  if (topLeafInst.instanceColor) topLeafInst.instanceColor.needsUpdate = true;
  if (bushInst.instanceColor) bushInst.instanceColor.needsUpdate = true;
  trunkInst.frustumCulled = false;
  leafInst.frustumCulled = false;
  topLeafInst.frustumCulled = false;
  bushInst.frustumCulled = false;
  openFieldGroup.add(trunkInst, leafInst, topLeafInst, bushInst);

  const hillGeo = new THREE.ConeGeometry(115, 76, 7);
  const hillMatA = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.95 });
  const hillMatB = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.95 });
  disposables.push(hillGeo, hillMatA, hillMatB);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r = 560 + (i % 3) * 85;
    const hill = new THREE.Mesh(hillGeo, i % 2 === 0 ? hillMatA : hillMatB);
    hill.position.set(Math.cos(a) * r * 1.25, 28, Math.sin(a) * r);
    hill.scale.set(1.4 + (i % 3) * 0.4, 0.8 + (i % 4) * 0.3, 1.3);
    openFieldGroup.add(hill);
  }

  // ==================== D. FLUFFY DAYTIME CLOUDS ====================
  const cloudGeo = new THREE.BoxGeometry(40, 11, 22);
  const cloudSubGeo = new THREE.BoxGeometry(24, 9, 18);
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: venue === 'stadium_night' ? 0 : 0.92,
    depthWrite: false,
  });
  disposables.push(cloudGeo, cloudSubGeo, cloudMat);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = 490 + (i % 3) * 105;
    const cx = Math.cos(a) * r;
    const cy = 140 + (i % 4) * 20;
    const cz = Math.sin(a) * r * 0.85;
    const c1 = new THREE.Mesh(cloudGeo, cloudMat);
    c1.position.set(cx, cy, cz);
    const c2 = new THREE.Mesh(cloudSubGeo, cloudMat);
    c2.position.set(cx + 15, cy + 5, cz + 2);
    dayCloudsGroup.add(c1, c2);
  }

  // ==================== COMPLETE HEAD-TO-TOE ANIMATED SPECTATORS ====================
  const specUniforms = {
    uTime: { value: 0 },
    uCheer: { value: 0 },
  };

  interface SpecPlacement {
    x: number;
    y: number;
    z: number;
    yaw: number;
    scale: number;
    phase: number;
    jerseyColor: THREE.Color;
    pantsColor: THREE.Color;
    skinColor: THREE.Color;
    hairColor: THREE.Color;
    shoeColor: THREE.Color;
  }

  const jerseyPalette = [
    new THREE.Color(0xef4444),
    new THREE.Color(0x3b82f6),
    new THREE.Color(0xfacc15),
    new THREE.Color(0xf97316),
    new THREE.Color(0x10b981),
    new THREE.Color(0xffffff),
    new THREE.Color(0x8b5cf6),
    new THREE.Color(0x06b6d4),
    new THREE.Color(0xec4899),
  ];
  const pantsPalette = [
    new THREE.Color(0x0f172a),
    new THREE.Color(0x1e293b),
    new THREE.Color(0x1e3a8a),
    new THREE.Color(0x334155),
  ];
  const skinPalette = [
    new THREE.Color(0xf6c8a5),
    new THREE.Color(0xe5b089),
    new THREE.Color(0xd2996c),
    new THREE.Color(0xfad4b8),
  ];
  const hairPalette = [
    new THREE.Color(0x111827),
    new THREE.Color(0x3b2314),
    new THREE.Color(0x78350f),
    new THREE.Color(0xd97706),
    new THREE.Color(0xef4444),
    new THREE.Color(0x2563eb),
  ];
  const shoePalette = [
    new THREE.Color(0xffffff),
    new THREE.Color(0x0f172a),
    new THREE.Color(0xef4444),
    new THREE.Color(0xfacc15),
  ];

  function computeSpectatorYaw(pose: TrackPose): number {
    const toCenterLen = Math.hypot(pose.x, pose.z) || 1;
    const cx = -pose.x / toCenterLen;
    const cz = -pose.z / toCenterLen;
    const inX = pose.fz * 0.72 + cx * 0.28;
    const inZ = -pose.fx * 0.72 + cz * 0.28;
    return Math.atan2(inX, inZ);
  }

  const stadiumPlacements: SpecPlacement[] = [];
  // Lower Bowl spectators (6 tiers — balanced lively crowd with high GPU frame rate)
  for (let t = 0; t < lowerTierCount; t++) {
    const r = lowerBaseR + t * lowerTierDepth + lowerTierDepth * 0.52;
    const stepY = lowerBaseY + (t + 1) * lowerTierStepH;
    const countOnTier = 62 + t * 4;
    for (let c = 0; c < countOnTier; c++) {
      const s = (c + (t % 2) * 0.5) / countOnTier;
      const pose = evaluateStadiumOval(s, r, straightLen, midR);
      const jitterR = (Math.random() - 0.5) * 0.8;
      stadiumPlacements.push({
        x: pose.x + -pose.fz * jitterR,
        y: stepY,
        z: pose.z + pose.fx * jitterR,
        yaw: computeSpectatorYaw(pose) + (Math.random() - 0.5) * 0.22,
        scale: 1.12 + Math.random() * 0.2,
        phase: s * 35 + t * 1.7 + Math.random() * 1.2,
        jerseyColor: jerseyPalette[(c + t * 3) % jerseyPalette.length],
        pantsColor: pantsPalette[(c + t) % pantsPalette.length],
        skinColor: skinPalette[(c * 7 + t) % skinPalette.length],
        hairColor: hairPalette[(c * 5 + t * 2) % hairPalette.length],
        shoeColor: shoePalette[(c + t * 2) % shoePalette.length],
      });
    }
  }

  // Upper Bowl spectators (7 tiers)
  for (let t = 0; t < upperTierCount; t++) {
    const r = upperBaseR + t * upperTierDepth + upperTierDepth * 0.52;
    const stepY = upperBaseY + (t + 1) * upperTierStepH;
    const countOnTier = 48 + t * 3;
    for (let c = 0; c < countOnTier; c++) {
      const s = (c + (t % 2) * 0.5) / countOnTier;
      const pose = evaluateStadiumOval(s, r, straightLen, midR);
      const jitterR = (Math.random() - 0.5) * 0.85;
      stadiumPlacements.push({
        x: pose.x + -pose.fz * jitterR,
        y: stepY,
        z: pose.z + pose.fx * jitterR,
        yaw: computeSpectatorYaw(pose) + (Math.random() - 0.5) * 0.22,
        scale: 1.15 + Math.random() * 0.22,
        phase: s * 35 + t * 2.1 + Math.random() * 1.4,
        jerseyColor: jerseyPalette[(c * 3 + t * 2) % jerseyPalette.length],
        pantsColor: pantsPalette[(c + t) % pantsPalette.length],
        skinColor: skinPalette[(c * 5 + t) % skinPalette.length],
        hairColor: hairPalette[(c * 7 + t) % hairPalette.length],
        shoeColor: shoePalette[(c + t) % shoePalette.length],
      });
    }
  }

  const fieldPlacements: SpecPlacement[] = [];
  for (let row = 0; row < 2; row++) {
    const r = outerR + 4.8 + row * 3.0;
    const count = 78 + row * 12;
    for (let c = 0; c < count; c++) {
      const s = (c + row * 0.5) / count;
      const pose = evaluateStadiumOval(s, r, straightLen, midR);
      fieldPlacements.push({
        x: pose.x,
        y: 0.03,
        z: pose.z,
        yaw: computeSpectatorYaw(pose) + (Math.random() - 0.5) * 0.28,
        scale: 1.05 + Math.random() * 0.2,
        phase: s * 35 + row * 1.7 + Math.random() * 1.2,
        jerseyColor: jerseyPalette[(c + row * 3) % jerseyPalette.length],
        pantsColor: pantsPalette[c % pantsPalette.length],
        skinColor: skinPalette[(c * 7 + row) % skinPalette.length],
        hairColor: hairPalette[(c * 5 + row * 2) % hairPalette.length],
        shoeColor: shoePalette[(c + row * 2) % shoePalette.length],
      });
    }
  }

  function createSpectatorFaceTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    // Pure white base so Three.js multiplies cleanly with each spectator's instanceColor skin tone
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 256, 128);

    // Soft rosy cheek tint near front face center (u = 0.5 -> x = 128)
    ctx.fillStyle = 'rgba(236, 110, 140, 0.28)';
    ctx.beginPath();
    ctx.arc(107, 72, 9, 0, Math.PI * 2);
    ctx.arc(149, 72, 9, 0, Math.PI * 2);
    ctx.fill();

    // Expressive dark oval eyes with tiny specular shine
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.ellipse(116, 61, 4.2, 5.4, 0, 0, Math.PI * 2);
    ctx.ellipse(140, 61, 4.2, 5.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(114.6, 59, 1.5, 0, Math.PI * 2);
    ctx.arc(138.6, 59, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Joyful cheering smile
    ctx.strokeStyle = '#451A03';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(128, 72, 8.5, 0.14 * Math.PI, 0.86 * Math.PI);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function createSpectatorTorsoGeo(): THREE.BufferGeometry {
    // Lightweight tapered humanoid torso (6-sided cylinder saves ~7x triangles per spectator)
    const geo = new THREE.CylinderGeometry(0.24, 0.17, 0.62, 6);
    geo.scale(1.16, 1.0, 0.72);
    return geo;
  }

  function makeSpectatorMaterial(
    partKind: 'feet' | 'body' | 'armL' | 'armR',
    _roughness = 0.72,
    _metalness = 0.04,
    map?: THREE.Texture
  ): THREE.MeshLambertMaterial {
    // MeshLambertMaterial avoids expensive GGX/IBL per-fragment math on ~980 distant crowd members
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      map,
    });
    mat.customProgramCacheKey = () => `spec-lambert-${partKind}-${map ? 'map' : 'nomap'}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = specUniforms.uTime;
      shader.uniforms.uCheer = specUniforms.uCheer;
      shader.vertexShader = `
        attribute float aSpecPhase;
        uniform float uTime;
        uniform float uCheer;
        ${shader.vertexShader}
      `.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        float amp = mix(0.08, 0.34, uCheer);
        float freq = mix(4.2, 9.2, uCheer);
        float hop = abs(sin(uTime * freq + aSpecPhase)) * amp;
        float sway = sin(uTime * freq * 0.5 + aSpecPhase) * mix(0.015, 0.055, uCheer);
        ${
          partKind === 'feet'
            ? 'transformed.y += hop * 0.32;'
            : partKind === 'body'
            ? 'transformed.y += hop; transformed.x += sway;'
            : partKind === 'armL'
            ? `
              float waveL = sin(uTime * freq * 1.3 + aSpecPhase) * mix(0.35, 0.85, uCheer);
              transformed.y += hop + abs(waveL) * 0.24;
              transformed.x += sway - waveL * 0.08;
              transformed.z += waveL * 0.16;
            `
            : `
              float waveR = cos(uTime * freq * 1.3 + aSpecPhase) * mix(0.35, 0.85, uCheer);
              transformed.y += hop + abs(waveR) * 0.24;
              transformed.x += sway + waveR * 0.08;
              transformed.z += waveR * 0.16;
            `
        }
        `
      );
    };
    return mat;
  }

  // Stylized low-poly instanced spectator geometries (>10x fewer GPU triangles across the stadium bowl)
  const shoeGeo = new THREE.BoxGeometry(0.14, 0.1, 0.22);
  const legGeo = new THREE.CylinderGeometry(0.086, 0.068, 0.56, 5, 1, true);
  const torsoGeo = createSpectatorTorsoGeo();
  const armGeo = new THREE.BoxGeometry(0.11, 0.42, 0.11);
  armGeo.translate(0, -0.22, 0);
  const headGeo = new THREE.SphereGeometry(0.195, 7, 5);
  headGeo.scale(0.95, 1.05, 0.94);
  // Align u = 0.5 directly onto +Z (front of face facing the track)
  headGeo.rotateY(-Math.PI / 2);
  const hairGeo = new THREE.SphereGeometry(0.208, 6, 4, 0, Math.PI * 2, 0, Math.PI * 0.56);
  hairGeo.scale(0.98, 1.02, 0.99);
  hairGeo.rotateX(-0.14);
  const cheerWandGeo = new THREE.BoxGeometry(0.06, 0.36, 0.06);
  cheerWandGeo.translate(0, -0.56, 0.04);

  const specFaceTex = createSpectatorFaceTexture();
  const shoeMat = makeSpectatorMaterial('feet', 0.42, 0.08);
  const legMat = makeSpectatorMaterial('feet', 0.78, 0.02);
  const torsoMat = makeSpectatorMaterial('body', 0.7, 0.04);
  const armLMat = makeSpectatorMaterial('armL', 0.68, 0.04);
  const armRMat = makeSpectatorMaterial('armR', 0.68, 0.04);
  const headMat = makeSpectatorMaterial('body', 0.56, 0.0, specFaceTex);
  const hairMat = makeSpectatorMaterial('body', 0.54, 0.06);
  const wandMat = makeSpectatorMaterial('armR', 0.35, 0.15);
  disposables.push(
    shoeGeo,
    legGeo,
    torsoGeo,
    armGeo,
    headGeo,
    hairGeo,
    cheerWandGeo,
    specFaceTex,
    shoeMat,
    legMat,
    torsoMat,
    armLMat,
    armRMat,
    headMat,
    hairMat,
    wandMat
  );

  const dummy = new THREE.Object3D();
  const localVec = new THREE.Vector3();

  function populateSpectatorsGroup(targetGroup: THREE.Group, placements: SpecPlacement[]) {
    const count = placements.length;
    const phaseArr = new Float32Array(count);
    const pairPhaseArr = new Float32Array(count * 2);
    const wandIndices: number[] = [];
    for (let i = 0; i < count; i++) {
      const ph = placements[i].phase;
      phaseArr[i] = ph;
      pairPhaseArr[i * 2] = ph;
      pairPhaseArr[i * 2 + 1] = ph;
      if (i % 3 === 0) wandIndices.push(i);
    }
    const wandPhaseArr = new Float32Array(wandIndices.length);
    for (let j = 0; j < wandIndices.length; j++) {
      wandPhaseArr[j] = placements[wandIndices[j]].phase;
    }

    const makeInst = (baseGeo: THREE.BufferGeometry, mat: THREE.Material, instCount: number, phases: Float32Array) => {
      const cloned = baseGeo.clone();
      cloned.setAttribute('aSpecPhase', new THREE.InstancedBufferAttribute(phases, 1));
      const mesh = new THREE.InstancedMesh(cloned, mat, instCount);
      mesh.frustumCulled = false;
      return mesh;
    };

    // Merge left+right shoes & left+right legs to cut draw calls cleanly
    const shoesMesh = makeInst(shoeGeo, shoeMat, count * 2, pairPhaseArr);
    const legsMesh = makeInst(legGeo, legMat, count * 2, pairPhaseArr);
    const torsoMesh = makeInst(torsoGeo, torsoMat, count, phaseArr);
    const armLMesh = makeInst(armGeo, armLMat, count, phaseArr);
    const armRMesh = makeInst(armGeo, armRMat, count, phaseArr);
    const headMesh = makeInst(headGeo, headMat, count, phaseArr);
    const hairMesh = makeInst(hairGeo, hairMat, count, phaseArr);
    const wandsMesh =
      wandIndices.length > 0 ? makeInst(cheerWandGeo, wandMat, wandIndices.length, wandPhaseArr) : null;

    let wandCursor = 0;
    for (let i = 0; i < count; i++) {
      const sp = placements[i];
      const cosY = Math.cos(sp.yaw);
      const sinY = Math.sin(sp.yaw);
      const s = sp.scale;

      const setPart = (
        inst: THREE.InstancedMesh,
        idx: number,
        lx: number,
        ly: number,
        lz: number,
        rx = 0,
        rz = 0,
        color?: THREE.Color
      ) => {
        localVec.set(lx * s, ly * s, lz * s);
        const wx = sp.x + localVec.x * cosY + localVec.z * sinY;
        const wz = sp.z - localVec.x * sinY + localVec.z * cosY;
        dummy.position.set(wx, sp.y + localVec.y, wz);
        dummy.rotation.set(rx, sp.yaw, rz);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        inst.setMatrixAt(idx, dummy.matrix);
        if (color) inst.setColorAt(idx, color);
      };

      setPart(shoesMesh, i * 2, -0.125, 0.06, 0.04, 0, 0, sp.shoeColor);
      setPart(shoesMesh, i * 2 + 1, 0.125, 0.06, 0.04, 0, 0, sp.shoeColor);
      setPart(legsMesh, i * 2, -0.125, 0.4, 0, 0, 0, sp.pantsColor);
      setPart(legsMesh, i * 2 + 1, 0.125, 0.4, 0, 0, 0, sp.pantsColor);
      setPart(torsoMesh, i, 0, 1.0, 0, 0, 0, sp.jerseyColor);
      setPart(armLMesh, i, -0.29, 1.24, 0.03, -2.35, 0.24, sp.jerseyColor);
      setPart(armRMesh, i, 0.29, 1.24, 0.03, -2.35, -0.24, sp.jerseyColor);
      setPart(headMesh, i, 0, 1.52, 0, 0, 0, sp.skinColor);
      setPart(hairMesh, i, 0, 1.54, -0.01, 0, 0, sp.hairColor);

      if (wandsMesh && i % 3 === 0) {
        const wandColor = jerseyPalette[(i + 2) % jerseyPalette.length];
        setPart(wandsMesh, wandCursor, 0.29, 1.24, 0.03, -2.35, -0.24, wandColor);
        wandCursor++;
      }
    }

    const meshes = [shoesMesh, legsMesh, torsoMesh, armLMesh, armRMesh, headMesh, hairMesh];
    if (wandsMesh) meshes.push(wandsMesh);
    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      targetGroup.add(m);
      spectatorMeshes.push(m);
      disposables.push(m.geometry);
    }
  }

  const spectatorMeshes: THREE.InstancedMesh[] = [];
  populateSpectatorsGroup(stadiumGroup, stadiumPlacements);
  populateSpectatorsGroup(openFieldGroup, fieldPlacements);

  const daySurfaceTint = new THREE.Color(0xffffff);
  const nightTrackTint = new THREE.Color(0xa69ca4);
  const nightInfieldTint = new THREE.Color(0xb2c2d0);
  const dayCurbTint = new THREE.Color(0xf8fafc);
  const nightCurbTint = new THREE.Color(0x94a3b8);

  function applyThemeWeights(w: ThemeWeights) {
    blendThemeColor(extMat.color, w, (p) => p.extGroundColor);
    blendThemeColor(apronMat.color, w, (p) => p.apronColor);
    blendThemeColor(tierMat.color, w, (p) => p.standTierColor);
    blendThemeColor(stepFrontMat.color, w, (p) => p.standStepColor);
    blendThemeColor(canopyMat.color, w, (p) => p.canopyColor);

    const stadiumPresence = THREE.MathUtils.clamp(w.day + w.night, 0, 1);
    const openPresence = THREE.MathUtils.clamp(w.open, 0, 1);

    stadiumGroup.visible = stadiumPresence > 0.01;
    stadiumGroup.position.y = -62 * Math.pow(1 - stadiumPresence, 2);

    openFieldGroup.visible = openPresence > 0.01;
    openFieldGroup.position.y = -36 * Math.pow(1 - openPresence, 2);

    const nightVis = THREE.MathUtils.clamp(w.night, 0, 1);
    trackMat.color.copy(daySurfaceTint).lerp(nightTrackTint, nightVis);
    infieldMat.color.copy(daySurfaceTint).lerp(nightInfieldTint, nightVis);
    curbMat.color.copy(dayCurbTint).lerp(nightCurbTint, nightVis);

    lampMat.emissiveIntensity = nightVis * 2.1;
    vipWallMat.emissiveIntensity = 0.2 + nightVis * 0.55;
    facadeAccentMat.emissiveIntensity = 0.28 + nightVis * 1.1;
    // Perimeter LED self-illuminated material remains vibrant day & night without emissive recalculation
    sfBannerMat.emissiveIntensity = 0.4 + nightVis * 0.42;
    moonMat.opacity = nightVis;
    starMat.opacity = nightVis;
    nightExtrasGroup.visible = nightVis > 0.01;

    const daySkyVis = THREE.MathUtils.clamp(1 - w.night, 0, 1);
    cloudMat.opacity = 0.92 * daySkyVis;
    dayCloudsGroup.visible = daySkyVis > 0.01;
  }

  applyThemeWeights(weightsForVenue(venue));

  // ==================== 3D CONFETTI PARTICLE SYSTEM ====================
  const confettiCount = 340;
  const confettiGeo = new THREE.PlaneGeometry(0.32, 0.18);
  const confettiMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const confettiMesh = new THREE.InstancedMesh(confettiGeo, confettiMat, confettiCount);
  confettiMesh.visible = false;
  confettiMesh.frustumCulled = false;

  const confettiVel: Array<{
    x: number;
    y: number;
    z: number;
    rx: number;
    ry: number;
    px: number;
    py: number;
    pz: number;
    ox: number;
    oz: number;
  }> = [];
  for (let i = 0; i < confettiCount; i++) {
    confettiMesh.setColorAt(i, jerseyPalette[i % jerseyPalette.length]);
    confettiVel.push({ x: 0, y: 0, z: 0, rx: 0, ry: 0, px: 0, py: -20, pz: 0, ox: 0, oz: 0 });
  }
  if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
  group.add(confettiMesh);
  disposables.push(confettiGeo, confettiMat);

  let confettiActive = false;

  function triggerConfetti(ox: number, oz: number) {
    confettiActive = true;
    confettiMesh.visible = true;
    for (let i = 0; i < confettiCount; i++) {
      const c = confettiVel[i];
      c.ox = ox;
      c.oz = oz;
      c.px = ox + (Math.random() - 0.5) * 30;
      c.py = 3 + Math.random() * 11;
      c.pz = oz + (Math.random() - 0.5) * 30;
      c.x = (Math.random() - 0.5) * 8;
      c.y = 4 + Math.random() * 9;
      c.z = (Math.random() - 0.5) * 8;
      c.rx = (Math.random() - 0.5) * 10;
      c.ry = (Math.random() - 0.5) * 10;
    }
  }

  function updateConfetti(dt: number) {
    if (!confettiActive) return;
    for (let i = 0; i < confettiCount; i++) {
      const c = confettiVel[i];
      c.y -= 9.2 * dt;
      c.px += c.x * dt;
      c.py += c.y * dt;
      c.pz += c.z * dt;
      if (c.py < 0.08) {
        c.py = 14 + Math.random() * 6;
        c.px = c.ox + (Math.random() - 0.5) * 26;
        c.pz = c.oz + (Math.random() - 0.5) * 26;
        c.y = -1;
      }
      dummy.position.set(c.px, c.py, c.pz);
      dummy.rotation.x += c.rx * dt;
      dummy.rotation.y += c.ry * dt;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      confettiMesh.setMatrixAt(i, dummy.matrix);
    }
    confettiMesh.instanceMatrix.needsUpdate = true;
  }

  // ==================== CENTER-FIELD CHAMPIONSHIP PODIUM (1, 2, 3, 4) ====================
  const podiumGroup = new THREE.Group();
  podiumGroup.visible = false;
  group.add(podiumGroup);

  const podiumTargets: PodiumTarget[] = [
    { rank: 2, x: -4.2, y: 1.06, z: 0.0, stepZ: 2.2, sideEntryX: -9.85, sideStairTopX: -5.5, sideDir: -1 },
    { rank: 1, x: -1.2, y: 1.38, z: 0.0, stepZ: 2.2, sideEntryX: -9.85, sideStairTopX: -5.5, sideDir: -1 },
    { rank: 3, x: 1.8, y: 0.82, z: 0.0, stepZ: 2.2, sideEntryX: 10.45, sideStairTopX: 6.1, sideDir: 1 },
    { rank: 4, x: 4.8, y: 0.62, z: 0.0, stepZ: 2.2, sideEntryX: 10.45, sideStairTopX: 6.1, sideDir: 1 },
  ];

  const carpetGeo = new THREE.BoxGeometry(11.6, 0.05, 13.6);
  const carpetMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.8 });
  const carpetMesh = new THREE.Mesh(carpetGeo, carpetMat);
  carpetMesh.position.set(0.3, 0.04, 10.0);
  carpetMesh.receiveShadow = true;
  podiumGroup.add(carpetMesh);

  const carpetTrimGeo = new THREE.BoxGeometry(0.28, 0.06, 13.6);
  const goldTrimMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    roughness: 0.28,
    metalness: 0.65,
    emissive: 0xca8a04,
    emissiveIntensity: 0.25,
  });
  const trimL = new THREE.Mesh(carpetTrimGeo, goldTrimMat);
  trimL.position.set(0.3 - 5.9, 0.045, 10.0);
  const trimR = new THREE.Mesh(carpetTrimGeo, goldTrimMat);
  trimR.position.set(0.3 + 5.9, 0.045, 10.0);
  podiumGroup.add(trimL, trimR);

  // Widened championship dais supporting both left and right side staircases cleanly
  const daisGeo = new THREE.BoxGeometry(18.6, 0.26, 7.6);
  const daisMat = new THREE.MeshStandardMaterial({ color: 0x0b1730, roughness: 0.5, metalness: 0.35 });
  const daisMesh = new THREE.Mesh(daisGeo, daisMat);
  daisMesh.position.set(0.3, 0.13, -0.4);
  daisMesh.receiveShadow = true;
  const daisEdgeGeo = new THREE.BoxGeometry(18.75, 0.1, 0.18);
  const daisEdge = new THREE.Mesh(daisEdgeGeo, goldTrimMat);
  daisEdge.position.set(0.3, 0.24, 3.35);
  podiumGroup.add(daisMesh, daisEdge);

  // Side access steps from ground (y=0) onto the dais (y=0.26) on BOTH left and right flanks
  const sideDaisStepGeo = new THREE.BoxGeometry(0.95, 0.14, 2.35);
  const sideDaisCarpetGeo = new THREE.BoxGeometry(0.96, 0.03, 2.15);
  const sideDaisNoseGeo = new THREE.BoxGeometry(0.08, 0.04, 2.38);

  for (const side of [-1, 1] as const) {
    const stepX = side === -1 ? -9.47 : 10.07;
    const outerEdgeX = side === -1 ? stepX - 0.45 : stepX + 0.45;
    const baseStep = new THREE.Mesh(sideDaisStepGeo, daisMat);
    baseStep.position.set(stepX, 0.07, 0.0);
    baseStep.receiveShadow = true;
    const tread = new THREE.Mesh(sideDaisCarpetGeo, carpetMat);
    tread.position.set(stepX, 0.15, 0.0);
    const nose = new THREE.Mesh(sideDaisNoseGeo, goldTrimMat);
    nose.position.set(outerEdgeX, 0.145, 0.0);
    podiumGroup.add(baseStep, tread, nose);
  }

  // Helper to build a grand royal side staircase climbing along +/-X with red carpet treads, gold nosing & handrails
  const buildSideStairFlight = (opts: {
    startX: number;
    endX: number;
    startY: number;
    endY: number;
    steps: number;
    depthZ: number;
    zCenter: number;
  }) => {
    const { startX, endX, startY, endY, steps, depthZ, zCenter } = opts;
    const totalRun = endX - startX;
    const stepRun = Math.abs(totalRun) / steps;
    const dir = Math.sign(totalRun) || 1;
    const totalRise = endY - startY;

    for (let s = 0; s < steps; s++) {
      const frac = (s + 1) / steps;
      const stepTopY = startY + totalRise * frac;
      const stepH = stepTopY - startY;
      const cx = startX + dir * (s + 0.5) * stepRun;
      const outerEdgeX = cx - dir * (stepRun / 2 - 0.03);

      const riserGeo = new THREE.BoxGeometry(stepRun + 0.02, stepH, depthZ);
      const riserMesh = new THREE.Mesh(riserGeo, daisMat);
      riserMesh.position.set(cx, startY + stepH / 2, zCenter);
      riserMesh.castShadow = true;
      riserMesh.receiveShadow = true;

      const treadGeo = new THREE.BoxGeometry(stepRun + 0.03, 0.035, depthZ - 0.14);
      const treadMesh = new THREE.Mesh(treadGeo, carpetMat);
      treadMesh.position.set(cx, stepTopY + 0.015, zCenter);

      const noseGeo = new THREE.BoxGeometry(0.065, 0.045, depthZ + 0.02);
      const noseMesh = new THREE.Mesh(noseGeo, goldTrimMat);
      noseMesh.position.set(outerEdgeX, stepTopY + 0.015, zCenter);

      podiumGroup.add(riserMesh, treadMesh, noseMesh);
      disposables.push(riserGeo, treadGeo, noseGeo);
    }

    // Brushed-gold ceremonial handrails flanking front & rear sides of the side staircase
    const railLen = Math.hypot(totalRun, totalRise) + 0.16;
    const railAngle = Math.atan2(totalRise, totalRun);
    const railBarGeo = new THREE.CylinderGeometry(0.042, 0.042, railLen, 8);
    const postGeo = new THREE.CylinderGeometry(0.038, 0.045, 0.85, 8);
    const midX = (startX + endX) / 2;
    const midY = (startY + endY) / 2 + 0.82;
    disposables.push(railBarGeo, postGeo);

    for (const zSide of [-1, 1] as const) {
      const railZ = zCenter + zSide * (depthZ / 2 - 0.04);
      const rail = new THREE.Mesh(railBarGeo, goldTrimMat);
      rail.position.set(midX, midY, railZ);
      rail.rotation.z = railAngle - Math.PI / 2;

      const startPost = new THREE.Mesh(postGeo, goldTrimMat);
      startPost.position.set(startX + dir * 0.12, startY + 0.42, railZ);

      const endPost = new THREE.Mesh(postGeo, goldTrimMat);
      endPost.position.set(endX - dir * 0.12, endY + 0.4, railZ);

      podiumGroup.add(rail, startPost, endPost);
    }
  };

  // Left side staircase climbing from dais (-8.75) up into Rank 2 (-5.50, y=1.06)
  buildSideStairFlight({
    startX: -8.75,
    endX: -5.5,
    startY: 0.26,
    endY: 1.06,
    steps: 4,
    depthZ: 2.05,
    zCenter: 0.0,
  });

  // Right side staircase climbing from dais (+9.35) up into Rank 4 (+6.10, y=0.62)
  buildSideStairFlight({
    startX: 9.35,
    endX: 6.1,
    startY: 0.26,
    endY: 0.62,
    steps: 3,
    depthZ: 2.05,
    zCenter: 0.0,
  });

  // Connecting side transition steps between adjacent podium blocks so winners step smoothly up from the sides
  const sideBridgeSpecs: Array<{ x: number; topY: number; widthX: number; depthZ: number; z: number }> = [
    { x: -2.7, topY: 1.22, widthX: 0.44, depthZ: 1.95, z: -0.1 }, // Rank 2 -> Rank 1
    { x: 3.3, topY: 0.72, widthX: 0.44, depthZ: 1.95, z: -0.1 }, // Rank 4 -> Rank 3
    { x: 0.3, topY: 1.1, widthX: 0.44, depthZ: 1.95, z: -0.1 }, // Rank 3 -> Rank 1
  ];
  for (const bridge of sideBridgeSpecs) {
    const h = bridge.topY - 0.26;
    const bGeo = new THREE.BoxGeometry(bridge.widthX, h, bridge.depthZ);
    const bMesh = new THREE.Mesh(bGeo, daisMat);
    bMesh.position.set(bridge.x, 0.26 + h / 2, bridge.z);
    const bTreadGeo = new THREE.BoxGeometry(bridge.widthX + 0.02, 0.035, bridge.depthZ - 0.08);
    const bTread = new THREE.Mesh(bTreadGeo, carpetMat);
    bTread.position.set(bridge.x, bridge.topY + 0.015, bridge.z);
    podiumGroup.add(bMesh, bTread);
    disposables.push(bGeo, bTreadGeo);
  }

  disposables.push(
    carpetGeo,
    carpetMat,
    carpetTrimGeo,
    goldTrimMat,
    daisGeo,
    daisMat,
    daisEdgeGeo,
    sideDaisStepGeo,
    sideDaisCarpetGeo,
    sideDaisNoseGeo
  );

  const rankColors: Record<1 | 2 | 3 | 4, { body: number; rim: number; hex: string; label: string }> = {
    1: { body: 0x1e3a8a, rim: 0xfacc15, hex: '#FACC15', label: 'JUARA 1' },
    2: { body: 0x1e293b, rim: 0xe2e8f0, hex: '#E2E8F0', label: 'JUARA 2' },
    3: { body: 0x431407, rim: 0xf97316, hex: '#FB923C', label: 'JUARA 3' },
    4: { body: 0x0c4a6e, rim: 0x38bdf8, hex: '#38BDF8', label: 'JUARA 4' },
  };

  function createRankPlaqueTexture(rank: 1 | 2 | 3 | 4): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const spec = rankColors[rank];

    ctx.fillStyle = '#081226';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = spec.hex;
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, 236, 236);

    ctx.fillStyle = spec.hex;
    ctx.font = 'bold 124px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(rank), 128, 114);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(spec.label, 128, 206);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  for (const pt of podiumTargets) {
    const spec = rankColors[pt.rank];
    const bodyHeight = pt.y - 0.26;
    const pedGeo = new THREE.BoxGeometry(2.6, bodyHeight, 2.7);
    const pedMat = new THREE.MeshStandardMaterial({
      color: spec.body,
      roughness: 0.38,
      metalness: 0.35,
    });
    const pedMesh = new THREE.Mesh(pedGeo, pedMat);
    pedMesh.position.set(pt.x, 0.26 + bodyHeight / 2, pt.z);
    pedMesh.castShadow = true;
    pedMesh.receiveShadow = true;

    const capGeo = new THREE.BoxGeometry(2.74, 0.12, 2.84);
    const capMat = new THREE.MeshStandardMaterial({
      color: spec.rim,
      roughness: 0.22,
      metalness: 0.72,
      emissive: spec.rim,
      emissiveIntensity: pt.rank === 1 ? 0.28 : 0.14,
    });
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.position.set(pt.x, pt.y - 0.06, pt.z);

    // Unobstructed front rank plaque (stairs are now exclusively on the left & right sides)
    const plaqueTex = createRankPlaqueTexture(pt.rank);
    const plaqueH = Math.min(0.95, Math.max(0.32, bodyHeight * 0.8));
    const plaqueW = Math.min(1.35, plaqueH * 1.15);
    const plaqueGeo = new THREE.PlaneGeometry(plaqueW, plaqueH);
    const plaqueMat = new THREE.MeshBasicMaterial({ map: plaqueTex });
    const plaque = new THREE.Mesh(plaqueGeo, plaqueMat);
    plaque.position.set(pt.x, 0.26 + bodyHeight * 0.48, pt.z + 1.37);

    podiumGroup.add(pedMesh, capMesh, plaque);
    disposables.push(pedGeo, pedMat, capGeo, capMat, plaqueTex, plaqueGeo, plaqueMat);
  }

  const backdropCanvas = document.createElement('canvas');
  backdropCanvas.width = 1280;
  backdropCanvas.height = 560;
  const backdropCtx = backdropCanvas.getContext('2d')!;
  const backdropTex = new THREE.CanvasTexture(backdropCanvas);
  backdropTex.colorSpace = THREE.SRGBColorSpace;
  backdropTex.anisotropy = maxAnisotropy;
  disposables.push(backdropTex);

  const backdropCenterX = 0.3;
  const backdropZ = -3.35;

  const trussColGeo = new THREE.BoxGeometry(0.65, 8.4, 0.65);
  const trussBeamGeo = new THREE.BoxGeometry(17.4, 0.7, 0.7);
  const trussMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.75, roughness: 0.24 });
  const pillarLeft = new THREE.Mesh(trussColGeo, trussMat);
  pillarLeft.position.set(backdropCenterX - 8.35, 4.46, backdropZ);
  const pillarRight = new THREE.Mesh(trussColGeo, trussMat);
  pillarRight.position.set(backdropCenterX + 8.35, 4.46, backdropZ);
  const topBeam = new THREE.Mesh(trussBeamGeo, trussMat);
  topBeam.position.set(backdropCenterX, 8.65, backdropZ);

  const backBoardGeo = new THREE.BoxGeometry(16.2, 7.6, 0.45);
  const backBoardMat = new THREE.MeshStandardMaterial({ color: 0x07132b, roughness: 0.45, metalness: 0.3 });
  const backBoard = new THREE.Mesh(backBoardGeo, backBoardMat);
  backBoard.position.set(backdropCenterX, 4.45, backdropZ);
  backBoard.castShadow = true;

  const backdropScreenGeo = new THREE.PlaneGeometry(15.6, 7.0);
  const backdropScreenMat = new THREE.MeshBasicMaterial({ map: backdropTex });
  const backdropScreen = new THREE.Mesh(backdropScreenGeo, backdropScreenMat);
  backdropScreen.position.set(backdropCenterX, 4.45, backdropZ + 0.24);

  const stageLampGeo = new THREE.BoxGeometry(0.75, 0.4, 0.55);
  const stageLampGlowMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  for (const pt of podiumTargets) {
    const housing = new THREE.Mesh(stageLampGeo, daisMat);
    housing.position.set(pt.x, 8.15, backdropZ + 0.45);
    housing.rotation.x = 0.42;
    const bulb = new THREE.Mesh(stageLampGeo, stageLampGlowMat);
    bulb.scale.set(0.78, 0.35, 0.2);
    bulb.position.set(pt.x, 8.05, backdropZ + 0.68);
    podiumGroup.add(housing, bulb);
  }

  podiumGroup.add(pillarLeft, pillarRight, topBeam, backBoard, backdropScreen);
  disposables.push(
    trussColGeo,
    trussBeamGeo,
    trussMat,
    backBoardGeo,
    backBoardMat,
    backdropScreenGeo,
    backdropScreenMat,
    stageLampGeo,
    stageLampGlowMat
  );

  // Clean podium backdrop displaying ONLY the official application logo image
  const APP_LOGO_SRC = '/assets/aistudio/file_0000000043908211ab498b6aee2c83f0_adb48a40.png';
  let podiumLogoImg: HTMLImageElement | null = null;
  let podiumBackdropDisposed = false;

  function renderLogoOnlyBackdrop() {
    if (podiumBackdropDisposed) return;
    const ctx = backdropCtx;
    const W = backdropCanvas.width;
    const H = backdropCanvas.height;

    // Clean championship navy backdrop with soft center spotlight glow
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#06132C');
    grad.addColorStop(0.5, '#0F2A5E');
    grad.addColorStop(1, '#06132C');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 440);
    glow.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
    glow.addColorStop(0.55, 'rgba(250, 204, 21, 0.10)');
    glow.addColorStop(1, 'rgba(6, 19, 44, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Subtle gold border frame matching the podium truss
    ctx.strokeStyle = '#FACC15';
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, W - 28, H - 28);

    // Draw ONLY the official app logo centered at native aspect ratio
    if (podiumLogoImg && podiumLogoImg.complete && podiumLogoImg.naturalWidth > 0) {
      const maxH = H - 64;
      const maxW = W - 160;
      const aspect = podiumLogoImg.naturalWidth / podiumLogoImg.naturalHeight;
      let drawH = maxH;
      let drawW = drawH * aspect;
      if (drawW > maxW) {
        drawW = maxW;
        drawH = drawW / aspect;
      }
      const dx = (W - drawW) / 2;
      const dy = (H - drawH) / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 8;
      ctx.drawImage(podiumLogoImg, dx, dy, drawW, drawH);
      ctx.restore();
    }

    backdropTex.needsUpdate = true;
  }

  renderLogoOnlyBackdrop();
  if (typeof Image !== 'undefined') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      podiumLogoImg = img;
      renderLogoOnlyBackdrop();
    };
    img.src = APP_LOGO_SRC;
  }

  function getPodiumTargets(): PodiumTarget[] {
    return podiumTargets;
  }

  function updatePodiumCeremony(active: boolean, riseT: number, _winners: PodiumWinnerSummary[] = []) {
    podiumGroup.visible = active;
    if (!active) return;
    const clampedT = THREE.MathUtils.clamp(riseT, 0, 1);
    podiumGroup.position.y = -6.5 * Math.pow(1 - clampedT, 3);
  }

  function getTrackPose(progress: number, lane: number, maxLanes = laneCount, out?: TrackPose): TrackPose {
    const clampedLane = Math.max(0, Math.min(laneCount - 1, lane));
    const usedSpan = Math.min(laneCount, Math.max(1, maxLanes));
    const offsetStart = Math.floor((laneCount - usedSpan) / 2);
    const effectiveLane = Math.min(laneCount - 1, offsetStart + clampedLane);
    const r = innerR + (effectiveLane + 0.5) * laneWidth;

    const lapFrac = (progress * totalLaps) % 1;
    return evaluateStadiumOval(lapFrac, r, straightLen, midR, out);
  }

  function getFinishPose(): TrackPose {
    return evaluateStadiumOval(0, midR, straightLen, midR);
  }

  function getEntrancePose(lane: number): StadiumEntrancePose {
    const slotOffset = ((lane % 5) - 2) * 0.72;
    return {
      startX: entranceCenterX + slotOffset,
      startZ: entranceBackZ - 0.65,
      exitZ: outerR + 0.45,
    };
  }

  // Freeze world matrices on static stadium architecture to eliminate redundant per-frame CPU traversal
  const dynamicNodes = new Set<THREE.Object3D>([
    group,
    stadiumGroup,
    openFieldGroup,
    dayCloudsGroup,
    nightExtrasGroup,
    podiumGroup,
    flameGroup,
    confettiMesh,
  ]);
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    if (!dynamicNodes.has(obj)) {
      obj.matrixAutoUpdate = false;
    }
  });

  return {
    group,
    trackWidth,
    laneWidth,
    totalLaps,
    updateSpectators: (elapsed, cheering) => {
      specUniforms.uTime.value = elapsed;
      specUniforms.uCheer.value = THREE.MathUtils.lerp(specUniforms.uCheer.value, cheering ? 1 : 0, 0.08);
      if (dayCloudsGroup.visible) {
        dayCloudsGroup.rotation.y = elapsed * 0.012;
      }
      // Gentle Olympic torch cauldron flame dance
      const flicker = 1 + Math.sin(elapsed * 9.5) * 0.08 + Math.cos(elapsed * 15.2) * 0.05;
      flameGroup.scale.set(1 + Math.sin(elapsed * 7.2) * 0.04, flicker, 1 + Math.cos(elapsed * 8.1) * 0.04);
      flameGroup.rotation.y = elapsed * 0.9;
    },
    updateJumbotron,
    applyThemeWeights,
    triggerConfetti,
    updateConfetti,
    getTrackPose,
    getFinishPose,
    getEntrancePose,
    getPodiumTargets,
    updatePodiumCeremony,
    updatePerimeterLed: (dt: number) => perimeterLed.update(dt),
    setPerimeterLedConfig: (cfg: StadiumLedConfig) => perimeterLed.setConfig(cfg),
    setSpectatorsVisible: (visible: boolean) => {
      for (let i = 0; i < spectatorMeshes.length; i++) {
        spectatorMeshes[i].visible = visible;
      }
    },
    dispose: () => {
      podiumBackdropDisposed = true;
      disposables.forEach((d) => d.dispose());
    },
  };
}
