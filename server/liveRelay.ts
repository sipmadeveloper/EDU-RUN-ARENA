import type { WebSocket } from 'ws';

export interface RelayRoomPatch {
  status?: 'waiting' | 'countdown' | 'playing' | 'finished';
  countdownStartMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  participantCount?: number;
  updatedAtMs: number;
}

export interface RelayParticipantPatch {
  id: string;
  roomCode: string;
  name?: string;
  className?: string;
  avatar?: {
    gender: 'male' | 'female';
    color: string;
    outfit: string;
    presetId?: string;
  };
  lane?: number;
  distance?: number;
  progress?: number;
  speed?: number;
  effectState?: 'normal' | 'boost' | 'penalty' | 'finished';
  effectExpiresAt?: number;
  currentQuestionIndex?: number;
  answeredCount?: number;
  correctCount?: number;
  wrongCount?: number;
  unansweredCount?: number;
  score?: number;
  connected?: boolean;
  joinedAtMs?: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  finishRank?: number;
  scoreRank?: number;
  lastSyncMs: number;
}

interface RelayChannel {
  roomCode: string;
  sockets: Set<WebSocket>;
  roomPatch: RelayRoomPatch | null;
  participants: Map<string, RelayParticipantPatch>;
  lastPositionFanoutAt: Map<string, number>;
  lastActivityAt: number;
}

const STATUS_RANK: Record<string, number> = {
  waiting: 0,
  countdown: 1,
  playing: 2,
  finished: 3,
};

const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_CHANNELS = 500;
const CHANNEL_IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX_MSGS = 45;
const PARTICIPANT_POSITION_FANOUT_MIN_MS = 180;

const channels = new Map<string, RelayChannel>();
let cleanupInterval: NodeJS.Timeout | null = null;

function normalizeCode(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function clampNum(val: unknown, min: number, max: number): number | undefined {
  if (val === undefined || val === null) return undefined;
  const n = Number(val);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
}

function sanitizeRoomPatch(raw: unknown): RelayRoomPatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const patch: RelayRoomPatch = {
    updatedAtMs: Date.now(),
  };

  if (
    obj.status === 'waiting' ||
    obj.status === 'countdown' ||
    obj.status === 'playing' ||
    obj.status === 'finished'
  ) {
    patch.status = obj.status;
  }

  const countdownStartMs = clampNum(obj.countdownStartMs, 0, 9e15);
  if (countdownStartMs !== undefined) patch.countdownStartMs = Math.round(countdownStartMs);

  const startedAtMs = clampNum(obj.startedAtMs, 0, 9e15);
  if (startedAtMs !== undefined) patch.startedAtMs = Math.round(startedAtMs);

  const finishedAtMs = clampNum(obj.finishedAtMs, 0, 9e15);
  if (finishedAtMs !== undefined) patch.finishedAtMs = Math.round(finishedAtMs);

  const participantCount = clampNum(obj.participantCount, 0, 30);
  if (participantCount !== undefined) patch.participantCount = Math.round(participantCount);

  return patch;
}

