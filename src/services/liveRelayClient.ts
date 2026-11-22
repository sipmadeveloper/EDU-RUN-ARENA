import type { AvatarConfig } from '../types/game';

export interface LiveRelayRoomPatch {
  status?: 'waiting' | 'countdown' | 'playing' | 'finished';
  countdownStartMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
  participantCount?: number;
  musicTrack?: 'semangat_juara' | 'lari_ceria' | 'turbo_arena';
  updatedAtMs?: number;
}

export interface LiveRelayParticipantPatch {
  id: string;
  roomCode: string;
  name?: string;
  className?: string;
  avatar?: AvatarConfig;
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

interface RoomListener {
  roomCode: string;
  onRoomPatch?: (patch: LiveRelayRoomPatch) => void;
  onParticipantPatch?: (patch: LiveRelayParticipantPatch) => void;
  onClockSample?: (offsetMs: number, rttMs: number) => void;
}

const listenersByRoom = new Map<string, Set<RoomListener>>();
const outboundQueue: string[] = [];
const MAX_OUTBOUND_QUEUE = 40;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let reconnectAttempt = 0;
let networkHooksRegistered = false;
let clockCallbackGlobal: ((offsetMs: number, rttMs: number) => void) | null = null;

function buildWsUrl(): string | null {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return null;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function sendRaw(serialized: string, queueIfClosed = false) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(serialized);
      return;
    } catch {
      // Fall through to queue
    }
  }
  if (queueIfClosed) {
    outboundQueue.push(serialized);
    if (outboundQueue.length > MAX_OUTBOUND_QUEUE) {
      outboundQueue.shift();
    }
  }
}

function sendClockPing() {
  sendRaw(JSON.stringify({ type: 'live:ping', clientTime: Date.now() }), false);
}

function flushSubscriptionsAndQueue() {
  for (const roomCode of listenersByRoom.keys()) {
    sendRaw(JSON.stringify({ type: 'live:subscribe', roomCode }), false);
  }
  while (outboundQueue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
    const next = outboundQueue.shift();
    if (next) sendRaw(next, false);
  }
  // Fire 3 staggered NTP-style clock pings on connect to lock offset within ~5ms
  sendClockPing();
  window.setTimeout(sendClockPing, 140);
  window.setTimeout(sendClockPing, 320);
}

function scheduleReconnect() {
  if (typeof window === 'undefined') return;
  if (listenersByRoom.size === 0) return;
  if (reconnectTimer !== null) return;
  const delay = Math.min(5000, 600 * Math.pow(1.6, Math.min(reconnectAttempt, 5)));
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    ensureConnected();
  }, delay);
}

function registerNetworkHooks() {
  if (networkHooksRegistered || typeof window === 'undefined') return;
  networkHooksRegistered = true;
  window.addEventListener('online', () => {
    reconnectAttempt = 0;
    if (listenersByRoom.size > 0) {
      ensureConnected();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && listenersByRoom.size > 0) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnectAttempt = 0;
        ensureConnected();
      } else {
        sendClockPing();
      }
    }
  });
}

