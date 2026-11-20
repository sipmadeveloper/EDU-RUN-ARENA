import { useEffect, useState, useCallback } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  Cloud,
  CloudUpload,
  CloudDownload,
  Trash2,
  ShieldCheck,
  Loader2,
  LogIn,
  LogOut,
  HardDrive,
  RefreshCw,
  GitBranch,
  Archive,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Database,
  CheckSquare,
  Square,
} from 'lucide-react';
import {
  auth,
  clearDriveAccessToken,
  firebaseProjectInfo,
  formatFriendlyFirestoreError,
  signInWithGoogleAccount,
} from '../firebase';
import {
  archiveMatchSummaryToCloud,
  clearAllTeacherCloudData,
  DEFAULT_MAX_ARCHIVED_MATCHES,
  DEFAULT_RETENTION_DAYS,
  deleteAllMatchArchivesFromCloud,
  deleteAllQuestionPacksFromCloud,
  deleteMatchArchiveFromCloud,
  deleteMultipleMatchArchivesFromCloud,
  deleteMultipleQuestionPacksFromCloud,
  deleteQuestionPackFromCloud,
  enforceSparkRetentionCleanup,
  ensureTeacherCloudProfile,
  isBootstrapAdminUser,
  loadQuestionBankFromCloud,
  loadSparkStorageOverview,
  MAX_PACKS_PER_TEACHER,
  MAX_QUESTIONS_PER_PACK,
  syncQuestionBankToCloud,
  updateTeacherCloudRetention,
  type SparkStorageOverview,
} from '../services/firebaseCloudStore';
import { AdminFirebasePanel } from './AdminFirebasePanel';
import { GoogleDrivePanel } from './GoogleDrivePanel';
import type { PlayerState, QuestionItem, RoomSummary, TeacherProfile } from '../types/game';

interface FirebaseCloudPanelProps {
  token: string;
  teacher: TeacherProfile;
  questions: QuestionItem[];
  rooms: RoomSummary[];
  onQuestionsRestored: () => Promise<void> | void;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
}

interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateShort(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

export function FirebaseCloudPanel({
  token,
  teacher,
  questions,
  rooms,
  onQuestionsRestored,
  onNotify,
}: FirebaseCloudPanelProps) {
  const [fbUser, setFbUser] = useState<User | null>(auth.currentUser);
  const [authReady, setAuthReady] = useState(false);
  const [overview, setOverview] = useState<SparkStorageOverview | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const [maxArchives, setMaxArchives] = useState<number>(DEFAULT_MAX_ARCHIVED_MATCHES);
  const [retentionDays, setRetentionDays] = useState<number>(DEFAULT_RETENTION_DAYS);

  // Multi-select state for bulk deleting Firebase records
  const [selectedPackIds, setSelectedPackIds] = useState<string[]>([]);
  const [selectedArchiveIds, setSelectedArchiveIds] = useState<string[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const refreshCloud = useCallback(
    async (user: User) => {
      setBusyAction('load');
      setLocalError(null);
      try {
        const profile = await ensureTeacherCloudProfile(user, teacher);
        const stats = await loadSparkStorageOverview(user.uid);
        setOverview({ ...stats, profile: stats.profile ?? profile });
        setMaxArchives(stats.profile?.maxArchivedMatches ?? profile.maxArchivedMatches);
        setRetentionDays(stats.profile?.retentionDays ?? profile.retentionDays);
        setSelectedPackIds([]);
        setSelectedArchiveIds([]);
      } catch (err) {
        setLocalError(formatFriendlyFirestoreError(err));
      } finally {
        setBusyAction(null);
      }
    },
    [teacher]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setAuthReady(true);
      if (user) {
        refreshCloud(user).catch(() => {});
      } else {
        setOverview(null);
      }
    });
    return () => unsub();
  }, [refreshCloud]);

  async function handleGoogleConnect() {
    setBusyAction('auth');
    setLocalError(null);
    try {
      const { user, accessToken } = await signInWithGoogleAccount();
      if (user) {
        await refreshCloud(user);
        onNotify(
          'ok',
          accessToken
            ? `Terhubung otomatis ke Google Drive & akun ${user.email || user.displayName}.`
            : `Terhubung ke akun Google ${user.email || user.displayName}.`
        );
      }
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGoogleDisconnect() {
    setBusyAction('auth');
    try {
      await signOut(auth);
      clearDriveAccessToken();
      setOverview(null);
      setSelectedPackIds([]);
      setSelectedArchiveIds([]);
      onNotify('ok', 'Koneksi akun Google (Drive & Firebase) diputus.');
    } catch (err) {
      onNotify('err', formatFriendlyFirestoreError(err));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSyncQuestionsToCloud() {
    if (!fbUser) return;
    setBusyAction('sync_q');
    setLocalError(null);
    try {
      await ensureTeacherCloudProfile(fbUser, teacher);
      const res = await syncQuestionBankToCloud(fbUser.uid, questions);
      await refreshCloud(fbUser);
      onNotify(
        'ok',
        `${res.savedQuestions} soal berhasil dipaketkan ke ${res.packCount} dokumen hemat (${formatBytes(res.totalBytes)}).`
      );
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreQuestionsFromCloud() {
    if (!fbUser) return;
    setBusyAction('restore_q');
    setLocalError(null);
    try {
      const cloud = await loadQuestionBankFromCloud(fbUser.uid);
      if (cloud.questions.length === 0) {
        onNotify('err', 'Belum ada paket soal tersimpan di Firebase Cloud.');
        return;
      }
      const res = await fetch('/api/questions/restore-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ questions: cloud.questions }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memulihkan soal ke server.');
      }
      await onQuestionsRestored();
      onNotify(
        'ok',
        `Pulih dari Firebase Cloud: ${data.added} soal baru ditambahkan (${data.skipped} sudah ada).`
      );
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleArchiveFinishedRooms() {
    if (!fbUser) return;
    const finishedRooms = rooms.filter((r) => r.status === 'finished').slice(0, maxArchives);
    if (finishedRooms.length === 0) {
      onNotify('err', 'Belum ada pertandingan berstatus selesai untuk diarsipkan.');
      return;
    }

    setBusyAction('archive');
    setLocalError(null);
    try {
      await ensureTeacherCloudProfile(fbUser, teacher);
      let archivedCount = 0;
      let totalPruned = 0;

      for (const rm of finishedRooms) {
        const res = await fetch(`/api/rooms/${rm.id}/results`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const detail = (await res.json()) as {
          room: {
            id: string;
            code: string;
            name: string;
            subject: string;
            grade: string;
            questionCount: number;
            totalLaps?: number;
          };
          byScore: PlayerState[];
        };
        const out = await archiveMatchSummaryToCloud(
          fbUser.uid,
          {
            roomId: detail.room.id,
            roomCode: detail.room.code,
            roomName: detail.room.name,
            subject: detail.room.subject,
            grade: detail.room.grade,
            questionCount: detail.room.questionCount,
            totalLaps: detail.room.totalLaps,
            participants: detail.byScore || [],
          },
          { maxArchivedMatches: maxArchives, retentionDays }
        );
        archivedCount += 1;
        totalPruned += out.prunedCount;
      }

      await refreshCloud(fbUser);
      onNotify(
        'ok',
        `${archivedCount} ringkasan pertandingan disimpan hemat ke Firebase${
          totalPruned > 0 ? ` (${totalPruned} arsip lama otomatis dibersihkan).` : '.'
        }`
      );
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveRetentionAndPrune() {
    if (!fbUser) return;
    setBusyAction('retention');
    setLocalError(null);
    try {
      await ensureTeacherCloudProfile(fbUser, teacher);
      await updateTeacherCloudRetention(fbUser.uid, {
        maxArchivedMatches: maxArchives,
        retentionDays,
        defaultSettings: teacher.defaultSettings,
      });
      const pruned = await enforceSparkRetentionCleanup(fbUser.uid, maxArchives, retentionDays);
      await refreshCloud(fbUser);
      onNotify(
        'ok',
        `Aturan anti-penuh disimpan (maks ${maxArchives} arsip / ${retentionDays} hari). ${pruned} arsip lama dibersihkan.`
      );
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  // ==================== GRANULAR & BULK DELETE HANDLERS ====================

  async function handleDeleteSingleArchive(archiveId: string) {
    if (!fbUser) return;
    setBusyAction(`del-arc-${archiveId}`);
    setLocalError(null);
    try {
      await deleteMatchArchiveFromCloud(fbUser.uid, archiveId);
      await refreshCloud(fbUser);
      onNotify('ok', 'Arsip pertandingan berhasil dihapus dari Firebase.');
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteSinglePack(packId: string) {
    if (!fbUser) return;
    setBusyAction(`del-pack-${packId}`);
    setLocalError(null);
    try {
      await deleteQuestionPackFromCloud(fbUser.uid, packId);
      await refreshCloud(fbUser);
      onNotify('ok', 'Paket soal berhasil dihapus dari Firebase.');
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setLocalError(msg);
      onNotify('err', msg);
    } finally {
      setBusyAction(null);
    }
  }

  function requestBulkDeleteSelectedArchives() {
    if (!fbUser || selectedArchiveIds.length === 0) return;
    const count = selectedArchiveIds.length;
    setConfirmDialog({
      title: `Hapus ${count} Arsip Pertandingan Terpilih?`,
      description: `Sebanyak ${count} dokumen arsip pertandingan yang Anda pilih akan dihapus permanen dari Firebase Firestore untuk mengosongkan ruang.`,
      confirmLabel: `Hapus ${count} Arsip`,
      onConfirm: async () => {
        setBusyAction('del-sel-arc');
        setLocalError(null);
        try {
          const deleted = await deleteMultipleMatchArchivesFromCloud(fbUser.uid, selectedArchiveIds);
          await refreshCloud(fbUser);
          onNotify('ok', `${deleted} arsip pertandingan berhasil dihapus dari Firebase.`);
        } catch (err) {
          const msg = formatFriendlyFirestoreError(err);
          setLocalError(msg);
          onNotify('err', msg);
        } finally {
          setBusyAction(null);
        }
      },
    });
  }

  function requestBulkDeleteSelectedPacks() {
    if (!fbUser || selectedPackIds.length === 0) return;
    const count = selectedPackIds.length;
    setConfirmDialog({
      title: `Hapus ${count} Paket Soal Terpilih di Firebase?`,
      description: `Sebanyak ${count} dokumen paket soal yang dipilih akan dihapus permanen dari Firebase Firestore. Bank soal lokal di server saat ini tidak akan terhapus.`,
      confirmLabel: `Hapus ${count} Paket`,
      onConfirm: async () => {
        setBusyAction('del-sel-pack');
        setLocalError(null);
        try {
          const deleted = await deleteMultipleQuestionPacksFromCloud(fbUser.uid, selectedPackIds);
          await refreshCloud(fbUser);
          onNotify('ok', `${deleted} paket soal berhasil dihapus dari Firebase.`);
        } catch (err) {
          const msg = formatFriendlyFirestoreError(err);
          setLocalError(msg);
          onNotify('err', msg);
        } finally {
          setBusyAction(null);
        }
      },
    });
  }

  function requestDeleteAllArchives() {
    if (!fbUser || !overview || overview.archiveCount === 0) return;
    setConfirmDialog({
      title: 'Hapus Semua Arsip Pertandingan di Firebase?',
      description: `Seluruh ${overview.archiveCount} arsip riwayat pertandingan di Firebase Cloud akan dihapus permanen agar kapasitas kembali lega.`,
      confirmLabel: 'Hapus Semua Arsip',
      onConfirm: async () => {
        setBusyAction('del-all-arc');
        setLocalError(null);
        try {
          const deleted = await deleteAllMatchArchivesFromCloud(fbUser.uid);
          await refreshCloud(fbUser);
          onNotify('ok', `Semua (${deleted}) arsip pertandingan berhasil dihapus dari Firebase.`);
        } catch (err) {
          const msg = formatFriendlyFirestoreError(err);
          setLocalError(msg);
          onNotify('err', msg);
        } finally {
          setBusyAction(null);
        }
      },
    });
  }

  function requestDeleteAllPacks() {
    if (!fbUser || !overview || overview.packCount === 0) return;
    setConfirmDialog({
      title: 'Hapus Semua Paket Soal di Firebase?',
      description: `Seluruh ${overview.packCount} paket (${overview.questionCount} soal) di Firebase Cloud akan dihapus permanen. Anda tetap dapat mencadangkan ulang kapan saja.`,
      confirmLabel: 'Hapus Semua Paket Soal',
      onConfirm: async () => {
        setBusyAction('del-all-pack');
        setLocalError(null);
        try {
          const deleted = await deleteAllQuestionPacksFromCloud(fbUser.uid);
          await refreshCloud(fbUser);
          onNotify('ok', `Semua (${deleted}) paket soal berhasil dihapus dari Firebase.`);
        } catch (err) {
          const msg = formatFriendlyFirestoreError(err);
          setLocalError(msg);
          onNotify('err', msg);
        } finally {
          setBusyAction(null);
        }
      },
    });
  }

  function requestClearAllFirebaseData() {
    if (!fbUser || !overview || (overview.packCount === 0 && overview.archiveCount === 0)) return;
    setConfirmDialog({
      title: 'Kosongkan Seluruh Data di Firebase?',
      description: `Tindakan ini akan menghapus permanen ${overview.packCount} paket soal (${overview.questionCount} soal) dan ${overview.archiveCount} arsip pertandingan di Firebase Firestore (~${formatBytes(
        Math.max(0, overview.totalApproxBytes - 600)
      )} dibebaskan). Akun profil guru Anda tetap aktif.`,
      confirmLabel: 'Ya, Kosongkan Firebase',
      onConfirm: async () => {
        setBusyAction('wipe-all');
        setLocalError(null);
        try {
          const res = await clearAllTeacherCloudData(fbUser.uid);
          await refreshCloud(fbUser);
          onNotify(
            'ok',
            `Firebase dikosongkan: ${res.deletedPacks} paket soal & ${res.deletedArchives} arsip lomba dihapus (${formatBytes(res.freedBytes)} dibebaskan).`
          );
        } catch (err) {
          const msg = formatFriendlyFirestoreError(err);
          setLocalError(msg);
          onNotify('err', msg);
        } finally {
          setBusyAction(null);
        }
      },
    });
  }

  function requestDeleteAllFinishedLocalRooms() {
    if (finishedCount === 0) return;
    setConfirmDialog({
      title: `Hapus ${finishedCount} Room Selesai dari Server?`,
      description: `Semua ${finishedCount} room berstatus selesai di server aplikasi akan dihapus beserta log jawaban peserta agar server tetap ringan.`,
      confirmLabel: `Hapus ${finishedCount} Room Selesai`,
      onConfirm: async () => {
        setBusyAction('del-local-rooms');
        try {
          const res = await fetch('/api/rooms/bulk/finished', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Gagal menghapus room selesai.');
          await onQuestionsRestored();
          onNotify('ok', `${data.deleted} room selesai berhasil dibersihkan dari server.`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Gagal menghapus room selesai.';
          onNotify('err', msg);
        } finally {
          setBusyAction(null);
        }
      },
    });
  }

  function togglePackSelect(id: string) {
    setSelectedPackIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAllPacks() {
    if (!overview) return;
    if (selectedPackIds.length === overview.packs.length) {
      setSelectedPackIds([]);
    } else {
      setSelectedPackIds(overview.packs.map((p) => p.id));
    }
  }

  function toggleArchiveSelect(id: string) {
    setSelectedArchiveIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleAllArchives() {
    if (!overview) return;
    if (selectedArchiveIds.length === overview.archives.length) {
      setSelectedArchiveIds([]);
    } else {
      setSelectedArchiveIds(overview.archives.map((a) => a.id));
    }
  }

  const finishedCount = rooms.filter((r) => r.status === 'finished').length;
  const hasAnyCloudData = Boolean(overview && (overview.packCount > 0 || overview.archiveCount > 0));

  return (
    <div className="space-y-6">
      {/* Personal Teacher Google Drive Storage (Zero Firebase Quota Usage) */}
      <GoogleDrivePanel
        token={token}
        teacher={teacher}
        questions={questions}
        rooms={rooms}
        onQuestionsRestored={onQuestionsRestored}
        onNotify={onNotify}
      />

      {/* Header & Connection Status */}
      <div className="p-5 sm:p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-[#1D4ED8]/40 border border-blue-400/40 flex items-center justify-center shrink-0">
            <Cloud className="w-6 h-6 text-[#FACC15]" />
          </div>
          <div>
            <h2 className="font-display font-bold text-xl text-white">
              Firebase Cloud Gratis & Manajemen Hapus Data
            </h2>
            <p className="text-xs sm:text-sm text-blue-200/80 mt-0.5">
              Project: <span className="font-mono text-cyan-300">{firebaseProjectInfo.projectId}</span> · Mode Hemat Kuota Spark Free Tier
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {!authReady ? (
            <span className="text-xs text-slate-300 inline-flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Memeriksa sesi Firebase...
            </span>
          ) : fbUser ? (
            <>
              <div className="text-right hidden sm:block">
                <div className="text-xs font-bold text-emerald-300">{fbUser.displayName || 'Akun Google'}</div>
                <div className="text-[11px] text-slate-300">{fbUser.email}</div>
              </div>
              <button
                type="button"
                onClick={() => refreshCloud(fbUser)}
                disabled={busyAction !== null}
                className="p-2.5 rounded-xl bg-[#081226] hover:bg-blue-950 border border-white/15 text-slate-200 cursor-pointer disabled:opacity-50"
                title="Muat Ulang Status Cloud"
              >
                <RefreshCw className={`w-4 h-4 ${busyAction === 'load' ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={handleGoogleDisconnect}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#081226] hover:bg-rose-950/70 border border-rose-400/30 text-xs font-semibold text-rose-200 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>Putus Google</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleGoogleConnect}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-50 font-display font-bold text-sm text-white cursor-pointer"
            >
              {busyAction === 'auth' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </div>

      {localError && (
        <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-400/40 text-xs sm:text-sm text-rose-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" />
          <span className="break-words">{localError}</span>
        </div>
      )}

      {/* Anti-Penuh Architecture Cards */}
      <div className="grid sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-2xl bg-[#0F2957] border border-emerald-400/30">
          <div className="flex items-center gap-2 text-emerald-300 font-bold text-xs uppercase mb-1.5">
            <ShieldCheck className="w-4 h-4" />
            <span>0 Write Saat Balapan</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Animasi lari 20 FPS, posisi lintasan, dan hitung mundur diproses di RAM + WebSocket. Firestore tidak pernah dibombardir saat lomba berlangsung.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-[#0F2957] border border-cyan-400/30">
          <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs uppercase mb-1.5">
            <HardDrive className="w-4 h-4" />
            <span>Bundling 50 Soal / Dokumen</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            50 soal digabung ke 1 dokumen ringkas (~15 KB). Anda dapat menghapus paket soal per dokumen atau sekaligus langsung dari aplikasi ini.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-[#0F2957] border border-[#FACC15]/35">
          <div className="flex items-center gap-2 text-[#FACC15] font-bold text-xs uppercase mb-1.5">
            <Archive className="w-4 h-4" />
            <span>Hapus Kapan Saja + Auto-Cleanup</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Hapus arsip satuan, hapus banyak sekaligus (centang), atau kosongkan seluruh isi Firebase dalam 1 klik agar penyimpanan tidak pernah penuh.
          </p>
        </div>
      </div>

      {/* Connected Firebase Controls */}
      {fbUser && (
        <>
          {/* Spark Storage Meter + Sync & Quick Wipe Actions */}
          <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-display font-bold text-base text-white flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-[#FF6B1A]" />
                <span>Pemakaian Ruang Firebase Gratis (Kuota 1 GiB)</span>
              </div>
              <span className="font-mono text-xs font-bold text-emerald-300">
                {formatBytes(overview?.totalApproxBytes ?? 0)} / 1.024 MB ({(overview?.percentOfSpark1GiB ?? 0).toFixed(4)}%)
              </span>
            </div>

            <div className="w-full h-2.5 rounded-full bg-[#081226] overflow-hidden border border-white/10">
              <div
                className="h-full bg-emerald-400 transition-all duration-300"
                style={{ width: `${Math.max(1, Math.min(100, (overview?.percentOfSpark1GiB ?? 0) * 10))}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#081226] border border-white/10">
                <div className="text-slate-400">Paket Bank Soal</div>
                <div className="font-mono font-bold text-base text-white mt-0.5">
                  {overview?.packCount ?? 0} / {MAX_PACKS_PER_TEACHER}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#081226] border border-white/10">
                <div className="text-slate-400">Soal di Cloud</div>
                <div className="font-mono font-bold text-base text-cyan-300 mt-0.5">
                  {overview?.questionCount ?? 0} / {MAX_PACKS_PER_TEACHER * MAX_QUESTIONS_PER_PACK}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#081226] border border-white/10">
                <div className="text-slate-400">Arsip Pertandingan</div>
                <div className="font-mono font-bold text-base text-[#FACC15] mt-0.5">
                  {overview?.archiveCount ?? 0} / {maxArchives}
                </div>
              </div>
              <div className="p-3 rounded-xl bg-[#081226] border border-white/10">
                <div className="text-slate-400">Estimasi Kapasitas</div>
                <div className="font-mono font-bold text-base text-emerald-300 mt-0.5">Sangat Aman</div>
              </div>
            </div>

            {/* Sync & Restore Actions */}
            <div className="flex flex-wrap gap-2.5 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleSyncQuestionsToCloud}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 disabled:opacity-50 text-xs sm:text-sm font-semibold text-white cursor-pointer"
              >
                {busyAction === 'sync_q' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
                <span>Cadangkan {questions.length} Soal ke Firebase</span>
              </button>

              <button
                type="button"
                onClick={handleRestoreQuestionsFromCloud}
                disabled={busyAction !== null}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs sm:text-sm font-semibold text-white cursor-pointer"
              >
                {busyAction === 'restore_q' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
                <span>Pulihkan Bank Soal dari Firebase</span>
              </button>

              <button
                type="button"
                onClick={handleArchiveFinishedRooms}
                disabled={busyAction !== null || finishedCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-50 text-xs sm:text-sm font-semibold text-white cursor-pointer"
              >
                {busyAction === 'archive' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                <span>Arsipkan {finishedCount} Lomba Selesai</span>
              </button>
            </div>

            {/* Quick Bulk Cleanup / Wipe Bar */}
            <div className="p-4 rounded-xl bg-rose-950/35 border border-rose-400/30 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-rose-300">
                <Trash2 className="w-4 h-4" />
                <span>Pembersihan Cepat Data (Kosongkan Ruang Penyimpanan)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={requestDeleteAllArchives}
                  disabled={busyAction !== null || !overview || overview.archiveCount === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#081226] hover:bg-rose-900/70 disabled:opacity-40 border border-rose-400/35 text-xs font-semibold text-rose-200 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Semua Arsip Lomba ({overview?.archiveCount ?? 0})</span>
                </button>

                <button
                  type="button"
                  onClick={requestDeleteAllPacks}
                  disabled={busyAction !== null || !overview || overview.packCount === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#081226] hover:bg-rose-900/70 disabled:opacity-40 border border-rose-400/35 text-xs font-semibold text-rose-200 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Semua Paket Soal Cloud ({overview?.packCount ?? 0})</span>
                </button>

                <button
                  type="button"
                  onClick={requestDeleteAllFinishedLocalRooms}
                  disabled={busyAction !== null || finishedCount === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#081226] hover:bg-amber-900/60 disabled:opacity-40 border border-amber-400/35 text-xs font-semibold text-amber-200 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Room Selesai di Server ({finishedCount})</span>
                </button>

                <button
                  type="button"
                  onClick={requestClearAllFirebaseData}
                  disabled={busyAction !== null || !hasAnyCloudData}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-xs font-bold text-white cursor-pointer"
                >
                  {busyAction === 'wipe-all' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Kosongkan Seluruh Data Firebase</span>
                </button>
              </div>
            </div>
          </div>

          {/* Auto-Cleanup Retention Policy */}
          <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-4">
            <h3 className="font-display font-bold text-base text-white">
              Pengaturan Auto-Cleanup (Agar Database Tidak Pernah Penuh)
            </h3>
            <div className="grid sm:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                  Maksimal Arsip Pertandingan Disimpan
                </label>
                <select
                  value={maxArchives}
                  onChange={(e) => setMaxArchives(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                >
                  <option value={5}>5 pertandingan terakhir (Paling Hemat)</option>
                  <option value={10}>10 pertandingan terakhir</option>
                  <option value={15}>15 pertandingan terakhir</option>
                  <option value={20}>20 pertandingan terakhir (Rekomendasi)</option>
                  <option value={25}>25 pertandingan terakhir (Maksimal)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                  Hapus Otomatis Arsip Lebih Lama Dari
                </label>
                <select
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                >
                  <option value={7}>7 Hari</option>
                  <option value={14}>14 Hari</option>
                  <option value={30}>30 Hari (Rekomendasi)</option>
                  <option value={60}>60 Hari</option>
                  <option value={90}>90 Hari</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleSaveRetentionAndPrune}
                disabled={busyAction !== null}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-sm font-semibold text-white cursor-pointer"
              >
                {busyAction === 'retention' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>Simpan & Bersihkan Lama</span>
              </button>
            </div>
          </div>

          {/* Cloud Question Packs List (with Multi-Select & Delete) */}
          <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-cyan-300" />
                <h3 className="font-display font-bold text-base text-white">
                  Paket Bank Soal di Firebase ({overview?.packs.length ?? 0})
                </h3>
              </div>

              {overview && overview.packs.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleAllPacks}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs font-semibold text-slate-200 cursor-pointer"
                  >
                    {selectedPackIds.length === overview.packs.length ? (
                      <CheckSquare className="w-3.5 h-3.5 text-[#FACC15]" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>
                      {selectedPackIds.length === overview.packs.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                    </span>
                  </button>

                  {selectedPackIds.length > 0 && (
                    <button
                      type="button"
                      onClick={requestBulkDeleteSelectedPacks}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-xs font-bold text-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Terpilih ({selectedPackIds.length})</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!overview || overview.packs.length === 0 ? (
              <div className="py-7 text-center text-xs sm:text-sm text-slate-300 bg-[#081226]/60 rounded-xl border border-white/10">
                Belum ada paket bank soal di Firebase Cloud. Klik <strong>Cadangkan Soal ke Firebase</strong> jika ingin menyimpan cadangan online.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {overview.packs.map((pack) => {
                  const checked = selectedPackIds.includes(pack.id);
                  return (
                    <div
                      key={pack.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => togglePackSelect(pack.id)}
                          className="mt-0.5 text-slate-300 hover:text-[#FACC15] cursor-pointer"
                          aria-label={`Pilih ${pack.id}`}
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-[#FACC15]" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="font-bold text-white flex items-center gap-2">
                            <span>Paket Soal #{pack.packIndex + 1}</span>
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#081226] text-cyan-300">
                              {pack.questionCount} soal
                            </span>
                            <span className="font-mono text-[11px] text-emerald-300">
                              {formatBytes(pack.approxBytes)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-300 mt-0.5 truncate">
                            Mapel: {pack.subjects.length > 0 ? pack.subjects.join(', ') : 'Umum'} · Diperbarui{' '}
                            {formatDateShort(pack.updatedAtMs)}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteSinglePack(pack.id)}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-400/30 text-xs font-semibold text-rose-200 cursor-pointer"
                      >
                        {busyAction === `del-pack-${pack.id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Hapus</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cloud Match Archives List (with Multi-Select & Delete) */}
          <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-[#FACC15]" />
                <h3 className="font-display font-bold text-base text-white">
                  Arsip Ringkas Pertandingan di Firebase ({overview?.archives.length ?? 0})
                </h3>
              </div>

              {overview && overview.archives.length > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleAllArchives}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs font-semibold text-slate-200 cursor-pointer"
                  >
                    {selectedArchiveIds.length === overview.archives.length ? (
                      <CheckSquare className="w-3.5 h-3.5 text-[#FACC15]" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    <span>
                      {selectedArchiveIds.length === overview.archives.length ? 'Batal Pilih Semua' : 'Pilih Semua'}
                    </span>
                  </button>

                  {selectedArchiveIds.length > 0 && (
                    <button
                      type="button"
                      onClick={requestBulkDeleteSelectedArchives}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-xs font-bold text-white cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Terpilih ({selectedArchiveIds.length})</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {!overview || overview.archives.length === 0 ? (
              <div className="py-8 text-center text-xs sm:text-sm text-slate-300 bg-[#081226]/60 rounded-xl border border-white/10">
                Belum ada arsip pertandingan di Firebase Cloud. Selesaikan pertandingan lalu klik <strong>Arsipkan Lomba Selesai</strong>.
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {overview.archives.map((arc) => {
                  const checked = selectedArchiveIds.includes(arc.id);
                  return (
                    <div
                      key={arc.id}
                      className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleArchiveSelect(arc.id)}
                          className="mt-0.5 text-slate-300 hover:text-[#FACC15] cursor-pointer"
                          aria-label={`Pilih ${arc.roomName}`}
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-[#FACC15]" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="font-bold text-white flex items-center gap-2 flex-wrap">
                            <span className="truncate">{arc.roomName}</span>
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-[#081226] text-[#FACC15]">
                              {arc.roomCode}
                            </span>
                            <span className="font-mono text-[11px] text-emerald-300">
                              {formatBytes(arc.approxBytes)}
                            </span>
                          </div>
                          <div className="text-xs text-slate-300 mt-0.5">
                            {arc.subject} · Kelas {arc.grade} · {arc.participantCount} Peserta · Rata-rata {arc.avgScore} · Juara 1:{' '}
                            <strong className="text-[#FACC15]">{arc.championName || '-'}</strong> ·{' '}
                            <span>{formatDateShort(arc.createdAtMs)}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeleteSingleArchive(arc.id)}
                        disabled={busyAction !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-400/30 text-xs font-semibold text-rose-200 cursor-pointer"
                      >
                        {busyAction === `del-arc-${arc.id}` ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>Hapus</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Verified Admin Cross-Teacher Management Panel */}
          {isBootstrapAdminUser(fbUser) && (
            <AdminFirebasePanel
              adminUid={fbUser.uid}
              onNotify={onNotify}
              onAdminMutated={() => refreshCloud(fbUser)}
            />
          )}
        </>
      )}

      {/* GitHub Deployment Guide */}
      <div className="p-5 rounded-2xl bg-[#081226] border border-blue-400/30 space-y-3">
        <div className="flex items-center gap-2 font-display font-bold text-base text-[#FACC15]">
          <GitBranch className="w-4 h-4" />
          <span>Checklist Deploy via GitHub (Cloud Run / Render / Railway)</span>
        </div>
        <ol className="list-decimal list-inside space-y-1.5 text-xs sm:text-sm text-slate-200 leading-relaxed">
          <li>
            Push repositori ke GitHub (file <code className="text-cyan-300">.env</code> dan folder lokal{' '}
            <code className="text-cyan-300">data/</code> sudah otomatis diabaikan oleh <code className="text-cyan-300">.gitignore</code>).
          </li>
          <li>
            Hubungkan repositori GitHub ke layanan hosting Node.js + WebSocket (misalnya <strong>Google Cloud Run</strong>, <strong>Render</strong>, atau <strong>Railway</strong>).
          </li>
          <li>
            Atur Build Command: <code className="text-[#FACC15]">npm install &amp;&amp; npm run build</code> dan Start Command:{' '}
            <code className="text-[#FACC15]">NODE_ENV=production npx tsx server.ts</code>.
          </li>
          <li>
            Tambahkan Environment Variables di dashboard hosting:{' '}
            <code className="text-emerald-300">NODE_ENV=production</code> dan{' '}
            <code className="text-emerald-300">JWT_SECRET</code> (teks acak bebas untuk sesi guru — <strong>tanpa perlu API Key AI apa pun!</strong>).
          </li>
          <li>
            Tambahkan domain produksi Anda ke <strong>Firebase Console &rarr; Authentication &rarr; Settings &rarr; Authorized domains</strong>.
          </li>
        </ol>
      </div>

      {/* In-App Confirmation Modal (no window.confirm) */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-md w-full p-6 rounded-2xl bg-[#0F2957] border border-rose-400/45 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-300" />
              </div>
              <div>
                <h4 className="font-display font-bold text-lg text-white">{confirmDialog.title}</h4>
                <p className="text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed">
                  {confirmDialog.description}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                disabled={busyAction !== null}
                className="px-4 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs sm:text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busyAction !== null}
                onClick={async () => {
                  const fn = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await fn();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs sm:text-sm font-bold text-white cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>{confirmDialog.confirmLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
