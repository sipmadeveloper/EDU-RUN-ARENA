import { clearDriveAccessToken } from '../firebase';
import type { QuestionItem, QuestionType, RoomSummary } from '../types/game';

export const EDU_RUN_FOLDER_NAME = 'EDU RUN ARENA 3D';
export const BANK_SOAL_FILENAME = 'Bank-Soal-EduRun.json';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const JSON_MIME = 'application/json';

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedTime: string;
  webViewLink?: string;
}

export interface DriveFolderInfo {
  id: string;
  name: string;
  webViewLink?: string;
}

export interface DriveBankSoalPayload {
  app: 'EDU RUN ARENA 3D';
  version: 1;
  exportedAt: string;
  teacherName: string;
  schoolName: string;
  questionCount: number;
  questions: Array<{
    id: string;
    subject: string;
    grade: string;
    questionType: QuestionType;
    prompt: string;
    options: Record<string, string>;
    correctAnswer: string;
    explanation: string;
  }>;
}

export class DriveAuthExpiredError extends Error {
  constructor(message = 'Sesi izin Google Drive telah berakhir. Silakan hubungkan kembali Google Drive.') {
    super(message);
    this.name = 'DriveAuthExpiredError';
  }
}

async function driveFetch(url: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    clearDriveAccessToken();
    throw new DriveAuthExpiredError();
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error?: { message?: string } };
      if (errJson.error?.message) detail = errJson.error.message;
    } catch {
      // ignore non-json error body
    }
    throw new Error(`Google Drive error: ${detail}`);
  }
  return res;
}

/**
 * Read-only lookup for the dedicated "EDU RUN ARENA 3D" folder in the teacher's Google Drive.
 * Never creates or modifies anything in Google Drive.
 */
export async function findEduRunDriveFolder(accessToken: string): Promise<DriveFolderInfo | null> {
  const q = encodeURIComponent(
    `name = '${EDU_RUN_FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false`
  );
  const searchRes = await driveFetch(
    `${DRIVE_API_BASE}/files?q=${q}&fields=files(id,name,webViewLink)&pageSize=5`,
    accessToken
  );
  const searchData = (await searchRes.json()) as { files?: DriveFolderInfo[] };
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0];
  }
  return null;
}

/**
 * Finds or creates the dedicated "EDU RUN ARENA 3D" folder in the teacher's personal Google Drive.
 * Only invoke after explicit user confirmation on write/upload operations.
 */
export async function ensureEduRunDriveFolder(accessToken: string): Promise<DriveFolderInfo> {
  const existing = await findEduRunDriveFolder(accessToken);
  if (existing) {
    return existing;
  }

  const createRes = await driveFetch(
    `${DRIVE_API_BASE}/files?fields=id,name,webViewLink`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: EDU_RUN_FOLDER_NAME,
        mimeType: FOLDER_MIME,
      }),
    }
  );
  return (await createRes.json()) as DriveFolderInfo;
}

/**
 * Read-only listing of Bank Soal & Rekap Nilai Excel files inside the teacher's "EDU RUN ARENA 3D" folder.
 * Returns { folder: null, files: [] } without creating a folder if none exists yet.
 */
export async function listEduRunDriveFilesReadOnly(accessToken: string): Promise<{
  folder: DriveFolderInfo | null;
  files: DriveFileItem[];
}> {
  const folder = await findEduRunDriveFolder(accessToken);
  if (!folder) {
    return { folder: null, files: [] };
  }
  const q = encodeURIComponent(`'${folder.id}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,webViewLink)');
  const res = await driveFetch(
    `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=100`,
    accessToken
  );
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  const files: DriveFileItem[] = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size || 0),
    modifiedTime: f.modifiedTime || new Date().toISOString(),
    webViewLink: f.webViewLink,
  }));

  return { folder, files };
}

/**
 * Lists all Bank Soal & Rekap Nilai Excel files stored inside the teacher's "EDU RUN ARENA 3D" folder.
 */
export async function listEduRunDriveFiles(accessToken: string): Promise<{
  folder: DriveFolderInfo;
  files: DriveFileItem[];
}> {
  const folder = await ensureEduRunDriveFolder(accessToken);
  const q = encodeURIComponent(`'${folder.id}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,webViewLink)');
  const res = await driveFetch(
    `${DRIVE_API_BASE}/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=100`,
    accessToken
  );
  const data = (await res.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  const files: DriveFileItem[] = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: Number(f.size || 0),
    modifiedTime: f.modifiedTime || new Date().toISOString(),
    webViewLink: f.webViewLink,
  }));

  return { folder, files };
}

