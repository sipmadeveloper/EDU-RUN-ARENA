import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  AnswerReviewItem,
  AvatarConfig,
  PlayerState,
  QuestionItem,
  QuestionType,
  RaceVenueId,
  RoomSettings,
  RoomStatus,
  RoomSummary,
  RunnerEffectState,
  TeacherProfile,
} from '../types/game';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcQuestionGateProgress,
  calcScoreFromCorrect,
  calcTotalLaps,
  calcTrackLength,
} from '../utils/matchScaling';
import {
  generateMatchExcelBlob,
  triggerBlobDownload,
  type ExcelAnswerDetailRow,
  type ExcelParticipantRow,
  type ExcelQuestionAnalysisRow,
  type ExcelRoomMeta,
} from './browserExcelExport';

export interface StoredRoomQuestion {
  id: string;
  subject: string;
  grade: string;
  questionType: QuestionType;
  prompt: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
}

export interface StoredAnswerRecord {
  questionIndex: number;
  questionId: string;
  submittedAnswer: string | null;
  isCorrect: boolean;
  isTimeout: boolean;
  pointsEarned: number;
  responseTimeMs: number;
}

export interface LiveFirebaseRoom {
  id: string; // same as roomCode
  code: string;
  roomCode: string;
  ownerId: string;
  name: string;
  roomName: string;
  teacherName: string;
  schoolName: string;
  subject: string;
  grade: string;
  status: RoomStatus;
  settings: RoomSettings;
  questionCount: number;
  totalLaps: number;
  pointsPerQuestion: number;
  maxScore: number;
  trackLength: number;
  questions: StoredRoomQuestion[];
  participantCount: number;
  countdownStartMs: number;
  startedAtMs: number;
  finishedAtMs: number;
  createdAtIso: string;
}

export interface LiveFirebaseParticipant extends PlayerState {
  roomCode: string;
  reconnectToken: string;
  lastSyncMs: number;
  answers: StoredAnswerRecord[];
}

