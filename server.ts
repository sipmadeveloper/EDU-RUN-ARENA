import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';

import { db, initDatabase, DEFAULT_ROOM_SETTINGS, seedSampleQuestionsForTeacher } from './server/db.ts';
import { generateWordTemplateBuffer, parseWordDocument } from './server/wordImport.ts';
import { generateMatchExcelBuffer } from './server/excelExport.ts';
import {
  attachWebSocketHandlers,
  finishRoomMatch,
  getRoomByCode,
  getRoomById,
  invalidateRoomCache,
  joinRoomParticipant,
  startRoomMatch,
} from './server/gameManager.ts';
import {
  attachLiveRelaySocket,
  getLiveRelayStats,
  startLiveRelayCleanup,
  stopLiveRelayCleanup,
} from './server/liveRelay.ts';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcScoreFromCorrect,
  calcTotalLaps,
} from './src/utils/matchScaling.ts';

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET?.trim() || crypto.randomBytes(32).toString('hex');

initDatabase();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'edu-run-arena-3d',
    serverTime: Date.now(),
    uptimeSec: Math.round(process.uptime()),
    relay: getLiveRelayStats(),
  });
});

app.get('/api/time', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ serverTime: Date.now() });
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

interface AuthRequest extends express.Request {
  teacherId?: string;
}

function signTeacherToken(teacherId: string): string {
  return jwt.sign({ teacherId }, JWT_SECRET, { expiresIn: '7d' });
}

function requireTeacher(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!token) {
    res.status(401).json({ error: 'Autentikasi guru diperlukan.' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { teacherId: string };
    const teacher = db.prepare('SELECT id FROM teachers WHERE id = ?').get(decoded.teacherId) as
      | { id: string }
      | undefined;
    if (!teacher) {
      res.status(401).json({ error: 'Akun guru tidak ditemukan.' });
      return;
    }
    req.teacherId = teacher.id;
    next();
  } catch {
    res.status(401).json({ error: 'Sesi guru kedaluwarsa, silakan login ulang.' });
  }
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    const exists = db.prepare('SELECT id FROM rooms WHERE code = ?').get(code);
    if (!exists) return code;
  }
  return crypto.randomUUID().slice(0, 6).toUpperCase();
}

function formatTeacher(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    schoolName: String(row.school_name),
    defaultSettings: JSON.parse(String(row.default_settings_json || JSON.stringify(DEFAULT_ROOM_SETTINGS))),
  };
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/register', (_req, res) => {
  res.status(403).json({
    error: 'Pendaftaran akun guru hanya menggunakan Akun Google.',
  });
});

app.post('/api/auth/login', (_req, res) => {
  res.status(403).json({
    error: 'Login akun guru hanya menggunakan Akun Google.',
  });
});