function buildMultipartBody(metadata: Record<string, unknown>, contentBlob: Blob, contentType: string): {
  boundary: string;
  body: Blob;
} {
  const boundary = `edurun_drive_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const metaPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`;
  const closingPart = `\r\n--${boundary}--`;
  return {
    boundary,
    body: new Blob([metaPart, contentBlob, closingPart], {
      type: `multipart/related; boundary=${boundary}`,
    }),
  };
}

/**
 * Saves or updates Bank Soal JSON directly inside the teacher's personal Google Drive folder.
 */
export async function saveQuestionBankToDrive(
  accessToken: string,
  params: {
    teacherName: string;
    schoolName: string;
    questions: QuestionItem[];
    existingFileId?: string;
  }
): Promise<DriveFileItem> {
  const folder = await ensureEduRunDriveFolder(accessToken);

  const payload: DriveBankSoalPayload = {
    app: 'EDU RUN ARENA 3D',
    version: 1,
    exportedAt: new Date().toISOString(),
    teacherName: params.teacherName,
    schoolName: params.schoolName,
    questionCount: params.questions.length,
    questions: params.questions.map((q) => {
      const cleanOpts: Record<string, string> = {};
      for (const k of ['A', 'B', 'C', 'D'] as const) {
        const val = q.options?.[k];
        if (typeof val === 'string' && val.trim()) {
          cleanOpts[k] = val.trim();
        }
      }
      return {
        id: q.id,
        subject: q.subject,
        grade: q.grade,
        questionType: q.questionType,
        prompt: q.prompt,
        options: cleanOpts,
        correctAnswer: q.correctAnswer || '',
        explanation: q.explanation || '',
      };
    }),
  };

  const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: JSON_MIME });
  const metadata: Record<string, unknown> = params.existingFileId
    ? { name: BANK_SOAL_FILENAME, mimeType: JSON_MIME }
    : { name: BANK_SOAL_FILENAME, mimeType: JSON_MIME, parents: [folder.id] };

  const { boundary, body } = buildMultipartBody(metadata, jsonBlob, JSON_MIME);
  const fields = encodeURIComponent('id,name,mimeType,size,modifiedTime,webViewLink');
  const url = params.existingFileId
    ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(params.existingFileId)}?uploadType=multipart&fields=${fields}`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${fields}`;

  const res = await driveFetch(url, accessToken, {
    method: params.existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });

  const saved = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  };

  return {
    id: saved.id,
    name: saved.name,
    mimeType: saved.mimeType,
    size: Number(saved.size || jsonBlob.size),
    modifiedTime: saved.modifiedTime || new Date().toISOString(),
    webViewLink: saved.webViewLink,
  };
}

/**
 * Downloads and validates a Bank Soal JSON file from the teacher's personal Google Drive.
 */
