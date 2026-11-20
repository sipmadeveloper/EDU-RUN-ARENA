import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { PlayerState, QuestionItem, QuestionType, RaceVenueId, RoomSettings, TeacherProfile } from '../types/game';
import { calcTotalLaps } from '../utils/matchScaling';

// ==================== SPARK FREE TIER CONSTANTS ====================
export const SPARK_FREE_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GiB Spark free tier storage
export const MAX_QUESTIONS_PER_PACK = 50;
export const MAX_PACKS_PER_TEACHER = 10; // Up to 500 questions across just 10 compact docs (~150KB total)
export const DEFAULT_MAX_ARCHIVED_MATCHES = 20;
export const DEFAULT_RETENTION_DAYS = 30;

export interface TeacherCloudProfileDoc {
  ownerId: string;
  name: string;
  email: string;
  schoolName: string;
  maxArchivedMatches: number;
  retentionDays: number;
  defaultVenue: RaceVenueId;
  defaultQuestionCount: number;
  defaultMaxPlayers: number;
  defaultTimePerQuestion: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CompactCloudQuestion {
  id: string;
  subject: string;
  grade: string;
  questionType: QuestionType;
  prompt: string;
  options: Record<string, string>;
  correctAnswer: string;
  explanation: string;
}

export interface CompactStandingRow {
  name: string;
  className: string;
  score: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  scoreRank: number;
  finishRank: number;
}

export interface MatchArchiveSummaryDoc {
  id: string;
  ownerId: string;
  roomCode: string;
  roomName: string;
  subject: string;
  grade: string;
  questionCount: number;
  totalLaps: number;
  participantCount: number;
  avgScore: number;
  championName: string;
  status: 'archived';
  approxBytes: number;
  standings: CompactStandingRow[];
  createdAtMs: number;
}

export interface QuestionPackSummaryDoc {
  id: string;
  packIndex: number;
  questionCount: number;
  approxBytes: number;
  subjects: string[];
  updatedAtMs: number;
}

export interface SparkStorageOverview {
  profile: TeacherCloudProfileDoc | null;
  packCount: number;
  questionCount: number;
  archiveCount: number;
  totalApproxBytes: number;
  percentOfSpark1GiB: number;
  packs: QuestionPackSummaryDoc[];
  archives: MatchArchiveSummaryDoc[];
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  return (s || fallback).slice(0, maxLen);
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeDocId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return clean || `id-${Date.now()}`;
}

function estimateBytes(obj: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(obj)).length;
  } catch {
    return 1024;
  }
}

function sanitizeVenue(v: unknown): RaceVenueId {
  if (v === 'stadium_night' || v === 'open_field') return v;
  return 'stadium_day';
}

// ==================== 1. TEACHER CLOUD PROFILE ====================