app.post('/api/auth/firebase-session', (req, res) => {
  const { firebaseUid, email, name, schoolName } = req.body as {
    firebaseUid?: string;
    email?: string;
    name?: string;
    schoolName?: string;
  };
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanUid = String(firebaseUid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!cleanUid || !cleanEmail || !cleanEmail.includes('@')) {
    res.status(400).json({ error: 'Data akun Google Firebase tidak valid.' });
    return;
  }

  let row = db
    .prepare('SELECT * FROM teachers WHERE LOWER(email) = LOWER(?)')
    .get(cleanEmail) as Record<string, unknown> | undefined;

  let isNewOnServer = false;
  if (!row) {
    isNewOnServer = true;
    const id = `fb-${cleanUid.slice(0, 20)}`;
    const randomHash = bcrypt.hashSync(crypto.randomUUID(), 10);
    db.prepare(
      `INSERT INTO teachers (id, name, email, password_hash, school_name, default_settings_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      String(name || cleanEmail.split('@')[0]).trim().slice(0, 100),
      cleanEmail,
      randomHash,
      String(schoolName || 'Sekolah Nusantara').trim().slice(0, 120),
      JSON.stringify(DEFAULT_ROOM_SETTINGS),
      new Date().toISOString()
    );
    seedSampleQuestionsForTeacher(id);
    row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id) as Record<string, unknown>;
  }

  const token = signTeacherToken(String(row.id));
  res.json({ token, teacher: formatTeacher(row), isNewOnServer });
});

app.get('/api/auth/me', requireTeacher, (req: AuthRequest, res) => {
  const row = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.teacherId) as Record<string, unknown>;
  res.json({ teacher: formatTeacher(row) });
});

app.put('/api/auth/profile', requireTeacher, (req: AuthRequest, res) => {
  const { name, schoolName, defaultSettings } = req.body as {
    name?: string;
    schoolName?: string;
    defaultSettings?: Record<string, unknown>;
  };

  const current = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.teacherId) as Record<string, unknown>;
  const mergedSettings = {
    ...JSON.parse(String(current.default_settings_json)),
    ...(defaultSettings || {}),
  };

  db.prepare('UPDATE teachers SET name = ?, school_name = ?, default_settings_json = ? WHERE id = ?').run(
    name?.trim() || String(current.name),
    schoolName?.trim() || String(current.school_name),
    JSON.stringify(mergedSettings),
    req.teacherId
  );

  const updated = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.teacherId) as Record<string, unknown>;
  res.json({ teacher: formatTeacher(updated) });
});

// ==================== QUESTION BANK ROUTES ====================
app.get('/api/questions', requireTeacher, (req: AuthRequest, res) => {
  const subject = typeof req.query.subject === 'string' ? req.query.subject.trim() : '';
  const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';

  const rows = db
    .prepare('SELECT * FROM questions WHERE teacher_id = ? ORDER BY created_at DESC')
    .all(req.teacherId) as Array<Record<string, unknown>>;

  const formatted = rows
    .map((r) => ({
      id: String(r.id),
      subject: String(r.subject),
      grade: String(r.grade),
      questionType: String(r.question_type),
      prompt: String(r.prompt),
      options: JSON.parse(String(r.options_json || '{}')),
      correctAnswer: String(r.correct_answer),
      explanation: String(r.explanation || ''),
      createdAt: String(r.created_at),
    }))
    .filter((q) => {
      if (subject && subject !== 'Semua' && q.subject !== subject) return false;
      if (search && !q.prompt.toLowerCase().includes(search) && !q.subject.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });

  res.json({ questions: formatted });
});

app.post('/api/questions/restore-bulk', requireTeacher, (req: AuthRequest, res) => {
  const items = Array.isArray(req.body?.questions) ? (req.body.questions as Array<Record<string, unknown>>) : [];
  if (items.length === 0) {
    res.json({ added: 0, skipped: 0 });
    return;
  }

  const existingPrompts = new Set<string>(
    (
      db
        .prepare('SELECT LOWER(TRIM(prompt)) as p FROM questions WHERE teacher_id = ?')
        .all(req.teacherId) as Array<{ p: string }>
    ).map((r) => r.p)
  );

  const insert = db.prepare(
    `INSERT INTO questions (id, teacher_id, subject, grade, question_type, prompt, options_json, correct_answer, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let added = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const raw of items.slice(0, 500)) {
      const prompt = String(raw.prompt || '').trim().slice(0, 400);
      if (!prompt) continue;
      const norm = prompt.toLowerCase();
      if (existingPrompts.has(norm)) {
        skipped += 1;
        continue;
      }
      existingPrompts.add(norm);
      const qType =
        raw.questionType === 'true_false' || raw.questionType === 'short_answer'
          ? raw.questionType
          : 'multiple_choice';
      const opts = typeof raw.options === 'object' && raw.options ? raw.options : {};
      insert.run(
        `q-${crypto.randomUUID().slice(0, 8)}`,
        req.teacherId,
        String(raw.subject || 'Umum').trim().slice(0, 60),
        String(raw.grade || 'Umum').trim().slice(0, 30),
        qType,
        prompt,
        JSON.stringify(opts),
        String(raw.correctAnswer || 'A').trim().slice(0, 120),
        String(raw.explanation || '').trim().slice(0, 300),
        now
      );
      added += 1;
    }
  });
  tx();

  res.json({ added, skipped });
});