export async function downloadQuestionBankFromDrive(
  accessToken: string,
  fileId: string
): Promise<DriveBankSoalPayload['questions']> {
  const res = await driveFetch(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`,
    accessToken
  );
  const parsed = (await res.json()) as Partial<DriveBankSoalPayload> | unknown[];
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.questions)
    ? parsed.questions
    : [];

  return list
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((q, idx) => ({
      id: typeof q.id === 'string' && q.id.trim() ? q.id.trim() : `drive-q-${Date.now()}-${idx}`,
      subject: typeof q.subject === 'string' && q.subject.trim() ? q.subject.trim() : 'Umum',
      grade: typeof q.grade === 'string' && q.grade.trim() ? q.grade.trim() : 'Umum',
      questionType:
        q.questionType === 'true_false' || q.questionType === 'short_answer'
          ? q.questionType
          : 'multiple_choice',
      prompt: typeof q.prompt === 'string' && q.prompt.trim() ? q.prompt.trim() : 'Soal',
      options:
        q.options && typeof q.options === 'object'
          ? (q.options as Record<string, string>)
          : {},
      correctAnswer:
        typeof q.correctAnswer === 'string' && q.correctAnswer.trim()
          ? q.correctAnswer.trim()
          : 'A',
      explanation: typeof q.explanation === 'string' ? q.explanation : '',
    }));
}

export function buildRoomExcelFileName(room: Pick<RoomSummary, 'code' | 'name'>): string {
  const safeCode = room.code.replace(/[^A-Z0-9_-]/gi, '') || 'ROOM';
  const safeName = room.name
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 36);
  return safeName ? `Rekap-Nilai-${safeCode}-${safeName}.xlsx` : `Rekap-Nilai-${safeCode}.xlsx`;
}

/**
 * Fetches the room's .xlsx report from the server and uploads it directly into the teacher's personal Google Drive.
 */
export async function uploadRoomExcelToDrive(
  accessToken: string,
  serverToken: string,
  room: Pick<RoomSummary, 'id' | 'code' | 'name'>,
  existingFileId?: string
): Promise<DriveFileItem> {
  const excelRes = await fetch(
    `/api/rooms/${encodeURIComponent(room.id)}/export-excel?token=${encodeURIComponent(serverToken)}`
  );
  if (!excelRes.ok) {
    throw new Error('Gagal membuat file Excel dari server.');
  }
  const xlsxBlob = await excelRes.blob();
  const folder = await ensureEduRunDriveFolder(accessToken);
  const fileName = buildRoomExcelFileName(room);

  // If no explicit existingFileId provided, check if a file with the exact same name already exists in folder
  let targetFileId = existingFileId;
  if (!targetFileId) {
    const q = encodeURIComponent(
      `name = '${fileName.replace(/'/g, "\\'")}' and '${folder.id}' in parents and trashed = false`
    );
    const checkRes = await driveFetch(
      `${DRIVE_API_BASE}/files?q=${q}&fields=files(id)&pageSize=1`,
      accessToken
    );
    const checkData = (await checkRes.json()) as { files?: Array<{ id: string }> };
    if (checkData.files && checkData.files.length > 0) {
      targetFileId = checkData.files[0].id;
    }
  }

  const metadata: Record<string, unknown> = targetFileId
    ? { name: fileName, mimeType: XLSX_MIME }
    : { name: fileName, mimeType: XLSX_MIME, parents: [folder.id] };

  const { boundary, body } = buildMultipartBody(metadata, xlsxBlob, XLSX_MIME);
  const fields = encodeURIComponent('id,name,mimeType,size,modifiedTime,webViewLink');
  const url = targetFileId
    ? `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(targetFileId)}?uploadType=multipart&fields=${fields}`
    : `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=${fields}`;

  const res = await driveFetch(url, accessToken, {
    method: targetFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });

  const saved = (await res.json()) as {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  };

  return {
    id: saved.id,
    name: saved.name,
    mimeType: saved.mimeType,
    size: Number(saved.size || xlsxBlob.size),
    modifiedTime: saved.modifiedTime || new Date().toISOString(),
    webViewLink: saved.webViewLink,
  };
}

/**
 * Deletes a file owned/created by EDU RUN ARENA 3D from the teacher's personal Google Drive.
 */
export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  await driveFetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}`, accessToken, {
    method: 'DELETE',
  });
}
