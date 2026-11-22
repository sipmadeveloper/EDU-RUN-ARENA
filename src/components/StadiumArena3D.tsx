import { memo, useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { Camera, Crosshair, Grid2x2, Maximize2, X } from 'lucide-react';
import { AVATAR_COLORS, type PlayerState, type RaceVenueId, type RoomStatus } from '../types/game';
import {
  createStadium,
  type JumbotronRunnerEntry,
  type StadiumController,
  type TrackPose,
} from '../three/createStadium';
import {
  createBlockyRunner,
  animateBlockyRunner,
  type BlockyRunnerRig,
  type RunnerAnimMode,
} from '../three/createBlockyRunner';
import { getVictoryAnimModeForRank } from '../three/victoryAnimations';
import {
  attachWornMedalToRunner,
  createFormalPresenterRig,
  evaluateMedalCeremony,
  getMedalTierForRank,
  type CeremonyRecipientTarget,
  type MedalAttachmentHandle,
} from '../three/medalCeremony';
import { soundEngine } from '../audio/soundEngine';
import { applyStudioEnvironment, createConfiguredRenderer, afterDraw } from '../three/webglGuard';
import {
  createSceneLightingRig,
  dampThemeWeights,
  weightsForVenue,
} from '../three/environmentThemes';
import { calcTrackLength } from '../utils/matchScaling';
import { subscribeStadiumLedConfig } from '../services/stadiumLedStore';
import {
  evaluateParticipantPhysics,
  getSyncedNowMs,
  type LiveFirebaseParticipant,
  type LiveFirebaseRoom,
  type LivePhysicsOut,
} from '../services/firebaseRaceService';

export type CameraPresetId = 'broadcast' | 'chase' | 'side' | 'finish';
export type CameraViewMode = 'single' | 'pip' | 'quad';
export type CameraPipPlacement = 'bottom-row' | 'right-grid' | 'top-row';

export interface CameraPresetMeta {
  id: CameraPresetId;
  camCode: string;
  label: string;
  shortLabel: string;
}

export const CAMERA_PRESET_LIST: CameraPresetMeta[] = [
  { id: 'broadcast', camCode: 'CAM 1', label: 'Udara Stadion', shortLabel: 'Udara' },
  { id: 'chase', camCode: 'CAM 2', label: 'Ikuti Pembalap', shortLabel: 'Kejar' },
  { id: 'side', camCode: 'CAM 3', label: 'Sisi Lintasan', shortLabel: 'Sisi' },
  { id: 'finish', camCode: 'CAM 4', label: 'Garis Finish', shortLabel: 'Finish' },
];

export interface FollowablePlayerOption {
  id: string;
  name: string;
  className?: string;
}

interface StadiumArena3DProps {
  questionCount: number;
  maxPlayers: number;
  players: PlayerState[];
  livePlayersRef?: MutableRefObject<PlayerState[]>;
  liveRoomRef?: MutableRefObject<LiveFirebaseRoom | null>;
  rawParticipantsRef?: MutableRefObject<LiveFirebaseParticipant[]>;
  liveVersionRef?: MutableRefObject<number>;
  localPlayerId?: string;
  followedPlayerId?: string | null;
  followedPlayerName?: string | null;
  followablePlayers?: FollowablePlayerOption[];
  defaultFollowLabel?: string;
  onSelectFollowedPlayer?: (playerId: string | null) => void;
  roomStatus: RoomStatus;
  roomName?: string;
  cameraPreset?: CameraPresetId;
  cameraViewMode?: CameraViewMode;
  pipPlacement?: CameraPipPlacement;
  onSelectCameraPreset?: (preset: CameraPresetId) => void;
  onChangeCameraViewMode?: (mode: CameraViewMode) => void;
  venue?: RaceVenueId;
  showcaseMode?: boolean;
  onFinishConfetti?: () => void;
}

interface ViewportRect {
  left: number;
  bottom: number;
  width: number;
  height: number;
  visible: boolean;
}

const _camTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const _physOut: LivePhysicsOut = {
  distance: 0,
  progress: 0,
  speed: 0,
  effectState: 'normal',
  effectExpiresAt: 0,
};
const AVATAR_COLOR_HEX_MAP = new Map<string, string>(AVATAR_COLORS.map((c) => [c.id, c.hex]));

export const StadiumArena3D = memo(function StadiumArena3D({
  questionCount,
  maxPlayers,
  players,
  livePlayersRef,
  liveRoomRef,
  rawParticipantsRef,
  liveVersionRef,
  localPlayerId,
  followedPlayerId = null,
  followedPlayerName = null,
  followablePlayers,
  defaultFollowLabel = 'Otomatis (Terdepan)',
  onSelectFollowedPlayer,
  roomStatus,
  roomName = 'EDU RUN ARENA 3D',
  cameraPreset = 'chase',
  cameraViewMode = 'single',
  pipPlacement = 'bottom-row',
  onSelectCameraPreset,
  onChangeCameraViewMode,
  venue = 'stadium_day',
  showcaseMode = false,
}: StadiumArena3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const pipSlotRefs = useRef<Array<HTMLButtonElement | null>>([null, null, null, null]);
  const pipRectsRef = useRef<ViewportRect[]>(
    CAMERA_PRESET_LIST.map(() => ({ left: 0, bottom: 0, width: 0, height: 0, visible: false }))
  );

  const playersRef = useRef<PlayerState[]>(players);
  const externalLivePlayersRef = useRef<MutableRefObject<PlayerState[]> | undefined>(livePlayersRef);
  const externalLiveRoomRef = useRef<MutableRefObject<LiveFirebaseRoom | null> | undefined>(liveRoomRef);
  const externalRawPartsRef = useRef<MutableRefObject<LiveFirebaseParticipant[]> | undefined>(
    rawParticipantsRef
  );
  const externalLiveVersionRef = useRef<MutableRefObject<number> | undefined>(liveVersionRef);
  const localIdRef = useRef<string | undefined>(localPlayerId);
  const followedIdRef = useRef<string | null>(followedPlayerId);
  const statusRef = useRef<RoomStatus>(roomStatus);
  const presetRef = useRef<CameraPresetId>(cameraPreset);
  const viewModeRef = useRef<CameraViewMode>(cameraViewMode);
  const roomNameRef = useRef(roomName);
  const maxPlayersRef = useRef(maxPlayers);
  const venueRef = useRef<RaceVenueId>(venue);
  const dataVersionRef = useRef(0);

  const prevStaticSigRef = useRef('');
  playersRef.current = players;
  externalLivePlayersRef.current = livePlayersRef;
  externalLiveRoomRef.current = liveRoomRef;
  externalRawPartsRef.current = rawParticipantsRef;
  externalLiveVersionRef.current = liveVersionRef;
  localIdRef.current = localPlayerId;
  followedIdRef.current = followedPlayerId ?? null;
  statusRef.current = roomStatus;
  presetRef.current = cameraPreset;
  viewModeRef.current = cameraViewMode;
  roomNameRef.current = roomName;
  maxPlayersRef.current = maxPlayers;
  venueRef.current = venue;
  const staticSig = `${roomStatus}:${maxPlayers}:${localPlayerId || ''}:${roomName}:${livePlayersRef || rawParticipantsRef ? 'ext' : players.length}`;
  if ((!livePlayersRef && !rawParticipantsRef) || prevStaticSigRef.current !== staticSig) {
    prevStaticSigRef.current = staticSig;
    dataVersionRef.current += 1;
  }

  const measurePipSlots = useCallback(() => {
    const host = mountRef.current;
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    const out = pipRectsRef.current;
    for (let i = 0; i < CAMERA_PRESET_LIST.length; i++) {
      const el = pipSlotRefs.current[i];
      if (!el) {
        out[i].visible = false;
        continue;
      }
      const r = el.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      if (w < 12 || h < 12) {
        out[i].visible = false;
        continue;
      }
      const left = Math.max(0, Math.round(r.left - hostRect.left));
      const bottom = Math.max(0, Math.round(hostRect.bottom - r.bottom));
      out[i].left = left;
      out[i].bottom = bottom;
      out[i].width = Math.min(w, Math.max(0, Math.floor(hostRect.width - left)));
      out[i].height = Math.min(h, Math.max(0, Math.floor(hostRect.height - bottom)));
      out[i].visible = out[i].width >= 12 && out[i].height >= 12;
    }
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(measurePipSlots);
    const settleId = window.setTimeout(measurePipSlots, 140);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(settleId);
    };
  }, [cameraViewMode, pipPlacement, measurePipSlots]);

  useEffect(() => {
    const container = canvasHostRef.current;
    const rootEl = mountRef.current;
    if (!container || !rootEl) return;

    const initialVenue = venueRef.current;
    const trackLength = calcTrackLength(questionCount);
    const scene = new THREE.Scene();

    const initW = container.clientWidth || window.innerWidth;
    const initH = container.clientHeight || window.innerHeight;

    const camera = new THREE.PerspectiveCamera(56, initW / initH, 0.2, 2400);
    const camLookCurrent = new THREE.Vector3(-2, 3.0, 147);
    camera.position.set(-34, 14.5, 118);
    camera.lookAt(camLookCurrent);

    // 4 persistent sub-cameras + lightweight offscreen render targets for smooth 4-angle live preview
    const previewCameras = CAMERA_PRESET_LIST.map(() => {
      const subCam = new THREE.PerspectiveCamera(54, 16 / 10, 0.2, 2400);
      subCam.position.set(-34, 14.5, 118);
      return subCam;
    });
    const previewLookCurrents = CAMERA_PRESET_LIST.map(() => new THREE.Vector3(-2, 3.0, 147));
    const previewInitialized = CAMERA_PRESET_LIST.map(() => false);

    const PIP_RT_W = 192;
    const PIP_RT_H = 120;
    const previewRenderTargets = CAMERA_PRESET_LIST.map(
      () =>
        new THREE.WebGLRenderTarget(PIP_RT_W, PIP_RT_H, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: true,
          stencilBuffer: false,
        })
    );
    const previewDirty = CAMERA_PRESET_LIST.map(() => true);
    let pipRoundRobinIdx = 0;
    let quadRoundRobinIdx = 0;
    let lastViewMode: CameraViewMode = viewModeRef.current;
    let lastFollowedId: string | null = followedIdRef.current;

    const blitScene = new THREE.Scene();
    const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const blitGeo = new THREE.PlaneGeometry(2, 2);
    const blitMat = new THREE.MeshBasicMaterial({
      map: previewRenderTargets[0].texture,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    const blitQuad = new THREE.Mesh(blitGeo, blitMat);
    blitQuad.frustumCulled = false;
    blitScene.add(blitQuad);

    const ensureRenderTargetSize = (rt: THREE.WebGLRenderTarget, targetW: number, targetH: number) => {
      const wClamped = Math.max(64, Math.round(targetW));
      const hClamped = Math.max(40, Math.round(targetH));
      if (Math.abs(rt.width - wClamped) > 16 || Math.abs(rt.height - hClamped) > 16) {
        rt.setSize(wClamped, hClamped);
      }
    };

    const { renderer, isSoftwareGl } = createConfiguredRenderer(container);
    if (!isSoftwareGl && renderer.getPixelRatio() > 1.25) {
      renderer.setPixelRatio(1.25);
    }
    // Keep shadowMap.enabled constant (never toggle mid-frame -> avoids GPU shader pipeline thrashing)
    // Bake static stadium shadows once and refresh only on theme/ceremony change
    if (renderer.shadowMap.enabled) {
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
    }
    const disposeEnv = applyStudioEnvironment(scene, renderer);

    const lightingRig = createSceneLightingRig(scene, isSoftwareGl, initialVenue);
    const themeWeights = weightsForVenue(initialVenue);
    lightingRig.applyWeights(scene, renderer, themeWeights);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const stadium: StadiumController = createStadium(questionCount, maxAniso, 30, initialVenue);
    scene.add(stadium.group);

    // Live subscription to Admin-managed 360° Perimeter LED Running Text & Sponsor Playlist
    const unsubscribeLed = subscribeStadiumLedConfig((ledCfg) => {
      stadium.setPerimeterLedConfig(ledCfg);
    });

    // Runner instances map keyed by participant ID with continuous smooth dead-reckoning & entrance walk-in state
    const runnerMap = new Map<
      string,
      {
        rig: BlockyRunnerRig;
        authProgress: number;
        lastAuthTime: number;
        renderProgress: number;
        velocityPerSec: number;
        pose: TrackPose;
        celebrated: boolean;
        signature: string;
        wornMedal: MedalAttachmentHandle | null;
        wornMedalRank: number | null;
        celebrateStartAt: number | null;
        walkInActive: boolean;
        walkInElapsed: number;
        walkInDuration: number;
        walkInTurnDur: number;
        walkInStartX: number;
        walkInStartZ: number;
        walkInExitZ: number;
        walkInCurrentX: number;
        walkInCurrentZ: number;
        walkInCurrentYaw: number;
      }
    >();
    let hasCompletedInitialSync = false;

    // Formal VIP Medal Presenter for the center-field stadium championship podium ceremony
    const presenterRig = createFormalPresenterRig(!showcaseMode && !isSoftwareGl);
    presenterRig.root.visible = false;
    scene.add(presenterRig.root);

    // Speed-boost aerodynamic energy particle trail pool
    const trailCount = 90;
    const trailGeo = new THREE.CapsuleGeometry(0.085, 0.26, 4, 8);
    trailGeo.rotateX(Math.PI / 2);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.82,
    });
    const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, trailCount);
    trailMesh.frustumCulled = false;
    const trailDummy = new THREE.Object3D();
    const trailData: Array<{ x: number; y: number; z: number; vx: number; vz: number; life: number }> = Array.from(
      { length: trailCount },
      () => ({ x: 0, y: -50, z: 0, vx: 0, vz: 0, life: 0 })
    );
    let trailCursor = 0;
    let hasActiveTrails = false;
    trailDummy.position.set(0, -50, 0);
    trailDummy.scale.set(0.01, 0.01, 0.01);
    trailDummy.updateMatrix();
    for (let i = 0; i < trailCount; i++) {
      trailMesh.setMatrixAt(i, trailDummy.matrix);
    }
    trailMesh.instanceMatrix.needsUpdate = true;
    scene.add(trailMesh);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let confettiFiredForFinish = false;
    let ceremonyElapsed = 0;
    let lastJumbotronKey = '';
    let lastJumbotronUpdateAt = -1;
    let lastSyncedVersion = -1;
    let lastSyncedExternalVersion = -1;
    let lastCeremonyRankVersion = -1;
    let cachedRankById = new Map<string, number>();
    let cachedWinnerSummaries: Array<{ rank: number; name: string; score: number }> = [];
    let cachedCeremonyTargets: CeremonyRecipientTarget[] = [];
    const stadiumAwardedRanks = new Set<number>();
    const finishPose = stadium.getFinishPose();
    const podiumTargetByRank = new Map(stadium.getPodiumTargets().map((t) => [t.rank, t]));
    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    // Adaptive DPR anti-lag governor for hardware WebGL on older laptops/tablets
    let slowFrameAccum = 0;
    let slowFrameSamples = 0;
    let currentDpr = renderer.getPixelRatio();
    let smoothNowMs = getSyncedNowMs();
    let lastCeremonyActive = false;

    let viewportW = initW;
    let viewportH = initH;
    let frameCounter = 0;

    const handleResize = () => {
      if (!container) return;
      viewportW = container.clientWidth || window.innerWidth;
      viewportH = container.clientHeight || window.innerHeight;
      camera.aspect = viewportW / Math.max(1, viewportH);
      camera.updateProjectionMatrix();
      renderer.setSize(viewportW, viewportH);
      measurePipSlots();
    };
    const resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(rootEl);

    const getActivePlayers = (): PlayerState[] => {
      if (externalRawPartsRef.current) return externalRawPartsRef.current.current;
      if (externalLivePlayersRef.current) return externalLivePlayersRef.current.current;
      return playersRef.current;
    };

    const syncRunnersAndTelemetry = () => {
      const list = getActivePlayers();
      const status = statusRef.current;
      const laneCap = Math.min(30, Math.max(1, maxPlayersRef.current || 30));
      const nowMs = getSyncedNowMs();

      if (runnerMap.size > list.length) {
        const activeIds = new Set(list.map((p) => p.id));
        for (const [id, entry] of runnerMap.entries()) {
          if (!activeIds.has(id)) {
            entry.wornMedal?.dispose();
            scene.remove(entry.rig.root);
            entry.rig.dispose();
            runnerMap.delete(id);
          }
        }
      }

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const sig = `${p.avatar.presetId || 'custom'}-${p.avatar.color}-${p.avatar.gender}-${p.avatar.outfit}-${p.name}-${p.id === localIdRef.current}`;
        const existing = runnerMap.get(p.id);
        const speedPerSec = status === 'playing' && p.finishedAt == null && p.speed > 0 ? p.speed / trackLength : 0;

        if (!existing || existing.signature !== sig) {
          const prevWalkState = existing
            ? {
                walkInActive: existing.walkInActive,
                walkInElapsed: existing.walkInElapsed,
                walkInDuration: existing.walkInDuration,
                walkInTurnDur: existing.walkInTurnDur,
                walkInStartX: existing.walkInStartX,
                walkInStartZ: existing.walkInStartZ,
                walkInExitZ: existing.walkInExitZ,
                walkInCurrentX: existing.walkInCurrentX,
                walkInCurrentZ: existing.walkInCurrentZ,
                walkInCurrentYaw: existing.walkInCurrentYaw,
              }
            : null;
          if (existing) {
            existing.wornMedal?.dispose();
            scene.remove(existing.rig.root);
            existing.rig.dispose();
          }
          const isLocal = p.id === localIdRef.current;
          // Contact shadow discs ground all 30 runners cleanly at 60 FPS with zero dynamic shadow-pass cost
          const rig = createBlockyRunner(p.avatar, p.name, p.lane + 1, isLocal, !showcaseMode, false);
          const pose = stadium.getTrackPose(p.progress, p.lane, laneCap);
          const entrance = stadium.getEntrancePose(p.lane, laneCap);
          const walkDist =
            Math.abs(entrance.startZ - entrance.exitZ) +
            Math.hypot(pose.x - entrance.startX, pose.z - entrance.exitZ);
          const walkDuration = THREE.MathUtils.clamp(walkDist / 7.5, 3.2, 6.8);
          const walkTurnDur = 0.45;

          let walkInActive = false;
          let walkInElapsed = 0;

          if (prevWalkState) {
            walkInActive = prevWalkState.walkInActive;
            walkInElapsed = prevWalkState.walkInElapsed;
          } else if (!showcaseMode && status === 'waiting' && p.progress <= 0.001) {
            const joinedAgeSec =
              p.joinedAtMs && p.joinedAtMs > 0 ? (nowMs - p.joinedAtMs) / 1000 : null;
            if (hasCompletedInitialSync) {
              // Brand-new participant joined live while teacher or peers are watching
              walkInActive = true;
              walkInElapsed = 0;
            } else if (isLocal) {
              // Local student just entered the lobby -> always experience walking out from stadium entrance
              if (joinedAgeSec === null || joinedAgeSec < 22) {
                walkInActive = true;
                walkInElapsed = 0;
              }
            } else if (joinedAgeSec !== null && joinedAgeSec >= -3 && joinedAgeSec < walkDuration + walkTurnDur) {
              // Peer joined just seconds ago before this viewer mounted -> resume mid-walk smoothly
              walkInActive = true;
              walkInElapsed = Math.max(0, joinedAgeSec);
            }
          }

          const initX = walkInActive ? entrance.startX : pose.x;
          const initZ = walkInActive ? entrance.startZ : pose.z;
          const initYaw = walkInActive ? Math.PI : pose.yaw;
          rig.root.position.set(initX, 0, initZ);
          rig.root.rotation.y = initYaw;
          scene.add(rig.root);
          runnerMap.set(p.id, {
            rig,
            authProgress: p.progress,
            lastAuthTime: clock.elapsedTime,
            renderProgress: p.progress,
            velocityPerSec: speedPerSec,
            pose,
            celebrated: Boolean(p.finishedAt),
            signature: sig,
            wornMedal: null,
            wornMedalRank: null,
            celebrateStartAt: null,
            walkInActive,
            walkInElapsed,
            walkInDuration: walkDuration,
            walkInTurnDur: walkTurnDur,
            walkInStartX: entrance.startX,
            walkInStartZ: entrance.startZ,
            walkInExitZ: entrance.exitZ,
            walkInCurrentX: prevWalkState ? prevWalkState.walkInCurrentX : initX,
            walkInCurrentZ: prevWalkState ? prevWalkState.walkInCurrentZ : initZ,
            walkInCurrentYaw: prevWalkState ? prevWalkState.walkInCurrentYaw : initYaw,
          });
        } else {
          existing.authProgress = p.progress;
          existing.lastAuthTime = clock.elapsedTime;
          existing.velocityPerSec = speedPerSec;
        }
      }

      if (list.length > 0 || clock.elapsedTime >= 1.2) {
        hasCompletedInitialSync = true;
      }
    };

    const tick = () => {
      if (disposed) return;

      // Pause GPU rendering completely while browser tab is hidden
      if (typeof document !== 'undefined' && document.hidden) {
        clock.getDelta();
        frameId = window.setTimeout(tick, 250);
        return;
      }

      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.04);
      const elapsed = clock.elapsedTime;

      // Smooth monotonic server-synced race clock (prevents OS timer jitter or sudden jumps)
      const targetNowMs = getSyncedNowMs();
      const clockDeltaMs = targetNowMs - smoothNowMs;
      if (Math.abs(clockDeltaMs) > 450) {
        smoothNowMs = targetNowMs;
      } else {
        smoothNowMs += rawDt * 1000 + clockDeltaMs * Math.min(1, dt * 4);
      }

      // Adaptive performance guard: if sustained frame time > 22ms on hardware WebGL, reduce resolution smoothly
      if (!isSoftwareGl && rawDt > 0 && rawDt < 0.25) {
        slowFrameAccum += rawDt;
        slowFrameSamples += 1;
        if (slowFrameSamples >= 18) {
          const avgDt = slowFrameAccum / slowFrameSamples;
          if (avgDt > 0.022 && currentDpr > 0.85) {
            currentDpr = Math.max(0.85, Number((currentDpr - 0.15).toFixed(2)));
            renderer.setPixelRatio(currentDpr);
          }
          slowFrameAccum = 0;
          slowFrameSamples = 0;
        }
      }

      // Only blend theme lights & venue architecture while actively transitioning between presets
      const targetVenue = venueRef.current;
      const targetW = weightsForVenue(targetVenue);
      const themeSettled =
        Math.abs(themeWeights.day - targetW.day) < 0.0005 &&
        Math.abs(themeWeights.night - targetW.night) < 0.0005 &&
        Math.abs(themeWeights.open - targetW.open) < 0.0005;
      if (!themeSettled) {
        dampThemeWeights(themeWeights, targetVenue, dt, 4.2);
        lightingRig.applyWeights(scene, renderer, themeWeights);
        stadium.applyThemeWeights(themeWeights);
        if (renderer.shadowMap.enabled && frameCounter % 6 === 0) {
          renderer.shadowMap.needsUpdate = true;
        }
      }

      const extVer = externalLiveVersionRef.current ? externalLiveVersionRef.current.current : 0;
      if (lastSyncedVersion !== dataVersionRef.current || lastSyncedExternalVersion !== extVer) {
        lastSyncedVersion = dataVersionRef.current;
        lastSyncedExternalVersion = extVer;
        syncRunnersAndTelemetry();
      }

      const laneCap = Math.min(30, Math.max(1, maxPlayersRef.current || 30));
      const list = getActivePlayers();
      const status = statusRef.current;
      const inCeremony = status === 'finished' && !showcaseMode;

      const MEDAL_CEREMONY_START_SEC = 4.25;
      const STADIUM_CARPET_Y = 0.26;
      const STADIUM_WALK_Z = 3.35;
      let medalStage: ReturnType<typeof evaluateMedalCeremony> | null = null;

      if (inCeremony) {
        ceremonyElapsed += dt;
        if (lastCeremonyRankVersion !== dataVersionRef.current) {
          lastCeremonyRankVersion = dataVersionRef.current;
          const rankedPlayers = [...list].sort((a, b) => {
            const ra = a.scoreRank ?? Number.MAX_SAFE_INTEGER;
            const rb = b.scoreRank ?? Number.MAX_SAFE_INTEGER;
            if (ra !== rb) return ra - rb;
            if (b.score !== a.score) return b.score - a.score;
            if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
            const durA = a.durationMs ?? Number.MAX_SAFE_INTEGER;
            const durB = b.durationMs ?? Number.MAX_SAFE_INTEGER;
            if (durA !== durB) return durA - durB;
            return b.progress - a.progress;
          });
          cachedRankById = new Map<string, number>();
          rankedPlayers.forEach((rp, idx) => cachedRankById.set(rp.id, idx + 1));
          cachedWinnerSummaries = rankedPlayers.slice(0, 4).map((rp, idx) => ({
            rank: idx + 1,
            name: rp.name,
            score: rp.score,
          }));
          cachedCeremonyTargets = [];
          for (let r = 1; r <= 3; r++) {
            const rp = rankedPlayers[r - 1];
            const pt = podiumTargetByRank.get(r as 1 | 2 | 3);
            if (!rp || !pt) continue;
            cachedCeremonyTargets.push({
              rank: r as 1 | 2 | 3,
              name: rp.name,
              runnerX: pt.x,
              runnerY: pt.y,
              runnerZ: pt.z,
              standX: pt.x,
              standY: STADIUM_CARPET_Y,
              standZ: 1.92,
            });
          }
        }
        stadium.updatePodiumCeremony(true, ceremonyElapsed / 0.85, cachedWinnerSummaries);

        // Show & choreograph the formal suited VIP presenter awarding Bronze -> Silver -> Gold sequentially
        if (cachedCeremonyTargets.length > 0 && ceremonyElapsed >= 2.2) {
          presenterRig.root.visible = true;
          medalStage = evaluateMedalCeremony({
            presenter: presenterRig,
            ceremonyTime: Math.max(0, ceremonyElapsed - MEDAL_CEREMONY_START_SEC),
            targets: cachedCeremonyTargets,
            floorY: STADIUM_CARPET_Y,
            walkZ: STADIUM_WALK_Z,
            startPos: { x: 5.8, z: STADIUM_WALK_Z },
            exitPos: { x: -6.2, z: 4.15, yaw: 0.45 },
            awardedRanks: stadiumAwardedRanks,
          });
          if (medalStage.newlyAwardedRank !== null) {
            const pt = podiumTargetByRank.get(medalStage.newlyAwardedRank);
            if (pt) {
              stadium.triggerConfetti(pt.x, pt.z);
            }
            soundEngine.playMedalAwarded(medalStage.newlyAwardedRank);
          }
        } else {
          presenterRig.root.visible = false;
        }
      } else {
        if (ceremonyElapsed !== 0 || presenterRig.root.visible) {
          ceremonyElapsed = 0;
          stadiumAwardedRanks.clear();
          presenterRig.root.visible = false;
          stadium.updatePodiumCeremony(false, 0);
          for (const entry of runnerMap.values()) {
            if (entry.wornMedal) {
              entry.wornMedal.setVisible(false, false);
            }
            entry.celebrateStartAt = null;
          }
        }
      }

      const liveRoom = externalLiveRoomRef.current ? externalLiveRoomRef.current.current : null;
      const rawParts = externalRawPartsRef.current ? externalRawPartsRef.current.current : null;
      const useDirectPhysics = Boolean(!showcaseMode && liveRoom && rawParts);

      if (inCeremony !== lastCeremonyActive) {
        lastCeremonyActive = inCeremony;
        if (renderer.shadowMap.enabled) {
          renderer.shadowMap.needsUpdate = true;
        }
      }

      let anyBoostOrFinish = false;
      let localTarget: { pose: TrackPose; effect: string; finished: boolean; walkingIn: boolean } | null = null;
      let followedTarget: { pose: TrackPose; effect: string; finished: boolean; walkingIn: boolean } | null = null;
      let leaderPlayer: PlayerState | null = null;
      let leaderPose: TrackPose | null = null;
      const activeFollowedId = followedIdRef.current;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const entry = runnerMap.get(p.id);
        if (!entry) continue;

        let liveEffect = p.effectState;

        if (showcaseMode) {
          const speedRate =
            p.effectState === 'boost'
              ? 0.0068
              : p.effectState === 'penalty'
              ? 0.001
              : 0.0032 + (p.lane % 4) * 0.0003;
          entry.renderProgress = (elapsed * speedRate + p.lane * 0.014) % 1;
        } else if (useDirectPhysics && liveRoom && rawParts && rawParts[i]) {
          // True 60 FPS zero-allocation physics directly from Firestore authoritative anchors (zero 10Hz timer judder!)
          const phys = evaluateParticipantPhysics(rawParts[i], liveRoom, smoothNowMs, _physOut);
          liveEffect = phys.effectState;
          const targetProg = phys.progress;
          const diff = targetProg - entry.renderProgress;
          if (status === 'waiting' || status === 'countdown' || Math.abs(diff) > 0.08) {
            entry.renderProgress = targetProg;
          } else if (Math.abs(diff) > 0.000001) {
            // Smoothly absorb discrete +5m boost jumps while tracking continuous velocity with zero lag
            entry.renderProgress = THREE.MathUtils.damp(entry.renderProgress, targetProg, 16, dt);
          }
        } else {
          const sinceAuth = Math.max(0, Math.min(0.3, elapsed - entry.lastAuthTime));
          const extrapolated = Math.min(1, entry.authProgress + entry.velocityPerSec * sinceAuth);
          const diff = extrapolated - entry.renderProgress;
          if (Math.abs(diff) > 0.06 || status === 'waiting' || status === 'countdown') {
            entry.renderProgress = extrapolated;
          } else if (entry.velocityPerSec > 0) {
            entry.renderProgress = Math.min(
              1,
              Math.max(0, entry.renderProgress + entry.velocityPerSec * dt + diff * Math.min(1, dt * 8))
            );
          } else {
            entry.renderProgress = THREE.MathUtils.damp(entry.renderProgress, extrapolated, 10, dt);
          }
        }

        const pose = stadium.getTrackPose(entry.renderProgress, p.lane, laneCap, entry.pose);

        if (
          !leaderPlayer ||
          entry.renderProgress > (runnerMap.get(leaderPlayer.id)?.renderProgress ?? leaderPlayer.progress) ||
          (p.progress === leaderPlayer.progress && p.score > leaderPlayer.score)
        ) {
          leaderPlayer = p;
          leaderPose = pose;
        }

        let animMode: RunnerAnimMode = 'idle';
        let animTime = elapsed;
        let animPhase = p.lane * 0.7;

        let ceremonyBowAmount = 0;
        let hideTrophyUntilGoldMedal = false;

        if (inCeremony) {
          const rank = cachedRankById.get(p.id) ?? 99;
          const pt = rank <= 4 ? podiumTargetByRank.get(rank as 1 | 2 | 3 | 4) : undefined;
          const medalTier = getMedalTierForRank(rank);

          // Lazily attach worn 3D Gold/Silver/Bronze medal to Top-3 winners on the podium
          if (medalTier && entry.wornMedalRank !== rank) {
            entry.wornMedal?.dispose();
            entry.wornMedal = attachWornMedalToRunner(entry.rig.bodyPivot, medalTier);
            entry.wornMedalRank = rank;
          } else if (!medalTier && entry.wornMedal) {
            entry.wornMedal.dispose();
            entry.wornMedal = null;
            entry.wornMedalRank = null;
          }

          if (pt) {
            // Walk to assigned side staircase -> climb sideways up the steps -> turn forward -> receive medal & celebrate!
            const tStart = 0.45 + (4 - rank) * 0.25;
            const walkDur = 1.25;
            const climbDur = 1.35;
            const turnDur = 0.42;

            const startX = pt.sideEntryX + pt.sideDir * 3.0;
            const startZ = 5.4 + (rank - 1) * 0.45;
            const approachYaw = Math.atan2(pt.sideEntryX - startX, pt.z - startZ);
            const climbYaw = pt.sideDir === -1 ? Math.PI / 2 : -Math.PI / 2;
            const localT = Math.max(0, ceremonyElapsed - tStart);

            let rx = startX;
            let ry = 0;
            let rz = startZ;
            let rYaw = approachYaw;

            const isMedalist = rank <= 3;
            const hasMedal = !isMedalist || stadiumAwardedRanks.has(rank);
            if (entry.wornMedal) {
              entry.wornMedal.setVisible(hasMedal, true);
              entry.wornMedal.update(dt);
            }

            if (localT < walkDur) {
              const u = THREE.MathUtils.smoothstep(localT / walkDur, 0, 1);
              rx = THREE.MathUtils.lerp(startX, pt.sideEntryX, u);
              ry = 0;
              rz = THREE.MathUtils.lerp(startZ, pt.z, u);
              rYaw = u < 0.82 ? approachYaw : THREE.MathUtils.lerp(approachYaw, climbYaw, (u - 0.82) / 0.18);
              animMode = localT > 0.02 ? 'normal' : 'idle';
              hideTrophyUntilGoldMedal = isMedalist && !hasMedal;
            } else if (localT < walkDur + climbDur) {
              const u = THREE.MathUtils.smoothstep((localT - walkDur) / climbDur, 0, 1);
              rx = THREE.MathUtils.lerp(pt.sideEntryX, pt.x, u);
              // Climb up the side staircase first, then step onto target tier
              const stairSpan = Math.max(0.01, Math.abs(pt.sideStairTopX - pt.sideEntryX));
              const totalSpan = Math.max(stairSpan, Math.abs(pt.x - pt.sideEntryX));
              const stairEndU = Math.min(1, stairSpan / totalSpan);
              const sideTopY = pt.sideDir === -1 ? 1.06 : 0.62;
              if (u <= stairEndU) {
                const su = THREE.MathUtils.clamp(u / Math.max(0.01, stairEndU), 0, 1);
                ry = THREE.MathUtils.lerp(0, Math.min(pt.y, sideTopY), su);
              } else {
                const tu = THREE.MathUtils.clamp((u - stairEndU) / Math.max(0.01, 1 - stairEndU), 0, 1);
                ry = THREE.MathUtils.lerp(Math.min(pt.y, sideTopY), pt.y, tu);
              }
              rz = pt.z;
              rYaw = climbYaw;
              animMode = 'normal';
              hideTrophyUntilGoldMedal = isMedalist && !hasMedal;
            } else if (localT < walkDur + climbDur + turnDur) {
              const u = THREE.MathUtils.smoothstep((localT - walkDur - climbDur) / turnDur, 0, 1);
              rx = pt.x;
              ry = pt.y;
              rz = pt.z;
              rYaw = THREE.MathUtils.lerp(climbYaw, 0, u);
              animMode = hasMedal ? getVictoryAnimModeForRank(rank) : 'idle';
              animTime = Math.max(0, localT - (walkDur + climbDur));
              animPhase = 0;
              hideTrophyUntilGoldMedal = isMedalist && !hasMedal;
            } else {
              rx = pt.x;
              ry = pt.y;
              rz = pt.z;
              rYaw = 0;
              if (hasMedal) {
                if (entry.celebrateStartAt === null) {
                  entry.celebrateStartAt = ceremonyElapsed;
                }
                animMode = getVictoryAnimModeForRank(rank);
                animTime = Math.max(0, ceremonyElapsed - entry.celebrateStartAt);
                animPhase = 0;
              } else {
                animMode = 'idle';
                animTime = ceremonyElapsed;
                animPhase = rank * 0.4;
                hideTrophyUntilGoldMedal = true;
                if (medalStage && medalStage.bowingRank === rank && medalStage.bowAmount > 0.005) {
                  ceremonyBowAmount = medalStage.bowAmount;
                }
              }
            }

            entry.rig.root.position.set(rx, ry, rz);
            entry.rig.root.rotation.y = rYaw;
          } else {
            // Non-top-4 runners line up along the red carpet flanks with dignified sportsman wave & applause
            const flankIdx = Math.max(0, rank - 5);
            const side = flankIdx % 2 === 0 ? -1 : 1;
            const row = Math.floor(flankIdx / 2);
            const fx = 0.3 + side * (7.2 + (row % 2) * 1.45);
            const fz = 4.6 + Math.floor(row / 2) * 2.1;
            entry.rig.root.position.set(fx, 0, fz);
            entry.rig.root.rotation.y = Math.atan2(0.3 - fx, -0.5 - fz);
            animMode = 'victory_finisher';
            animTime = ceremonyElapsed;
            animPhase = flankIdx * 0.55;
          }
          anyBoostOrFinish = true;
        } else if (!showcaseMode && entry.walkInActive && (status === 'waiting' || status === 'countdown')) {
          if (status === 'countdown') {
            // Smoothly hurry into assigned starting lane so runner is locked on the start line before GO!
            const nextX = THREE.MathUtils.damp(entry.walkInCurrentX, pose.x, 6.5, dt);
            const nextZ = THREE.MathUtils.damp(entry.walkInCurrentZ, pose.z, 6.5, dt);
            const dx = pose.x - entry.walkInCurrentX;
            const dz = pose.z - entry.walkInCurrentZ;
            const distLeft = Math.hypot(dx, dz);
            let nextYaw = pose.yaw;
            if (distLeft > 0.25) {
              const targetYaw = Math.atan2(dx, dz);
              const angDiff = Math.atan2(
                Math.sin(targetYaw - entry.walkInCurrentYaw),
                Math.cos(targetYaw - entry.walkInCurrentYaw)
              );
              nextYaw = entry.walkInCurrentYaw + angDiff * Math.min(1, dt * 10);
              animMode = 'normal';
            } else {
              const angDiff = Math.atan2(
                Math.sin(pose.yaw - entry.walkInCurrentYaw),
                Math.cos(pose.yaw - entry.walkInCurrentYaw)
              );
              nextYaw = entry.walkInCurrentYaw + angDiff * Math.min(1, dt * 12);
              animMode = 'idle';
              if (distLeft < 0.08 && Math.abs(angDiff) < 0.05) {
                entry.walkInActive = false;
              }
            }
            entry.walkInCurrentX = nextX;
            entry.walkInCurrentZ = nextZ;
            entry.walkInCurrentYaw = nextYaw;
            pose.x = nextX;
            pose.z = nextZ;
            pose.yaw = nextYaw;
            pose.fx = Math.sin(nextYaw);
            pose.fz = Math.cos(nextYaw);
            entry.rig.root.position.set(nextX, 0, nextZ);
            entry.rig.root.rotation.y = nextYaw;
          } else {
            // Walk smoothly from Stadium Athlete Entrance Tunnel ("PINTU MASUK ATLET") to assigned start lane
            entry.walkInElapsed += dt;
            const walkDur = entry.walkInDuration;
            const turnDur = entry.walkInTurnDur;
            const totalDur = walkDur + turnDur;
            const startX = entry.walkInStartX;
            const startZ = entry.walkInStartZ;
            const exitZ = entry.walkInExitZ;
            const targetX = pose.x;
            const targetZ = pose.z;
            const targetYaw = pose.yaw;

            const exitDist = Math.abs(startZ - exitZ);
            const curveDist = Math.hypot(targetX - startX, targetZ - exitZ);
            const exitFrac = THREE.MathUtils.clamp(
              exitDist / Math.max(0.5, exitDist + curveDist),
              0.14,
              0.38
            );
            const exitDur = walkDur * exitFrac;
            const ctrlX = startX + 2.2;
            const ctrlZ = targetZ + (exitZ - targetZ) * 0.14;

            let rx = targetX;
            let rz = targetZ;
            let rYaw = targetYaw;

            if (entry.walkInElapsed < exitDur) {
              const u = THREE.MathUtils.clamp(entry.walkInElapsed / Math.max(0.05, exitDur), 0, 1);
              rx = startX;
              rz = THREE.MathUtils.lerp(startZ, exitZ, u);
              rYaw = Math.PI;
              animMode = 'walk';
            } else if (entry.walkInElapsed < walkDur) {
              const rawU = THREE.MathUtils.clamp(
                (entry.walkInElapsed - exitDur) / Math.max(0.1, walkDur - exitDur),
                0,
                1
              );
              // Gentle ease-out in the final 20% so the runner decelerates smoothly onto the starting line
              const u = rawU < 0.8 ? rawU / 0.8 * 0.86 : 0.86 + THREE.MathUtils.smoothstep((rawU - 0.8) / 0.2, 0, 1) * 0.14;
              const inv = 1 - u;
              rx = inv * inv * startX + 2 * inv * u * ctrlX + u * u * targetX;
              rz = inv * inv * exitZ + 2 * inv * u * ctrlZ + u * u * targetZ;
              const dxdt = 2 * inv * (ctrlX - startX) + 2 * u * (targetX - ctrlX);
              const dzdt = 2 * inv * (ctrlZ - exitZ) + 2 * u * (targetZ - ctrlZ);
              const desiredYaw = Math.hypot(dxdt, dzdt) > 1e-4 ? Math.atan2(dxdt, dzdt) : targetYaw;
              const angDiff = Math.atan2(
                Math.sin(desiredYaw - entry.walkInCurrentYaw),
                Math.cos(desiredYaw - entry.walkInCurrentYaw)
              );
              rYaw = entry.walkInCurrentYaw + angDiff * Math.min(1, dt * 8.5);
              animMode = 'walk';
            } else if (entry.walkInElapsed < totalDur) {
              const u = THREE.MathUtils.smoothstep(
                (entry.walkInElapsed - walkDur) / Math.max(0.05, turnDur),
                0,
                1
              );
              rx = targetX;
              rz = targetZ;
              const arrivalDx = targetX - ctrlX;
              const arrivalDz = targetZ - ctrlZ;
              const arrivalYaw =
                Math.hypot(arrivalDx, arrivalDz) > 1e-4
                  ? Math.atan2(arrivalDx, arrivalDz)
                  : targetYaw;
              const angDiff = Math.atan2(
                Math.sin(targetYaw - arrivalYaw),
                Math.cos(targetYaw - arrivalYaw)
              );
              rYaw = arrivalYaw + angDiff * u;
              animMode = 'idle';
            } else {
              rx = targetX;
              rz = targetZ;
              rYaw = targetYaw;
              entry.walkInActive = false;
              animMode = 'idle';
            }

            entry.walkInCurrentX = rx;
            entry.walkInCurrentZ = rz;
            entry.walkInCurrentYaw = rYaw;
            pose.x = rx;
            pose.z = rz;
            pose.yaw = rYaw;
            pose.fx = Math.sin(rYaw);
            pose.fz = Math.cos(rYaw);
            entry.rig.root.position.set(rx, 0, rz);
            entry.rig.root.rotation.y = rYaw;
          }
        } else {
          if (entry.walkInActive) {
            entry.walkInActive = false;
          }
          entry.rig.root.position.set(pose.x, 0, pose.z);
          entry.rig.root.rotation.y = pose.yaw;

          if (showcaseMode) {
            animMode = p.effectState;
          } else if (p.finishedAt != null) {
            animMode = getVictoryAnimModeForRank(p.finishRank ?? p.scoreRank);
            if (!entry.celebrated) {
              entry.celebrated = true;
              stadium.triggerConfetti(pose.x, pose.z);
            }
            anyBoostOrFinish = true;
          } else if (status === 'playing') {
            animMode = liveEffect;
            if (liveEffect === 'boost') {
              anyBoostOrFinish = true;
              hasActiveTrails = true;
              const td = trailData[trailCursor];
              td.x = pose.x - pose.fx * 0.6 + (Math.random() - 0.5) * 0.4;
              td.y = 0.5 + Math.random() * 0.9;
              td.z = pose.z - pose.fz * 0.6 + (Math.random() - 0.5) * 0.4;
              td.vx = -pose.fx * 4;
              td.vz = -pose.fz * 4;
              td.life = 0.45;
              trailCursor = (trailCursor + 1) % trailCount;
            }
          }
        }

        animateBlockyRunner(entry.rig, animTime, animMode, animPhase, dt);
        if (hideTrophyUntilGoldMedal) {
          entry.rig.trophyGroup.visible = false;
        }
        if (ceremonyBowAmount > 0.005) {
          entry.rig.headGroup.rotation.x += ceremonyBowAmount * 0.54;
          entry.rig.bodyPivot.rotation.x += ceremonyBowAmount * 0.22;
        }

        if (p.id === localIdRef.current) {
          localTarget = {
            pose,
            effect: liveEffect,
            finished: Boolean(p.finishedAt),
            walkingIn: entry.walkInActive,
          };
        }
        if (activeFollowedId && p.id === activeFollowedId) {
          followedTarget = {
            pose,
            effect: liveEffect,
            finished: Boolean(p.finishedAt),
            walkingIn: entry.walkInActive,
          };
        }
      }

      if (inCeremony && !confettiFiredForFinish) {
        confettiFiredForFinish = true;
        stadium.triggerConfetti(0.3, 0);
      } else if (!inCeremony) {
        confettiFiredForFinish = false;
      }

      // Update boost trail particles only when active trails exist
      if (hasActiveTrails) {
        let alive = false;
        for (let i = 0; i < trailCount; i++) {
          const td = trailData[i];
          if (td.life > 0) {
            alive = true;
            td.life -= dt;
            td.x += td.vx * dt;
            td.z += td.vz * dt;
            const s = Math.max(0.01, td.life * 2);
            trailDummy.position.set(td.x, td.y, td.z);
            trailDummy.scale.set(s, s, s);
          } else {
            trailDummy.position.set(0, -50, 0);
            trailDummy.scale.set(0.01, 0.01, 0.01);
          }
          trailDummy.updateMatrix();
          trailMesh.setMatrixAt(i, trailDummy.matrix);
        }
        trailMesh.instanceMatrix.needsUpdate = true;
        hasActiveTrails = alive;
      }

      stadium.updateSpectators(elapsed, anyBoostOrFinish || status === 'finished');
      stadium.updateConfetti(dt);
      stadium.updatePerimeterLed(dt);

      // Update Upper-Side Stadium Digital Jumbotron with Live Runner Ranking Board (throttled ~1.2Hz to prevent GPU texture upload stalls)
      if (lastJumbotronUpdateAt < 0 || elapsed - lastJumbotronUpdateAt >= 0.85) {
        const sortedForBoard = [...list].sort((a, b) => {
          if (status === 'finished') {
            const ra = a.scoreRank ?? Number.MAX_SAFE_INTEGER;
            const rb = b.scoreRank ?? Number.MAX_SAFE_INTEGER;
            if (ra !== rb) return ra - rb;
            if (b.score !== a.score) return b.score - a.score;
            return (a.finishRank ?? 999) - (b.finishRank ?? 999);
          }
          if (status === 'waiting' || status === 'countdown') {
            return a.lane - b.lane;
          }
          const fa = a.finishRank ?? Number.MAX_SAFE_INTEGER;
          const fb = b.finishRank ?? Number.MAX_SAFE_INTEGER;
          if (fa !== fb) return fa - fb;
          const progA = runnerMap.get(a.id)?.renderProgress ?? a.progress;
          const progB = runnerMap.get(b.id)?.renderProgress ?? b.progress;
          if (Math.abs(progB - progA) > 0.0005) return progB - progA;
          return b.score - a.score;
        });

        const top8 = sortedForBoard.slice(0, 8);
        const localIdx = localIdRef.current
          ? sortedForBoard.findIndex((p) => p.id === localIdRef.current)
          : -1;
        const leader = sortedForBoard[0];
        const leaderProg = leader ? runnerMap.get(leader.id)?.renderProgress ?? leader.progress : 0;
        const leaderPct = Math.round(leaderProg * 100);
        const lapNum = Math.min(stadium.totalLaps, Math.floor(leaderProg * stadium.totalLaps) + 1);

        // Quantized signature avoids redundant 2D canvas redraws & GPU texture uploads
        const boardSig = top8
          .map((p) => {
            const rp = Math.round(((runnerMap.get(p.id)?.renderProgress ?? p.progress) * 100) / 2);
            return `${p.id}:${rp}:${Math.round(p.score)}:${p.effectState}:${p.finishRank ?? ''}`;
          })
          .join('|');
        const localSig =
          localIdx >= 0
            ? `${localIdx}:${Math.round(((runnerMap.get(sortedForBoard[localIdx].id)?.renderProgress ?? sortedForBoard[localIdx].progress) * 100) / 2)}:${Math.round(sortedForBoard[localIdx].score)}`
            : '';
        const jKey = `${status}:${list.length}:${lapNum}:${boardSig}:${localSig}`;

        if (jKey !== lastJumbotronKey) {
          lastJumbotronKey = jKey;
          lastJumbotronUpdateAt = elapsed;

          const toEntry = (p: PlayerState, rank: number): JumbotronRunnerEntry => ({
            rank,
            name: p.name,
            className: p.className,
            colorHex: AVATAR_COLOR_HEX_MAP.get(p.avatar.color) || '#3B82F6',
            progress: runnerMap.get(p.id)?.renderProgress ?? p.progress,
            score: p.score,
            effectState: p.effectState,
            finishRank: p.finishRank,
            isLocal: p.id === localIdRef.current,
          });

          const subtitle =
            status === 'finished'
              ? 'PERTANDINGAN SELESAI · KLASEMEN AKHIR PEMBALAP'
              : status === 'playing'
              ? `PUTARAN ${lapNum}/${stadium.totalLaps} · ${leaderPct}% LINTASAN · ${questionCount} SOAL`
              : status === 'countdown'
              ? `BERSIAP DI GARIS START · ${list.length} PEMBALAP`
              : `${questionCount} SOAL · ${stadium.totalLaps} PUTARAN · MENUNGGU START`;

          stadium.updateJumbotron({
            title: roomNameRef.current,
            subtitle,
            status,
            runners: top8.map((p, idx) => toEntry(p, idx + 1)),
            totalPlayers: list.length,
            localRunner: localIdx >= 0 ? toEntry(sortedForBoard[localIdx], localIdx + 1) : null,
          });
        }
      }

      // Unified 4-position camera solver (zero per-frame allocations)
      const startPose = finishPose;
      const hasExplicitFollow = Boolean(followedTarget);
      const focusRunner = followedTarget
        ? followedTarget
        : localTarget
        ? localTarget
        : leaderPose
        ? { pose: leaderPose, effect: leaderPlayer?.effectState || 'normal', finished: false }
        : { pose: startPose, effect: 'normal', finished: false };

      const computePresetCamera = (
        preset: CameraPresetId,
        allowStatusOverride: boolean,
        outPos: THREE.Vector3,
        outLook: THREE.Vector3
      ): { fov: number; damp: number } => {
        // Status-driven dramatic framing for the main camera during waiting/countdown/ceremony
        if (allowStatusOverride && !showcaseMode) {
          if (status === 'waiting' && !followedTarget) {
            if (localTarget?.walkingIn) {
              // Follow local student cinematically from the track side as they emerge from PINTU MASUK ATLET
              const lp = localTarget.pose;
              outPos.set(lp.x - 10.5, 5.2, Math.min(160.5, lp.z - 12.2));
              outLook.set(lp.x + lp.fx * 2.2, 1.45, lp.z + lp.fz * 2.2);
              return { fov: 54, damp: 5.2 };
            }
            // Wide broadcast shot framing BOTH PINTU MASUK ATLET (x=-12, z=168) AND the full 30-lane Start Line (x=0)
            outPos.set(startPose.x - 34 + Math.sin(elapsed * 0.22) * 4.5, 14.5, startPose.z - 23.75);
            outLook.set(startPose.x - 2, 3.0, startPose.z + 5.25);
            return { fov: 56, damp: 3.6 };
          }
          if (status === 'countdown') {
            const focus = followedTarget
              ? followedTarget.pose
              : localTarget
              ? localTarget.pose
              : startPose;
            const lookY = followedTarget || !localTarget ? 1.2 : -0.7;
            outPos.set(focus.x - focus.fx * 7.4, 3.6, focus.z - focus.fz * 7.4 + 1.8);
            outLook.set(focus.x + focus.fx * 5.0, lookY, focus.z + focus.fz * 5.0);
            return { fov: 56, damp: 6.5 };
          }
          if (inCeremony) {
            if (medalStage && medalStage.focusPoint && medalStage.phase !== 'complete') {
              const sideOffset = medalStage.activeRank === 2 ? 2.6 : -2.6;
              outPos.set(
                medalStage.focusPoint.x + sideOffset,
                medalStage.focusPoint.y + 1.05,
                medalStage.focusPoint.z + 6.4
              );
              outLook.set(
                medalStage.focusPoint.x,
                medalStage.focusPoint.y - 0.05,
                medalStage.focusPoint.z
              );
              return { fov: 54, damp: 3.8 };
            }
            const heroZoom = THREE.MathUtils.clamp((ceremonyElapsed - 1.2) / 2.6, 0, 1);
            const sway = Math.sin(ceremonyElapsed * 0.36) * 2.8;
            outPos.set(
              0.3 + sway * heroZoom,
              THREE.MathUtils.lerp(6.2, 4.4, heroZoom),
              THREE.MathUtils.lerp(20.5, 13.8, heroZoom)
            );
            outLook.set(
              0.3,
              THREE.MathUtils.lerp(1.7, 2.35, heroZoom),
              THREE.MathUtils.lerp(5.5, -0.5, heroZoom)
            );
            return { fov: 54, damp: 4.0 };
          }
        }

        // 1) CAM 1 — Udara Stadion (Aerial Wide Broadcast / Elevated Follow Cam)
        if (preset === 'broadcast') {
          if (showcaseMode && !followedTarget) {
            const camOrbitAngle = elapsed * 0.12 - 0.52;
            outPos.set(Math.sin(camOrbitAngle) * 515, 112, Math.cos(camOrbitAngle) * 335);
            outLook.set(0, 16, 0);
            return { fov: 54, damp: 3.2 };
          }
          if (followedTarget) {
            const focus = followedTarget.pose;
            outPos.set(focus.x * 0.72, 42, focus.z * 0.72);
            outLook.set(focus.x, 1.8, focus.z);
            return { fov: 50, damp: 5.5 };
          }
          const focus = leaderPose || startPose;
          outPos.set(focus.x * 0.62, 78, focus.z * 0.62);
          outLook.set(focus.x, 1.5, focus.z);
          return { fov: 54, damp: 4.2 };
        }

        // 2) CAM 3 — Sisi Lintasan (Infield Rail Dolly Tracking Cam — 100% unobstructed)
        if (preset === 'side') {
          const p = focusRunner.pose;
          const inX = p.fz;
          const inZ = -p.fx;
          const sideZ = p.z + inZ * 23 + p.fz * 15;
          outPos.set(
            p.x + inX * 23 + p.fx * 15,
            6.0,
            status === 'waiting' ? Math.min(161.5, sideZ) : sideZ
          );
          outLook.set(p.x + p.fx * 2.5, 1.55, p.z + p.fz * 2.5);
          return { fov: 46, damp: 6.2 };
        }

        // 3) CAM 4 — Garis Finish (Start/Finish Gantry / Podium Angle)
        if (preset === 'finish' || (allowStatusOverride && !hasExplicitFollow && localTarget?.finished)) {
          if (inCeremony) {
            const sway = Math.sin(ceremonyElapsed * 0.4) * 3.2;
            outPos.set(0.3 + sway, 4.9, 15.2);
            outLook.set(0.3, 2.2, -0.4);
            return { fov: 52, damp: 4.2 };
          }
          if (!hasExplicitFollow && localTarget?.finished) {
            const focus = localTarget.pose;
            outPos.set(
              focus.x + focus.fx * 9 + Math.sin(elapsed * 0.6) * 4,
              4.5,
              focus.z + focus.fz * 9 + 5
            );
            outLook.set(focus.x, 1.4, focus.z);
            return { fov: 54, damp: 4.5 };
          }
          outPos.set(
            startPose.x + startPose.fx * 28 + Math.sin(elapsed * 0.35) * 3.5,
            8.2,
            startPose.z + startPose.fz * 28 - 19
          );
          outLook.set(startPose.x - startPose.fx * 8, 2.1, startPose.z + 2);
          return { fov: 50, damp: 4.5 };
        }

        // 4) CAM 2 — Ikuti Pembalap (Low Action Chase Cam)
        const p = focusRunner.pose;
        const targetFov =
          focusRunner.effect === 'boost' ? 64 : focusRunner.effect === 'penalty' ? 50 : 56;
        // Guard camera from going behind the outer grandstand wall while runner exits the athlete tunnel
        if (status === 'waiting' && p.z > 156 && p.fz < -0.25) {
          outPos.set(p.x - 10.2, 4.9, Math.min(160.5, p.z - 10.5));
          outLook.set(p.x + p.fx * 1.5, 1.45, p.z + p.fz * 1.5);
          return { fov: 54, damp: 6.5 };
        }
        const lookY = showcaseMode || !localTarget || hasExplicitFollow ? 1.15 : -1.65;
        const chaseZ = p.z - p.fz * 9.4;
        outPos.set(
          p.x - p.fx * 9.4,
          4.35,
          status === 'waiting' ? Math.min(163.5, chaseZ) : chaseZ
        );
        outLook.set(p.x + p.fx * 4.2, lookY, p.z + p.fz * 4.2);
        return { fov: targetFov, damp: 9.0 };
      };

      const viewMode = viewModeRef.current;
      const w = viewportW || container.clientWidth || window.innerWidth;
      const h = viewportH || container.clientHeight || window.innerHeight;
      frameCounter += 1;

      if (viewMode !== lastViewMode || activeFollowedId !== lastFollowedId) {
        lastViewMode = viewMode;
        lastFollowedId = activeFollowedId;
        for (let i = 0; i < previewDirty.length; i++) {
          previewDirty[i] = true;
        }
      }

      const updateSubCamera = (idx: number, preset: CameraPresetId, aspect: number) => {
        const subCam = previewCameras[idx];
        const lookVec = previewLookCurrents[idx];
        const cfg = computePresetCamera(preset, false, _camDesired, _camTarget);
        if (!previewInitialized[idx]) {
          subCam.position.copy(_camDesired);
          lookVec.copy(_camTarget);
          subCam.fov = cfg.fov;
          subCam.aspect = aspect;
          subCam.updateProjectionMatrix();
          previewInitialized[idx] = true;
        } else {
          const alpha = 1 - Math.exp(-cfg.damp * dt);
          subCam.position.lerp(_camDesired, alpha);
          lookVec.lerp(_camTarget, alpha);
          let projDirty = false;
          if (Math.abs(subCam.fov - cfg.fov) > 0.12) {
            subCam.fov = THREE.MathUtils.damp(subCam.fov, cfg.fov, 6, dt);
            projDirty = true;
          }
          if (Math.abs(subCam.aspect - aspect) > 0.005) {
            subCam.aspect = aspect;
            projDirty = true;
          }
          if (projDirty) subCam.updateProjectionMatrix();
        }
        subCam.lookAt(lookVec);
      };

      if (viewMode === 'quad') {
        const halfW = Math.floor(w / 2);
        const halfH = Math.floor(h / 2);
        const topH = h - halfH;
        const rightW = w - halfW;
        // WebGL (0,0) is bottom-left: Top-Left = CAM 1, Top-Right = CAM 2, Bottom-Left = CAM 3, Bottom-Right = CAM 4
        const quadCells: Array<[number, number, number, number]> = [
          [0, halfH, halfW, topH],
          [halfW, halfH, rightW, topH],
          [0, 0, halfW, halfH],
          [halfW, 0, rightW, halfH],
        ];

        // Update 1 quadrant per frame round-robin (or 2 on first dirty init) — cuts GPU cost by 75% vs 4-pass
        const qTargetW = Math.min(384, Math.max(180, Math.floor(halfW * 0.72)));
        const qTargetH = Math.min(240, Math.max(120, Math.floor(halfH * 0.72)));
        let updateIdx = -1;
        for (let i = 0; i < CAMERA_PRESET_LIST.length; i++) {
          if (previewDirty[i]) {
            updateIdx = i;
            break;
          }
        }
        if (updateIdx === -1) {
          updateIdx = quadRoundRobinIdx;
          quadRoundRobinIdx = (quadRoundRobinIdx + 1) % CAMERA_PRESET_LIST.length;
        }

        const [, , vw, vh] = quadCells[updateIdx];
        if (vw >= 4 && vh >= 4) {
          const rt = previewRenderTargets[updateIdx];
          ensureRenderTargetSize(rt, qTargetW, qTargetH);
          updateSubCamera(updateIdx, CAMERA_PRESET_LIST[updateIdx].id, vw / vh);
          renderer.setScissorTest(false);
          renderer.setRenderTarget(rt);
          renderer.setViewport(0, 0, rt.width, rt.height);
          renderer.render(scene, previewCameras[updateIdx]);
          renderer.setRenderTarget(null);
          previewDirty[updateIdx] = false;
        }

        // Blit all 4 cached quadrant textures in 4 ultra-lightweight fullscreen-quad draws
        const prevAutoClear = renderer.autoClear;
        renderer.autoClear = false;
        renderer.setScissorTest(true);
        for (let i = 0; i < CAMERA_PRESET_LIST.length; i++) {
          const [vx, vy, cw, ch] = quadCells[i];
          if (cw < 4 || ch < 4) continue;
          blitMat.map = previewRenderTargets[i].texture;
          renderer.setViewport(vx, vy, cw, ch);
          renderer.setScissor(vx, vy, cw, ch);
          renderer.render(blitScene, blitCamera);
        }
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        renderer.autoClear = prevAutoClear;
      } else {
        // Main camera pass (single or pip base) — always full 60 FPS smoothness
        const mainCfg = computePresetCamera(presetRef.current, true, _camDesired, _camTarget);
        if (Math.abs(camera.fov - mainCfg.fov) > 0.08) {
          camera.fov = THREE.MathUtils.damp(camera.fov, mainCfg.fov, 6, dt);
          camera.updateProjectionMatrix();
        }
        const camAlpha = 1 - Math.exp(-mainCfg.damp * dt);
        camera.position.lerp(_camDesired, camAlpha);
        camLookCurrent.lerp(_camTarget, camAlpha);
        camera.lookAt(camLookCurrent);

        renderer.setRenderTarget(null);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        renderer.render(scene, camera);

        // Cached round-robin 4-angle PiP preview (at most 1 tiny 192x120 thumbnail every 4 frames, zero shadowMap toggling!)
        if (viewMode === 'pip') {
          const rects = pipRectsRef.current;

          let updateIdx = -1;
          for (let i = 0; i < CAMERA_PRESET_LIST.length; i++) {
            const r = rects[i];
            if (previewDirty[i] && r && r.visible && r.width >= 12 && r.height >= 12) {
              updateIdx = i;
              break;
            }
          }
          const cadence = isSoftwareGl || currentDpr < 1 ? 6 : 4;
          if (updateIdx === -1 && frameCounter % cadence === 0) {
            for (let step = 0; step < CAMERA_PRESET_LIST.length; step++) {
              const cand = (pipRoundRobinIdx + step) % CAMERA_PRESET_LIST.length;
              const r = rects[cand];
              if (r && r.visible && r.width >= 12 && r.height >= 12) {
                updateIdx = cand;
                pipRoundRobinIdx = (cand + 1) % CAMERA_PRESET_LIST.length;
                break;
              }
            }
          }

          if (updateIdx >= 0) {
            const r = rects[updateIdx];
            const rt = previewRenderTargets[updateIdx];
            ensureRenderTargetSize(rt, PIP_RT_W, PIP_RT_H);
            updateSubCamera(updateIdx, CAMERA_PRESET_LIST[updateIdx].id, r.width / r.height);
            // Hide distant crowd during tiny 192x120 thumbnail pass (never toggle shadowMap.enabled!)
            stadium.setSpectatorsVisible(false);
            renderer.setScissorTest(false);
            renderer.setRenderTarget(rt);
            renderer.setViewport(0, 0, rt.width, rt.height);
            renderer.render(scene, previewCameras[updateIdx]);
            renderer.setRenderTarget(null);
            stadium.setSpectatorsVisible(true);
            previewDirty[updateIdx] = false;
          }

          const prevAutoClear = renderer.autoClear;
          renderer.autoClear = false;
          renderer.setScissorTest(true);
          for (let i = 0; i < CAMERA_PRESET_LIST.length; i++) {
            const r = rects[i];
            if (!r || !r.visible || r.width < 12 || r.height < 12) continue;
            if (previewDirty[i]) continue;
            blitMat.map = previewRenderTargets[i].texture;
            renderer.setViewport(r.left, r.bottom, r.width, r.height);
            renderer.setScissor(r.left, r.bottom, r.width, r.height);
            renderer.render(blitScene, blitCamera);
          }
          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, w, h);
          renderer.autoClear = prevAutoClear;
        }
      }

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
      unsubscribeLed();
      presenterRig.dispose();
      for (const entry of runnerMap.values()) {
        entry.wornMedal?.dispose();
        entry.rig.dispose();
      }
      runnerMap.clear();
      for (const rt of previewRenderTargets) {
        rt.dispose();
      }
      blitGeo.dispose();
      blitMat.dispose();
      trailGeo.dispose();
      trailMat.dispose();
      stadium.dispose();
      lightingRig.dispose();
      disposeEnv();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [questionCount, showcaseMode, measurePipSlots]);

  const pipContainerClass =
    pipPlacement === 'right-grid'
      ? 'absolute bottom-14 left-3 right-3 sm:left-6 sm:right-6 lg:left-auto lg:right-6 xl:right-10 lg:top-1/2 lg:bottom-auto lg:-translate-y-1/2 lg:w-[390px] xl:w-[448px] z-20 pointer-events-auto'
      : pipPlacement === 'top-row'
      ? 'absolute top-[138px] left-2.5 right-2.5 sm:left-auto sm:right-3 sm:w-[460px] z-20 pointer-events-auto'
      : 'absolute bottom-[60px] left-3 right-3 z-20 pointer-events-auto';

  const pipGridClass =
    pipPlacement === 'right-grid'
      ? 'grid grid-cols-4 lg:grid-cols-2 gap-1.5 sm:gap-2'
      : 'grid grid-cols-4 gap-1.5 sm:gap-2';

  return (
    <div ref={mountRef} className="w-full h-full relative overflow-hidden">
      {/* Isolated WebGL Canvas Host */}
      <div ref={canvasHostRef} className="absolute inset-0" />

      {/* Live 4-Camera 2x2 Broadcast Grid Overlay */}
      {cameraViewMode === 'quad' && (
        <div className="absolute inset-0 z-20 grid grid-cols-2 grid-rows-2 pointer-events-none">
          {CAMERA_PRESET_LIST.map((cam) => {
            const isActive = cameraPreset === cam.id;
            const tracksParticipant = cam.id === 'broadcast' || cam.id === 'chase' || cam.id === 'side';
            return (
              <button
                key={cam.id}
                type="button"
                onClick={() => {
                  onSelectCameraPreset?.(cam.id);
                  onChangeCameraViewMode?.('single');
                }}
                className={`relative pointer-events-auto group border transition-colors cursor-pointer text-left ${
                  isActive
                    ? 'border-[#FF6B1A] ring-2 ring-inset ring-[#FF6B1A]/75'
                    : 'border-white/25 hover:border-[#FACC15]'
                }`}
                title={`Fokus ke ${cam.camCode} · ${cam.label}`}
              >
                <div className="absolute top-2 left-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#081226]/90 border border-white/20 text-[11px] font-bold text-white max-w-[calc(100%-16px)]">
                  <Camera className="w-3 h-3 text-[#FF6B1A] shrink-0" />
                  <span className="font-mono text-[#FACC15] shrink-0">{cam.camCode}</span>
                  <span className="hidden sm:inline text-slate-200 font-semibold truncate">
                    · {cam.label}
                  </span>
                  {tracksParticipant && followedPlayerName && (
                    <span className="text-cyan-300 font-semibold truncate">
                      · {followedPlayerName}
                    </span>
                  )}
                </div>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#081226]/90 border border-white/20 text-[10px] font-semibold text-white">
                  <Maximize2 className="w-3 h-3 text-[#FACC15]" />
                  <span>Layar Penuh</span>
                </div>
              </button>
            );
          })}

          {onSelectFollowedPlayer && followablePlayers && followablePlayers.length > 0 && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#081226]/95 border border-[#FACC15]/60 shadow-2xl">
              <Crosshair className="w-3.5 h-3.5 text-[#FACC15] shrink-0" />
              <span className="text-[11px] font-bold text-slate-200 hidden sm:inline">Ikuti:</span>
              <select
                aria-label="Pilih peserta untuk diikuti kamera"
                value={followedPlayerId ?? ''}
                onChange={(e) => onSelectFollowedPlayer(e.target.value || null)}
                className="bg-[#0F2957] text-white text-[11px] font-semibold rounded px-2 py-0.5 border border-white/20 focus:outline-none focus:border-[#FACC15] max-w-[180px] cursor-pointer"
              >
                <option value="">{defaultFollowLabel}</option>
                {followablePlayers.map((fp) => (
                  <option key={fp.id} value={fp.id}>
                    {fp.name}
                    {fp.className ? ` (${fp.className})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Live 4-Camera PiP Preview Strip / Panel Overlay */}
      {cameraViewMode === 'pip' && (
        <div className={pipContainerClass}>
          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5 px-2.5 py-1 rounded-lg bg-[#081226]/92 border border-blue-400/30">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-white min-w-0">
              <Camera className="w-3.5 h-3.5 text-[#FF6B1A] shrink-0" />
              <span className="truncate">LIVE 4 KAMERA</span>
            </div>

            {onSelectFollowedPlayer && followablePlayers && followablePlayers.length > 0 && (
              <div className="inline-flex items-center gap-1 min-w-0">
                <Crosshair className="w-3 h-3 text-[#FACC15] shrink-0" />
                <select
                  aria-label="Pilih nama peserta untuk diikuti kamera live preview"
                  value={followedPlayerId ?? ''}
                  onChange={(e) => onSelectFollowedPlayer(e.target.value || null)}
                  className="bg-[#0F2957] text-white text-[10px] font-semibold rounded px-1.5 py-0.5 border border-white/20 focus:outline-none focus:border-[#FACC15] max-w-[145px] sm:max-w-[180px] cursor-pointer"
                >
                  <option value="">{defaultFollowLabel}</option>
                  {followablePlayers.map((fp) => (
                    <option key={fp.id} value={fp.id}>
                      {fp.name}
                      {fp.className ? ` (${fp.className})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="inline-flex items-center gap-1 shrink-0">
              {onChangeCameraViewMode && (
                <>
                  <button
                    type="button"
                    onClick={() => onChangeCameraViewMode('quad')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0F2957] hover:bg-blue-700 text-[10px] font-semibold text-blue-100 cursor-pointer"
                    title="Tampilkan 4 Kamera Penuh (Grid 2x2)"
                  >
                    <Grid2x2 className="w-3 h-3 text-[#FACC15]" />
                    <span>2×2</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeCameraViewMode('single')}
                    className="p-0.5 rounded bg-[#0F2957] hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
                    title="Sembunyikan Preview 4 Kamera"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>

          <div className={pipGridClass}>
            {CAMERA_PRESET_LIST.map((cam, idx) => {
              const isActive = cameraPreset === cam.id;
              return (
                <button
                  key={cam.id}
                  ref={(el) => {
                    pipSlotRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => onSelectCameraPreset?.(cam.id)}
                  className={`relative aspect-[16/10] w-full rounded-lg overflow-hidden border-2 transition-colors cursor-pointer bg-transparent ${
                    isActive
                      ? 'border-[#FF6B1A] shadow-md shadow-orange-950/60'
                      : 'border-white/30 hover:border-[#FACC15]'
                  }`}
                  title={`Pilih ${cam.camCode}: ${cam.label}`}
                >
                  <div className="absolute inset-x-0 bottom-0 px-1.5 py-0.5 bg-[#081226]/88 flex items-center justify-between gap-1 text-[10px] leading-tight">
                    <span className={`font-mono font-bold ${isActive ? 'text-[#FACC15]' : 'text-cyan-300'}`}>
                      {cam.camCode}
                    </span>
                    <span className="text-white font-semibold truncate">{cam.shortLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
