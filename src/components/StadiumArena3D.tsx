import { memo, useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
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

interface StadiumArena3DProps {
  questionCount: number;
  maxPlayers: number;
  players: PlayerState[];
  livePlayersRef?: MutableRefObject<PlayerState[]>;
  liveVersionRef?: MutableRefObject<number>;
  localPlayerId?: string;
  roomStatus: RoomStatus;
  roomName?: string;
  cameraPreset?: 'chase' | 'broadcast' | 'finish';
  venue?: RaceVenueId;
  showcaseMode?: boolean;
  onFinishConfetti?: () => void;
}

const _camTarget = new THREE.Vector3();
const _camDesired = new THREE.Vector3();
const AVATAR_COLOR_HEX_MAP = new Map<string, string>(AVATAR_COLORS.map((c) => [c.id, c.hex]));

export const StadiumArena3D = memo(function StadiumArena3D({
  questionCount,
  maxPlayers,
  players,
  livePlayersRef,
  liveVersionRef,
  localPlayerId,
  roomStatus,
  roomName = 'EDU RUN ARENA 3D',
  cameraPreset = 'chase',
  venue = 'stadium_day',
  showcaseMode = false,
}: StadiumArena3DProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  const playersRef = useRef<PlayerState[]>(players);
  const externalLivePlayersRef = useRef<MutableRefObject<PlayerState[]> | undefined>(livePlayersRef);
  const externalLiveVersionRef = useRef<MutableRefObject<number> | undefined>(liveVersionRef);
  const localIdRef = useRef<string | undefined>(localPlayerId);
  const statusRef = useRef<RoomStatus>(roomStatus);
  const presetRef = useRef(cameraPreset);
  const roomNameRef = useRef(roomName);
  const maxPlayersRef = useRef(maxPlayers);
  const venueRef = useRef<RaceVenueId>(venue);
  const dataVersionRef = useRef(0);

  playersRef.current = players;
  externalLivePlayersRef.current = livePlayersRef;
  externalLiveVersionRef.current = liveVersionRef;
  localIdRef.current = localPlayerId;
  statusRef.current = roomStatus;
  presetRef.current = cameraPreset;
  roomNameRef.current = roomName;
  maxPlayersRef.current = maxPlayers;
  venueRef.current = venue;
  dataVersionRef.current += 1;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const initialVenue = venueRef.current;
    const trackLength = calcTrackLength(questionCount);
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      56,
      (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight),
      0.2,
      2400
    );
    const camLookCurrent = new THREE.Vector3(14, 2, 142);
    camera.position.set(-30, 16, 175);
    camera.lookAt(camLookCurrent);

    const { renderer, isSoftwareGl } = createConfiguredRenderer(container);
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

    // Runner instances map keyed by participant ID with continuous dead-reckoning state
    const runnerMap = new Map<
      string,
      {
        rig: BlockyRunnerRig;
        targetProgress: number;
        renderProgress: number;
        velocityPerSec: number;
        pose: TrackPose;
        celebrated: boolean;
        signature: string;
        wornMedal: MedalAttachmentHandle | null;
        wornMedalRank: number | null;
        celebrateStartAt: number | null;
      }
    >();

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
    let shadowsAutoDisabled = false;

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const resizeObs = new ResizeObserver(handleResize);
    resizeObs.observe(container);

    const getActivePlayers = () =>
      externalLivePlayersRef.current ? externalLivePlayersRef.current.current : playersRef.current;

    const syncRunnersAndTelemetry = () => {
      const list = getActivePlayers();
      const status = statusRef.current;
      const laneCap = Math.min(30, Math.max(1, maxPlayersRef.current || 30));

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
          if (existing) {
            existing.wornMedal?.dispose();
            scene.remove(existing.rig.root);
            existing.rig.dispose();
          }
          const isLocal = p.id === localIdRef.current;
          // Keep contactShadow discs on all 30 runners; only cast dynamic shadow maps on local player or small rooms (<=6) to eliminate 700+ shadow draw calls
          const allowShadow =
            !showcaseMode && !isSoftwareGl && !shadowsAutoDisabled && (isLocal || list.length <= 6);
          const rig = createBlockyRunner(p.avatar, p.name, p.lane + 1, isLocal, !showcaseMode, allowShadow);
          const pose = stadium.getTrackPose(p.progress, p.lane, laneCap);
          rig.root.position.set(pose.x, 0, pose.z);
          rig.root.rotation.y = pose.yaw;
          scene.add(rig.root);
          runnerMap.set(p.id, {
            rig,
            targetProgress: p.progress,
            renderProgress: p.progress,
            velocityPerSec: speedPerSec,
            pose,
            celebrated: Boolean(p.finishedAt),
            signature: sig,
            wornMedal: null,
            wornMedalRank: null,
            celebrateStartAt: null,
          });
        } else {
          // Sync authoritative server target + current velocity for smooth between-tick dead-reckoning
          if (Math.abs(p.progress - existing.targetProgress) > 0.04) {
            existing.targetProgress = p.progress;
          } else {
            existing.targetProgress = Math.max(existing.targetProgress * 0.35 + p.progress * 0.65, p.progress);
          }
          existing.velocityPerSec = speedPerSec;
        }
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

      // Adaptive performance guard: if sustained frame time > 28ms on hardware WebGL, reduce resolution cleanly
      if (!isSoftwareGl && rawDt > 0 && rawDt < 0.25) {
        slowFrameAccum += rawDt;
        slowFrameSamples += 1;
        if (slowFrameSamples >= 30) {
          const avgDt = slowFrameAccum / slowFrameSamples;
          if (avgDt > 0.028) {
            if (currentDpr > 0.9) {
              currentDpr = Math.max(0.85, Number((currentDpr - 0.25).toFixed(2)));
              renderer.setPixelRatio(currentDpr);
            } else if (!shadowsAutoDisabled && renderer.shadowMap.enabled) {
              shadowsAutoDisabled = true;
              renderer.shadowMap.enabled = false;
              renderer.shadowMap.autoUpdate = false;
            }
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
              standY: Math.max(STADIUM_CARPET_Y + 0.24, pt.y - 0.34),
              standZ: 1.42,
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

      let anyBoostOrFinish = false;
      let localTarget: { pose: TrackPose; effect: string; finished: boolean } | null = null;
      let leaderPlayer: PlayerState | null = null;
      let leaderPose: TrackPose | null = null;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const entry = runnerMap.get(p.id);
        if (!entry) continue;

        if (showcaseMode) {
          const speedRate =
            p.effectState === 'boost'
              ? 0.0068
              : p.effectState === 'penalty'
              ? 0.001
              : 0.0032 + (p.lane % 4) * 0.0003;
          entry.renderProgress = (elapsed * speedRate + p.lane * 0.014) % 1;
        } else {
          // Continuous dead-reckoning advance between server ticks eliminates 15/20Hz micro-stutter
          if (entry.velocityPerSec > 0) {
            const maxLead = Math.min(1, p.progress + entry.velocityPerSec * 0.18);
            entry.targetProgress = Math.min(maxLead, entry.targetProgress + entry.velocityPerSec * dt);
          } else {
            entry.targetProgress = p.progress;
          }
          entry.renderProgress = THREE.MathUtils.damp(entry.renderProgress, entry.targetProgress, 14, dt);
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
            // Walk up red carpet -> climb podium steps -> turn forward -> wait & bow for medal -> celebrate wearing medal!
            const tStart = 0.45 + (4 - rank) * 0.25;
            const walkDur = 1.65;
            const climbDur = 0.95;
            const turnDur = 0.42;

            const startX = pt.x * 1.12;
            const startZ = 15.2 + (rank - 1) * 0.35;
            const localT = Math.max(0, ceremonyElapsed - tStart);

            let rx = startX;
            let ry = 0;
            let rz = startZ;
            let rYaw = Math.PI;

            const isMedalist = rank <= 3;
            const hasMedal = !isMedalist || stadiumAwardedRanks.has(rank);
            if (entry.wornMedal) {
              entry.wornMedal.setVisible(hasMedal, true);
              entry.wornMedal.update(dt);
            }

            if (localT < walkDur) {
              const u = THREE.MathUtils.smoothstep(localT / walkDur, 0, 1);
              rx = THREE.MathUtils.lerp(startX, pt.x, u);
              ry = 0;
              rz = THREE.MathUtils.lerp(startZ, pt.stepZ, u);
              rYaw = Math.PI;
              animMode = localT > 0.02 ? 'normal' : 'idle';
              hideTrophyUntilGoldMedal = isMedalist && !hasMedal;
            } else if (localT < walkDur + climbDur) {
              const u = THREE.MathUtils.smoothstep((localT - walkDur) / climbDur, 0, 1);
              rx = pt.x;
              ry = THREE.MathUtils.lerp(0, pt.y, u);
              rz = THREE.MathUtils.lerp(pt.stepZ, pt.z, u);
              rYaw = Math.PI;
              animMode = 'normal';
              hideTrophyUntilGoldMedal = isMedalist && !hasMedal;
            } else if (localT < walkDur + climbDur + turnDur) {
              const u = THREE.MathUtils.smoothstep((localT - walkDur - climbDur) / turnDur, 0, 1);
              rx = pt.x;
              ry = pt.y;
              rz = pt.z;
              rYaw = THREE.MathUtils.lerp(Math.PI, 0, u);
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
        } else {
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
            animMode = p.effectState;
            if (p.effectState === 'boost') {
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
          entry.rig.headGroup.rotation.x += ceremonyBowAmount * 0.44;
          entry.rig.bodyPivot.rotation.x += ceremonyBowAmount * 0.12;
        }

        if (p.id === localIdRef.current) {
          localTarget = {
            pose,
            effect: p.effectState,
            finished: Boolean(p.finishedAt),
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

      // Update Upper-Side Stadium Digital Jumbotron with Live Runner Ranking Board (throttled ~2.5Hz for zero GPU stutter)
      if (lastJumbotronUpdateAt < 0 || elapsed - lastJumbotronUpdateAt >= 0.38) {
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

      // Smooth dual-damped camera choreography around the Oval Stadium
      const startPose = finishPose;
      let camDamp = 6.0;

      if (showcaseMode) {
        const camOrbitAngle = elapsed * 0.12 - 0.52;
        _camDesired.set(Math.sin(camOrbitAngle) * 515, 112, Math.cos(camOrbitAngle) * 335);
        _camTarget.set(0, 16, 0);
        camDamp = 3.2;
      } else if (status === 'waiting') {
        _camDesired.set(startPose.x - 30 + Math.sin(elapsed * 0.25) * 6, 12.5, startPose.z + 17);
        _camTarget.set(startPose.x + 14, 3.0, startPose.z - 2);
        camDamp = 4.0;
      } else if (status === 'countdown') {
        const focus = localTarget ? localTarget.pose : startPose;
        _camDesired.set(focus.x - focus.fx * 7.4, 3.6, focus.z - focus.fz * 7.4 + 1.8);
        _camTarget.set(focus.x + focus.fx * 5.0, -0.7, focus.z + focus.fz * 5.0);
        camDamp = 6.5;
      } else if (inCeremony) {
        if (medalStage && medalStage.focusPoint && medalStage.phase !== 'complete') {
          const sideOffset = medalStage.activeRank === 2 ? 2.6 : -2.6;
          _camDesired.set(
            medalStage.focusPoint.x + sideOffset,
            medalStage.focusPoint.y + 1.05,
            medalStage.focusPoint.z + 6.4
          );
          _camTarget.set(
            medalStage.focusPoint.x,
            medalStage.focusPoint.y - 0.05,
            medalStage.focusPoint.z
          );
          camDamp = 3.8;
        } else {
          const heroZoom = THREE.MathUtils.clamp((ceremonyElapsed - 1.2) / 2.6, 0, 1);
          const sway = Math.sin(ceremonyElapsed * 0.36) * 2.8;
          _camDesired.set(
            0.3 + sway * heroZoom,
            THREE.MathUtils.lerp(6.2, 4.4, heroZoom),
            THREE.MathUtils.lerp(20.5, 13.8, heroZoom)
          );
          _camTarget.set(0.3, THREE.MathUtils.lerp(1.7, 2.35, heroZoom), THREE.MathUtils.lerp(5.5, -0.5, heroZoom));
          camDamp = 4.0;
        }
      } else if (presetRef.current === 'finish' || localTarget?.finished) {
        const focus = localTarget?.finished ? localTarget.pose : startPose;
        _camDesired.set(
          focus.x + focus.fx * 9 + Math.sin(elapsed * 0.6) * 4,
          4.5,
          focus.z + focus.fz * 9 + 5
        );
        _camTarget.set(focus.x, 1.4, focus.z);
        camDamp = 4.5;
      } else if (presetRef.current === 'broadcast') {
        const focus = leaderPose || startPose;
        _camDesired.set(focus.x * 0.65, 78, focus.z * 0.65);
        _camTarget.set(focus.x, 1.5, focus.z);
        camDamp = 4.2;
      } else {
        const targetRunner = localTarget
          ? localTarget
          : leaderPose
          ? { pose: leaderPose, effect: leaderPlayer?.effectState || 'normal' }
          : { pose: startPose, effect: 'normal' };

        const targetFov = targetRunner.effect === 'boost' ? 65 : targetRunner.effect === 'penalty' ? 50 : 56;
        if (Math.abs(camera.fov - targetFov) > 0.08) {
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 6, dt);
          camera.updateProjectionMatrix();
        }

        const p = targetRunner.pose;
        _camDesired.set(p.x - p.fx * 9.4, 4.35, p.z - p.fz * 9.4);
        _camTarget.set(p.x + p.fx * 4.2, -1.65, p.z + p.fz * 4.2);
        camDamp = 9.0;
      }

      const camAlpha = 1 - Math.exp(-camDamp * dt);
      camera.position.lerp(_camDesired, camAlpha);
      camLookCurrent.lerp(_camTarget, camAlpha);
      camera.lookAt(camLookCurrent);

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
      unsubscribeLed();
      presenterRig.dispose();
      for (const entry of runnerMap.values()) {
        entry.wornMedal?.dispose();
        entry.rig.dispose();
      }
      runnerMap.clear();
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
  }, [questionCount, showcaseMode]);

  return <div ref={mountRef} className="w-full h-full relative overflow-hidden" />;
});