app.post('/api/questions', requireTeacher, (req: AuthRequest, res) => {
  const { subject, grade, questionType, prompt, options, correctAnswer, explanation } = req.body as {
    subject?: string;
    grade?: string;
    questionType?: string;
    prompt?: string;
    options?: Record<string, string>;
    correctAnswer?: string;
    explanation?: string;
  };

  if (!prompt?.trim() || !correctAnswer?.trim()) {
    res.status(400).json({ error: 'Pertanyaan dan kunci jawaban wajib diisi.' });
    return;
  }

  const normalizedPrompt = prompt.trim().toLowerCase();
  const dup = db
    .prepare('SELECT id FROM questions WHERE teacher_id = ? AND LOWER(TRIM(prompt)) = ?')
    .get(req.teacherId, normalizedPrompt);
  if (dup) {
    res.status(409).json({ error: 'Soal dengan pertanyaan yang sama sudah ada di Bank Soal.' });
    return;
  }

  const id = `q-${crypto.randomUUID().slice(0, 10)}`;
  const qType = questionType || 'multiple_choice';
  const cleanOptions =
    qType === 'true_false'
      ? { A: options?.A || 'Benar', B: options?.B || 'Salah' }
      : qType === 'short_answer'
      ? {}
      : {
          A: options?.A || '',
          B: options?.B || '',
          C: options?.C || '',
          D: options?.D || '',
        };

  db.prepare(
    `INSERT INTO questions (id, teacher_id, subject, grade, question_type, prompt, options_json, correct_answer, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.teacherId,
    (subject || 'Pengetahuan Umum').trim(),
    (grade || 'Umum').trim(),
    qType,
    prompt.trim(),
    JSON.stringify(cleanOptions),
    qType === 'short_answer' ? correctAnswer.trim() : correctAnswer.trim().toUpperCase(),
    (explanation || '').trim(),
    new Date().toISOString()
  );

  res.json({ id, message: 'Soal berhasil disimpan ke Bank Soal.' });
});

app.put('/api/questions/:id', requireTeacher, (req: AuthRequest, res) => {
  const { id } = req.params;
  const existing = db
    .prepare('SELECT id FROM questions WHERE id = ? AND teacher_id = ?')
    .get(id, req.teacherId);
  if (!existing) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }

  const { subject, grade, questionType, prompt, options, correctAnswer, explanation } = req.body as {
    subject: string;
    grade: string;
    questionType: string;
    prompt: string;
    options: Record<string, string>;
    correctAnswer: string;
    explanation: string;
  };

  db.prepare(
    `UPDATE questions SET subject = ?, grade = ?, question_type = ?, prompt = ?, options_json = ?, correct_answer = ?, explanation = ?
     WHERE id = ? AND teacher_id = ?`
  ).run(
    subject.trim(),
    grade.trim(),
    questionType,
    prompt.trim(),
    JSON.stringify(options || {}),
    questionType === 'short_answer' ? correctAnswer.trim() : correctAnswer.trim().toUpperCase(),
    (explanation || '').trim(),
    id,
    req.teacherId
  );

  res.json({ ok: true });
});

app.delete('/api/questions/bulk/all', requireTeacher, (req: AuthRequest, res) => {
  const result = db.prepare('DELETE FROM questions WHERE teacher_id = ?').run(req.teacherId);
  res.json({ ok: true, deleted: result.changes });
});

app.delete('/api/questions/:id', requireTeacher, (req: AuthRequest, res) => {
  const result = db
    .prepare('DELETE FROM questions WHERE id = ? AND teacher_id = ?')
    .run(req.params.id, req.teacherId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Soal tidak ditemukan.' });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/questions/seed-starter', requireTeacher, (req: AuthRequest, res) => {
  const added = seedSampleQuestionsForTeacher(req.teacherId!);
  res.json({ added, message: `${added} soal contoh berhasil ditambahkan ke Bank Soal.` });
});

// ==================== WORD TEMPLATE & IMPORT ====================
app.get('/api/questions/word-template', async (_req, res) => {
  try {
    const buffer = await generateWordTemplateBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="Template-Soal-EDU-RUN-ARENA-3D.docx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membuat template Word.' });
  }
});

app.post(
  '/api/questions/import-word/preview',
  requireTeacher,
  upload.single('file'),
  async (req: AuthRequest, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'Silakan pilih file dokumen Word (.docx).' });
      return;
    }
    try {
      const existingRows = db
        .prepare('SELECT LOWER(TRIM(prompt)) as p FROM questions WHERE teacher_id = ?')
        .all(req.teacherId) as Array<{ p: string }>;
      const existingSet = new Set(existingRows.map((r) => r.p));

      const parsed = await parseWordDocument(req.file.buffer, existingSet);
      res.json({ items: parsed });
    } catch (err) {
      res.status(400).json({ error: 'Gagal membaca file Word (.docx). Pastikan file valid dan tidak rusak.' });
    }
  }
);

app.post('/api/questions/import-word/commit', requireTeacher, (req: AuthRequest, res) => {
  const { subject, grade, items } = req.body as {
    subject?: string;
    grade?: string;
    items?: Array<{
      prompt: string;
      questionType: string;
      options: Record<string, string>;
      correctAnswer: string;
      explanation: string;
    }>;
  };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Tidak ada soal yang dipilih untuk disimpan.' });
    return;
  }

  const existingRows = db
    .prepare('SELECT LOWER(TRIM(prompt)) as p FROM questions WHERE teacher_id = ?')
    .all(req.teacherId) as Array<{ p: string }>;
  const existingSet = new Set(existingRows.map((r) => r.p));

  const insert = db.prepare(
    `INSERT INTO questions (id, teacher_id, subject, grade, question_type, prompt, options_json, correct_answer, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let saved = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    for (const item of items) {
      const norm = item.prompt?.trim().toLowerCase();
      if (!norm || !item.correctAnswer?.trim() || existingSet.has(norm)) {
        skipped++;
        continue;
      }
      existingSet.add(norm);
      insert.run(
        `q-${crypto.randomUUID().slice(0, 10)}`,
        req.teacherId,
        (subject || 'Umum').trim(),
        (grade || 'Umum').trim(),
        item.questionType || 'multiple_choice',
        item.prompt.trim(),
        JSON.stringify(item.options || {}),
        item.questionType === 'short_answer'
          ? item.correctAnswer.trim()
          : item.correctAnswer.trim().toUpperCase(),
        (item.explanation || '').trim(),
        now
      );
      saved++;
    }
  });
  tx();

  res.json({ saved, skipped, message: `${saved} soal berhasil disimpan ke Bank Soal.` });
});