function sanitizeParticipantPatch(roomCode: string, raw: unknown): RelayParticipantPatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = String(obj.id || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  if (!id) return null;

  const patch: RelayParticipantPatch = {
    id,
    roomCode,
    lastSyncMs: Math.round(clampNum(obj.lastSyncMs, 0, 9e15) ?? Date.now()),
  };

  if (typeof obj.name === 'string' && obj.name.trim()) {
    patch.name = obj.name.trim().slice(0, 40);
  }
  if (typeof obj.className === 'string' && obj.className.trim()) {
    patch.className = obj.className.trim().slice(0, 24);
  }
  if (obj.avatar && typeof obj.avatar === 'object') {
    const av = obj.avatar as Record<string, unknown>;
    patch.avatar = {
      gender: av.gender === 'female' ? 'female' : 'male',
      color: String(av.color || 'blue').slice(0, 24),
      outfit: String(av.outfit || 'sprinter').slice(0, 24),
      ...(typeof av.presetId === 'string' && av.presetId
        ? { presetId: av.presetId.slice(0, 32) }
        : {}),
    };
  }

  const lane = clampNum(obj.lane, 0, 30);
  if (lane !== undefined) patch.lane = Math.round(lane);

  const distance = clampNum(obj.distance, 0, 50000);
  if (distance !== undefined) patch.distance = Number(distance.toFixed(2));

  const progress = clampNum(obj.progress, 0, 1);
  if (progress !== undefined) patch.progress = Number(progress.toFixed(6));

  const speed = clampNum(obj.speed, 0, 100);
  if (speed !== undefined) patch.speed = Number(speed.toFixed(2));

  if (
    obj.effectState === 'normal' ||
    obj.effectState === 'boost' ||
    obj.effectState === 'penalty' ||
    obj.effectState === 'finished'
  ) {
    patch.effectState = obj.effectState;
  }

  const effectExpiresAt = clampNum(obj.effectExpiresAt, 0, 9e15);
  if (effectExpiresAt !== undefined) patch.effectExpiresAt = Math.round(effectExpiresAt);

  const currentQuestionIndex = clampNum(obj.currentQuestionIndex, 0, 50);
  if (currentQuestionIndex !== undefined) patch.currentQuestionIndex = Math.round(currentQuestionIndex);

  const answeredCount = clampNum(obj.answeredCount, 0, 50);
  if (answeredCount !== undefined) patch.answeredCount = Math.round(answeredCount);

  const correctCount = clampNum(obj.correctCount, 0, 50);
  if (correctCount !== undefined) patch.correctCount = Math.round(correctCount);

  const wrongCount = clampNum(obj.wrongCount, 0, 50);
  if (wrongCount !== undefined) patch.wrongCount = Math.round(wrongCount);

  const unansweredCount = clampNum(obj.unansweredCount, 0, 50);
  if (unansweredCount !== undefined) patch.unansweredCount = Math.round(unansweredCount);

  const score = clampNum(obj.score, 0, 100);
  if (score !== undefined) patch.score = Number(score.toFixed(2));

  if (typeof obj.connected === 'boolean') patch.connected = obj.connected;

  const joinedAtMs = clampNum(obj.joinedAtMs, 0, 9e15);
  if (joinedAtMs !== undefined) patch.joinedAtMs = Math.round(joinedAtMs);

  const startedAt = clampNum(obj.startedAt, 0, 9e15);
  if (startedAt !== undefined) patch.startedAt = Math.round(startedAt);

  const finishedAt = clampNum(obj.finishedAt, 0, 9e15);
  if (finishedAt !== undefined) patch.finishedAt = Math.round(finishedAt);

  const durationMs = clampNum(obj.durationMs, 0, 9e12);
  if (durationMs !== undefined) patch.durationMs = Math.round(durationMs);

  const finishRank = clampNum(obj.finishRank, 0, 30);
  if (finishRank !== undefined) patch.finishRank = Math.round(finishRank);

  const scoreRank = clampNum(obj.scoreRank, 0, 30);
  if (scoreRank !== undefined) patch.scoreRank = Math.round(scoreRank);

  return patch;
}

function mergeRoomPatch(prev: RelayRoomPatch | null, next: RelayRoomPatch): RelayRoomPatch {
  if (!prev) return next;
  const prevRank = prev.status ? STATUS_RANK[prev.status] ?? 0 : 0;
  const nextRank = next.status ? STATUS_RANK[next.status] ?? 0 : prevRank;
  const status = nextRank >= prevRank ? next.status ?? prev.status : prev.status;

  return {
    status,
    countdownStartMs: next.countdownStartMs ?? prev.countdownStartMs,
    startedAtMs: next.startedAtMs ?? prev.startedAtMs,
    finishedAtMs: next.finishedAtMs ?? prev.finishedAtMs,
    participantCount: Math.max(prev.participantCount ?? 0, next.participantCount ?? 0),
    updatedAtMs: Math.max(prev.updatedAtMs, next.updatedAtMs),
  };
}

function mergeParticipantPatch(
  prev: RelayParticipantPatch | undefined,
  next: RelayParticipantPatch
): RelayParticipantPatch {
  if (!prev) return next;
  const prevFinished = (prev.finishedAt ?? 0) > 0;
  const nextFinished = (next.finishedAt ?? 0) > 0;
  if (prevFinished && !nextFinished) {
    return { ...prev, connected: next.connected ?? prev.connected };
  }
  const prevAns = prev.answeredCount ?? 0;
  const nextAns = next.answeredCount ?? prevAns;
  if (!nextFinished && nextAns < prevAns) {
    return prev;
  }
  if (!nextFinished && nextAns === prevAns && next.lastSyncMs < prev.lastSyncMs) {
    return prev;
  }
  return {
    ...prev,
    ...next,
    joinedAtMs: prev.joinedAtMs ?? next.joinedAtMs,
    avatar: next.avatar ?? prev.avatar,
  };
}

function getOrCreateChannel(roomCode: string): RelayChannel {
  let ch = channels.get(roomCode);
  if (!ch) {
    if (channels.size >= MAX_CHANNELS) {
      // Evict oldest inactive channel to bound memory strictly
      let oldestCode: string | null = null;
      let oldestTime = Infinity;
      for (const [code, c] of channels) {
        if (c.sockets.size === 0 && c.lastActivityAt < oldestTime) {
          oldestTime = c.lastActivityAt;
          oldestCode = code;
        }
      }
      if (oldestCode) channels.delete(oldestCode);
    }
    ch = {
      roomCode,
      sockets: new Set(),
      roomPatch: null,
      participants: new Map(),
      lastPositionFanoutAt: new Map(),
      lastActivityAt: Date.now(),
    };
    channels.set(roomCode, ch);
  }
  ch.lastActivityAt = Date.now();
  return ch;
}

function safeSend(ws: WebSocket, serialized: string, dropOnBackpressure = false) {
  if (ws.readyState !== 1) return;
  if (dropOnBackpressure && ws.bufferedAmount >= MAX_BUFFERED_BYTES) return;
  try {
    ws.send(serialized);
  } catch {
    // Ignore transient send errors on closing sockets
  }
}

