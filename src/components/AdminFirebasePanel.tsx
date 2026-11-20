import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldAlert,
  Users,
  Trash2,
  RefreshCw,
  Loader2,
  Search,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  AlertTriangle,
  Archive,
  Database,
  HardDrive,
  Sliders,
  UserX,
  Tv,
} from 'lucide-react';
import { formatFriendlyFirestoreError } from '../firebase';
import { AdminLedBoardPanel } from './AdminLedBoardPanel';
import {
  adminApplyRetentionToAllTeachers,
  adminClearSelectedTeachersData,
  adminDeleteAllArchivesAcrossAllTeachers,
  adminDeleteTeacherProfileAndAllData,
  adminRunAutoCleanupAllTeachers,
  BOOTSTRAP_ADMIN_EMAIL,
  clearAllTeacherCloudData,
  DEFAULT_MAX_ARCHIVED_MATCHES,
  DEFAULT_RETENTION_DAYS,
  deleteAllMatchArchivesFromCloud,
  deleteAllQuestionPacksFromCloud,
  deleteMatchArchiveFromCloud,
  deleteQuestionPackFromCloud,
  enforceSparkRetentionCleanup,
  loadAllTeachersCloudOverview,
  type AdminGlobalOverview,
  type AdminTeacherCloudSummary,
} from '../services/firebaseCloudStore';

interface AdminFirebasePanelProps {
  adminUid: string;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
  onAdminMutated: () => Promise<void> | void;
}

interface ConfirmState {
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

export function AdminFirebasePanel({
  adminUid,
  onNotify,
  onAdminMutated,
}: AdminFirebasePanelProps) {
  const [overview, setOverview] = useState<AdminGlobalOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);
  const [globalMaxArchives, setGlobalMaxArchives] = useState(DEFAULT_MAX_ARCHIVED_MATCHES);
  const [globalRetentionDays, setGlobalRetentionDays] = useState(DEFAULT_RETENTION_DAYS);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [adminSection, setAdminSection] = useState<'teachers' | 'led'>('teachers');