function ensureConnected() {
  if (typeof window === 'undefined') return;
  registerNetworkHooks();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const url = buildWsUrl();
  if (!url) return;

  try {
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) {
        socket.close();
        return;
      }
      reconnectAttempt = 0;
      flushSubscriptionsAndQueue();
      if (pingTimer !== null) window.clearInterval(pingTimer);
      pingTimer = window.setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN && listenersByRoom.size > 0) {
          sendClockPing();
        }
      }, 20000);
    };

    socket.onmessage = (evt) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(evt.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = String(msg.type || '');

      if (type === 'live:pong') {
        const clientTime = Number(msg.clientTime || 0);
        const serverTime = Number(msg.serverTime || 0);
        if (clientTime > 0 && serverTime > 1_700_000_000_000) {
          const now = Date.now();
          const rtt = now - clientTime;
          if (rtt >= 0 && rtt < 2500) {
            const offset = Math.round(serverTime - (clientTime + rtt * 0.5));
            clockCallbackGlobal?.(offset, rtt);
            for (const set of listenersByRoom.values()) {
              for (const l of set) l.onClockSample?.(offset, rtt);
            }
          }
        }
        return;
      }

      const roomCode = String(msg.roomCode || '').toUpperCase();
      if (!roomCode) return;
      const set = listenersByRoom.get(roomCode);
      if (!set || set.size === 0) return;

      if (type === 'live:subscribed') {
        const rp = msg.roomPatch as LiveRelayRoomPatch | null | undefined;
        const parts = Array.isArray(msg.participants)
          ? (msg.participants as LiveRelayParticipantPatch[])
          : [];
        for (const l of set) {
          if (rp) l.onRoomPatch?.(rp);
          for (const p of parts) l.onParticipantPatch?.(p);
        }
        return;
      }

      if (type === 'live:room_patch' && msg.patch && typeof msg.patch === 'object') {
        const patch = msg.patch as LiveRelayRoomPatch;
        for (const l of set) l.onRoomPatch?.(patch);
        return;
      }

      if (type === 'live:participant_patch' && msg.participant && typeof msg.participant === 'object') {
        const patch = msg.participant as LiveRelayParticipantPatch;
        for (const l of set) l.onParticipantPatch?.(patch);
      }
    };

    socket.onclose = () => {
      if (ws === socket) {
        ws = null;
      }
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
      // Quietly fall back to Firestore; onclose triggers exponential backoff reconnect
    };
  } catch {
    scheduleReconnect();
  }
}

export function setGlobalRelayClockHandler(cb: (offsetMs: number, rttMs: number) => void) {
  clockCallbackGlobal = cb;
}

const POSITION_RELAY_MIN_INTERVAL_MS = 250;

interface RelayPositionThrottleEntry {
  lastSentAtMs: number;
  pending: LiveRelayParticipantPatch | null;
  timerId: number | null;
}

const relayPositionThrottle = new Map<string, RelayPositionThrottleEntry>();

function isCriticalParticipantPatch(patch: LiveRelayParticipantPatch): boolean {
  return (
    patch.name !== undefined ||
    patch.lane !== undefined ||
    patch.avatar !== undefined ||
    patch.answeredCount !== undefined ||
    patch.currentQuestionIndex !== undefined ||
    patch.score !== undefined ||
    patch.finishedAt !== undefined ||
    patch.finishRank !== undefined ||
    patch.scoreRank !== undefined ||
    patch.joinedAtMs !== undefined ||
    patch.effectState === 'finished'
  );
}

function clearRelayPositionThrottlesForRoom(code: string) {
  const prefix = `${code}:`;
  for (const [key, entry] of relayPositionThrottle) {
    if (key.startsWith(prefix)) {
      if (entry.timerId !== null && typeof window !== 'undefined') {
        window.clearTimeout(entry.timerId);
      }
      relayPositionThrottle.delete(key);
    }
  }
}

export function subscribeRelayRoom(
  roomCode: string,
  handlers: {
    onRoomPatch?: (patch: LiveRelayRoomPatch) => void;
    onParticipantPatch?: (patch: LiveRelayParticipantPatch) => void;
    onClockSample?: (offsetMs: number, rttMs: number) => void;
  }
): () => void {
  const code = roomCode.trim().toUpperCase();
  const listener: RoomListener = {
    roomCode: code,
    ...handlers,
  };

  let set = listenersByRoom.get(code);
  const isFirstForRoom = !set;
  if (!set) {
    set = new Set();
    listenersByRoom.set(code, set);
  }
  set.add(listener);

  ensureConnected();
  if (isFirstForRoom && ws && ws.readyState === WebSocket.OPEN) {
    sendRaw(JSON.stringify({ type: 'live:subscribe', roomCode: code }), false);
  }

  return () => {
    const currentSet = listenersByRoom.get(code);
    if (!currentSet) return;
    currentSet.delete(listener);
    if (currentSet.size === 0) {
      listenersByRoom.delete(code);
      clearRelayPositionThrottlesForRoom(code);
      sendRaw(JSON.stringify({ type: 'live:unsubscribe', roomCode: code }), false);
    }
    if (listenersByRoom.size === 0) {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    }
  };
}

