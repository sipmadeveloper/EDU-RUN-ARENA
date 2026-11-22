import type { RunnerEffectState } from '../types/game';

export interface PositionSyncSnapshot {
  distance: number;
  progress: number;
  speed: number;
  effectState: RunnerEffectState;
  effectExpiresAt: number;
  lastSyncMs: number;
}

export interface PositionRateLimitConfig {
  /** Minimum interval between position-only Firestore writes per participant (ms). */
  minIntervalMs: number;
  /** Maximum position-only Firestore writes per minute per participant (token-bucket refill rate). */
  maxWritesPerMinute: number;
  /** Token-bucket burst capacity. */
  burstCapacity: number;
  /** Minimum distance change (meters) required to trigger a position write. */
  minDistanceDelta: number;
  /** Minimum normalized progress change (0..1) required to trigger a position write. */
  minProgressDelta: number;
  /** Minimum speed change (m/s) required to trigger a position write. */
  minSpeedDelta: number;
  /** Maximum adaptive backoff interval (ms) when transient rate/network errors occur. */
  maxBackoffMs: number;
}

export const POSITION_RATE_LIMIT_CONFIG: Readonly<PositionRateLimitConfig> = Object.freeze({
  minIntervalMs: 2500,
  maxWritesPerMinute: 20,
  burstCapacity: 2,
  minDistanceDelta: 1.5,
  minProgressDelta: 0.004,
  minSpeedDelta: 0.25,
  maxBackoffMs: 10000,
});

export type RateLimitScheduleResult =
  | 'sent'
  | 'coalesced'
  | 'suppressed_delta'
  | 'ignored_terminal';

interface ParticipantLimiterState {
  lastCommitted: PositionSyncSnapshot | null;
  lastWriteAtMs: number;
  tokens: number;
  lastRefillAtMs: number;
  inFlight: boolean;
  pending: {
    snapshot: PositionSyncSnapshot;
    commitFn: (snapshot: PositionSyncSnapshot) => Promise<void>;
  } | null;
  timerId: ReturnType<typeof setTimeout> | null;
  consecutiveErrors: number;
  terminal: boolean;
}

const limiterByKey = new Map<string, ParticipantLimiterState>();

function makeKey(roomCode: string, participantId: string): string {
  return `${roomCode.trim().toUpperCase()}:${participantId}`;
}

function getOrCreateState(key: string, nowMs: number): ParticipantLimiterState {
  let state = limiterByKey.get(key);
  if (!state) {
    state = {
      lastCommitted: null,
      lastWriteAtMs: 0,
      tokens: POSITION_RATE_LIMIT_CONFIG.burstCapacity,
      lastRefillAtMs: nowMs,
      inFlight: false,
      pending: null,
      timerId: null,
      consecutiveErrors: 0,
      terminal: false,
    };
    limiterByKey.set(key, state);
  }
  return state;
}

function refillTokens(state: ParticipantLimiterState, nowMs: number): void {
  const elapsedMs = Math.max(0, nowMs - state.lastRefillAtMs);
  if (elapsedMs <= 0) return;
  const refillPerMs = POSITION_RATE_LIMIT_CONFIG.maxWritesPerMinute / 60000;
  state.tokens = Math.min(
    POSITION_RATE_LIMIT_CONFIG.burstCapacity,
    state.tokens + elapsedMs * refillPerMs
  );
  state.lastRefillAtMs = nowMs;
}

function getEffectiveIntervalMs(state: ParticipantLimiterState): number {
  const { minIntervalMs, maxBackoffMs } = POSITION_RATE_LIMIT_CONFIG;
  if (state.consecutiveErrors <= 0) return minIntervalMs;
  const scaled = Math.round(minIntervalMs * Math.pow(1.6, Math.min(state.consecutiveErrors, 4)));
  return Math.min(maxBackoffMs, scaled);
}

function computeRequiredWaitMs(state: ParticipantLimiterState, nowMs: number): number {
  refillTokens(state, nowMs);
  const effectiveInterval = getEffectiveIntervalMs(state);
  const cooldownWait =
    state.lastWriteAtMs > 0 ? Math.max(0, state.lastWriteAtMs + effectiveInterval - nowMs) : 0;
  const tokenWait =
    state.tokens >= 1
      ? 0
      : Math.ceil(
          ((1 - state.tokens) * 60000) / Math.max(1, POSITION_RATE_LIMIT_CONFIG.maxWritesPerMinute)
        );
  return Math.max(cooldownWait, tokenWait);
}

export function hasMeaningfulPositionDelta(
  prev: PositionSyncSnapshot | null,
  next: PositionSyncSnapshot
): boolean {
  const { minDistanceDelta, minProgressDelta, minSpeedDelta } = POSITION_RATE_LIMIT_CONFIG;
  if (!prev) {
    return (
      next.distance >= minDistanceDelta ||
      next.progress >= minProgressDelta ||
      next.effectState !== 'normal'
    );
  }
  if (prev.effectState !== next.effectState) {
    return true;
  }
  if (Math.abs(next.distance - prev.distance) >= minDistanceDelta) {
    return true;
  }
  if (Math.abs(next.progress - prev.progress) >= minProgressDelta) {
    return true;
  }
  if (Math.abs(next.speed - prev.speed) >= minSpeedDelta) {
    return true;
  }
  return false;
}