export interface FirebaseRoomResultBundle {
  room: {
    id: string;
    code: string;
    name: string;
    subject: string;
    grade: string;
    teacherName: string;
    schoolName: string;
    status: RoomStatus;
    questionCount: number;
    totalLaps: number;
    pointsPerQuestion: number;
    maxScore: number;
    createdAtIso: string;
    finishedAtMs: number;
  };
  byScore: LiveFirebaseParticipant[];
  byFinish: LiveFirebaseParticipant[];
  questionAnalysis: ExcelQuestionAnalysisRow[];
  answerDetails: ExcelAnswerDetailRow[];
  review: AnswerReviewItem[];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  return (s || fallback).slice(0, maxLen);
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeDocId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return clean || `id-${Date.now()}`;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function randomToken(len = 24): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function sanitizeVenue(v: unknown): RaceVenueId {
  if (v === 'stadium_night' || v === 'open_field') return v;
  return 'stadium_day';
}

function sanitizeRoomSettings(input?: Partial<RoomSettings>): RoomSettings {
  return {
    questionCount: clampInt(input?.questionCount, 1, 50, 10),
    maxPlayers: clampInt(input?.maxPlayers, 2, 30, 30),
    timePerQuestion: clampInt(input?.timePerQuestion, 5, 120, 20),
    baseSpeed: clampNum(input?.baseSpeed, 1.5, 15, 3),
    boostDuration: clampInt(input?.boostDuration, 3, 60, 15),
    penaltyDuration: clampInt(input?.penaltyDuration, 5, 60, 30),
    allowShortAnswer: Boolean(input?.allowShortAnswer),
    venue: sanitizeVenue(input?.venue),
    ...(input?.scheduledAt ? { scheduledAt: String(input.scheduledAt).slice(0, 40) } : {}),
  };
}

function compactRoomQuestion(q: QuestionItem, idx: number): StoredRoomQuestion {
  const cleanOpts: { A?: string; B?: string; C?: string; D?: string } = {};
  for (const k of ['A', 'B', 'C', 'D'] as const) {
    const val = q.options?.[k];
    if (typeof val === 'string' && val.trim()) {
      cleanOpts[k] = val.trim().slice(0, 180);
    }
  }
  return {
    id: sanitizeDocId(q.id || `rq-${idx}`),
    subject: clampStr(q.subject, 60, 'Umum'),
    grade: clampStr(q.grade, 30, 'Umum'),
    questionType:
      q.questionType === 'true_false' || q.questionType === 'short_answer'
        ? q.questionType
        : 'multiple_choice',
    prompt: clampStr(q.prompt, 400, 'Soal'),
    options: cleanOpts,
    correctAnswer: clampStr(q.correctAnswer, 120, 'A'),
    explanation: clampStr(q.explanation, 300, ''),
  };
}

function parseRoomDoc(id: string, data: Record<string, unknown>): LiveFirebaseRoom {
  const rawQuestions = Array.isArray(data.questions) ? (data.questions as StoredRoomQuestion[]) : [];
  const questionCount = Math.max(1, Number(data.questionCount || rawQuestions.length || 1));
  const settings = sanitizeRoomSettings(data.settings as Partial<RoomSettings> | undefined);
  settings.questionCount = questionCount;
  const createdTs = data.createdAt as Timestamp | undefined;
  const createdAtIso =
    createdTs && typeof createdTs.toDate === 'function'
      ? createdTs.toDate().toISOString()
      : new Date().toISOString();

  const roomCode = String(data.roomCode || id).toUpperCase();
  const roomName = String(data.roomName || 'Pertandingan EduRun');

  return {
    id: roomCode,
    code: roomCode,
    roomCode,
    ownerId: String(data.ownerId || ''),
    name: roomName,
    roomName,
    teacherName: String(data.teacherName || 'Guru EduRun'),
    schoolName: String(data.schoolName || 'Sekolah Nusantara'),
    subject: String(data.subject || 'Umum'),
    grade: String(data.grade || 'Umum'),
    status: (String(data.status || 'waiting') as RoomStatus),
    settings,
    questionCount,
    totalLaps: Number(data.totalLaps || calcTotalLaps(questionCount)),
    pointsPerQuestion: Number(data.pointsPerQuestion || calcPointsPerQuestion(questionCount)),
    maxScore: MAX_MATCH_SCORE,
    trackLength: calcTrackLength(questionCount),
    questions: rawQuestions,
    participantCount: Number(data.participantCount || 0),
    countdownStartMs: Number(data.countdownStartMs || 0),
    startedAtMs: Number(data.startedAtMs || 0),
    finishedAtMs: Number(data.finishedAtMs || 0),
    createdAtIso,
  };
}

function parseParticipantDoc(id: string, data: Record<string, unknown>): LiveFirebaseParticipant {
  const rawAvatar = (data.avatar && typeof data.avatar === 'object'
    ? data.avatar
    : { gender: 'male', color: 'blue', outfit: 'sprinter' }) as AvatarConfig;

  const startedAtNum = Number(data.startedAt || 0);
  const finishedAtNum = Number(data.finishedAt || 0);
  const durationMsNum = Number(data.durationMs || 0);
  const finishRankNum = Number(data.finishRank || 0);
  const scoreRankNum = Number(data.scoreRank || 0);

  return {
    id: String(data.id || id),
    roomCode: String(data.roomCode || ''),
    reconnectToken: String(data.reconnectToken || ''),
    name: String(data.name || 'Peserta'),
    className: String(data.className || '-'),
    avatar: rawAvatar,
    lane: Number(data.lane || 0),
    distance: Number(data.distance || 0),
    progress: Number(data.progress || 0),
    speed: Number(data.speed || 0),
    effectState: (String(data.effectState || 'normal') as RunnerEffectState),
    effectExpiresAt: Number(data.effectExpiresAt || 0),
    currentQuestionIndex: Number(data.currentQuestionIndex || 0),
    answeredCount: Number(data.answeredCount || 0),
    correctCount: Number(data.correctCount || 0),
    wrongCount: Number(data.wrongCount || 0),
    unansweredCount: Number(data.unansweredCount || 0),
    score: Number(data.score || 0),
    connected: Boolean(data.connected ?? true),
    startedAt: startedAtNum > 0 ? startedAtNum : undefined,
    finishedAt: finishedAtNum > 0 ? finishedAtNum : undefined,
    durationMs: durationMsNum > 0 ? durationMsNum : undefined,
    finishRank: finishRankNum > 0 ? finishRankNum : undefined,
    scoreRank: scoreRankNum > 0 ? scoreRankNum : undefined,
    lastSyncMs: Number(data.lastSyncMs || 0),
    answers: Array.isArray(data.answers) ? (data.answers as StoredAnswerRecord[]) : [],
  };
}

function toRoomSummary(r: LiveFirebaseRoom): RoomSummary {
  return {
    id: r.roomCode,
    code: r.roomCode,
    name: r.roomName,
    subject: r.subject,
    grade: r.grade,
    teacherId: r.ownerId,
    teacherName: r.teacherName,
    schoolName: r.schoolName,
    status: r.status,
    settings: r.settings,
    questionCount: r.questionCount,
    totalLaps: r.totalLaps,
    pointsPerQuestion: r.pointsPerQuestion,
    maxScore: MAX_MATCH_SCORE,
    participantCount: r.participantCount,
    createdAt: r.createdAtIso,
    startedAt: r.startedAtMs > 0 ? new Date(r.startedAtMs).toISOString() : undefined,
    finishedAt: r.finishedAtMs > 0 ? new Date(r.finishedAtMs).toISOString() : undefined,
  };
}

// ==================== 1. TEACHER ROOM MANAGEMENT ====================

export async function createFirebaseRoom(params: {
  ownerId: string;
  teacher: TeacherProfile;
  name: string;
  subject: string;
  grade: string;
  settings: RoomSettings;
  allQuestions: QuestionItem[];
  questionIds?: string[];
  scheduledAt?: string;
}): Promise<LiveFirebaseRoom> {
  const cleanOwnerId = sanitizeDocId(params.ownerId);
  const cleanSettings = sanitizeRoomSettings({
    ...params.settings,
    scheduledAt: params.scheduledAt || params.settings.scheduledAt,
  });

  // Select questions (manual selection or automatic smart match)
  let chosen: QuestionItem[] = [];
  if (params.questionIds && params.questionIds.length > 0) {
    const byId = new Map(params.allQuestions.map((q) => [q.id, q]));
    for (const qId of params.questionIds) {
      const found = byId.get(qId);
      if (found) chosen.push(found);
    }
    chosen = chosen.slice(0, 50);
  } else {
    const eligible = params.allQuestions.filter(
      (q) => cleanSettings.allowShortAnswer || q.questionType !== 'short_answer'
    );
    const subjectLower = params.subject.trim().toLowerCase();
    const matched = eligible.filter((q) => q.subject.trim().toLowerCase() === subjectLower);
    const others = eligible.filter((q) => q.subject.trim().toLowerCase() !== subjectLower);

    // Shuffle copies gently so rooms vary while prioritizing requested subject
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    const pool = [...shuffle(matched), ...shuffle(others)];
    chosen = pool.slice(0, Math.min(50, Math.max(1, cleanSettings.questionCount)));
  }

  if (chosen.length === 0) {
    throw new Error(
      'Bank Soal Anda masih kosong atau belum ada soal yang cocok. Muat 50 Soal Contoh atau tambah soal terlebih dahulu.'
    );
  }

  const compactQuestions = chosen.map((q, idx) => compactRoomQuestion(q, idx));
  const questionCount = compactQuestions.length;
  cleanSettings.questionCount = questionCount;
  const totalLaps = calcTotalLaps(questionCount);
  const pointsPerQuestion = calcPointsPerQuestion(questionCount);

  // Pick a unique 6-char room code
  let roomCode = generateRoomCode();
  for (let attempt = 0; attempt < 6; attempt++) {
    const checkRef = doc(db, 'rooms', roomCode);
    const snap = await getDoc(checkRef);
    if (!snap.exists()) break;
    roomCode = generateRoomCode();
  }

  const path = `rooms/${roomCode}`;
  const payload = {
    roomCode,
    ownerId: cleanOwnerId,
    roomName: clampStr(params.name, 100, 'Pertandingan EduRun'),
    teacherName: clampStr(params.teacher.name, 100, 'Guru EduRun'),
    schoolName: clampStr(params.teacher.schoolName, 120, 'Sekolah Nusantara'),
    subject: clampStr(params.subject, 60, 'Umum'),
    grade: clampStr(params.grade, 30, 'Umum'),
    status: 'waiting' as const,
    settings: cleanSettings,
    questionCount,
    totalLaps,
    pointsPerQuestion,
    questions: compactQuestions,
    participantCount: 0,
    countdownStartMs: 0,
    startedAtMs: 0,
    finishedAtMs: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'rooms', roomCode), payload);
    return parseRoomDoc(roomCode, {
      ...payload,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listTeacherRooms(ownerId: string): Promise<RoomSummary[]> {
  const cleanOwnerId = sanitizeDocId(ownerId);
  const path = 'rooms';
  try {
    const snap = await getDocs(query(collection(db, 'rooms'), where('ownerId', '==', cleanOwnerId)));
    const rooms = snap.docs.map((d) => parseRoomDoc(d.id, d.data() as Record<string, unknown>));
    rooms.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));

    // Fetch live participant count for active rooms (waiting/countdown/playing) so dashboard is always fresh
    const summaries = await Promise.all(
      rooms.map(async (rm) => {
        if (rm.status !== 'finished') {
          try {
            const pSnap = await getDocs(
              query(collection(db, 'rooms', rm.roomCode, 'participants'), where('roomCode', '==', rm.roomCode))
            );
            rm.participantCount = pSnap.size;
          } catch {
            // fallback to cached count
          }
        }
        return toRoomSummary(rm);
      })
    );
    return summaries;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function startFirebaseRoom(roomCode: string, participantCount?: number): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    const pSnap =
      participantCount === undefined
        ? await getDocs(query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code)))
        : null;
    const count = pSnap ? pSnap.size : clampInt(participantCount, 0, 30, 0);
    if (count === 0) {
      throw new Error('Minimal harus ada 1 peserta di lobby sebelum memulai pertandingan.');
    }