// ==================== TEACHER ROOM ROUTES ====================
app.get('/api/rooms', requireTeacher, (req: AuthRequest, res) => {
  const rows = db
    .prepare(
      `SELECT r.*, t.name as teacher_name, t.school_name as school_name,
       (SELECT COUNT(*) FROM participants p WHERE p.room_id = r.id) as participant_count
       FROM rooms r
       JOIN teachers t ON t.id = r.teacher_id
       WHERE r.teacher_id = ?
       ORDER BY r.created_at DESC`
    )
    .all(req.teacherId) as Array<Record<string, unknown>>;

  const rooms = rows.map((r) => {
    const qCount = JSON.parse(String(r.question_ids_json)).length;
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name),
      subject: String(r.subject),
      grade: String(r.grade),
      teacherId: String(r.teacher_id),
      teacherName: String(r.teacher_name),
      schoolName: String(r.school_name),
      status: String(r.status),
      settings: JSON.parse(String(r.settings_json)),
      questionCount: qCount,
      totalLaps: calcTotalLaps(qCount),
      pointsPerQuestion: calcPointsPerQuestion(qCount),
      maxScore: MAX_MATCH_SCORE,
      participantCount: Number(r.participant_count || 0),
      scheduledAt: r.scheduled_at ? String(r.scheduled_at) : undefined,
      createdAt: String(r.created_at),
      startedAt: r.started_at ? String(r.started_at) : undefined,
      finishedAt: r.finished_at ? String(r.finished_at) : undefined,
    };
  });

  res.json({ rooms });
});

