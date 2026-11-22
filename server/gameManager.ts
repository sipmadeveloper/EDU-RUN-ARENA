import type { WebSocket, WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { db } from './db.ts';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcScoreFromCorrect,
  calcTotalLaps,
  calcTrackLength,
} from '../src/utils/matchScaling.ts';

export interface ServerAvatarConfig {
  gender: 'male' | 'female';
  color: string;
  outfit: string;
  presetId?: string;
}

export interface ServerRoomSettings {
  questionCount: number;
  maxPlayers: number;
  timePerQuestion: number;
  baseSpeed: number;
  boostDuration: number;
  penaltyDuration: number;
  allowShortAnswer: boolean;
  venue?: 'stadium_night' | 'stadium_day' | 'open_field';
  scheduledAt?: string;
}

export interface ServerQuestion {
  id: string;
  subject: string;
  grade: string;
  questionType: 'multiple_choice' | 'true_false' | 'short_answer';
  prompt: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
}

export interface LiveParticipant {
  id: string;
  reconnectToken: string;
  name: string;
  className: string;
  avatar: ServerAvatarConfig;
  lane: number;
  distance: number;
  progress: number;
  speed: number;
  effectState: 'normal' | 'boost' | 'penalty' | 'finished';
  effectExpiresAt: number;
  currentQuestionIndex: number;
  questionStartedAt: number;
  questionCooldownUntil: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  score: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  finishRank: number | null;
  scoreRank: number | null;
  connected: boolean;
}

export interface LiveRoom {
  id: string;
  code: string;
  teacherId: string;
  teacherName: string;
  schoolName: string;
  name: string;
  subject: string;
  grade: string;
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  settings: ServerRoomSettings;
  questions: ServerQuestion[];
  trackLength: number;
  participants: Map<string, LiveParticipant>;
  studentSockets: Map<string, Set<WebSocket>>;
  teacherSockets: Set<WebSocket>;
  finishCounter: number;
  startedAt: number | null;
  finishedAt: number | null;
  tickTimer: NodeJS.Timeout | null;
  countdownTimer: NodeJS.Timeout | null;
  stateBroadcastTimer: NodeJS.Timeout | null;
  lastTickAt: number;
  dirtyPersist: boolean;
}

const activeRooms = new Map<string, LiveRoom>(); // keyed by roomId