function scheduleTrailingTimer(key: string, state: ParticipantLimiterState, delayMs: number): void {
  if (state.timerId !== null || state.terminal) return;
  const wait = Math.max(50, Math.round(delayMs));
  state.timerId = setTimeout(() => {
    state.timerId = null;
    if (state.terminal || state.inFlight || !state.pending) return;

    const current = limiterByKey.get(key);
    if (current !== state) return;

    const pending = state.pending;
    if (!hasMeaningfulPositionDelta(state.lastCommitted, pending.snapshot)) {
      state.pending = null;
      return;
    }

    const now = Date.now();
    const remainingWait = computeRequiredWaitMs(state, now);
    if (remainingWait > 0) {
      scheduleTrailingTimer(key, state, remainingWait);
      return;
    }

    state.pending = null;
    void executeWrite(key, state, pending.snapshot, pending.commitFn);
  }, wait);
}

async function executeWrite(
  key: string,
  state: ParticipantLimiterState,
  snapshot: PositionSyncSnapshot,
  commitFn: (snapshot: PositionSyncSnapshot) => Promise<void>
): Promise<void> {
  if (state.terminal) return;

  const startMs = Date.now();
  refillTokens(state, startMs);
  state.tokens = Math.max(0, state.tokens - 1);
  state.inFlight = true;
  state.lastWriteAtMs = startMs;

  try {
    await commitFn(snapshot);
    const doneMs = Date.now();
    // Only record committed snapshot if not superseded by a newer authoritative write
    if (!state.terminal && (!state.lastCommitted || snapshot.lastSyncMs >= state.lastCommitted.lastSyncMs)) {
      state.lastCommitted = snapshot;
    }
    state.consecutiveErrors = 0;
    state.lastWriteAtMs = Math.max(state.lastWriteAtMs, doneMs);
  } catch {
    state.consecutiveErrors = Math.min(6, state.consecutiveErrors + 1);
    state.lastWriteAtMs = Math.max(state.lastWriteAtMs, Date.now());
  } finally {
    state.inFlight = false;
    const current = limiterByKey.get(key);
    if (current === state && !state.terminal && state.pending) {
      if (!hasMeaningfulPositionDelta(state.lastCommitted, state.pending.snapshot)) {
        state.pending = null;
      } else {
        const nextWait = computeRequiredWaitMs(state, Date.now());
        scheduleTrailingTimer(key, state, nextWait);
      }
    }
  }
}

/**
 * Schedules a character position update to Firebase subject to strict per-participant rate limiting:
 * - Delta deduplication (skips no-op or sub-threshold movement)
 * - Minimum cooldown interval + token-bucket cap (reduces write traffic & server load)
 * - Trailing-edge coalescing (merges burst updates into a single latest Firestore write)
 * - Single-flight serialization & adaptive error backoff
 */
export function scheduleRateLimitedPositionWrite(
  roomCode: string,
  participantId: string,
  snapshot: PositionSyncSnapshot,
  commitFn: (snapshot: PositionSyncSnapshot) => Promise<void>
): RateLimitScheduleResult {
  const key = makeKey(roomCode, participantId);
  const now = Date.now();
  const state = getOrCreateState(key, now);

  if (state.terminal) {
    return 'ignored_terminal';
  }

  if (!hasMeaningfulPositionDelta(state.lastCommitted, snapshot)) {
    return 'suppressed_delta';
  }

  const waitMs = computeRequiredWaitMs(state, now);
  if (state.inFlight || waitMs > 0) {
    state.pending = { snapshot, commitFn };
    if (!state.inFlight) {
      scheduleTrailingTimer(key, state, waitMs);
    }
    return 'coalesced';
  }

  if (state.timerId !== null) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.pending = null;
  void executeWrite(key, state, snapshot, commitFn);
  return 'sent';
}

/**
 * Records an authoritative participant write (join, quiz answer, or finish) so:
 * 1. Any deferred position-only write is immediately cancelled (prevents stale overwrites).
 * 2. The rate-limit cooldown resets from this write (prevents redundant double-writes).
 * 3. When `terminal: true`, further position-only writes are permanently halted.
 */
export function markAuthoritativeParticipantWrite(
  roomCode: string,
  participantId: string,
  snapshot: PositionSyncSnapshot,
  options?: { terminal?: boolean }
): void {
  const key = makeKey(roomCode, participantId);
  const now = Date.now();
  const state = getOrCreateState(key, now);

  if (state.timerId !== null) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.pending = null;
  state.lastCommitted = snapshot;
  state.lastWriteAtMs = now;
  state.consecutiveErrors = 0;
  if (options?.terminal) {
    state.terminal = true;
  }
}

/**
 * Cancels any pending position sync timer and cleans up limiter state for a participant.
 */
export function cancelParticipantPositionSync(roomCode: string, participantId: string): void {
  const key = makeKey(roomCode, participantId);
  const state = limiterByKey.get(key);
  if (!state) return;
  if (state.timerId !== null) {
    clearTimeout(state.timerId);
    state.timerId = null;
  }
  state.pending = null;
  limiterByKey.delete(key);
}

/**
 * Clears all rate-limiter timers and state belonging to a room (e.g. when match finishes).
 */
export function clearRoomPositionSync(roomCode: string): void {
  const prefix = `${roomCode.trim().toUpperCase()}:`;
  for (const [key, state] of limiterByKey) {
    if (key.startsWith(prefix)) {
      if (state.timerId !== null) {
        clearTimeout(state.timerId);
        state.timerId = null;
      }
      state.pending = null;
      limiterByKey.delete(key);
    }
  }
}