    const now = Date.now();
    const countdownDurationMs = 5000;
    await updateDoc(doc(db, 'rooms', code), {
      status: 'countdown',
      countdownStartMs: now,
      startedAtMs: now + countdownDurationMs,
      participantCount: count,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Minimal harus ada')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function activatePlayingFirebaseRoom(roomCode: string, participantCount: number): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    await updateDoc(doc(db, 'rooms', code), {
      status: 'playing',
      participantCount: clampInt(participantCount, 0, 30, 0),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function finishFirebaseRoom(roomCode: string): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    const roomRef = doc(db, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return;
    const room = parseRoomDoc(roomSnap.id, roomSnap.data() as Record<string, unknown>);
    if (room.status === 'finished') return;

    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    const now = Date.now();
    const participants = pSnap.docs.map((d) =>
      projectParticipantPhysics(parseParticipantDoc(d.id, d.data() as Record<string, unknown>), room, now)
    );

    // Assign finishRank to already-finished first (by finishedAt asc), then unfinished by progress desc
    const alreadyFinished = participants
      .filter((p) => p.finishedAt && p.finishedAt > 0)
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    const unfinished = participants
      .filter((p) => !p.finishedAt || p.finishedAt <= 0)
      .sort((a, b) => b.progress - a.progress || b.score - a.score);

    const finishOrder = [...alreadyFinished, ...unfinished];
    const finishRankMap = new Map<string, number>();
    finishOrder.forEach((p, idx) => finishRankMap.set(p.id, idx + 1));

    const durationMap = new Map<string, number>();
    for (const p of participants) {
      if (p.durationMs && p.durationMs > 0) {
        durationMap.set(p.id, Math.round(p.durationMs));
      } else {
        const startAnchor = p.startedAt || room.startedAtMs || now;
        durationMap.set(p.id, Math.max(0, Math.round(now - startAnchor)));
      }
    }

    // Compute scoreRank (score desc -> correctCount desc -> durationMs asc -> finishRank asc)
    const byScore = [...participants].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      const dA = durationMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const dB = durationMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (dA !== dB) return dA - dB;
      return (finishRankMap.get(a.id) ?? 999) - (finishRankMap.get(b.id) ?? 999);
    });
    const scoreRankMap = new Map<string, number>();
    byScore.forEach((p, idx) => scoreRankMap.set(p.id, idx + 1));

    // Update all participants in a single batch (Tier 1 rules allow teacher finalization)
    if (participants.length > 0) {
      const batch = writeBatch(db);
      for (const p of participants) {
        batch.update(doc(db, 'rooms', code, 'participants', p.id), {
          effectState: 'finished',
          speed: 0,
          finishedAt: p.finishedAt && p.finishedAt > 0 ? Math.round(p.finishedAt) : now,
          durationMs: durationMap.get(p.id) ?? 0,
          finishRank: finishRankMap.get(p.id) ?? 1,
          scoreRank: scoreRankMap.get(p.id) ?? 1,
          lastSyncMs: now,
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    await updateDoc(roomRef, {
      status: 'finished',
      finishedAtMs: now,
      participantCount: participants.length,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFirebaseRoom(roomCode: string): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    // Delete participant subcollection docs FIRST (rules check roomExists(roomCode)!)
    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    if (!pSnap.empty) {
      const batch = writeBatch(db);
      for (const d of pSnap.docs) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
    await deleteDoc(doc(db, 'rooms', code));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteFinishedTeacherRooms(ownerId: string): Promise<number> {
  const rooms = await listTeacherRooms(ownerId);
  const finished = rooms.filter((r) => r.status === 'finished');
  for (const rm of finished) {
    await deleteFirebaseRoom(rm.code);
  }
  return finished.length;
}

// ==================== 2. STUDENT LOOKUP, JOIN & ANSWER SYNC ====================

export async function lookupPublicRoom(roomCode: string): Promise<{
  id: string;
  code: string;
  name: string;
  subject: string;
  grade: string;
  teacherName: string;
  schoolName: string;
  status: RoomStatus;
  questionCount: number;
  participantCount: number;
  settings: RoomSettings;
}> {
  const code = normalizeRoomCode(roomCode);
  if (code.length !== 6) {
    throw new Error('Kode room harus terdiri dari 6 karakter huruf/angka.');
  }
  const path = `rooms/${code}`;
  try {
    const snap = await getDoc(doc(db, 'rooms', code));
    if (!snap.exists()) {
      throw new Error('Kode room tidak ditemukan. Periksa kembali kode dari guru Anda.');
    }
    const room = parseRoomDoc(snap.id, snap.data() as Record<string, unknown>);
    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    return {
      id: room.roomCode,
      code: room.roomCode,
      name: room.roomName,
      subject: room.subject,
      grade: room.grade,
      teacherName: room.teacherName,
      schoolName: room.schoolName,
      status: room.status,
      questionCount: room.questionCount,
      participantCount: pSnap.size,
      settings: room.settings,
    };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Kode room') || error.message.includes('tidak ditemukan'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function joinFirebaseRoom(
  roomCode: string,
  input: {
    name: string;
    className: string;
    avatar: AvatarConfig;
    participantId?: string;
    reconnectToken?: string;
  }
): Promise<{
  participantId: string;
  reconnectToken: string;
  participant: LiveFirebaseParticipant;
  reconnected: boolean;
}> {
  const code = normalizeRoomCode(roomCode);
  const cleanName = clampStr(input.name, 40, '');
  const cleanClass = clampStr(input.className, 24, '');
  if (!cleanName || !cleanClass) {
    throw new Error('Nama lengkap dan kelas wajib diisi.');
  }

  const path = `rooms/${code}/participants`;
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', code));
    if (!roomSnap.exists()) {
      throw new Error('Kode room tidak ditemukan.');
    }
    const room = parseRoomDoc(roomSnap.id, roomSnap.data() as Record<string, unknown>);

    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    const existingList = pSnap.docs.map((d) =>
      parseParticipantDoc(d.id, d.data() as Record<string, unknown>)
    );

    // 1. Explicit reconnect via saved token
    if (input.participantId && input.reconnectToken) {
      const found = existingList.find(
        (p) => p.id === input.participantId && p.reconnectToken === input.reconnectToken
      );
      if (found) {
        if (room.status !== 'finished') {
          await updateDoc(doc(db, 'rooms', code, 'participants', found.id), {
            connected: true,
            ...(room.status === 'waiting' ? { avatar: input.avatar } : {}),
            updatedAt: serverTimestamp(),
          });
        }
        return {
          participantId: found.id,
          reconnectToken: found.reconnectToken,
          participant: {
            ...found,
            avatar: room.status === 'waiting' ? input.avatar : found.avatar,
            connected: true,
          },
          reconnected: true,
        };
      }
    }

    // 2. Identity reconnect (same name + class in room)
    const byIdentity = existingList.find(
      (p) =>
        p.name.toLowerCase() === cleanName.toLowerCase() &&
        p.className.toLowerCase() === cleanClass.toLowerCase()
    );
    if (byIdentity) {
      if (room.status !== 'finished') {
        await updateDoc(doc(db, 'rooms', code, 'participants', byIdentity.id), {
          connected: true,
          ...(room.status === 'waiting' ? { avatar: input.avatar } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      return {
        participantId: byIdentity.id,
        reconnectToken: byIdentity.reconnectToken,
        participant: {
          ...byIdentity,
          avatar: room.status === 'waiting' ? input.avatar : byIdentity.avatar,
          connected: true,
        },
        reconnected: true,
      };
    }

    if (room.status === 'finished') {
      throw new Error('Pertandingan pada room ini sudah selesai.');
    }
    if (existingList.length >= room.settings.maxPlayers) {
      throw new Error(`Room sudah penuh (maksimal ${room.settings.maxPlayers} peserta).`);
    }

    const usedLanes = new Set(existingList.map((p) => p.lane));
    let lane = 0;
    while (usedLanes.has(lane) && lane < 30) lane++;

    const participantId = `p-${randomToken(10).toLowerCase()}`;
    const reconnectToken = randomToken(24);
    const now = Date.now();
    const isAlreadyPlaying = room.status === 'playing' || (room.status === 'countdown' && room.startedAtMs > 0 && now >= room.startedAtMs);

    const payload = {
      id: participantId,
      roomCode: code,
      reconnectToken,
      name: cleanName,
      className: cleanClass,
      avatar: {
        gender: input.avatar.gender === 'female' ? 'female' : 'male',
        color: input.avatar.color || 'blue',
        outfit: input.avatar.outfit || 'sprinter',
        ...(input.avatar.presetId ? { presetId: input.avatar.presetId } : {}),
      },
      lane,
      distance: 0,
      progress: 0,
      speed: isAlreadyPlaying ? room.settings.baseSpeed : 0,
      effectState: 'normal' as const,
      effectExpiresAt: 0,
      currentQuestionIndex: 0,
      answeredCount: 0,
      correctCount: 0,
      wrongCount: 0,
      unansweredCount: 0,
      score: 0,
      connected: true,
      startedAt: isAlreadyPlaying ? now : 0,
      finishedAt: 0,
      durationMs: 0,
      finishRank: 0,
      scoreRank: 0,
      lastSyncMs: now,
      answers: [] as StoredAnswerRecord[],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(doc(db, 'rooms', code, 'participants', participantId), payload);

    return {
      participantId,
      reconnectToken,
      participant: parseParticipantDoc(participantId, payload),
      reconnected: false,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Room sudah penuh') ||
        error.message.includes('sudah selesai') ||
        error.message.includes('tidak ditemukan') ||
        error.message.includes('wajib diisi'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== 3. DETERMINISTIC 60 FPS RACE PHYSICS ====================

export function projectParticipantPhysics(
  p: LiveFirebaseParticipant,
  room: LiveFirebaseRoom,
  nowMs: number
): LiveFirebaseParticipant {
  const effectivePlaying =
    room.status === 'playing' ||
    (room.status === 'countdown' && room.startedAtMs > 0 && nowMs >= room.startedAtMs);

  if (room.status === 'waiting' || (!effectivePlaying && room.status !== 'finished')) {
    return { ...p, distance: 0, progress: 0, speed: 0 };
  }

  if (room.status === 'finished' || p.effectState === 'finished' || (p.finishedAt && p.finishedAt > 0)) {
    return {
      ...p,
      speed: 0,
      effectState: 'finished',
    };
  }

  const trackLength = Math.max(10, room.trackLength);
  const totalQuestions = Math.max(1, room.questionCount);
  const segmentLen = trackLength / totalQuestions;
  const nextGateDist =
    p.answeredCount < totalQuestions
      ? Math.min(trackLength - 0.5, calcQuestionGateProgress(p.answeredCount, totalQuestions) * trackLength + 4)
      : trackLength;
  const maxAllowedDist =
    p.answeredCount >= totalQuestions
      ? trackLength
      : Math.max(
          nextGateDist,
          Math.min(trackLength - 0.5, (p.answeredCount + 0.96) * segmentLen)
        );

  const raceStartMs = room.startedAtMs > 0 ? room.startedAtMs : p.startedAt || nowMs;
  const anchorMs = Math.max(raceStartMs, p.lastSyncMs || raceStartMs);
  if (nowMs <= anchorMs) {
    return p;
  }

  const baseSpeed = room.settings.baseSpeed;
  let dist = p.distance;
  let speed = p.speed > 0 ? p.speed : baseSpeed;
  let effectState: RunnerEffectState = p.effectState;
  let effectExpiresAt = p.effectExpiresAt;

  if (effectState !== 'normal' && effectExpiresAt > anchorMs) {
    if (nowMs < effectExpiresAt) {
      const dt = (nowMs - anchorMs) / 1000;
      dist = Math.min(maxAllowedDist, dist + speed * dt);
    } else {
      const dtEffect = (effectExpiresAt - anchorMs) / 1000;
      dist = Math.min(maxAllowedDist, dist + speed * dtEffect);
      const dtNormal = (nowMs - effectExpiresAt) / 1000;
      dist = Math.min(maxAllowedDist, dist + baseSpeed * dtNormal);
      effectState = 'normal';
      effectExpiresAt = 0;
      speed = baseSpeed;
    }
  } else {
    if (effectState !== 'normal' && effectExpiresAt <= nowMs) {
      effectState = 'normal';
      effectExpiresAt = 0;
      speed = baseSpeed;
    }
    const dt = (nowMs - anchorMs) / 1000;
    dist = Math.min(maxAllowedDist, dist + speed * dt);
  }

  const progress = Math.max(0, Math.min(1, dist / trackLength));

  return {
    ...p,
    distance: Number(dist.toFixed(2)),
    progress: Number(progress.toFixed(4)),
    speed: Number(speed.toFixed(2)),
    effectState,
    effectExpiresAt,
  };
}

function normalizeShortAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function submitParticipantAnswer(params: {
  room: LiveFirebaseRoom;
  participant: LiveFirebaseParticipant;
  questionIndex: number;
  submittedAnswer: string | null;
  isTimeout: boolean;
  questionStartedAt: number;
}): Promise<{
  isCorrect: boolean;
  isTimeout: boolean;
  pointsEarned: number;
  correctAnswer: string;
  explanation: string;
  effectState: RunnerEffectState;
  effectDurationSec: number;
  score: number;
  nextParticipant: LiveFirebaseParticipant;
}> {
  const { room, participant, questionIndex, submittedAnswer, isTimeout, questionStartedAt } = params;
  const q = room.questions[questionIndex];
  if (!q) {
    throw new Error('Soal tidak ditemukan.');
  }

  // Prevent duplicate submission
  if (participant.answers.some((a) => a.questionIndex === questionIndex)) {
    throw new Error('Jawaban untuk soal ini sudah tercatat.');
  }

  const now = Date.now();
  const projected = projectParticipantPhysics(participant, room, now);
  const responseTimeMs = Math.max(100, Math.min(180000, Math.round(now - questionStartedAt)));

  let isCorrect = false;
  if (!isTimeout && submittedAnswer !== null) {
    if (q.questionType === 'short_answer') {
      isCorrect = normalizeShortAnswer(submittedAnswer) === normalizeShortAnswer(q.correctAnswer);
    } else {
      isCorrect = submittedAnswer.trim().toUpperCase() === q.correctAnswer.trim().toUpperCase();
    }
  }

  const totalQuestions = Math.max(1, room.questionCount);
  let pointsEarned = 0;
  let nextScore = projected.score;
  const nextCorrectCount = projected.correctCount + (isCorrect ? 1 : 0);
  if (isCorrect) {
    nextScore = calcScoreFromCorrect(nextCorrectCount, totalQuestions);
    pointsEarned = Number((nextScore - projected.score).toFixed(2));
  }

  const nextAnsweredCount = projected.answeredCount + 1;
  const nextWrongCount = projected.wrongCount + (!isTimeout && !isCorrect ? 1 : 0);
  const nextUnansweredCount = projected.unansweredCount + (isTimeout ? 1 : 0);

  let nextEffectState: RunnerEffectState = 'normal';
  let nextEffectExpiresAt = 0;
  let nextSpeed = room.settings.baseSpeed;
  let nextDistance = projected.distance;

  if (isCorrect) {
    nextEffectState = 'boost';
    nextEffectExpiresAt = now + room.settings.boostDuration * 1000;
    nextSpeed = Number((room.settings.baseSpeed * 2.25).toFixed(2));
    nextDistance = Math.min(room.trackLength, projected.distance + 5);
  } else {
    nextEffectState = 'penalty';
    nextEffectExpiresAt = now + room.settings.penaltyDuration * 1000;
    nextSpeed = Number((room.settings.baseSpeed * 0.25).toFixed(2));
  }

  const nextProgress = Math.max(0, Math.min(1, Number((nextDistance / room.trackLength).toFixed(4))));
  const answerRec: StoredAnswerRecord = {
    questionIndex,
    questionId: q.id,
    submittedAnswer: submittedAnswer ? submittedAnswer.slice(0, 120) : null,
    isCorrect,
    isTimeout,
    pointsEarned,
    responseTimeMs,
  };
  const nextAnswers = [...participant.answers, answerRec].slice(0, 50);
  const startedAtVal = participant.startedAt || room.startedAtMs || now;

  const updatePayload = {
    distance: Number(nextDistance.toFixed(2)),
    progress: nextProgress,
    speed: nextSpeed,
    effectState: nextEffectState,
    effectExpiresAt: nextEffectExpiresAt,
    currentQuestionIndex: Math.min(totalQuestions, questionIndex + 1),
    answeredCount: Math.min(totalQuestions, nextAnsweredCount),
    correctCount: Math.min(totalQuestions, nextCorrectCount),
    wrongCount: Math.min(totalQuestions, nextWrongCount),
    unansweredCount: Math.min(totalQuestions, nextUnansweredCount),
    score: Math.min(100, Number(nextScore.toFixed(2))),
    connected: true,
    startedAt: Math.round(startedAtVal),
    lastSyncMs: now,
    answers: nextAnswers,
    updatedAt: serverTimestamp(),
  };

  const path = `rooms/${room.roomCode}/participants/${participant.id}`;
  try {
    await updateDoc(doc(db, 'rooms', room.roomCode, 'participants', participant.id), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  return {
    isCorrect,
    isTimeout,
    pointsEarned,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    effectState: nextEffectState,
    effectDurationSec: isCorrect ? room.settings.boostDuration : room.settings.penaltyDuration,
    score: updatePayload.score,
    nextParticipant: {
      ...participant,
      ...updatePayload,
      startedAt: updatePayload.startedAt,
    },
  };
}

export async function syncParticipantFinished(params: {
  room: LiveFirebaseRoom;
  participant: LiveFirebaseParticipant;
  alreadyFinishedCount: number;
}): Promise<{ finishRank: number; durationMs: number }> {
  const { room, participant, alreadyFinishedCount } = params;
  const now = Date.now();
  const startAnchor = participant.startedAt || room.startedAtMs || now;
  const durationMs = Math.max(100, Math.round(now - startAnchor));
  const finishRank = Math.max(1, Math.min(30, alreadyFinishedCount + 1));

  const path = `rooms/${room.roomCode}/participants/${participant.id}`;
  try {
    await updateDoc(doc(db, 'rooms', room.roomCode, 'participants', participant.id), {
      distance: room.trackLength,
      progress: 1,
      speed: 0,
      effectState: 'finished',
      effectExpiresAt: 0,
      finishedAt: now,
      durationMs,
      finishRank,
      lastSyncMs: now,
      updatedAt: serverTimestamp(),
    });
    return { finishRank, durationMs };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================== 4. LIVE REAL-TIME SUBSCRIPTION ====================

export function subscribeLiveRoom(
  roomCode: string,
  callbacks: {
    onRoom: (room: LiveFirebaseRoom | null) => void;
    onParticipants: (participants: LiveFirebaseParticipant[]) => void;
    onError?: (err: Error) => void;
  }
): Unsubscribe {
  const code = normalizeRoomCode(roomCode);
  const roomPath = `rooms/${code}`;
  const partPath = `rooms/${code}/participants`;

  const unsubRoom = onSnapshot(
    doc(db, 'rooms', code),
    (snap) => {
      if (!snap.exists()) {
        callbacks.onRoom(null);
        return;
      }
      callbacks.onRoom(parseRoomDoc(snap.id, snap.data() as Record<string, unknown>));
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, roomPath);
      } catch (wrapped) {
        callbacks.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  const unsubParts = onSnapshot(
    query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code)),
    (snap) => {
      const list = snap.docs
        .map((d) => parseParticipantDoc(d.id, d.data() as Record<string, unknown>))
        .sort((a, b) => a.lane - b.lane);
      callbacks.onParticipants(list);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, partPath);
      } catch (wrapped) {
        callbacks.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  return () => {
    unsubRoom();
    unsubParts();
  };
}

// ==================== 5. RESULTS, REVIEW & BROWSER EXCEL EXPORT ====================

export async function getFirebaseRoomResults(
  roomCode: string,
  localParticipantId?: string
): Promise<FirebaseRoomResultBundle> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    const [roomSnap, pSnap] = await Promise.all([
      getDoc(doc(db, 'rooms', code)),
      getDocs(query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))),
    ]);

    if (!roomSnap.exists()) {
      throw new Error('Room tidak ditemukan.');
    }

    const room = parseRoomDoc(roomSnap.id, roomSnap.data() as Record<string, unknown>);
    const participants = pSnap.docs.map((d) =>
      parseParticipantDoc(d.id, d.data() as Record<string, unknown>)
    );

    const byScore = [...participants]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
        const dA = a.durationMs ?? Number.MAX_SAFE_INTEGER;
        const dB = b.durationMs ?? Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;
        return (a.finishRank ?? 999) - (b.finishRank ?? 999);
      })
      .map((p, idx) => ({ ...p, scoreRank: p.scoreRank ?? idx + 1 }));

    const byFinish = [...participants]
      .sort((a, b) => {
        const fA = a.finishRank ?? 999;
        const fB = b.finishRank ?? 999;
        if (fA !== fB) return fA - fB;
        return b.progress - a.progress;
      })
      .map((p, idx) => ({ ...p, finishRank: p.finishRank ?? idx + 1 }));

    // Build detailed answer rows & question analysis
    const answerDetails: ExcelAnswerDetailRow[] = [];
    const analysisMap = new Map<
      number,
      { correct: number; wrong: number; unanswered: number }
    >();

    for (let i = 0; i < room.questions.length; i++) {
      analysisMap.set(i, { correct: 0, wrong: 0, unanswered: 0 });
    }

    for (const p of byScore) {
      const ansByIdx = new Map(p.answers.map((a) => [a.questionIndex, a]));
      for (let i = 0; i < room.questions.length; i++) {
        const q = room.questions[i];
        const a = ansByIdx.get(i);
        const bucket = analysisMap.get(i)!;

        if (!a || a.isTimeout) {
          bucket.unanswered += 1;
          answerDetails.push({
            questionNumber: i + 1,
            participantName: p.name,
            className: p.className,
            prompt: q.prompt,
            submittedAnswer: '-',
            correctAnswer: q.correctAnswer,
            status: 'Tidak Dijawab',
            points: 0,
            responseTimeSec: a ? a.responseTimeMs / 1000 : room.settings.timePerQuestion,
          });
        } else if (a.isCorrect) {
          bucket.correct += 1;
          answerDetails.push({
            questionNumber: i + 1,
            participantName: p.name,
            className: p.className,
            prompt: q.prompt,
            submittedAnswer: a.submittedAnswer || '-',
            correctAnswer: q.correctAnswer,
            status: 'Benar',
            points: a.pointsEarned,
            responseTimeSec: a.responseTimeMs / 1000,
          });
        } else {
          bucket.wrong += 1;
          answerDetails.push({
            questionNumber: i + 1,
            participantName: p.name,
            className: p.className,
            prompt: q.prompt,
            submittedAnswer: a.submittedAnswer || '-',
            correctAnswer: q.correctAnswer,
            status: 'Salah',
            points: 0,
            responseTimeSec: a.responseTimeMs / 1000,
          });
        }
      }
    }

    const totalParts = Math.max(1, participants.length);
    const questionAnalysis: ExcelQuestionAnalysisRow[] = room.questions.map((q, idx) => {
      const bucket = analysisMap.get(idx) || { correct: 0, wrong: 0, unanswered: 0 };
      const correctPct = participants.length > 0 ? (bucket.correct / totalParts) * 100 : 0;
      const difficulty: 'Mudah' | 'Sedang' | 'Sulit' =
        correctPct >= 70 ? 'Mudah' : correctPct >= 40 ? 'Sedang' : 'Sulit';
      return {
        questionNumber: idx + 1,
        prompt: q.prompt,
        subject: q.subject,
        correctCount: bucket.correct,
        wrongCount: bucket.wrong,
        unansweredCount: bucket.unanswered,
        correctPct: Number(correctPct.toFixed(1)),
        difficulty,
      };
    });

    // Build personal review items if localParticipantId provided
    let review: AnswerReviewItem[] = [];
    if (localParticipantId) {
      const me = participants.find((p) => p.id === localParticipantId);
      const ansByIdx = new Map((me?.answers || []).map((a) => [a.questionIndex, a]));
      review = room.questions.map((q, idx) => {
        const a = ansByIdx.get(idx);
        return {
          questionIndex: idx,
          questionId: q.id,
          prompt: q.prompt,
          questionType: q.questionType,
          options: q.options,
          submittedAnswer: a?.submittedAnswer ?? null,
          correctAnswer: q.correctAnswer,
          isCorrect: Boolean(a?.isCorrect),
          isTimeout: a ? Boolean(a.isTimeout) : true,
          pointsEarned: a?.pointsEarned ?? 0,
          explanation: q.explanation,
          responseTimeMs: a?.responseTimeMs ?? 0,
        };
      });
    }

    return {
      room: {
        id: room.roomCode,
        code: room.roomCode,
        name: room.roomName,
        subject: room.subject,
        grade: room.grade,
        teacherName: room.teacherName,
        schoolName: room.schoolName,
        status: room.status,
        questionCount: room.questionCount,
        totalLaps: room.totalLaps,
        pointsPerQuestion: room.pointsPerQuestion,
        maxScore: MAX_MATCH_SCORE,
        createdAtIso: room.createdAtIso,
        finishedAtMs: room.finishedAtMs,
      },
      byScore,
      byFinish,
      questionAnalysis,
      answerDetails,
      review,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Room tidak ditemukan.') {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function buildRoomExcelBlobFromFirebase(roomCode: string): Promise<{
  blob: Blob;
  filename: string;
}> {
  const res = await getFirebaseRoomResults(roomCode);
  const matchDate = new Date(res.room.finishedAtMs || res.room.createdAtIso).toLocaleDateString(
    'id-ID',
    { day: '2-digit', month: 'long', year: 'numeric' }
  );

  const meta: ExcelRoomMeta = {
    schoolName: res.room.schoolName,
    teacherName: res.room.teacherName,
    roomName: res.room.name,
    subject: res.room.subject,
    grade: res.room.grade,
    roomCode: res.room.code,
    matchDate,
    questionCount: res.room.questionCount,
    totalLaps: res.room.totalLaps,
    pointsPerQuestion: res.room.pointsPerQuestion,
    maxScore: res.room.maxScore,
    participantCount: res.byScore.length,
  };

  const participantRows: ExcelParticipantRow[] = res.byScore.map((p, idx) => ({
    name: p.name,
    className: p.className,
    correctCount: p.correctCount,
    wrongCount: p.wrongCount,
    unansweredCount: p.unansweredCount,
    totalPoints: Number(p.score.toFixed(2)),
    finalScore: Number(p.score.toFixed(2)),
    scoreRank: p.scoreRank ?? idx + 1,
    finishRank: p.finishRank ?? null,
    durationMs: p.durationMs ?? null,
  }));

  const blob = await generateMatchExcelBlob(
    meta,
    participantRows,
    res.answerDetails,
    res.questionAnalysis
  );
  const safeName = res.room.name
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 36);
  const filename = safeName
    ? `Rekap-Nilai-${res.room.code}-${safeName}.xlsx`
    : `Rekap-Nilai-${res.room.code}.xlsx`;

  return { blob, filename };
}

export async function downloadRoomExcelFromFirebase(roomCode: string): Promise<void> {
  const { blob, filename } = await buildRoomExcelBlobFromFirebase(roomCode);
  triggerBlobDownload(blob, filename);
}