// Cached hot SQLite prepared statements (lazy-initialized after initDatabase runs)
function createHotStmts() {
  return {
    updateParticipant: db.prepare(`
      UPDATE participants SET
        distance = ?, progress = ?, speed = ?, effect_state = ?, effect_expires_at = ?,
        current_question_index = ?, answered_count = ?, correct_count = ?, wrong_count = ?,
        unanswered_count = ?, score = ?, started_at = ?, finished_at = ?, duration_ms = ?,
        finish_rank = ?, score_rank = ?, connected = ?
      WHERE id = ?
    `),
    setConnected: db.prepare('UPDATE participants SET connected = ? WHERE id = ?'),
    checkDupAnswer: db.prepare(
      'SELECT id FROM answers WHERE participant_id = ? AND question_index = ?'
    ),
    insertAnswer: db.prepare(`
      INSERT INTO answers (
        id, room_id, participant_id, question_id, question_index,
        submitted_answer, is_correct, is_timeout, points_earned, response_time_ms, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
  };
}

let cachedStmts: ReturnType<typeof createHotStmts> | null = null;

function getHotStmts() {
  if (!cachedStmts) {
    cachedStmts = createHotStmts();
  }
  return cachedStmts;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeQuestionForClient(q: ServerQuestion, index: number, total: number, timeLimit: number, startedAt: number) {
  return {
    index,
    total,
    id: q.id,
    subject: q.subject,
    questionType: q.questionType,
    prompt: q.prompt,
    options: q.options,
    timeLimit,
    questionStartedAt: startedAt,
  };
}

function loadRoomFromDb(roomIdOrCode: string, byCode = false): LiveRoom | null {
  const row = db
    .prepare(
      `SELECT r.*, t.name as teacher_name, t.school_name as school_name
       FROM rooms r
       JOIN teachers t ON t.id = r.teacher_id
       WHERE ${byCode ? 'UPPER(r.code) = UPPER(?)' : 'r.id = ?'}`
    )
    .get(roomIdOrCode) as Record<string, unknown> | undefined;

  if (!row) return null;

  const existing = activeRooms.get(String(row.id));
  if (existing) return existing;

  const settings = safeJsonParse<ServerRoomSettings>(String(row.settings_json), {
    questionCount: 50,
    maxPlayers: 30,
    timePerQuestion: 20,
    baseSpeed: 3,
    boostDuration: 15,
    penaltyDuration: 30,
    allowShortAnswer: false,
    venue: 'stadium_day',
  });
  if (!settings.venue) settings.venue = 'stadium_day';

  const questionIds = safeJsonParse<string[]>(String(row.question_ids_json), []);
  const questions: ServerQuestion[] = [];
  const getQ = db.prepare('SELECT * FROM questions WHERE id = ?');
  for (const qId of questionIds) {
    const qRow = getQ.get(qId) as Record<string, unknown> | undefined;
    if (qRow) {
      questions.push({
        id: String(qRow.id),
        subject: String(qRow.subject),
        grade: String(qRow.grade),
        questionType: (String(qRow.question_type) as ServerQuestion['questionType']) || 'multiple_choice',
        prompt: String(qRow.prompt),
        options: safeJsonParse(String(qRow.options_json), {}),
        correctAnswer: String(qRow.correct_answer),
        explanation: String(qRow.explanation || ''),
      });
    }
  }

  const partRows = db
    .prepare('SELECT * FROM participants WHERE room_id = ? ORDER BY lane ASC')
    .all(String(row.id)) as Array<Record<string, unknown>>;

  const participants = new Map<string, LiveParticipant>();
  let maxFinishRank = 0;
  for (const p of partRows) {
    const fRank = p.finish_rank != null ? Number(p.finish_rank) : null;
    if (fRank && fRank > maxFinishRank) maxFinishRank = fRank;
    participants.set(String(p.id), {
      id: String(p.id),
      reconnectToken: String(p.reconnect_token),
      name: String(p.name),
      className: String(p.class_name),
      avatar: safeJsonParse<ServerAvatarConfig>(String(p.avatar_json), {
        gender: 'male',
        color: 'blue',
        outfit: 'sprinter',
      }),
      lane: Number(p.lane),
      distance: Number(p.distance),
      progress: Number(p.progress),
      speed: Number(p.speed),
      effectState: (String(p.effect_state) as LiveParticipant['effectState']) || 'normal',
      effectExpiresAt: Number(p.effect_expires_at || 0),
      currentQuestionIndex: Number(p.current_question_index || 0),
      questionStartedAt: Date.now(),
      questionCooldownUntil: 0,
      answeredCount: Number(p.answered_count || 0),
      correctCount: Number(p.correct_count || 0),
      wrongCount: Number(p.wrong_count || 0),
      unansweredCount: Number(p.unanswered_count || 0),
      score: Number(p.score || 0),
      startedAt: p.started_at != null ? Number(p.started_at) : null,
      finishedAt: p.finished_at != null ? Number(p.finished_at) : null,
      durationMs: p.duration_ms != null ? Number(p.duration_ms) : null,
      finishRank: fRank,
      scoreRank: p.score_rank != null ? Number(p.score_rank) : null,
      connected: Boolean(p.connected),
    });
  }

  const room: LiveRoom = {
    id: String(row.id),
    code: String(row.code),
    teacherId: String(row.teacher_id),
    teacherName: String(row.teacher_name),
    schoolName: String(row.school_name),
    name: String(row.name),
    subject: String(row.subject),
    grade: String(row.grade),
    status: (String(row.status) as LiveRoom['status']) || 'waiting',
    settings: {
      ...settings,
      questionCount: questions.length > 0 ? questions.length : settings.questionCount,
    },
    questions,
    trackLength: calcTrackLength(questions.length, settings.baseSpeed),
    participants,
    studentSockets: new Map(),
    teacherSockets: new Set(),
    finishCounter: maxFinishRank,
    startedAt: row.started_at ? new Date(String(row.started_at)).getTime() : null,
    finishedAt: row.finished_at ? new Date(String(row.finished_at)).getTime() : null,
    tickTimer: null,
    countdownTimer: null,
    stateBroadcastTimer: null,
    lastTickAt: Date.now(),
    dirtyPersist: false,
  };

  activeRooms.set(room.id, room);

  if (room.status === 'playing' && !room.tickTimer) {
    startSimulationLoop(room);
  }

  return room;
}

export function getRoomByCode(code: string): LiveRoom | null {
  return loadRoomFromDb(code, true);
}

export function getRoomById(id: string): LiveRoom | null {
  return loadRoomFromDb(id, false);
}

export function invalidateRoomCache(roomId: string) {
  const room = activeRooms.get(roomId);
  if (room) {
    if (room.tickTimer) clearInterval(room.tickTimer);
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    if (room.stateBroadcastTimer) clearTimeout(room.stateBroadcastTimer);
    activeRooms.delete(roomId);
  }
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(room: LiveRoom, payload: unknown, dropIfBackpressured = false) {
  const msg = JSON.stringify(payload);
  const maxBuffered = 64 * 1024;
  for (const sockets of room.studentSockets.values()) {
    for (const ws of sockets) {
      if (ws.readyState === 1 && (!dropIfBackpressured || ws.bufferedAmount < maxBuffered)) {
        ws.send(msg);
      }
    }
  }
  for (const ws of room.teacherSockets) {
    if (ws.readyState === 1 && (!dropIfBackpressured || ws.bufferedAmount < maxBuffered)) {
      ws.send(msg);
    }
  }
}

function scheduleRoomStateBroadcast(room: LiveRoom) {
  if (room.stateBroadcastTimer) return;
  room.stateBroadcastTimer = setTimeout(() => {
    room.stateBroadcastTimer = null;
    broadcastToRoom(room, {
      type: 'room:state',
      room: serializeRoomState(room),
    });
  }, 60);
}

function serializeParticipants(room: LiveRoom) {
  return Array.from(room.participants.values())
    .sort((a, b) => a.lane - b.lane)
    .map((p) => ({
      id: p.id,
      name: p.name,
      className: p.className,
      avatar: p.avatar,
      lane: p.lane,
      distance: Number(p.distance.toFixed(2)),
      progress: Number(p.progress.toFixed(4)),
      speed: Number(p.speed.toFixed(2)),
      effectState: p.effectState,
      effectExpiresAt: p.effectExpiresAt,
      currentQuestionIndex: p.currentQuestionIndex,
      answeredCount: p.answeredCount,
      correctCount: p.correctCount,
      wrongCount: p.wrongCount,
      unansweredCount: p.unansweredCount,
      score: p.score,
      connected: p.connected,
      startedAt: p.startedAt,
      finishedAt: p.finishedAt,
      durationMs: p.durationMs,
      finishRank: p.finishRank,
      scoreRank: p.scoreRank,
    }));
}

function serializeRoomState(room: LiveRoom) {
  return {
    id: room.id,
    code: room.code,
    name: room.name,
    subject: room.subject,
    grade: room.grade,
    teacherName: room.teacherName,
    schoolName: room.schoolName,
    status: room.status,
    settings: room.settings,
    trackLength: room.trackLength,
    questionCount: room.questions.length,
    totalLaps: calcTotalLaps(room.questions.length),
    pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
    maxScore: MAX_MATCH_SCORE,
    startedAt: room.startedAt,
    finishedAt: room.finishedAt,
    participants: serializeParticipants(room),
  };
}

function persistParticipantsToDb(room: LiveRoom) {
  const { updateParticipant } = getHotStmts();
  const tx = db.transaction(() => {
    for (const p of room.participants.values()) {
      updateParticipant.run(
        p.distance,
        p.progress,
        p.speed,
        p.effectState,
        p.effectExpiresAt,
        p.currentQuestionIndex,
        p.answeredCount,
        p.correctCount,
        p.wrongCount,
        p.unansweredCount,
        p.score,
        p.startedAt,
        p.finishedAt,
        p.durationMs,
        p.finishRank,
        p.scoreRank,
        p.connected ? 1 : 0,
        p.id
      );
    }
  });
  tx();
}

export function joinRoomParticipant(
  room: LiveRoom,
  input: {
    name: string;
    className: string;
    avatar: ServerAvatarConfig;
    participantId?: string;
    reconnectToken?: string;
  }
): { participant: LiveParticipant; reconnected: boolean } | { error: string } {
  const cleanName = input.name.trim().slice(0, 40);
  const cleanClass = input.className.trim().slice(0, 24);
  if (!cleanName || !cleanClass) {
    return { error: 'Nama dan kelas wajib diisi.' };
  }

  // 1. Try explicit reconnect token
  if (input.participantId && input.reconnectToken) {
    const existing = room.participants.get(input.participantId);
    if (existing && existing.reconnectToken === input.reconnectToken) {
      existing.connected = true;
      return { participant: existing, reconnected: true };
    }
  }

  // 2. Try identity-based reconnect (same name + class in active room)
  for (const existing of room.participants.values()) {
    if (
      existing.name.toLowerCase() === cleanName.toLowerCase() &&
      existing.className.toLowerCase() === cleanClass.toLowerCase()
    ) {
      if (room.status === 'finished') {
        return { participant: existing, reconnected: true };
      }
      existing.connected = true;
      if (room.status === 'waiting') {
        existing.avatar = input.avatar;
        db.prepare('UPDATE participants SET avatar_json = ?, connected = 1 WHERE id = ?').run(
          JSON.stringify(input.avatar),
          existing.id
        );
      }
      return { participant: existing, reconnected: true };
    }
  }

  if (room.status === 'finished') {
    return { error: 'Pertandingan pada room ini sudah selesai.' };
  }
  if (room.participants.size >= room.settings.maxPlayers) {
    return { error: `Room sudah penuh (maksimal ${room.settings.maxPlayers} peserta).` };
  }

  const usedLanes = new Set(Array.from(room.participants.values()).map((p) => p.lane));
  let lane = 0;
  while (usedLanes.has(lane) && lane < 30) lane++;

  const now = Date.now();
  const participant: LiveParticipant = {
    id: `p-${crypto.randomUUID().slice(0, 10)}`,
    reconnectToken: crypto.randomUUID(),
    name: cleanName,
    className: cleanClass,
    avatar: input.avatar,
    lane,
    distance: 0,
    progress: 0,
    speed: room.status === 'playing' ? room.settings.baseSpeed : 0,
    effectState: 'normal',
    effectExpiresAt: 0,
    currentQuestionIndex: 0,
    questionStartedAt: now,
    questionCooldownUntil: 0,
    answeredCount: 0,
    correctCount: 0,
    wrongCount: 0,
    unansweredCount: 0,
    score: 0,
    startedAt: room.status === 'playing' ? now : null,
    finishedAt: null,
    durationMs: null,
    finishRank: null,
    scoreRank: null,
    connected: true,
  };

  room.participants.set(participant.id, participant);
  db.prepare(
    `INSERT INTO participants (
      id, room_id, reconnect_token, name, class_name, avatar_json, lane,
      distance, progress, speed, effect_state, effect_expires_at,
      current_question_index, answered_count, correct_count, wrong_count,
      unanswered_count, score, started_at, connected
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'normal', 0, 0, 0, 0, 0, 0, 0, ?, 1)`
  ).run(
    participant.id,
    room.id,
    participant.reconnectToken,
    participant.name,
    participant.className,
    JSON.stringify(participant.avatar),
    participant.lane,
    participant.speed,
    participant.startedAt
  );

  // Coalesce burst joins within 60ms so 30 students joining at once never flood the network
  scheduleRoomStateBroadcast(room);

  return { participant, reconnected: false };
}

function sendCurrentQuestionToParticipant(room: LiveRoom, p: LiveParticipant) {
  const sockets = room.studentSockets.get(p.id);
  if (!sockets || sockets.size === 0) return;

  if (p.currentQuestionIndex >= room.questions.length) {
    for (const ws of sockets) {
      sendJson(ws, {
        type: 'question:completed',
        answeredCount: p.answeredCount,
        totalQuestions: room.questions.length,
        score: p.score,
      });
    }
    return;
  }

  const q = room.questions[p.currentQuestionIndex];
  const payload = {
    type: 'question:current',
    question: sanitizeQuestionForClient(
      q,
      p.currentQuestionIndex,
      room.questions.length,
      room.settings.timePerQuestion,
      p.questionStartedAt
    ),
  };
  for (const ws of sockets) {
    sendJson(ws, payload);
  }
}

export function startRoomMatch(room: LiveRoom): { ok: true } | { error: string } {
  if (room.status !== 'waiting') {
    return { error: 'Pertandingan sudah dimulai atau telah selesai.' };
  }
  if (room.questions.length === 0) {
    return { error: 'Room belum memiliki soal.' };
  }
  if (room.participants.size === 0) {
    return { error: 'Minimal harus ada 1 peserta di lobby sebelum memulai pertandingan.' };
  }

  room.status = 'countdown';
  db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run('countdown', room.id);

  broadcastToRoom(room, {
    type: 'room:state',
    room: serializeRoomState(room),
  });

  const COUNTDOWN_TOTAL = 5;
  let count = COUNTDOWN_TOTAL;
  broadcastToRoom(room, { type: 'race:countdown', value: count, total: COUNTDOWN_TOTAL });

  const stepCountdown = () => {
    count -= 1;
    if (count > 0) {
      broadcastToRoom(room, { type: 'race:countdown', value: count, total: COUNTDOWN_TOTAL });
      room.countdownTimer = setTimeout(stepCountdown, 1000);
    } else if (count === 0) {
      broadcastToRoom(room, { type: 'race:countdown', value: 0, total: COUNTDOWN_TOTAL });
      const now = Date.now();
      room.status = 'playing';
      room.startedAt = now;
      room.lastTickAt = now;
      db.prepare('UPDATE rooms SET status = ?, started_at = ? WHERE id = ?').run(
        'playing',
        new Date(now).toISOString(),
        room.id
      );

      for (const p of room.participants.values()) {
        p.startedAt = now;
        p.questionStartedAt = now;
        p.questionCooldownUntil = 0;
        p.speed = room.settings.baseSpeed;
        p.effectState = 'normal';
        p.currentQuestionIndex = 0;
        sendCurrentQuestionToParticipant(room, p);
      }
      persistParticipantsToDb(room);

      broadcastToRoom(room, {
        type: 'room:state',
        room: serializeRoomState(room),
      });

      startSimulationLoop(room);
    }
  };

  room.countdownTimer = setTimeout(stepCountdown, 1000);
  return { ok: true };
}

function normalizeShortAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function recordAnswer(
  room: LiveRoom,
  p: LiveParticipant,
  questionIndex: number,
  submittedAnswer: string | null,
  isTimeout: boolean
) {
  if (room.status !== 'playing') return { error: 'Pertandingan tidak sedang berlangsung.' };
  if (questionIndex !== p.currentQuestionIndex) {
    return { error: 'Soal sudah dijawab atau tidak sesuai urutan.' };
  }
  if (questionIndex >= room.questions.length) {
    return { error: 'Semua soal sudah selesai dijawab.' };
  }

  const q = room.questions[questionIndex];
  const now = Date.now();
  const responseTimeMs = Math.max(100, now - p.questionStartedAt);

  // Check DB uniqueness guard using cached statement
  const { checkDupAnswer, insertAnswer } = getHotStmts();
  const dup = checkDupAnswer.get(p.id, questionIndex);
  if (dup) {
    return { error: 'Jawaban untuk soal ini sudah tercatat.' };
  }

  let isCorrect = false;
  if (!isTimeout && submittedAnswer !== null) {
    if (q.questionType === 'short_answer') {
      isCorrect = normalizeShortAnswer(submittedAnswer) === normalizeShortAnswer(q.correctAnswer);
    } else {
      isCorrect = submittedAnswer.trim().toUpperCase() === q.correctAnswer.trim().toUpperCase();
    }
  }

  const totalQuestions = Math.max(1, room.questions.length);
  let pointsEarned = 0;
  let nextScore = p.score;
  if (isCorrect) {
    nextScore = calcScoreFromCorrect(p.correctCount + 1, totalQuestions);
    pointsEarned = Number((nextScore - p.score).toFixed(2));
  }

  insertAnswer.run(
    `ans-${crypto.randomUUID().slice(0, 10)}`,
    room.id,
    p.id,
    q.id,
    questionIndex,
    submittedAnswer,
    isCorrect ? 1 : 0,
    isTimeout ? 1 : 0,
    pointsEarned,
    responseTimeMs,
    new Date(now).toISOString()
  );

  p.answeredCount += 1;
  if (isTimeout) {
    p.unansweredCount += 1;
  } else if (isCorrect) {
    p.correctCount += 1;
    p.score = nextScore;
  } else {
    p.wrongCount += 1;
  }

  if (isCorrect) {
    p.effectState = 'boost';
    p.effectExpiresAt = now + room.settings.boostDuration * 1000;
    p.speed = room.settings.baseSpeed * 2.25;
    // Instant stride surge reward on correct answer
    p.distance = Math.min(room.trackLength, p.distance + 12);
    p.progress = Math.min(1, p.distance / room.trackLength);
  } else {
    p.effectState = 'penalty';
    p.effectExpiresAt = now + room.settings.penaltyDuration * 1000;
    // Casual walking pace on wrong answer or timeout
    p.speed = room.settings.baseSpeed * 0.42;
  }

  p.currentQuestionIndex += 1;
  room.dirtyPersist = true;

  const QUESTION_HIDE_GAP_MS = 2200;
  const sockets = room.studentSockets.get(p.id);
  if (sockets) {
    const resultPayload = {
      type: 'answer:result',
      questionIndex,
      isCorrect,
      isTimeout,
      pointsEarned,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      effectState: p.effectState,
      effectDurationSec: isCorrect ? room.settings.boostDuration : room.settings.penaltyDuration,
      score: p.score,
    };
    for (const ws of sockets) sendJson(ws, resultPayload);
  }

  broadcastToRoom(room, {
    type: 'race:event',
    kind: isCorrect ? 'boost' : isTimeout ? 'timeout' : 'penalty',
    participantId: p.id,
    name: p.name,
    className: p.className,
    lane: p.lane,
    score: p.score,
    answeredCount: p.answeredCount,
  });

  if (p.currentQuestionIndex >= room.questions.length) {
    p.questionCooldownUntil = 0;
    p.questionStartedAt = now;
    sendCurrentQuestionToParticipant(room, p);
  } else {
    // Auto-hide the answered/timed-out question before revealing the next question
    p.questionCooldownUntil = now + QUESTION_HIDE_GAP_MS;
    p.questionStartedAt = p.questionCooldownUntil;
    if (sockets) {
      const hidePayload = {
        type: 'question:hide',
        reason: isTimeout ? 'timeout' : 'answered',
        nextIndex: p.currentQuestionIndex,
        total: room.questions.length,
        waitMs: QUESTION_HIDE_GAP_MS,
      };
      for (const ws of sockets) sendJson(ws, hidePayload);
    }
  }
  return { ok: true };
}

export function finishRoomMatch(room: LiveRoom) {
  if (room.status === 'finished') return;
  const now = Date.now();
  room.status = 'finished';
  room.finishedAt = now;

  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }

  const allParts = Array.from(room.participants.values());

  // Assign finishRank to any runners who didn't cross finish line yet (sorted by progress desc)
  const unfinished = allParts
    .filter((p) => p.finishRank == null)
    .sort((a, b) => b.progress - a.progress || b.score - a.score);

  for (const p of unfinished) {
    room.finishCounter += 1;
    p.finishRank = room.finishCounter;
    p.durationMs = p.startedAt ? now - p.startedAt : 0;
    p.effectState = 'finished';
    p.speed = 0;
  }

  // Compute scoreRank (total points desc -> correctCount desc -> durationMs asc -> finishRank asc)
  const byScore = [...allParts].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    const durA = a.durationMs ?? Number.MAX_SAFE_INTEGER;
    const durB = b.durationMs ?? Number.MAX_SAFE_INTEGER;
    if (durA !== durB) return durA - durB;
    return (a.finishRank ?? 999) - (b.finishRank ?? 999);
  });

  byScore.forEach((p, idx) => {
    p.scoreRank = idx + 1;
  });

  persistParticipantsToDb(room);
  db.prepare('UPDATE rooms SET status = ?, finished_at = ? WHERE id = ?').run(
    'finished',
    new Date(now).toISOString(),
    room.id
  );

  broadcastToRoom(room, {
    type: 'room:finished',
    room: serializeRoomState(room),
  });
}

function startSimulationLoop(room: LiveRoom) {
  if (room.tickTimer) clearInterval(room.tickTimer);
  room.lastTickAt = Date.now();
  let persistCounter = 0;

  room.tickTimer = setInterval(() => {
    if (room.status !== 'playing') return;

    const now = Date.now();
    const dt = Math.min((now - room.lastTickAt) / 1000, 0.15);
    room.lastTickAt = now;

    const segmentLen = room.trackLength / Math.max(1, room.questions.length);
    let unfinishedCount = 0;

    for (const p of room.participants.values()) {
      if (p.finishedAt != null) continue;
      unfinishedCount++;

      // Advance question cooldown pause or check per-question server timeout
      if (p.questionCooldownUntil > 0) {
        if (now >= p.questionCooldownUntil) {
          p.questionCooldownUntil = 0;
          p.questionStartedAt = now;
          sendCurrentQuestionToParticipant(room, p);
        }
      } else if (
        p.currentQuestionIndex < room.questions.length &&
        now - p.questionStartedAt >= room.settings.timePerQuestion * 1000 + 250
      ) {
        recordAnswer(room, p, p.currentQuestionIndex, null, true);
      }

      // Check boost/penalty expiration -> automatically return to normal
      if (p.effectState !== 'normal' && p.effectExpiresAt > 0 && now >= p.effectExpiresAt) {
        p.effectState = 'normal';
        p.effectExpiresAt = 0;
        p.speed = room.settings.baseSpeed;
      }

      const maxAllowedDist =
        p.answeredCount >= room.questions.length
          ? room.trackLength
          : Math.min(room.trackLength - 0.5, (p.answeredCount + 0.96) * segmentLen);

      if (p.distance < maxAllowedDist) {
        p.distance = Math.min(maxAllowedDist, p.distance + p.speed * dt);
      }
      p.progress = Math.min(1, p.distance / room.trackLength);

      if (p.answeredCount >= room.questions.length && p.distance >= room.trackLength) {
        p.distance = room.trackLength;
        p.progress = 1;
        p.speed = 0;
        p.effectState = 'finished';
        p.finishedAt = now;
        p.durationMs = p.startedAt ? now - p.startedAt : 0;
        room.finishCounter += 1;
        p.finishRank = room.finishCounter;
        room.dirtyPersist = true;

        broadcastToRoom(room, {
          type: 'player:finished',
          participantId: p.id,
          name: p.name,
          className: p.className,
          finishRank: p.finishRank,
          score: p.score,
          durationMs: p.durationMs,
        });
      }
    }

    // Broadcast lightweight snapshot at 10Hz (clients smooth at 60 FPS via dead-reckoning)
    // Backpressure guard prevents slow-WiFi devices from accumulating stale packet lag
    broadcastToRoom(
      room,
      {
        type: 'race:tick',
        serverTime: now,
        players: Array.from(room.participants.values()).map((p) => ({
          id: p.id,
          lane: p.lane,
          distance: Number(p.distance.toFixed(2)),
          progress: Number(p.progress.toFixed(4)),
          speed: Number(p.speed.toFixed(2)),
          effectState: p.effectState,
          effectExpiresAt: p.effectExpiresAt,
          currentQuestionIndex: p.currentQuestionIndex,
          answeredCount: p.answeredCount,
          correctCount: p.correctCount,
          wrongCount: p.wrongCount,
          unansweredCount: p.unansweredCount,
          score: p.score,
          finishedAt: p.finishedAt,
          durationMs: p.durationMs,
          finishRank: p.finishRank,
          connected: p.connected,
        })),
      },
      true
    );

    persistCounter++;
    if (persistCounter >= 25 || (room.dirtyPersist && persistCounter >= 12)) {
      persistParticipantsToDb(room);
      room.dirtyPersist = false;
      persistCounter = 0;
    }

    if (room.participants.size > 0 && unfinishedCount === 0) {
      finishRoomMatch(room);
    }
  }, 100);
}

export function attachWebSocketHandlers(wss: WebSocketServer) {
  wss.on('connection', (ws) => {
    let attachedRoomId: string | null = null;
    let attachedParticipantId: string | null = null;
    let isTeacher = false;

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'student:subscribe') {
        const roomCode = String(msg.roomCode || '');
        const participantId = String(msg.participantId || '');
        const reconnectToken = String(msg.reconnectToken || '');
        const room = getRoomByCode(roomCode);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'Room tidak ditemukan.' });
          return;
        }
        const p = room.participants.get(participantId);
        if (!p || p.reconnectToken !== reconnectToken) {
          sendJson(ws, { type: 'error', message: 'Sesi peserta tidak valid.' });
          return;
        }

        attachedRoomId = room.id;
        attachedParticipantId = p.id;
        isTeacher = false;
        p.connected = true;

        if (!room.studentSockets.has(p.id)) {
          room.studentSockets.set(p.id, new Set());
        }
        room.studentSockets.get(p.id)!.add(ws);

        sendJson(ws, {
          type: 'room:state',
          room: serializeRoomState(room),
        });

        if (room.status === 'playing') {
          const now = Date.now();
          if (p.questionCooldownUntil > 0 && now < p.questionCooldownUntil) {
            sendJson(ws, {
              type: 'question:hide',
              reason: 'cooldown',
              nextIndex: p.currentQuestionIndex,
              total: room.questions.length,
              waitMs: p.questionCooldownUntil - now,
            });
          } else {
            if (p.questionCooldownUntil > 0) {
              p.questionCooldownUntil = 0;
              p.questionStartedAt = now;
            }
            sendCurrentQuestionToParticipant(room, p);
          }
        }

        broadcastToRoom(room, {
          type: 'player:presence',
          participantId: p.id,
          connected: true,
        });
        return;
      }

      if (type === 'teacher:subscribe') {
        const roomId = String(msg.roomId || '');
        const room = getRoomById(roomId);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'Room tidak ditemukan.' });
          return;
        }
        attachedRoomId = room.id;
        isTeacher = true;
        room.teacherSockets.add(ws);
        sendJson(ws, {
          type: 'room:state',
          room: serializeRoomState(room),
        });
        return;
      }

      if (type === 'student:submit_answer') {
        if (!attachedRoomId || !attachedParticipantId) return;
        const room = getRoomById(attachedRoomId);
        if (!room) return;
        const p = room.participants.get(attachedParticipantId);
        if (!p) return;

        const qIndex = Number(msg.questionIndex);
        const answer = msg.answer != null ? String(msg.answer) : null;
        const res = recordAnswer(room, p, qIndex, answer, false);
        if ('error' in res && res.error) {
          sendJson(ws, { type: 'answer:rejected', message: res.error });
        }
        return;
      }
    });

    ws.on('close', () => {
      if (!attachedRoomId) return;
      const room = activeRooms.get(attachedRoomId);
      if (!room) return;

      if (isTeacher) {
        room.teacherSockets.delete(ws);
      } else if (attachedParticipantId) {
        const set = room.studentSockets.get(attachedParticipantId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            room.studentSockets.delete(attachedParticipantId);
            const p = room.participants.get(attachedParticipantId);
            if (p) {
              p.connected = false;
              getHotStmts().setConnected.run(0, p.id);
              broadcastToRoom(room, {
                type: 'player:presence',
                participantId: p.id,
                connected: false,
              });
            }
          }
        }
      }
    });
  });
}