app.post('/api/rooms', requireTeacher, (req: AuthRequest, res) => {
  const { name, subject, grade, settings, questionIds, scheduledAt } = req.body as {
    name?: string;
    subject?: string;
    grade?: string;
    settings?: Partial<typeof DEFAULT_ROOM_SETTINGS>;
    questionIds?: string[];
    scheduledAt?: string;
  };

  if (!name?.trim() || !subject?.trim() || !grade?.trim()) {
    res.status(400).json({ error: 'Nama pertandingan, mata pelajaran, dan kelas wajib diisi.' });
    return;
  }

  const requestedCount = Math.min(50, Math.max(1, Number(settings?.questionCount || 50)));
  const maxPlayers = Math.min(30, Math.max(2, Number(settings?.maxPlayers || 30)));
  const allowShortAnswer = Boolean(settings?.allowShortAnswer);

  let selectedIds: string[] = [];
  if (Array.isArray(questionIds) && questionIds.length > 0) {
    // Validate ownership of manually selected question IDs (up to 50)
    const validRows = db
      .prepare('SELECT id FROM questions WHERE teacher_id = ?')
      .all(req.teacherId) as Array<{ id: string }>;
    const validSet = new Set(validRows.map((r) => r.id));
    selectedIds = questionIds.filter((id) => validSet.has(id)).slice(0, 50);
  } else {
    // Auto-select from teacher's question bank matching subject first, then other subjects
    const allTeacherQs = db
      .prepare('SELECT id, subject, question_type FROM questions WHERE teacher_id = ? ORDER BY created_at DESC')
      .all(req.teacherId) as Array<{ id: string; subject: string; question_type: string }>;

    const eligible = allTeacherQs.filter(
      (q) => allowShortAnswer || q.question_type !== 'short_answer'
    );
    const matchingSubject = eligible.filter(
      (q) => q.subject.toLowerCase() === subject.trim().toLowerCase()
    );
    const others = eligible.filter(
      (q) => q.subject.toLowerCase() !== subject.trim().toLowerCase()
    );
    selectedIds = [...matchingSubject, ...others].slice(0, requestedCount).map((q) => q.id);
  }

  if (selectedIds.length === 0) {
    res.status(400).json({
      error: 'Bank Soal Anda masih kosong. Tambahkan soal atau muat paket soal terlebih dahulu.',
    });
    return;
  }

  const validVenues = ['stadium_night', 'stadium_day', 'open_field'] as const;
  const venue = validVenues.includes(settings?.venue as (typeof validVenues)[number])
    ? (settings?.venue as (typeof validVenues)[number])
    : 'stadium_day';

  const finalSettings = {
    questionCount: selectedIds.length,
    maxPlayers,
    timePerQuestion: Math.min(120, Math.max(5, Number(settings?.timePerQuestion || 20))),
    baseSpeed: Math.min(15, Math.max(1.5, Number(settings?.baseSpeed || 3))),
    boostDuration: Math.min(60, Math.max(3, Number(settings?.boostDuration || 15))),
    penaltyDuration: Math.min(60, Math.max(5, Number(settings?.penaltyDuration || 30))),
    allowShortAnswer,
    venue,
    scheduledAt: scheduledAt || undefined,
  };

  const roomId = `rm-${crypto.randomUUID().slice(0, 10)}`;
  const code = generateRoomCode();

  db.prepare(
    `INSERT INTO rooms (id, code, teacher_id, name, subject, grade, status, settings_json, question_ids_json, scheduled_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`
  ).run(
    roomId,
    code,
    req.teacherId,
    name.trim(),
    subject.trim(),
    grade.trim(),
    JSON.stringify(finalSettings),
    JSON.stringify(selectedIds),
    scheduledAt || null,
    new Date().toISOString()
  );

  res.json({
    id: roomId,
    code,
    questionCount: selectedIds.length,
    totalLaps: calcTotalLaps(selectedIds.length),
    pointsPerQuestion: calcPointsPerQuestion(selectedIds.length),
    maxScore: MAX_MATCH_SCORE,
  });
});

app.get('/api/rooms/:id', requireTeacher, (req: AuthRequest, res) => {
  const room = getRoomById(String(req.params.id));
  if (!room || room.teacherId !== req.teacherId) {
    res.status(404).json({ error: 'Room tidak ditemukan atau Anda tidak memiliki akses.' });
    return;
  }

  res.json({
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      subject: room.subject,
      grade: room.grade,
      teacherName: room.teacherName,
      schoolName: room.schoolName,
      status: room.status,
      settings: room.settings,
      questionCount: room.questions.length,
      totalLaps: calcTotalLaps(room.questions.length),
      pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
      maxScore: MAX_MATCH_SCORE,
      trackLength: room.trackLength,
      startedAt: room.startedAt,
      finishedAt: room.finishedAt,
      participants: Array.from(room.participants.values()).sort((a, b) => a.lane - b.lane),
    },
  });
});

app.post('/api/rooms/:id/start', requireTeacher, (req: AuthRequest, res) => {
  const room = getRoomById(String(req.params.id));
  if (!room || room.teacherId !== req.teacherId) {
    res.status(404).json({ error: 'Room tidak ditemukan.' });
    return;
  }
  const result = startRoomMatch(room);
  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/rooms/:id/close', requireTeacher, (req: AuthRequest, res) => {
  const room = getRoomById(String(req.params.id));
  if (!room || room.teacherId !== req.teacherId) {
    res.status(404).json({ error: 'Room tidak ditemukan.' });
    return;
  }
  finishRoomMatch(room);
  res.json({ ok: true });
});

app.delete('/api/rooms/bulk/finished', requireTeacher, (req: AuthRequest, res) => {
  const rows = db
    .prepare("SELECT id FROM rooms WHERE teacher_id = ? AND status = 'finished'")
    .all(req.teacherId) as Array<{ id: string }>;
  for (const r of rows) {
    invalidateRoomCache(r.id);
  }
  const result = db
    .prepare("DELETE FROM rooms WHERE teacher_id = ? AND status = 'finished'")
    .run(req.teacherId);
  res.json({ ok: true, deleted: result.changes });
});

app.delete('/api/rooms/:id', requireTeacher, (req: AuthRequest, res) => {
  const roomId = String(req.params.id);
  const existing = db
    .prepare('SELECT id FROM rooms WHERE id = ? AND teacher_id = ?')
    .get(roomId, req.teacherId);
  if (!existing) {
    res.status(404).json({ error: 'Room tidak ditemukan.' });
    return;
  }
  invalidateRoomCache(roomId);
  db.prepare('DELETE FROM rooms WHERE id = ? AND teacher_id = ?').run(roomId, req.teacherId);
  res.json({ ok: true });
});