function fanout(channel: RelayChannel, payload: unknown, exclude?: WebSocket) {
  if (channel.sockets.size === 0) return;
  const msg = JSON.stringify(payload);
  for (const sock of channel.sockets) {
    if (sock === exclude) continue;
    safeSend(sock, msg, true);
  }
}

export function startLiveRelayCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const cutoff = Date.now() - CHANNEL_IDLE_TTL_MS;
    for (const [code, ch] of channels) {
      if (ch.sockets.size === 0 && ch.lastActivityAt < cutoff) {
        channels.delete(code);
      }
    }
  }, 10 * 60 * 1000);
  cleanupInterval.unref?.();
}

export function stopLiveRelayCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  channels.clear();
}

export function getLiveRelayStats() {
  let activeSockets = 0;
  for (const ch of channels.values()) {
    activeSockets += ch.sockets.size;
  }
  return {
    activeChannels: channels.size,
    activeSockets,
  };
}

/**
 * Attaches ultra-low-latency `live:*` message handlers to a WebSocket connection.
 * Coexists cleanly with existing legacy gameManager WS message types.
 */
export function attachLiveRelaySocket(ws: WebSocket) {
  const subscribedCodes = new Set<string>();
  let windowStart = Date.now();
  let windowCount = 0;

  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - windowStart >= RATE_LIMIT_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > RATE_LIMIT_MAX_MSGS) {
      return;
    }

    let msg: Record<string, unknown>;
    try {
      const str = typeof raw === 'string' ? raw : raw.toString();
      if (!str.includes('"live:')) return;
      msg = JSON.parse(str) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(msg.type || '');
    if (!type.startsWith('live:')) return;

    if (type === 'live:ping') {
      safeSend(
        ws,
        JSON.stringify({
          type: 'live:pong',
          clientTime: Number(msg.clientTime || 0),
          serverTime: Date.now(),
        })
      );
      return;
    }

    if (type === 'live:subscribe') {
      const code = normalizeCode(msg.roomCode);
      if (code.length !== 6) return;
      const ch = getOrCreateChannel(code);
      ch.sockets.add(ws);
      subscribedCodes.add(code);

      safeSend(
        ws,
        JSON.stringify({
          type: 'live:subscribed',
          roomCode: code,
          serverTime: Date.now(),
          roomPatch: ch.roomPatch,
          participants: Array.from(ch.participants.values()),
        })
      );
      return;
    }

    if (type === 'live:unsubscribe') {
      const code = normalizeCode(msg.roomCode);
      if (!code) return;
      subscribedCodes.delete(code);
      const ch = channels.get(code);
      if (ch) ch.sockets.delete(ws);
      return;
    }

    if (type === 'live:room_patch') {
      const code = normalizeCode(msg.roomCode);
      if (code.length !== 6) return;
      const patch = sanitizeRoomPatch(msg.patch);
      if (!patch) return;
      const ch = getOrCreateChannel(code);
      ch.roomPatch = mergeRoomPatch(ch.roomPatch, patch);
      fanout(
        ch,
        {
          type: 'live:room_patch',
          roomCode: code,
          patch: ch.roomPatch,
          serverTime: Date.now(),
        },
        ws
      );
      return;
    }

    if (type === 'live:participant_patch') {
      const code = normalizeCode(msg.roomCode);
      if (code.length !== 6) return;
      const patch = sanitizeParticipantPatch(code, msg.participant);
      if (!patch) return;
      const ch = getOrCreateChannel(code);
      const prev = ch.participants.get(patch.id);
      const isCritical =
        !prev ||
        patch.name !== undefined ||
        patch.lane !== undefined ||
        patch.avatar !== undefined ||
        (patch.answeredCount !== undefined && patch.answeredCount > (prev.answeredCount ?? 0)) ||
        (patch.finishedAt !== undefined && patch.finishedAt > 0 && !(prev.finishedAt && prev.finishedAt > 0)) ||
        patch.scoreRank !== undefined ||
        patch.joinedAtMs !== undefined ||
        patch.effectState === 'finished';

      const merged = mergeParticipantPatch(prev, patch);
      ch.participants.set(patch.id, merged);

      if (!isCritical) {
        const lastFanout = ch.lastPositionFanoutAt.get(patch.id) ?? 0;
        if (now - lastFanout < PARTICIPANT_POSITION_FANOUT_MIN_MS) {
          return;
        }
      }
      ch.lastPositionFanoutAt.set(patch.id, now);

      fanout(
        ch,
        {
          type: 'live:participant_patch',
          roomCode: code,
          participant: merged,
          serverTime: Date.now(),
        },
        ws
      );
      return;
    }
  });

  ws.on('close', () => {
    for (const code of subscribedCodes) {
      const ch = channels.get(code);
      if (ch) {
        ch.sockets.delete(ws);
        ch.lastActivityAt = Date.now();
      }
    }
    subscribedCodes.clear();
  });
}
