import { useCallback, useEffect, useState } from 'react';
import {
  HardDrive,
  CloudUpload,
  CloudDownload,
  FileSpreadsheet,
  FileJson,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  getDriveAccessToken,
  signInWithGoogleDrive,
  subscribeDriveToken,
} from '../firebase';
import {
  BANK_SOAL_FILENAME,
  buildRoomExcelFileName,
  deleteDriveFile,
  downloadQuestionBankFromDrive,
  DriveAuthExpiredError,
  EDU_RUN_FOLDER_NAME,
  listEduRunDriveFilesReadOnly,
  saveQuestionBankToDrive,
  uploadRoomExcelToDrive,
  type DriveFileItem,
  type DriveFolderInfo,
} from '../services/googleDriveService';
import { syncQuestionBankToCloud } from '../services/firebaseCloudStore';
import { mergeQuestionsDeduplicated } from '../services/starterQuestions';
import type { QuestionItem, RoomSummary, TeacherProfile } from '../types/game';

interface GoogleDrivePanelProps {
  token: string;
  teacher: TeacherProfile;
  questions: QuestionItem[];
  rooms: RoomSummary[];
  onQuestionsRestored: () => Promise<void> | void;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
}

interface ConfirmDialog {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatModified(iso: string): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
}

export function GoogleDrivePanel({
  teacher,
  questions,
  rooms,
  onQuestionsRestored,
  onNotify,
}: GoogleDrivePanelProps) {
  const [driveToken, setDriveToken] = useState<string | null>(() => getDriveAccessToken());
  const [folder, setFolder] = useState<DriveFolderInfo | null>(null);
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);

  useEffect(() => {
    if (!selectedRoomId && rooms.length > 0) {
      setSelectedRoomId(rooms[0].id);
    }
  }, [rooms, selectedRoomId]);

  useEffect(() => {
    return subscribeDriveToken((nextToken) => {
      setDriveToken(nextToken);
      if (!nextToken) {
        setFiles([]);
        setFolder(null);
      }
    });
  }, []);

  const refreshDriveFiles = useCallback(async (accessToken: string) => {
    setBusy('load-drive');
    setErrorMsg(null);
    try {
      const res = await listEduRunDriveFilesReadOnly(accessToken);
      setFolder(res.folder);
      setFiles(res.files);
    } catch (err) {
      if (err instanceof DriveAuthExpiredError) {
        setDriveToken(null);
      }
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat isi folder Google Drive.');
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (driveToken) {
      refreshDriveFiles(driveToken).catch(() => {});
    }
  }, [driveToken, refreshDriveFiles]);

  async function handleConnectDrive() {
    setBusy('connect');
    setErrorMsg(null);
    try {
      const { accessToken } = await signInWithGoogleDrive();
      setDriveToken(accessToken);
      onNotify('ok', 'Google Drive pribadi berhasil terhubung!');
      await refreshDriveFiles(accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menghubungkan Google Drive.';
      setErrorMsg(msg);
      onNotify('err', msg);
    } finally {
      setBusy(null);
    }
  }

  const existingBankFile = files.find((f) => f.name === BANK_SOAL_FILENAME);
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) || rooms[0];

  function requestSaveBankSoalToDrive() {
    if (!driveToken) return;
    if (questions.length === 0) {
      onNotify('err', 'Bank Soal lokal masih kosong.');
      return;
    }

    setConfirmDialog({
      title: existingBankFile
        ? `Perbarui ${BANK_SOAL_FILENAME} di Google Drive?`
        : `Simpan ${BANK_SOAL_FILENAME} ke Google Drive?`,
      description: existingBankFile
        ? `File cadangan "${BANK_SOAL_FILENAME}" di folder "${EDU_RUN_FOLDER_NAME}" pada Google Drive pribadi Anda akan ditimpa dengan ${questions.length} soal terbaru.`
        : `Sebanyak ${questions.length} soal akan disimpan sebagai file "${BANK_SOAL_FILENAME}" di folder "${EDU_RUN_FOLDER_NAME}" pada Google Drive pribadi Anda (menggunakan kuota Drive Anda sendiri, bukan Firebase).`,
      confirmLabel: existingBankFile ? 'Perbarui di Drive' : 'Simpan ke Drive',
      tone: 'primary',
      onConfirm: async () => {
        setBusy('save-bank');
        setErrorMsg(null);
        try {
          await saveQuestionBankToDrive(driveToken, {
            teacherName: teacher.name,
            schoolName: teacher.schoolName,
            questions,
            existingFileId: existingBankFile?.id,
          });
          onNotify(
            'ok',
            `${questions.length} soal berhasil disimpan ke Google Drive pribadi (${EDU_RUN_FOLDER_NAME}/${BANK_SOAL_FILENAME}).`
          );
          await refreshDriveFiles(driveToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gagal menyimpan Bank Soal ke Drive.';
          setErrorMsg(msg);
          onNotify('err', msg);
        } finally {
          setBusy(null);
        }
      },
    });
  }

  async function handleRestoreBankFromDrive(file: DriveFileItem) {
    if (!driveToken) return;
    setBusy(`restore-${file.id}`);
    setErrorMsg(null);
    try {
      const driveQuestions = await downloadQuestionBankFromDrive(driveToken, file.id);
      if (driveQuestions.length === 0) {
        onNotify('err', `File "${file.name}" tidak berisi soal yang valid.`);
        return;
      }
      const incoming: QuestionItem[] = driveQuestions.map((q) => ({
        id: q.id,
        subject: q.subject,
        grade: q.grade,
        questionType: q.questionType,
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        createdAt: new Date().toISOString(),
      }));
      const { merged, added, skipped } = mergeQuestionsDeduplicated(questions, incoming);
      await syncQuestionBankToCloud(teacher.id, merged);
      await onQuestionsRestored();
      onNotify(
        'ok',
        `Berhasil memulihkan ${added} soal baru dari Google Drive (${file.name}${skipped > 0 ? `, ${skipped} duplikat dilewati` : ''}).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memulihkan Bank Soal dari Drive.';
      setErrorMsg(msg);
      onNotify('err', msg);
    } finally {
      setBusy(null);
    }
  }

  function requestUploadExcelToDrive() {
    if (!driveToken || !selectedRoom) return;
    const expectedName = buildRoomExcelFileName(selectedRoom);
    const existingExcel = files.find((f) => f.name === expectedName);

    setConfirmDialog({
      title: existingExcel
        ? `Perbarui File Excel di Google Drive?`
        : `Simpan Rekap Excel ke Google Drive?`,
      description: existingExcel
        ? `File "${expectedName}" sudah ada di folder "${EDU_RUN_FOLDER_NAME}" dan akan diperbarui dengan laporan nilai terbaru dari room "${selectedRoom.name}".`
        : `Laporan nilai lengkap 3 sheet ("${expectedName}") untuk room "${selectedRoom.name}" akan disimpan ke folder "${EDU_RUN_FOLDER_NAME}" di Google Drive pribadi Anda.`,
      confirmLabel: existingExcel ? 'Perbarui Excel di Drive' : 'Simpan Excel ke Drive',
      tone: 'primary',
      onConfirm: async () => {
        setBusy('upload-excel');
        setErrorMsg(null);
        try {
          const uploaded = await uploadRoomExcelToDrive(
            driveToken,
            selectedRoom,
            existingExcel?.id
          );
          onNotify(
            'ok',
            `Rekap Excel "${uploaded.name}" berhasil disimpan ke Google Drive pribadi Anda!`
          );
          await refreshDriveFiles(driveToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gagal mengunggah Excel ke Google Drive.';
          setErrorMsg(msg);
          onNotify('err', msg);
        } finally {
          setBusy(null);
        }
      },
    });
  }

  function requestDeleteDriveFile(file: DriveFileItem) {
    if (!driveToken) return;
    setConfirmDialog({
      title: `Hapus "${file.name}" dari Google Drive?`,
      description: `File "${file.name}" (${formatBytes(file.size)}) akan dihapus permanen dari folder "${EDU_RUN_FOLDER_NAME}" di Google Drive pribadi Anda. Tindakan ini tidak dapat dibatalkan.`,
      confirmLabel: 'Hapus dari Drive',
      tone: 'danger',
      onConfirm: async () => {
        setBusy(`del-${file.id}`);
        setErrorMsg(null);
        try {
          await deleteDriveFile(driveToken, file.id);
          onNotify('ok', `File "${file.name}" berhasil dihapus dari Google Drive.`);
          await refreshDriveFiles(driveToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gagal menghapus file dari Google Drive.';
          setErrorMsg(msg);
          onNotify('err', msg);
        } finally {
          setBusy(null);
        }
      },
    });
  }

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#0F2F3C] via-[#10294B] to-[#0B1733] border border-emerald-400/35 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
            <HardDrive className="w-4 h-4" />
            <span>Google Drive Pribadi Guru (15 GB Gratis Milik Guru)</span>
          </div>
          <h3 className="font-display font-extrabold text-xl text-white">
            Simpan Bank Soal &amp; Rekap Nilai Excel ke Google Drive Anda
          </h3>
          <p className="text-xs sm:text-sm text-slate-200/90 max-w-2xl leading-relaxed">
            File Bank Soal dan laporan Excel (<code className="text-emerald-300">.xlsx</code>) disimpan langsung ke folder{' '}
            <strong className="text-[#FACC15]">{EDU_RUN_FOLDER_NAME}</strong> di Google Drive pribadi akun Google Anda —{' '}
            <strong>0 beban kuota Firebase</strong> dan tidak memengaruhi kelancaran balapan 3D.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!driveToken ? (
            <button
              type="button"
              onClick={handleConnectDrive}
              disabled={busy !== null}
              className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-800 font-semibold text-sm shadow-md border border-slate-300 cursor-pointer disabled:opacity-60 transition-colors"
            >
              {busy === 'connect' ? (
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              ) : (
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              )}
              <span>Sign in with Google</span>
            </button>
          ) : (
            <>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-xs font-bold text-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Google Drive Terhubung</span>
              </span>
              {folder?.webViewLink && (
                <a
                  href={folder.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-emerald-400/30 text-xs font-semibold text-emerald-200"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Buka Folder Drive</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <button
                type="button"
                onClick={() => refreshDriveFiles(driveToken)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                {busy === 'load-drive' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>Refresh</span>
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-400/45 text-xs sm:text-sm text-rose-100 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {driveToken && (
        <>
          {/* Two main actions: Bank Soal Sync & Excel Export to Drive */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card 1: Bank Soal -> Google Drive */}
            <div className="p-4 rounded-xl bg-[#081226]/90 border border-white/12 space-y-3">
              <div className="flex items-center gap-2 font-display font-bold text-sm sm:text-base text-cyan-300">
                <FileJson className="w-4 h-4" />
                <span>Cadangan Bank Soal di Google Drive</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Simpan seluruh <strong>{questions.length} soal</strong> lokal Anda ke file{' '}
                <code className="text-cyan-200">{BANK_SOAL_FILENAME}</code> di Google Drive pribadi atau pulihkan kapan saja di perangkat baru.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={requestSaveBankSoalToDrive}
                  disabled={busy !== null || questions.length === 0}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs sm:text-sm font-bold text-white cursor-pointer disabled:opacity-50"
                >
                  {busy === 'save-bank' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  <span>
                    {existingBankFile ? 'Perbarui Bank Soal di Drive' : 'Simpan Bank Soal ke Drive'}
                  </span>
                </button>

                {existingBankFile && (
                  <button
                    type="button"
                    onClick={() => handleRestoreBankFromDrive(existingBankFile)}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0F2957] hover:bg-blue-900 border border-cyan-400/35 text-xs sm:text-sm font-semibold text-cyan-200 cursor-pointer disabled:opacity-50"
                  >
                    {busy === `restore-${existingBankFile.id}` ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CloudDownload className="w-4 h-4" />
                    )}
                    <span>Pulihkan dari Drive</span>
                  </button>
                )}
              </div>
            </div>

            {/* Card 2: Rekap Excel -> Google Drive */}
            <div className="p-4 rounded-xl bg-[#081226]/90 border border-white/12 space-y-3">
              <div className="flex items-center gap-2 font-display font-bold text-sm sm:text-base text-emerald-300">
                <FileSpreadsheet className="w-4 h-4" />
                <span>Simpan Rekap Nilai Excel ke Google Drive</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Unggah file Excel 3 sheet (<code className="text-emerald-200">.xlsx</code>) langsung ke Google Drive pribadi agar bisa langsung dibuka di Google Sheets.
              </p>
              {rooms.length === 0 ? (
                <div className="text-xs text-slate-400 italic">
                  Buat minimal 1 room terlebih dahulu untuk menyimpan laporan Excel ke Drive.
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={selectedRoom?.id || ''}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#0F2957] border border-white/15 text-xs sm:text-sm text-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code}) · {r.participantCount} peserta
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={requestUploadExcelToDrive}
                    disabled={busy !== null || !selectedRoom}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs sm:text-sm font-bold text-white whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    {busy === 'upload-excel' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <FileSpreadsheet className="w-4 h-4" />
                    )}
                    <span>Simpan Excel ke Drive</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* File Explorer for Folder EDU RUN ARENA 3D */}
          <div className="p-4 rounded-xl bg-[#081226]/85 border border-white/10 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs sm:text-sm font-bold text-slate-200 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[#FACC15]" />
                <span>
                  Isi Folder &ldquo;{EDU_RUN_FOLDER_NAME}&rdquo; di Google Drive Anda ({files.length} file)
                </span>
              </div>
            </div>

            {files.length === 0 ? (
              <div className="text-xs text-slate-400 py-3">
                Belum ada file tersimpan di folder Google Drive ini. Klik tombol di atas untuk menyimpan Bank Soal atau Rekap Excel pertama Anda.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {files.map((file) => {
                  const isJson = file.name.toLowerCase().endsWith('.json');
                  return (
                    <div
                      key={file.id}
                      className="p-3 rounded-xl bg-[#0F2957]/65 border border-white/10 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isJson ? (
                          <FileJson className="w-4 h-4 text-cyan-300 shrink-0" />
                        ) : (
                          <FileSpreadsheet className="w-4 h-4 text-emerald-300 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs sm:text-sm font-bold text-white truncate">
                            {file.name}
                          </div>
                          <div className="text-[11px] text-slate-300">
                            {formatBytes(file.size)} · Diperbarui {formatModified(file.modifiedTime)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isJson && (
                          <button
                            type="button"
                            onClick={() => handleRestoreBankFromDrive(file)}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-400/35 text-xs font-semibold text-cyan-200 cursor-pointer"
                          >
                            {busy === `restore-${file.id}` ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <CloudDownload className="w-3.5 h-3.5" />
                            )}
                            <span>Pulihkan</span>
                          </button>
                        )}
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs font-semibold text-slate-200"
                          >
                            <span>Buka</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => requestDeleteDriveFile(file)}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/75 hover:bg-rose-900 border border-rose-400/35 text-xs font-semibold text-rose-200 cursor-pointer"
                        >
                          {busy === `del-${file.id}` ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                          <span>Hapus</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Mandatory Confirmation Modal for all Drive mutations/deletes */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-w-md w-full p-6 rounded-2xl bg-[#0F2957] border border-emerald-400/45 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  confirmDialog.tone === 'danger'
                    ? 'bg-rose-500/20 border border-rose-400/40'
                    : 'bg-emerald-500/20 border border-emerald-400/40'
                }`}
              >
                <AlertTriangle
                  className={`w-5 h-5 ${
                    confirmDialog.tone === 'danger' ? 'text-rose-300' : 'text-emerald-300'
                  }`}
                />
              </div>
              <div>
                <h4 className="font-display font-bold text-lg text-white">
                  {confirmDialog.title}
                </h4>
                <p className="text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed">
                  {confirmDialog.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                disabled={busy !== null}
                className="px-4 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs sm:text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await fn();
                }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold text-white cursor-pointer ${
                  confirmDialog.tone === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                <span>{confirmDialog.confirmLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