app.get('/api/rooms/:id/results', requireTeacher, (req: AuthRequest, res) => {
  const room = getRoomById(String(req.params.id));
  if (!room || room.teacherId !== req.teacherId) {
    res.status(404).json({ error: 'Room tidak ditemukan.' });
    return;
  }

  const participants = Array.from(room.participants.values());
  const byScore = [...participants].sort((a, b) => (a.scoreRank ?? 999) - (b.scoreRank ?? 999));
  const byFinish = [...participants].sort((a, b) => (a.finishRank ?? 999) - (b.finishRank ?? 999));

  const ansRows = db
    .prepare('SELECT * FROM answers WHERE room_id = ?')
    .all(room.id) as Array<Record<string, unknown>>;

  const questionAnalysis = room.questions.map((q, idx) => {
    const qAnswers = ansRows.filter((a) => Number(a.question_index) === idx);
    const correctCount = qAnswers.filter((a) => Number(a.is_correct) === 1).length;
    const timeoutCount = qAnswers.filter((a) => Number(a.is_timeout) === 1).length;
    const wrongCount = qAnswers.filter((a) => Number(a.is_correct) === 0 && Number(a.is_timeout) === 0).length;
    const total = Math.max(1, participants.length);
    const pct = (correctCount / total) * 100;
    return {
      questionNumber: idx + 1,
      prompt: q.prompt,
      subject: q.subject,
      correctAnswer: q.correctAnswer,
      correctCount,
      wrongCount,
      unansweredCount: Math.max(timeoutCount, participants.length - correctCount - wrongCount),
      correctPct: Number(pct.toFixed(1)),
      difficulty: pct >= 70 ? 'Mudah' : pct >= 40 ? 'Sedang' : 'Sulit',
    };
  });

  res.json({
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      subject: room.subject,
      grade: room.grade,
      teacherName: room.teacherName,
      schoolName: room.schoolName,
      status: room.status,
      questionCount: room.questions.length,
      totalLaps: calcTotalLaps(room.questions.length),
      pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
      maxScore: MAX_MATCH_SCORE,
      startedAt: room.startedAt,
      finishedAt: room.finishedAt,
    },
    byScore,
    byFinish,
    questionAnalysis,
  });
});