  const loadGlobal = useCallback(async () => {
    setBusy('load-all');
    setErrorMsg(null);
    try {
      const data = await loadAllTeachersCloudOverview();
      setOverview(data);
      setSelectedUids([]);
    } catch (err) {
      setErrorMsg(formatFriendlyFirestoreError(err));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    loadGlobal().catch(() => {});
  }, [loadGlobal]);

  const filteredTeachers = useMemo(() => {
    const list = overview?.teachers ?? [];
    const q = searchText.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q) ||
        t.schoolName.toLowerCase().includes(q)
    );
  }, [overview, searchText]);

  const allFilteredSelected =
    filteredTeachers.length > 0 && filteredTeachers.every((t) => selectedUids.includes(t.uid));

  function toggleSelectTeacher(uid: string) {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredTeachers.map((t) => t.uid));
      setSelectedUids((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      setSelectedUids(Array.from(new Set([...selectedUids, ...filteredTeachers.map((t) => t.uid)])));
    }
  }

  async function runAction(actionId: string, fn: () => Promise<void>) {
    setBusy(actionId);
    setErrorMsg(null);
    try {
      await fn();
      await loadGlobal();
      await onAdminMutated();
    } catch (err) {
      const msg = formatFriendlyFirestoreError(err);
      setErrorMsg(msg);
      onNotify('err', msg);
    } finally {
      setBusy(null);
    }
  }

  function handleRunAutoCleanupAll() {
    runAction('auto-all', async () => {
      const res = await adminRunAutoCleanupAllTeachers();
      onNotify(
        'ok',
        `Hapus otomatis selesai untuk ${res.processedTeachers} akun guru (${res.prunedArchives} arsip lama dihapus).`
      );
    });
  }

  function handleApplyGlobalRetention() {
    setConfirmState({
      title: 'Terapkan Hapus Otomatis ke Semua Guru?',
      description: `Semua akun guru akan diatur ke batas maksimal ${globalMaxArchives} arsip pertandingan dan hapus otomatis arsip lebih lama dari ${globalRetentionDays} hari, lalu pembersihan langsung dijalankan sekarang.`,
      confirmLabel: 'Terapkan & Bersihkan Semua',
      onConfirm: async () => {
        await runAction('apply-global-retention', async () => {
          const res = await adminApplyRetentionToAllTeachers(
            globalMaxArchives,
            globalRetentionDays
          );
          onNotify(
            'ok',
            `Aturan hapus otomatis diterapkan ke ${res.updatedTeachers} guru dan menghapus ${res.prunedArchives} arsip lama.`
          );
        });
      },
    });
  }

  function handleDeleteAllArchivesEveryTeacher() {
    if (!overview || overview.totalArchives === 0) {
      onNotify('err', 'Tidak ada arsip lomba di akun guru mana pun.');
      return;
    }
    setConfirmState({
      title: `Hapus ${overview.totalArchives} Arsip Lomba dari Semua Guru?`,
      description:
        'Seluruh arsip ringkas pertandingan milik semua akun guru di Firebase akan dihapus permanen. Paket Bank Soal tiap guru tetap aman.',
      confirmLabel: 'Hapus Semua Arsip',
      onConfirm: async () => {
        await runAction('del-all-archives-global', async () => {
          const res = await adminDeleteAllArchivesAcrossAllTeachers();
          onNotify(
            'ok',
            `Berhasil menghapus ${res.deletedArchives} arsip lomba dari ${res.clearedTeachers} akun guru.`
          );
        });
      },
    });
  }

  function handleClearSelectedTeachers(includeProfiles: boolean) {
    if (selectedUids.length === 0) return;
    setConfirmState({
      title: includeProfiles
        ? `Hapus Akun Cloud & Data dari ${selectedUids.length} Guru Terpilih?`
        : `Kosongkan Data Cloud dari ${selectedUids.length} Guru Terpilih?`,
      description: includeProfiles
        ? 'Seluruh paket bank soal, arsip pertandingan, dan profil cloud guru terpilih (kecuali akun Admin Anda sendiri) akan dihapus permanen dari Firebase.'
        : 'Seluruh paket bank soal dan arsip pertandingan milik guru terpilih akan dihapus dari Firebase. Profil akun mereka tetap tersimpan agar tetap bisa login.',
      confirmLabel: includeProfiles ? 'Hapus Akun & Data' : 'Kosongkan Data Terpilih',
      onConfirm: async () => {
        await runAction('clear-selected-teachers', async () => {
          const res = await adminClearSelectedTeachersData(selectedUids, {
            includeProfiles,
            adminSelfUid: adminUid,
          });
          onNotify(
            'ok',
            `Selesai membersihkan ${res.clearedTeachers} guru (${res.deletedPacks} paket soal & ${res.deletedArchives} arsip dihapus, ${formatBytes(res.freedBytes)} dibebaskan).`
          );
        });
      },
    });
  }

  function handleTeacherAction(
    t: AdminTeacherCloudSummary,
    kind: 'cleanup' | 'archives' | 'packs' | 'all_data' | 'full_profile'
  ) {
    if (kind === 'cleanup') {
      runAction(`cleanup-${t.uid}`, async () => {
        const pruned = await enforceSparkRetentionCleanup(
          t.uid,
          t.maxArchivedMatches,
          t.retentionDays
        );
        onNotify(
          'ok',
          pruned > 0
            ? `Auto-cleanup pada ${t.name} menghapus ${pruned} arsip lama.`
            : `Arsip ${t.name} sudah bersih sesuai batas (${t.maxArchivedMatches} arsip / ${t.retentionDays} hari).`
        );
      });
      return;
    }

    if (kind === 'archives') {
      setConfirmState({
        title: `Hapus Semua Arsip Lomba Milik ${t.name}?`,
        description: `Menghapus ${t.archiveCount} arsip pertandingan milik ${t.email} di Firebase.`,
        confirmLabel: 'Hapus Arsip Guru',
        onConfirm: async () => {
          await runAction(`del-arc-${t.uid}`, async () => {
            const count = await deleteAllMatchArchivesFromCloud(t.uid);
            onNotify('ok', `${count} arsip lomba milik ${t.name} berhasil dihapus.`);
          });
        },
      });
      return;
    }

    if (kind === 'packs') {
      setConfirmState({
        title: `Hapus Semua Paket Soal Milik ${t.name}?`,
        description: `Menghapus ${t.packCount} paket soal (${t.questionCount} soal) milik ${t.email} di Firebase.`,
        confirmLabel: 'Hapus Paket Soal',
        onConfirm: async () => {
          await runAction(`del-packs-${t.uid}`, async () => {
            const count = await deleteAllQuestionPacksFromCloud(t.uid);
            onNotify('ok', `${count} paket soal milik ${t.name} berhasil dihapus.`);
          });
        },
      });
      return;
    }

    if (kind === 'all_data') {
      setConfirmState({
        title: `Kosongkan Semua Data Firebase Milik ${t.name}?`,
        description: `Menghapus seluruh ${t.packCount} paket soal dan ${t.archiveCount} arsip lomba milik ${t.email}. Profil akun guru tetap ada sehingga ia masih bisa login kembali.`,
        confirmLabel: 'Kosongkan Data Guru',
        onConfirm: async () => {
          await runAction(`wipe-${t.uid}`, async () => {
            const res = await clearAllTeacherCloudData(t.uid);
            onNotify(
              'ok',
              `Data ${t.name} dikosongkan (${res.deletedPacks} paket soal & ${res.deletedArchives} arsip dihapus, ${formatBytes(res.freedBytes)} dibebaskan).`
            );
          });
        },
      });
      return;
    }

    setConfirmState({
      title: `Hapus Total Akun Cloud & Data Milik ${t.name}?`,
      description: `Menghapus seluruh paket soal, arsip pertandingan, dan dokumen profil cloud milik ${t.email} dari Firebase.`,
      confirmLabel: 'Hapus Akun Cloud',
      onConfirm: async () => {
        await runAction(`drop-${t.uid}`, async () => {
          const res = await adminDeleteTeacherProfileAndAllData(t.uid);
          onNotify(
            'ok',
            `Akun cloud ${t.name} beserta ${res.deletedPacks} paket soal & ${res.deletedArchives} arsip telah dihapus.`
          );
        });
      },
    });
  }

  return (
    <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-[#1B123A] via-[#131C44] to-[#0B1733] border-2 border-amber-400/45 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
            <ShieldAlert className="w-4 h-4" />
            <span>Panel Admin Firebase ({BOOTSTRAP_ADMIN_EMAIL})</span>
          </div>
          <h3 className="font-display font-extrabold text-xl text-white">
            Pusat Kontrol Admin Stadion &amp; Firebase
          </h3>
          <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
            Sebagai Admin, Anda dapat mengelola &amp; menghapus data semua akun guru, mengatur hapus otomatis global, serta mengatur <strong>Layar LED 360° Pembatas Bawah Tribun</strong> (running text &amp; gambar sponsor bergantian).
          </p>
        </div>

        {adminSection === 'teachers' && (
          <button
            type="button"
            onClick={() => loadGlobal()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-amber-300/35 text-xs sm:text-sm font-semibold text-amber-200 cursor-pointer"
          >
            {busy === 'load-all' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>Muat Ulang Semua Guru</span>
          </button>
        )}
      </div>

      {/* Admin Sub-Navigation */}
      <div className="inline-flex flex-wrap p-1 rounded-xl bg-[#081226] border border-amber-400/30 gap-1">
        <button
          type="button"
          onClick={() => setAdminSection('teachers')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-colors ${
            adminSection === 'teachers'
              ? 'bg-[#1D4ED8] text-white'
              : 'text-slate-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Data Guru &amp; Hapus Otomatis</span>
        </button>
        <button
          type="button"
          onClick={() => setAdminSection('led')}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold cursor-pointer transition-colors ${
            adminSection === 'led'
              ? 'bg-[#FF6B1A] text-white'
              : 'text-amber-200 hover:text-white hover:bg-white/10'
          }`}
        >
          <Tv className="w-4 h-4" />
          <span>Layar LED Tribun 360° &amp; Sponsor</span>
        </button>
      </div>

      {adminSection === 'led' ? (
        <AdminLedBoardPanel adminUid={adminUid} onNotify={onNotify} />
      ) : (
        <div className="space-y-5">

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-400/45 text-xs sm:text-sm text-rose-100 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-300 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Global Combined Spark Quota Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-[#081226]/90 border border-white/10">
          <div className="text-[11px] text-slate-400 font-semibold uppercase flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-amber-300" />
            Total Akun Guru
          </div>
          <div className="font-display font-extrabold text-2xl text-white mt-1">
            {overview?.totalTeachers ?? 0}
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5">Terdaftar di Firebase</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#081226]/90 border border-white/10">
          <div className="text-[11px] text-slate-400 font-semibold uppercase flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-emerald-300" />
            Total Kuota Terpakai
          </div>
          <div className="font-display font-extrabold text-2xl text-emerald-300 mt-1">
            {formatBytes(overview?.totalApproxBytes ?? 0)}
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5">
            {overview?.percentOfSpark1GiB ?? 0}% dari 1 GiB Gratis
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#081226]/90 border border-white/10">
          <div className="text-[11px] text-slate-400 font-semibold uppercase flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-cyan-300" />
            Total Soal Cloud
          </div>
          <div className="font-display font-extrabold text-2xl text-cyan-300 mt-1">
            {overview?.totalQuestions ?? 0}
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5">
            Dalam {overview?.totalPacks ?? 0} paket kompak
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#081226]/90 border border-white/10">
          <div className="text-[11px] text-slate-400 font-semibold uppercase flex items-center gap-1.5">
            <Archive className="w-3.5 h-3.5 text-[#FACC15]" />
            Total Arsip Lomba
          </div>
          <div className="font-display font-extrabold text-2xl text-[#FACC15] mt-1">
            {overview?.totalArchives ?? 0}
          </div>
          <div className="text-[11px] text-slate-300 mt-0.5">Gabungan semua guru</div>
        </div>
      </div>

      {/* Global Auto-Cleanup Policy Bar */}
      <div className="p-4 rounded-xl bg-[#081226]/90 border border-amber-400/30 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-display font-bold text-sm sm:text-base text-amber-300">
            <Sliders className="w-4 h-4" />
            <span>Kontrol Hapus Otomatis Lintas Semua Guru</span>
          </div>
          <button
            type="button"
            onClick={handleRunAutoCleanupAll}
            disabled={busy !== null || !overview?.totalTeachers}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-xs font-bold text-white cursor-pointer disabled:opacity-50"
          >
            {busy === 'auto-all' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Jalankan Hapus Otomatis Semua Guru</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <label className="block space-y-1">
            <span className="text-xs text-slate-300 font-semibold">
              Batas Maks Arsip / Guru (5–25)
            </span>
            <input
              type="number"
              min={5}
              max={25}
              value={globalMaxArchives}
              onChange={(e) => setGlobalMaxArchives(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[#0F2957] border border-white/15 text-sm text-white font-mono"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-slate-300 font-semibold">
              Hapus Otomatis Lebih Lama Dari (7–90 hari)
            </span>
            <input
              type="number"
              min={7}
              max={90}
              value={globalRetentionDays}
              onChange={(e) => setGlobalRetentionDays(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg bg-[#0F2957] border border-white/15 text-sm text-white font-mono"
            />
          </label>
          <button
            type="button"
            onClick={handleApplyGlobalRetention}
            disabled={busy !== null || !overview?.totalTeachers}
            className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-xs sm:text-sm font-extrabold text-[#081226] cursor-pointer disabled:opacity-50"
          >
            {busy === 'apply-global-retention' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sliders className="w-4 h-4" />
            )}
            <span>Terapkan ke Semua Guru</span>
          </button>
        </div>
      </div>

      {/* Search + Multi-Select Bulk Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Cari nama guru, email, atau sekolah..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#081226] border border-white/15 text-xs sm:text-sm text-white placeholder:text-slate-400"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            disabled={filteredTeachers.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs font-semibold text-slate-200 cursor-pointer disabled:opacity-50"
          >
            {allFilteredSelected ? (
              <CheckSquare className="w-4 h-4 text-amber-300" />
            ) : (
              <Square className="w-4 h-4 text-slate-400" />
            )}
            <span>Pilih Semua ({filteredTeachers.length})</span>
          </button>

          {selectedUids.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => handleClearSelectedTeachers(false)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-xs font-bold text-white cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Kosongkan Data ({selectedUids.length})</span>
              </button>
              <button
                type="button"
                onClick={() => handleClearSelectedTeachers(true)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950 hover:bg-rose-900 border border-rose-400/50 text-xs font-bold text-rose-200 cursor-pointer"
              >
                <UserX className="w-3.5 h-3.5" />
                <span>Hapus Akun Terpilih</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={handleDeleteAllArchivesEveryTeacher}
            disabled={busy !== null || !overview?.totalArchives}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-400/35 text-xs font-semibold text-rose-200 cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Hapus Semua Arsip ({overview?.totalArchives ?? 0})</span>
          </button>
        </div>
      </div>

      {/* Per-Teacher List */}
      {busy === 'load-all' && !overview ? (
        <div className="p-8 text-center text-slate-300 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-amber-300" />
          <span>Memuat daftar akun guru dari Firebase...</span>
        </div>
      ) : filteredTeachers.length === 0 ? (
        <div className="p-6 rounded-xl bg-[#081226]/70 border border-white/10 text-center text-sm text-slate-300">
          Tidak ada akun guru yang cocok dengan pencarian.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTeachers.map((t) => {
            const isSelf = t.uid === adminUid;
            const isChecked = selectedUids.includes(t.uid);
            const isExpanded = expandedUid === t.uid;

            return (
              <div
                key={t.uid}
                className={`rounded-xl border transition-colors ${
                  isChecked
                    ? 'bg-[#172852] border-amber-400/60'
                    : 'bg-[#081226]/90 border-white/12'
                }`}
              >
                <div className="p-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleSelectTeacher(t.uid)}
                      className="mt-0.5 text-slate-300 hover:text-amber-300 cursor-pointer"
                      aria-label={`Pilih ${t.name}`}
                    >
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-amber-300" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-white text-sm sm:text-base">
                          {t.name}
                        </span>
                        {isSelf && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-amber-400/20 border border-amber-300/40 text-amber-200">
                            Admin Anda
                          </span>
                        )}
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                          {formatBytes(t.totalApproxBytes)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 mt-0.5 break-all">
                        {t.email} · {t.schoolName}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        <span>
                          Bank Soal: <strong className="text-cyan-300">{t.questionCount} soal</strong> ({t.packCount} paket)
                        </span>
                        <span>
                          Arsip Lomba: <strong className="text-[#FACC15]">{t.archiveCount}</strong>
                        </span>
                        <span>
                          Auto-Cleanup: <strong className="text-emerald-300">Maks {t.maxArchivedMatches} · {t.retentionDays} hari</strong>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Per-teacher quick action controls */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setExpandedUid(isExpanded ? null : t.uid)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0F2957] hover:bg-blue-900 border border-white/15 text-xs font-semibold text-slate-200 cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      <span>Detail</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTeacherAction(t, 'cleanup')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-400/35 text-xs font-semibold text-emerald-200 cursor-pointer disabled:opacity-50"
                      title="Jalankan hapus otomatis sesuai batas guru ini"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Auto-Clean</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTeacherAction(t, 'archives')}
                      disabled={busy !== null || t.archiveCount === 0}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-400/30 text-xs font-semibold text-rose-200 cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Arsip</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTeacherAction(t, 'packs')}
                      disabled={busy !== null || t.packCount === 0}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-400/30 text-xs font-semibold text-rose-200 cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Soal</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTeacherAction(t, 'all_data')}
                      disabled={busy !== null || (t.packCount === 0 && t.archiveCount === 0)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-700/90 hover:bg-rose-600 text-xs font-bold text-white cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Kosongkan</span>
                    </button>

                    {!isSelf && (
                      <button
                        type="button"
                        onClick={() => handleTeacherAction(t, 'full_profile')}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-950 hover:bg-rose-800 border border-rose-400/50 text-xs font-bold text-rose-200 cursor-pointer disabled:opacity-40"
                        title="Hapus total profil cloud & seluruh data guru ini"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>Hapus Akun</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Expandable per-item inspector & single-item delete */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-white/10 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Packs */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-cyan-300 uppercase">
                        Paket Bank Soal ({t.packs.length})
                      </div>
                      {t.packs.length === 0 ? (
                        <div className="text-xs text-slate-400 italic">Tidak ada paket soal di cloud.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {t.packs.map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#0F2957]/60 border border-white/10 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-white">
                                  Paket #{p.packIndex + 1} · {p.questionCount} soal ({formatBytes(p.approxBytes)})
                                </div>
                                <div className="text-[11px] text-slate-300 truncate">
                                  {p.subjects.join(', ') || 'Umum'} · {formatDateShort(p.updatedAtMs)}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() =>
                                  runAction(`del-pack-${t.uid}-${p.id}`, async () => {
                                    await deleteQuestionPackFromCloud(t.uid, p.id);
                                    onNotify('ok', `Paket #${p.packIndex + 1} milik ${t.name} dihapus.`);
                                  })
                                }
                                className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-800 border border-rose-400/30 text-rose-200 font-semibold cursor-pointer shrink-0"
                              >
                                Hapus
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Archives */}
                    <div className="space-y-2">
                      <div className="text-xs font-bold text-[#FACC15] uppercase">
                        Arsip Pertandingan ({t.archives.length})
                      </div>
                      {t.archives.length === 0 ? (
                        <div className="text-xs text-slate-400 italic">Tidak ada arsip lomba di cloud.</div>
                      ) : (
                        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                          {t.archives.map((a) => (
                            <div
                              key={a.id}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#0F2957]/60 border border-white/10 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-white truncate">
                                  {a.roomName} ({a.roomCode}) · {formatBytes(a.approxBytes)}
                                </div>
                                <div className="text-[11px] text-slate-300">
                                  {a.subject} · {a.participantCount} peserta · {formatDateShort(a.createdAtMs)}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() =>
                                  runAction(`del-arc-${t.uid}-${a.id}`, async () => {
                                    await deleteMatchArchiveFromCloud(t.uid, a.id);
                                    onNotify('ok', `Arsip ${a.roomCode} milik ${t.name} dihapus.`);
                                  })
                                }
                                className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-800 border border-rose-400/30 text-rose-200 font-semibold cursor-pointer shrink-0"
                              >
                                Hapus
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </div>
      )}

      {/* In-App Confirmation Modal (no window.confirm) */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="max-w-md w-full p-6 rounded-2xl bg-[#0F2957] border border-rose-400/50 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-300" />
              </div>
              <div>
                <h4 className="font-display font-bold text-lg text-white">{confirmState.title}</h4>
                <p className="text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed">
                  {confirmState.description}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                disabled={busy !== null}
                className="px-4 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs sm:text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  const fn = confirmState.onConfirm;
                  setConfirmState(null);
                  await fn();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs sm:text-sm font-bold text-white cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>{confirmState.confirmLabel}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