export function publishRelayRoomPatch(roomCode: string, patch: LiveRelayRoomPatch) {
  const code = roomCode.trim().toUpperCase();
  if (code.length !== 6) return;
  ensureConnected();
  sendRaw(
    JSON.stringify({
      type: 'live:room_patch',
      roomCode: code,
      patch,
    }),
    true
  );
}

function transmitRelayParticipantPatch(code: string, participant: LiveRelayParticipantPatch) {
  ensureConnected();
  // Strip any accidental sensitive keys before wire transmission
  const safePatch: LiveRelayParticipantPatch = {
    id: participant.id,
    roomCode: code,
    name: participant.name,
    className: participant.className,
    avatar: participant.avatar,
    lane: participant.lane,
    distance: participant.distance,
    progress: participant.progress,
    speed: participant.speed,
    effectState: participant.effectState,
    effectExpiresAt: participant.effectExpiresAt,
    currentQuestionIndex: participant.currentQuestionIndex,
    answeredCount: participant.answeredCount,
    correctCount: participant.correctCount,
    wrongCount: participant.wrongCount,
    unansweredCount: participant.unansweredCount,
    score: participant.score,
    connected: participant.connected,
    joinedAtMs: participant.joinedAtMs,
    startedAt: participant.startedAt,
    finishedAt: participant.finishedAt,
    durationMs: participant.durationMs,
    finishRank: participant.finishRank,
    scoreRank: participant.scoreRank,
    lastSyncMs: participant.lastSyncMs,
  };
  sendRaw(
    JSON.stringify({
      type: 'live:participant_patch',
      roomCode: code,
      participant: safePatch,
    }),
    true
  );
}

export function publishRelayParticipantPatch(
  roomCode: string,
  participant: LiveRelayParticipantPatch
) {
  const code = roomCode.trim().toUpperCase();
  if (code.length !== 6) return;

  const key = `${code}:${participant.id}`;
  const now = Date.now();
  let entry = relayPositionThrottle.get(key);
  if (!entry) {
    entry = { lastSentAtMs: 0, pending: null, timerId: null };
    relayPositionThrottle.set(key, entry);
  }

  // Critical authoritative events (join, answer, finish, rank) bypass throttling immediately
  if (isCriticalParticipantPatch(participant)) {
    if (entry.timerId !== null && typeof window !== 'undefined') {
      window.clearTimeout(entry.timerId);
      entry.timerId = null;
    }
    entry.pending = null;
    entry.lastSentAtMs = now;
    transmitRelayParticipantPatch(code, participant);
    return;
  }

  // Position-only telemetry patches are rate-limited & trailing-coalesced per participant
  const elapsed = now - entry.lastSentAtMs;
  if (elapsed >= POSITION_RELAY_MIN_INTERVAL_MS && entry.timerId === null) {
    entry.lastSentAtMs = now;
    entry.pending = null;
    transmitRelayParticipantPatch(code, participant);
    return;
  }

  entry.pending = participant;
  if (entry.timerId === null && typeof window !== 'undefined') {
    const waitMs = Math.max(40, POSITION_RELAY_MIN_INTERVAL_MS - elapsed);
    entry.timerId = window.setTimeout(() => {
      const current = relayPositionThrottle.get(key);
      if (!current) return;
      current.timerId = null;
      const next = current.pending;
      current.pending = null;
      if (next) {
        current.lastSentAtMs = Date.now();
        transmitRelayParticipantPatch(code, next);
      }
    }, waitMs);
  }
}