export async function ensureTeacherCloudProfile(
  user: User,
  localTeacher?: TeacherProfile | null
): Promise<TeacherCloudProfileDoc> {
  const uid = sanitizeDocId(user.uid);
  const path = `teachers/${uid}`;
  const ref = doc(db, 'teachers', uid);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as TeacherCloudProfileDoc;
    }

    const email = clampStr(user.email, 160, 'guru@edurun.id');
    const payload = {
      ownerId: uid,
      name: clampStr(localTeacher?.name || user.displayName, 100, 'Guru EduRun'),
      email,
      schoolName: clampStr(localTeacher?.schoolName, 120, 'Sekolah Nusantara'),
      maxArchivedMatches: DEFAULT_MAX_ARCHIVED_MATCHES,
      retentionDays: DEFAULT_RETENTION_DAYS,
      defaultVenue: sanitizeVenue(localTeacher?.defaultSettings?.venue),
      defaultQuestionCount: clampInt(localTeacher?.defaultSettings?.questionCount, 5, 100, 50),
      defaultMaxPlayers: clampInt(localTeacher?.defaultSettings?.maxPlayers, 2, 30, 30),
      defaultTimePerQuestion: clampInt(localTeacher?.defaultSettings?.timePerQuestion, 5, 120, 20),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(ref, payload);
    return {
      ...payload,
      createdAt: undefined,
      updatedAt: undefined,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateTeacherCloudRetention(
  uid: string,
  params: {
    maxArchivedMatches: number;
    retentionDays: number;
    defaultSettings?: RoomSettings;
  }
): Promise<void> {
  const cleanUid = sanitizeDocId(uid);
  const path = `teachers/${cleanUid}`;
  const ref = doc(db, 'teachers', cleanUid);

  try {
    await updateDoc(ref, {
      maxArchivedMatches: clampInt(params.maxArchivedMatches, 5, 25, DEFAULT_MAX_ARCHIVED_MATCHES),
      retentionDays: clampInt(params.retentionDays, 7, 90, DEFAULT_RETENTION_DAYS),
      defaultVenue: sanitizeVenue(params.defaultSettings?.venue),
      defaultQuestionCount: clampInt(params.defaultSettings?.questionCount, 5, 100, 50),
      defaultMaxPlayers: clampInt(params.defaultSettings?.maxPlayers, 2, 30, 30),
      defaultTimePerQuestion: clampInt(params.defaultSettings?.timePerQuestion, 5, 120, 20),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateTeacherCloudIdentity(
  uid: string,
  name: string,
  schoolName: string
): Promise<void> {
  const cleanUid = sanitizeDocId(uid);
  const path = `teachers/${cleanUid}`;
  const ref = doc(db, 'teachers', cleanUid);

  try {
    await updateDoc(ref, {
      name: clampStr(name, 100, 'Guru EduRun'),
      schoolName: clampStr(schoolName, 120, 'Sekolah Nusantara'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================== 2. COMPACT BUNDLED QUESTION PACKS (50 SOAL / DOC) ====================

function compactQuestion(q: QuestionItem): CompactCloudQuestion {
  const cleanOpts: Record<string, string> = {};
  for (const k of ['A', 'B', 'C', 'D'] as const) {
    const val = q.options?.[k];
    if (typeof val === 'string' && val.trim()) {
      cleanOpts[k] = val.trim().slice(0, 180);
    }
  }
  return {
    id: sanitizeDocId(q.id || `q-${Math.random().toString(36).slice(2, 10)}`),
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

/**
 * Bundles all teacher questions into compact 50-question Firestore docs (max 10 packs = 500 questions).
 * Uses ~1-2 writes total instead of 50-500 writes, keeping Spark Free Tier quota ultra-low!
 */
export async function syncQuestionBankToCloud(
  uid: string,
  questions: QuestionItem[]
): Promise<{ packCount: number; savedQuestions: number; totalBytes: number }> {
  const cleanUid = sanitizeDocId(uid);
  const colPath = `teachers/${cleanUid}/questionPacks`;
  const capped = questions.slice(0, MAX_QUESTIONS_PER_PACK * MAX_PACKS_PER_TEACHER);
  const chunks: CompactCloudQuestion[][] = [];

  for (let i = 0; i < capped.length; i += MAX_QUESTIONS_PER_PACK) {
    chunks.push(capped.slice(i, i + MAX_QUESTIONS_PER_PACK).map(compactQuestion));
  }

  let totalBytes = 0;

  try {
    // Check existing packs so we preserve createdAt on updates and delete unused trailing packs
    const existingSnap = await getDocs(
      query(collection(db, 'teachers', cleanUid, 'questionPacks'), where('ownerId', '==', cleanUid))
    );
    const existingIds = new Set(existingSnap.docs.map((d) => d.id));

    for (let packIndex = 0; packIndex < chunks.length; packIndex++) {
      const packId = `pack-${packIndex}`;
      const packQuestions = chunks[packIndex];
      const approxBytes = Math.min(240000, estimateBytes(packQuestions) + 180);
      totalBytes += approxBytes;

      const packRef = doc(db, 'teachers', cleanUid, 'questionPacks', packId);
      if (existingIds.has(packId)) {
        await updateDoc(packRef, {
          questionCount: packQuestions.length,
          approxBytes,
          questions: packQuestions,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(packRef, {
          ownerId: cleanUid,
          packIndex,
          questionCount: packQuestions.length,
          approxBytes,
          questions: packQuestions,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      existingIds.delete(packId);
    }

    // Delete obsolete trailing packs so deleted questions don't linger in storage
    for (const staleId of existingIds) {
      await deleteDoc(doc(db, 'teachers', cleanUid, 'questionPacks', staleId));
    }

    return {
      packCount: chunks.length,
      savedQuestions: capped.length,
      totalBytes,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, colPath);
  }
}

export async function loadQuestionBankFromCloud(uid: string): Promise<{
  questions: CompactCloudQuestion[];
  packs: QuestionPackSummaryDoc[];
  packCount: number;
  totalBytes: number;
}> {
  const cleanUid = sanitizeDocId(uid);
  const colPath = `teachers/${cleanUid}/questionPacks`;

  try {
    const snap = await getDocs(
      query(collection(db, 'teachers', cleanUid, 'questionPacks'), where('ownerId', '==', cleanUid))
    );
    const rawPacks = snap.docs
      .map((d) => {
        const data = d.data() as {
          packIndex?: number;
          questionCount?: number;
          approxBytes?: number;
          questions?: CompactCloudQuestion[];
          updatedAt?: Timestamp;
        };
        const qs = Array.isArray(data.questions) ? data.questions : [];
        const subjects = Array.from(new Set(qs.map((q) => q.subject).filter(Boolean))).slice(0, 6);
        const ts = data.updatedAt;
        return {
          id: d.id,
          packIndex: Number(data.packIndex ?? 0),
          questionCount: Number(data.questionCount ?? qs.length),
          approxBytes: Number(data.approxBytes ?? 0),
          subjects,
          updatedAtMs: ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now(),
          questions: qs,
        };
      })
      .sort((a, b) => a.packIndex - b.packIndex);

    const questions: CompactCloudQuestion[] = [];
    const packs: QuestionPackSummaryDoc[] = [];
    let totalBytes = 0;

    for (const p of rawPacks) {
      totalBytes += p.approxBytes;
      questions.push(...p.questions);
      packs.push({
        id: p.id,
        packIndex: p.packIndex,
        questionCount: p.questionCount,
        approxBytes: p.approxBytes,
        subjects: p.subjects,
        updatedAtMs: p.updatedAtMs,
      });
    }
    return { questions, packs, packCount: packs.length, totalBytes };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

// ==================== 3. ULTRA-COMPACT 1-DOC MATCH ARCHIVES + AUTO-CLEANUP ====================

export async function archiveMatchSummaryToCloud(
  uid: string,
  input: {
    roomId: string;
    roomCode: string;
    roomName: string;
    subject: string;
    grade: string;
    questionCount: number;
    totalLaps?: number;
    participants: PlayerState[];
  },
  retention?: { maxArchivedMatches: number; retentionDays: number }
): Promise<{ archiveId: string; approxBytes: number; prunedCount: number }> {
  const cleanUid = sanitizeDocId(uid);
  const archiveId = sanitizeDocId(`match-${input.roomCode}-${input.roomId.slice(-8)}`);
  const docPath = `teachers/${cleanUid}/matchArchives/${archiveId}`;

  const sorted = [...input.participants]
    .sort((a, b) => {
      const ra = a.scoreRank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.scoreRank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return b.score - a.score;
    })
    .slice(0, 30);

  const standings: CompactStandingRow[] = sorted.map((p, idx) => ({
    name: clampStr(p.name, 48, 'Peserta'),
    className: clampStr(p.className, 24, '-'),
    score: Math.max(0, Math.min(100, Number(Number(p.score || 0).toFixed(2)))),
    correctCount: clampInt(p.correctCount, 0, 100, 0),
    wrongCount: clampInt(p.wrongCount, 0, 100, 0),
    unansweredCount: clampInt(p.unansweredCount, 0, 100, 0),
    scoreRank: clampInt(p.scoreRank ?? idx + 1, 1, 30, idx + 1),
    finishRank: clampInt(p.finishRank ?? idx + 1, 1, 30, idx + 1),
  }));

  const avgScore =
    standings.length > 0
      ? Number((standings.reduce((acc, s) => acc + s.score, 0) / standings.length).toFixed(2))
      : 0;
  const championName = clampStr(standings[0]?.name || '', 60, '');
  const cleanCode = input.roomCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'ROOM';
  const qCount = clampInt(input.questionCount, 1, 100, 10);
  const laps = clampInt(input.totalLaps ?? calcTotalLaps(qCount), 1, 20, 1);

  const basePayload = {
    ownerId: cleanUid,
    roomCode: cleanCode.length >= 4 ? cleanCode : `${cleanCode}0000`.slice(0, 4),
    roomName: clampStr(input.roomName, 100, 'Pertandingan EduRun'),
    subject: clampStr(input.subject, 60, 'Umum'),
    grade: clampStr(input.grade, 30, 'Umum'),
    questionCount: qCount,
    totalLaps: laps,
    participantCount: standings.length,
    avgScore,
    championName,
    status: 'archived' as const,
    standings,
  };

  const approxBytes = Math.min(60000, estimateBytes(basePayload) + 120);

  try {
    const ref = doc(db, 'teachers', cleanUid, 'matchArchives', archiveId);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        ...basePayload,
        approxBytes,
        createdAt: serverTimestamp(),
      });
    }

    const prunedCount = await enforceSparkRetentionCleanup(
      cleanUid,
      retention?.maxArchivedMatches ?? DEFAULT_MAX_ARCHIVED_MATCHES,
      retention?.retentionDays ?? DEFAULT_RETENTION_DAYS
    );

    return { archiveId, approxBytes, prunedCount };
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function loadMatchArchivesFromCloud(uid: string): Promise<MatchArchiveSummaryDoc[]> {
  const cleanUid = sanitizeDocId(uid);
  const colPath = `teachers/${cleanUid}/matchArchives`;

  try {
    const snap = await getDocs(
      query(collection(db, 'teachers', cleanUid, 'matchArchives'), where('ownerId', '==', cleanUid))
    );

    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const ts = data.createdAt as Timestamp | undefined;
        return {
          id: d.id,
          ownerId: String(data.ownerId || cleanUid),
          roomCode: String(data.roomCode || ''),
          roomName: String(data.roomName || ''),
          subject: String(data.subject || ''),
          grade: String(data.grade || ''),
          questionCount: Number(data.questionCount || 0),
          totalLaps: Number(data.totalLaps || 1),
          participantCount: Number(data.participantCount || 0),
          avgScore: Number(data.avgScore || 0),
          championName: String(data.championName || ''),
          status: 'archived' as const,
          approxBytes: Number(data.approxBytes || 0),
          standings: Array.isArray(data.standings) ? (data.standings as CompactStandingRow[]) : [],
          createdAtMs: ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now(),
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

/**
 * Automatically deletes archives older than `retentionDays` OR exceeding `maxArchivedMatches`.
 * Guarantees Firestore Spark Free Tier never fills up!
 */
export async function enforceSparkRetentionCleanup(
  uid: string,
  maxArchivedMatches = DEFAULT_MAX_ARCHIVED_MATCHES,
  retentionDays = DEFAULT_RETENTION_DAYS
): Promise<number> {
  const cleanUid = sanitizeDocId(uid);
  const archives = await loadMatchArchivesFromCloud(cleanUid);
  const cutoffMs = Date.now() - clampInt(retentionDays, 7, 90, 30) * 24 * 60 * 60 * 1000;
  const maxKeep = clampInt(maxArchivedMatches, 5, 25, DEFAULT_MAX_ARCHIVED_MATCHES);

  const toDelete = archives.filter((item, index) => index >= maxKeep || item.createdAtMs < cutoffMs);
  for (const item of toDelete) {
    const path = `teachers/${cleanUid}/matchArchives/${item.id}`;
    try {
      await deleteDoc(doc(db, 'teachers', cleanUid, 'matchArchives', item.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
  return toDelete.length;
}

export async function deleteMatchArchiveFromCloud(uid: string, archiveId: string): Promise<void> {
  const cleanUid = sanitizeDocId(uid);
  const cleanArchiveId = sanitizeDocId(archiveId);
  const path = `teachers/${cleanUid}/matchArchives/${cleanArchiveId}`;
  try {
    await deleteDoc(doc(db, 'teachers', cleanUid, 'matchArchives', cleanArchiveId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteMultipleMatchArchivesFromCloud(
  uid: string,
  archiveIds: string[]
): Promise<number> {
  const cleanUid = sanitizeDocId(uid);
  const unique = Array.from(new Set(archiveIds.map((id) => sanitizeDocId(id))));
  if (unique.length === 0) return 0;

  const colPath = `teachers/${cleanUid}/matchArchives`;
  try {
    // Firestore writeBatch limit is 500 ops; chunk safely at 400
    for (let i = 0; i < unique.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of unique.slice(i, i + 400)) {
        batch.delete(doc(db, 'teachers', cleanUid, 'matchArchives', id));
      }
      await batch.commit();
    }
    return unique.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, colPath);
  }
}

export async function deleteAllMatchArchivesFromCloud(uid: string): Promise<number> {
  const archives = await loadMatchArchivesFromCloud(uid);
  if (archives.length === 0) return 0;
  return deleteMultipleMatchArchivesFromCloud(
    uid,
    archives.map((a) => a.id)
  );
}

export async function deleteQuestionPackFromCloud(uid: string, packId: string): Promise<void> {
  const cleanUid = sanitizeDocId(uid);
  const cleanPackId = sanitizeDocId(packId);
  const path = `teachers/${cleanUid}/questionPacks/${cleanPackId}`;
  try {
    await deleteDoc(doc(db, 'teachers', cleanUid, 'questionPacks', cleanPackId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteMultipleQuestionPacksFromCloud(
  uid: string,
  packIds: string[]
): Promise<number> {
  const cleanUid = sanitizeDocId(uid);
  const unique = Array.from(new Set(packIds.map((id) => sanitizeDocId(id))));
  if (unique.length === 0) return 0;

  const colPath = `teachers/${cleanUid}/questionPacks`;
  try {
    const batch = writeBatch(db);
    for (const id of unique) {
      batch.delete(doc(db, 'teachers', cleanUid, 'questionPacks', id));
    }
    await batch.commit();
    return unique.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, colPath);
  }
}

export async function deleteAllQuestionPacksFromCloud(uid: string): Promise<number> {
  const bank = await loadQuestionBankFromCloud(uid);
  if (bank.packs.length === 0) return 0;
  return deleteMultipleQuestionPacksFromCloud(
    uid,
    bank.packs.map((p) => p.id)
  );
}

/**
 * Deletes ALL archived matches AND ALL question packs for the teacher in Firebase Firestore
 * to immediately reclaim 99.9% of storage space on Spark Free Tier.
 */
export async function clearAllTeacherCloudData(
  uid: string
): Promise<{ deletedPacks: number; deletedArchives: number; freedBytes: number }> {
  const overview = await loadSparkStorageOverview(uid);
  const freedBytes = Math.max(0, overview.totalApproxBytes - 600);
  const [deletedPacks, deletedArchives] = await Promise.all([
    deleteMultipleQuestionPacksFromCloud(
      uid,
      overview.packs.map((p) => p.id)
    ),
    deleteMultipleMatchArchivesFromCloud(
      uid,
      overview.archives.map((a) => a.id)
    ),
  ]);
  return { deletedPacks, deletedArchives, freedBytes };
}

export async function loadSparkStorageOverview(uid: string): Promise<SparkStorageOverview> {
  const cleanUid = sanitizeDocId(uid);
  const profilePath = `teachers/${cleanUid}`;

  try {
    const [profileSnap, packData, archives] = await Promise.all([
      getDoc(doc(db, 'teachers', cleanUid)),
      loadQuestionBankFromCloud(cleanUid),
      loadMatchArchivesFromCloud(cleanUid),
    ]);

    const profile = profileSnap.exists() ? (profileSnap.data() as TeacherCloudProfileDoc) : null;
    const archiveBytes = archives.reduce((sum, a) => sum + (a.approxBytes || 1200), 0);
    const totalApproxBytes = 600 + packData.totalBytes + archiveBytes;
    const percentOfSpark1GiB = Number(((totalApproxBytes / SPARK_FREE_STORAGE_BYTES) * 100).toFixed(4));

    return {
      profile,
      packCount: packData.packCount,
      questionCount: packData.questions.length,
      archiveCount: archives.length,
      totalApproxBytes,
      percentOfSpark1GiB,
      packs: packData.packs,
      archives,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, profilePath);
  }
}

// ==================== 4. VERIFIED ADMIN CROSS-TEACHER MANAGEMENT ====================

export const BOOTSTRAP_ADMIN_EMAIL = 'sipmadeveloper@gmail.com';

export function isBootstrapAdminUser(user: User | null | undefined): boolean {
  return Boolean(
    user &&
      user.emailVerified &&
      typeof user.email === 'string' &&
      user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
  );
}

export interface AdminTeacherCloudSummary {
  uid: string;
  name: string;
  email: string;
  schoolName: string;
  maxArchivedMatches: number;
  retentionDays: number;
  packCount: number;
  questionCount: number;
  archiveCount: number;
  totalApproxBytes: number;
  updatedAtMs: number;
  packs: QuestionPackSummaryDoc[];
  archives: MatchArchiveSummaryDoc[];
}

export interface AdminGlobalOverview {
  teachers: AdminTeacherCloudSummary[];
  totalTeachers: number;
  totalPacks: number;
  totalQuestions: number;
  totalArchives: number;
  totalApproxBytes: number;
  percentOfSpark1GiB: number;
}

/**
 * Loads storage usage, question packs, match archives, and auto-cleanup settings
 * for EVERY teacher stored in Firestore (Verified Bootstrap Admin only).
 */
export async function loadAllTeachersCloudOverview(): Promise<AdminGlobalOverview> {
  const teachersPath = 'teachers';
  try {
    const snap = await getDocs(collection(db, 'teachers'));
    const teachers: AdminTeacherCloudSummary[] = await Promise.all(
      snap.docs.map(async (d) => {
        const uid = d.id;
        const data = d.data() as Partial<TeacherCloudProfileDoc>;
        const [packData, archives] = await Promise.all([
          loadQuestionBankFromCloud(uid),
          loadMatchArchivesFromCloud(uid),
        ]);
        const archiveBytes = archives.reduce((sum, a) => sum + (a.approxBytes || 1200), 0);
        const totalApproxBytes = 600 + packData.totalBytes + archiveBytes;
        const ts = data.updatedAt;
        return {
          uid,
          name: String(data.name || 'Guru EduRun'),
          email: String(data.email || '-'),
          schoolName: String(data.schoolName || '-'),
          maxArchivedMatches: clampInt(data.maxArchivedMatches, 5, 25, DEFAULT_MAX_ARCHIVED_MATCHES),
          retentionDays: clampInt(data.retentionDays, 7, 90, DEFAULT_RETENTION_DAYS),
          packCount: packData.packCount,
          questionCount: packData.questions.length,
          archiveCount: archives.length,
          totalApproxBytes,
          updatedAtMs: ts && typeof ts.toMillis === 'function' ? ts.toMillis() : Date.now(),
          packs: packData.packs,
          archives,
        };
      })
    );

    teachers.sort((a, b) => b.totalApproxBytes - a.totalApproxBytes);

    const totalPacks = teachers.reduce((s, t) => s + t.packCount, 0);
    const totalQuestions = teachers.reduce((s, t) => s + t.questionCount, 0);
    const totalArchives = teachers.reduce((s, t) => s + t.archiveCount, 0);
    const totalApproxBytes = teachers.reduce((s, t) => s + t.totalApproxBytes, 0);
    const percentOfSpark1GiB = Number(((totalApproxBytes / SPARK_FREE_STORAGE_BYTES) * 100).toFixed(4));

    return {
      teachers,
      totalTeachers: teachers.length,
      totalPacks,
      totalQuestions,
      totalArchives,
      totalApproxBytes,
      percentOfSpark1GiB,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, teachersPath);
  }
}

/**
 * Tier 1 Admin update: modifies ONLY auto-cleanup retention controls for any teacher.
 */
export async function adminUpdateTeacherRetention(
  teacherUid: string,
  maxArchivedMatches: number,
  retentionDays: number
): Promise<void> {
  const cleanUid = sanitizeDocId(teacherUid);
  const path = `teachers/${cleanUid}`;
  try {
    await updateDoc(doc(db, 'teachers', cleanUid), {
      maxArchivedMatches: clampInt(maxArchivedMatches, 5, 25, DEFAULT_MAX_ARCHIVED_MATCHES),
      retentionDays: clampInt(retentionDays, 7, 90, DEFAULT_RETENTION_DAYS),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Runs auto-cleanup across ALL teachers using each teacher's configured retention rules.
 */
export async function adminRunAutoCleanupAllTeachers(): Promise<{
  processedTeachers: number;
  prunedArchives: number;
}> {
  const globalData = await loadAllTeachersCloudOverview();
  let prunedArchives = 0;
  for (const t of globalData.teachers) {
    prunedArchives += await enforceSparkRetentionCleanup(
      t.uid,
      t.maxArchivedMatches,
      t.retentionDays
    );
  }
  return {
    processedTeachers: globalData.teachers.length,
    prunedArchives,
  };
}

/**
 * Applies a uniform auto-cleanup retention policy to ALL teachers and immediately prunes old archives.
 */
export async function adminApplyRetentionToAllTeachers(
  maxArchivedMatches: number,
  retentionDays: number
): Promise<{ updatedTeachers: number; prunedArchives: number }> {
  const safeMax = clampInt(maxArchivedMatches, 5, 25, DEFAULT_MAX_ARCHIVED_MATCHES);
  const safeDays = clampInt(retentionDays, 7, 90, DEFAULT_RETENTION_DAYS);
  const globalData = await loadAllTeachersCloudOverview();

  let prunedArchives = 0;
  for (const t of globalData.teachers) {
    await adminUpdateTeacherRetention(t.uid, safeMax, safeDays);
    prunedArchives += await enforceSparkRetentionCleanup(t.uid, safeMax, safeDays);
  }
  return {
    updatedTeachers: globalData.teachers.length,
    prunedArchives,
  };
}

/**
 * Master-Gate safe full removal of a teacher's cloud data AND profile document.
 * Always deletes subcollections (questionPacks & matchArchives) BEFORE deleting /teachers/{uid}.
 */
export async function adminDeleteTeacherProfileAndAllData(
  teacherUid: string
): Promise<{ deletedPacks: number; deletedArchives: number; freedBytes: number }> {
  const cleanUid = sanitizeDocId(teacherUid);
  const cleared = await clearAllTeacherCloudData(cleanUid);
  const path = `teachers/${cleanUid}`;
  try {
    await deleteDoc(doc(db, 'teachers', cleanUid));
    return {
      deletedPacks: cleared.deletedPacks,
      deletedArchives: cleared.deletedArchives,
      freedBytes: cleared.freedBytes + 600,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Deletes ALL match archives across ALL teachers in Firebase.
 */
export async function adminDeleteAllArchivesAcrossAllTeachers(): Promise<{
  clearedTeachers: number;
  deletedArchives: number;
}> {
  const globalData = await loadAllTeachersCloudOverview();
  let deletedArchives = 0;
  for (const t of globalData.teachers) {
    if (t.archives.length > 0) {
      deletedArchives += await deleteMultipleMatchArchivesFromCloud(
        t.uid,
        t.archives.map((a) => a.id)
      );
    }
  }
  return {
    clearedTeachers: globalData.teachers.length,
    deletedArchives,
  };
}

/**
 * Clears ALL packs & archives (and optionally profile docs, never deleting adminSelfUid profile)
 * for the selected list of teacher UIDs.
 */
export async function adminClearSelectedTeachersData(
  teacherUids: string[],
  options?: { includeProfiles?: boolean; adminSelfUid?: string }
): Promise<{
  clearedTeachers: number;
  deletedPacks: number;
  deletedArchives: number;
  freedBytes: number;
}> {
  const unique = Array.from(new Set(teacherUids.map((u) => sanitizeDocId(u))));
  let deletedPacks = 0;
  let deletedArchives = 0;
  let freedBytes = 0;

  for (const uid of unique) {
    const canDeleteProfile =
      Boolean(options?.includeProfiles) && uid !== options?.adminSelfUid;
    const res = canDeleteProfile
      ? await adminDeleteTeacherProfileAndAllData(uid)
      : await clearAllTeacherCloudData(uid);
    deletedPacks += res.deletedPacks;
    deletedArchives += res.deletedArchives;
    freedBytes += res.freedBytes;
  }

  return {
    clearedTeachers: unique.length,
    deletedPacks,
    deletedArchives,
    freedBytes,
  };
}