app.get('/api/rooms/:id/export-excel', requireTeacher, async (req: AuthRequest, res) => {
  const room = getRoomById(String(req.params.id));
  if (!room || room.teacherId !== req.teacherId) {
    res.status(404).json({ error: 'Room tidak ditemukan.' });
    return;
  }

  try {
    const participants = Array.from(room.participants.values());

    const byScore = [...participants].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      return (a.durationMs ?? 9e9) - (b.durationMs ?? 9e9);
    });

    const participantRows = byScore.map((p, idx) => ({
      name: p.name,
      className: p.className,
      correctCount: p.correctCount,
      wrongCount: p.wrongCount,
      unansweredCount: p.unansweredCount,
      totalPoints: p.score,
      finalScore: calcScoreFromCorrect(p.correctCount, room.questions.length),
      scoreRank: p.scoreRank ?? idx + 1,
      finishRank: p.finishRank,
      durationMs: p.durationMs,
    }));

    const ansRows = db
      .prepare('SELECT * FROM answers WHERE room_id = ? ORDER BY question_index ASC, answered_at ASC')
      .all(room.id) as Array<Record<string, unknown>>;

    const partMap = new Map(participants.map((p) => [p.id, p]));
    const ansLookup = new Map<string, Record<string, unknown>>();
    for (const r of ansRows) {
      ansLookup.set(`${r.participant_id}:${r.question_index}`, r);
    }

    const answerDetails = [];
    for (const p of byScore) {
      for (let qIdx = 0; qIdx < room.questions.length; qIdx++) {
        const q = room.questions[qIdx];
        const a = ansLookup.get(`${p.id}:${qIdx}`);
        let status: 'Benar' | 'Salah' | 'Tidak Dijawab' = 'Tidak Dijawab';
        if (a) {
          if (Number(a.is_correct) === 1) status = 'Benar';
          else if (Number(a.is_timeout) === 1) status = 'Tidak Dijawab';
          else status = 'Salah';
        }
        answerDetails.push({
          questionNumber: qIdx + 1,
          participantName: p.name,
          className: p.className,
          prompt: q.prompt,
          submittedAnswer: a?.submitted_answer ? String(a.submitted_answer) : '-',
          correctAnswer: q.correctAnswer,
          status,
          points: a ? Number(a.points_earned) : 0,
          responseTimeSec: a ? Number(a.response_time_ms) / 1000 : 0,
        });
      }
    }

    const questionAnalysis = room.questions.map((q, qIdx) => {
      let correctCount = 0;
      let wrongCount = 0;
      let unansweredCount = 0;
      for (const p of participants) {
        const a = ansLookup.get(`${p.id}:${qIdx}`);
        if (!a || Number(a.is_timeout) === 1) unansweredCount++;
        else if (Number(a.is_correct) === 1) correctCount++;
        else wrongCount++;
      }
      const total = Math.max(1, participants.length);
      const pct = (correctCount / total) * 100;
      const difficulty: 'Mudah' | 'Sedang' | 'Sulit' =
        pct >= 70 ? 'Mudah' : pct >= 40 ? 'Sedang' : 'Sulit';
      return {
        questionNumber: qIdx + 1,
        prompt: q.prompt,
        subject: q.subject,
        correctCount,
        wrongCount,
        unansweredCount,
        correctPct: pct,
        difficulty,
      };
    });

    const matchDateStr = room.startedAt
      ? new Date(room.startedAt).toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : new Date().toLocaleDateString('id-ID', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });

    const buffer = await generateMatchExcelBuffer(
      {
        schoolName: room.schoolName,
        teacherName: room.teacherName,
        roomName: room.name,
        subject: room.subject,
        grade: room.grade,
        roomCode: room.code,
        matchDate: matchDateStr,
        questionCount: room.questions.length,
        totalLaps: calcTotalLaps(room.questions.length),
        pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
        maxScore: MAX_MATCH_SCORE,
        participantCount: partMap.size,
      },
      participantRows,
      answerDetails,
      questionAnalysis
    );

    const safeFileName = room.code.replace(/[^A-Z0-9_-]/gi, '');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="Rekap-Nilai-${safeFileName}.xlsx"`
    );
    res.send(buffer);
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'Gagal membuat file Excel.' });
  }
});

// ==================== PUBLIC STUDENT ROUTES ====================
app.get('/api/public/rooms/:code', (req, res) => {
  const room = getRoomByCode(String(req.params.code));
  if (!room) {
    res.status(404).json({ error: 'Kode room tidak ditemukan. Periksa kembali kode dari guru Anda.' });
    return;
  }

  res.json({
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      subject: room.subject,
      grade: room.grade,
      teacherName: room.teacherName,
      schoolName: room.schoolName,
      status: room.status,
      settings: room.settings,
      questionCount: room.questions.length,
      totalLaps: calcTotalLaps(room.questions.length),
      pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
      maxScore: MAX_MATCH_SCORE,
      trackLength: room.trackLength,
      participantCount: room.participants.size,
      participants: Array.from(room.participants.values()).map((p) => ({
        id: p.id,
        name: p.name,
        className: p.className,
        avatar: p.avatar,
        lane: p.lane,
        connected: p.connected,
      })),
    },
  });
});

app.post('/api/public/rooms/:code/join', (req, res) => {
  const room = getRoomByCode(String(req.params.code));
  if (!room) {
    res.status(404).json({ error: 'Kode room tidak ditemukan.' });
    return;
  }

  const { name, className, avatar, participantId, reconnectToken } = req.body as {
    name?: string;
    className?: string;
    avatar?: { gender: 'male' | 'female'; color: string; outfit: string; presetId?: string };
    participantId?: string;
    reconnectToken?: string;
  };

  const result = joinRoomParticipant(room, {
    name: name || '',
    className: className || '',
    avatar: avatar || { gender: 'male', color: 'blue', outfit: 'sprinter' },
    participantId,
    reconnectToken,
  });

  if ('error' in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  res.json({
    reconnected: result.reconnected,
    participantId: result.participant.id,
    reconnectToken: result.participant.reconnectToken,
    participant: {
      id: result.participant.id,
      name: result.participant.name,
      className: result.participant.className,
      avatar: result.participant.avatar,
      lane: result.participant.lane,
    },
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      subject: room.subject,
      grade: room.grade,
      teacherName: room.teacherName,
      schoolName: room.schoolName,
      status: room.status,
      settings: room.settings,
      questionCount: room.questions.length,
      totalLaps: calcTotalLaps(room.questions.length),
      pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
      maxScore: MAX_MATCH_SCORE,
      trackLength: room.trackLength,
    },
  });
});

app.get('/api/public/rooms/:code/results/:participantId', (req, res) => {
  const room = getRoomByCode(String(req.params.code));
  if (!room) {
    res.status(404).json({ error: 'Room tidak ditemukan.' });
    return;
  }

  const participant = room.participants.get(String(req.params.participantId));
  if (!participant) {
    res.status(404).json({ error: 'Peserta tidak ditemukan.' });
    return;
  }

  // Anti-cheat gate: only release answer keys/explanations after participant finishes or match ends
  if (room.status !== 'finished' && participant.finishedAt == null) {
    res.status(403).json({ error: 'Pembahasan soal hanya tersedia setelah Anda mencapai garis finish atau pertandingan selesai.' });
    return;
  }

  const allParts = Array.from(room.participants.values());
  const byScore = [...allParts].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    return (a.durationMs ?? 9e9) - (b.durationMs ?? 9e9);
  });
  const byFinish = [...allParts].sort((a, b) => (a.finishRank ?? 999) - (b.finishRank ?? 999));

  const ansRows = db
    .prepare('SELECT * FROM answers WHERE room_id = ? AND participant_id = ? ORDER BY question_index ASC')
    .all(room.id, participant.id) as Array<Record<string, unknown>>;
  const ansMap = new Map(ansRows.map((a) => [Number(a.question_index), a]));

  const review = room.questions.map((q, idx) => {
    const a = ansMap.get(idx);
    return {
      questionIndex: idx,
      questionId: q.id,
      prompt: q.prompt,
      questionType: q.questionType,
      options: q.options,
      submittedAnswer: a?.submitted_answer ? String(a.submitted_answer) : null,
      correctAnswer: q.correctAnswer,
      isCorrect: a ? Number(a.is_correct) === 1 : false,
      isTimeout: a ? Number(a.is_timeout) === 1 : true,
      pointsEarned: a ? Number(a.points_earned) : 0,
      explanation: q.explanation,
      responseTimeMs: a ? Number(a.response_time_ms) : 0,
    };
  });

  res.json({
    room: {
      code: room.code,
      name: room.name,
      subject: room.subject,
      grade: room.grade,
      status: room.status,
      questionCount: room.questions.length,
      totalLaps: calcTotalLaps(room.questions.length),
      pointsPerQuestion: calcPointsPerQuestion(room.questions.length),
      maxScore: MAX_MATCH_SCORE,
    },
    byScore: byScore.map((p, i) => ({ ...p, scoreRank: p.scoreRank ?? i + 1 })),
    byFinish,
    review,
  });
});

// ==================== GLOBAL EXPRESS ERROR GUARD ====================
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const errObj = err as { code?: string; status?: number; message?: string };
  if (errObj?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Ukuran file terlalu besar (maksimal 10 MB).' });
    return;
  }
  const status = typeof errObj?.status === 'number' && errObj.status >= 400 ? errObj.status : 500;
  if (status >= 500) {
    console.error('[Express Error]', err);
  }
  res.status(status).json({
    error: status >= 500 ? 'Terjadi gangguan sementara pada server. Silakan coba lagi.' : errObj?.message || 'Permintaan tidak valid.',
  });
});

// ==================== SERVER STARTUP (HTTP + WS + VITE) ====================
async function startServer() {
  const server = http.createServer(app);
  // Proxy-safe HTTP keep-alive & low-latency TCP settings (prevents 502 / Nagle stalls)
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;
  server.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30000);
  });

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    perMessageDeflate: false,
    maxPayload: 64 * 1024,
  });

  startLiveRelayCleanup();

  // WebSocket keepalive heartbeat + TCP_NODELAY (prevents idle disconnects & 40-200ms Nagle delay)
  const aliveSockets = new WeakMap<object, boolean>();
  wss.on('connection', (ws, req) => {
    req.socket?.setNoDelay?.(true);
    aliveSockets.set(ws, true);
    ws.on('pong', () => {
      aliveSockets.set(ws, true);
    });
    ws.on('error', () => {
      // Prevent unhandled socket error events from bubbling up
    });
    attachLiveRelaySocket(ws);
  });
  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (aliveSockets.get(ws) === false) {
        ws.terminate();
        continue;
      }
      aliveSockets.set(ws, false);
      if (ws.readyState === 1) {
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
    }
  }, 20000);
  wss.on('close', () => {
    clearInterval(heartbeatTimer);
    stopLiveRelayCleanup();
  });

  attachWebSocketHandlers(wss);

  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (isProd) {
    app.use(
      express.static(distDir, {
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`EDU RUN ARENA 3D server running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    clearInterval(heartbeatTimer);
    stopLiveRelayCleanup();
    wss.close(() => {
      server.close(() => {
        try {
          db.close();
        } catch {
          // ignore
        }
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
