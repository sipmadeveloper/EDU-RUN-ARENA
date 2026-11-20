import { useEffect, useState, useCallback } from 'react';
import {
  LayoutDashboard,
  PlusSquare,
  ListChecks,
  Database,
  FilePlus2,
  FileText,
  Trophy,
  FileSpreadsheet,
  Settings,
  UserCircle,
  LogOut,
  Menu,
  X,
  Play,
  Trash2,
  Copy,
  Check,
  Download,
  Upload,
  Eye,
  AlertCircle,
  CheckCircle2,
  Search,
  Edit3,
  Sparkles,
  Sun,
  Moon,
  Trees,
  Cloud,
  HardDrive,
  Loader2,
} from 'lucide-react';
import {
  RACE_VENUES,
  type PlayerState,
  type QuestionItem,
  type QuestionType,
  type RaceVenueId,
  type RoomSettings,
  type RoomSummary,
  type TeacherProfile,
} from '../types/game';
import { TeacherRoomMonitor } from './TeacherRoomMonitor';
import { VictoryPodium3D } from './VictoryPodium3D';
import { FirebaseCloudPanel } from './FirebaseCloudPanel';
import { AppLogo } from './AppLogo';
import {
  clearDriveAccessToken,
  getDriveAccessToken,
  signInWithGoogleDrive,
  subscribeDriveToken,
} from '../firebase';
import {
  buildRoomExcelFileName,
  EDU_RUN_FOLDER_NAME,
  uploadRoomExcelToDrive,
} from '../services/googleDriveService';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcTotalLaps,
  formatScoreValue,
} from '../utils/matchScaling';

type DashboardTab =
  | 'overview'
  | 'create_room'
  | 'rooms'
  | 'bank'
  | 'add_question'
  | 'import_word'
  | 'results'
  | 'excel'
  | 'cloud'
  | 'settings'
  | 'profile';

interface WordPreviewItem {
  number: number;
  prompt: string;
  questionType: QuestionType;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
  valid: boolean;
  warnings: string[];
  isDuplicate: boolean;
  selected?: boolean;
}

interface RoomResultDetail {
  room: {
    id: string;
    code: string;
    name: string;
    subject: string;
    grade: string;
    teacherName: string;
    schoolName: string;
    status: string;
    questionCount: number;
    totalLaps?: number;
    pointsPerQuestion?: number;
    maxScore?: number;
  };
  byScore: PlayerState[];
  byFinish: PlayerState[];
  questionAnalysis: Array<{
    questionNumber: number;
    prompt: string;
    subject: string;
    correctCount: number;
    wrongCount: number;
    unansweredCount: number;
    correctPct: number;
    difficulty: string;
  }>;
}

interface TeacherDashboardProps {
  token: string;
  teacher: TeacherProfile;
  onTeacherUpdated: (teacher: TeacherProfile) => void;
  onLogout: () => void;
}

const MENU_ITEMS: Array<{ id: DashboardTab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Dashboard Utama', icon: LayoutDashboard },
  { id: 'create_room', label: 'Buat Room', icon: PlusSquare },
  { id: 'rooms', label: 'Daftar Room', icon: ListChecks },
  { id: 'bank', label: 'Bank Soal', icon: Database },
  { id: 'add_question', label: 'Tambah Soal', icon: FilePlus2 },
  { id: 'import_word', label: 'Impor Soal Word', icon: FileText },
  { id: 'results', label: 'Hasil Pertandingan', icon: Trophy },
  { id: 'excel', label: 'Rekap Nilai Excel', icon: FileSpreadsheet },
  { id: 'cloud', label: 'Cloud & Drive', icon: Cloud },
  { id: 'settings', label: 'Pengaturan Game', icon: Settings },
  { id: 'profile', label: 'Profil Guru', icon: UserCircle },
];

export function TeacherDashboard({
  token,
  teacher,
  onTeacherUpdated,
  onLogout,
}: TeacherDashboardProps) {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [monitoringRoomId, setMonitoringRoomId] = useState<string | null>(null);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [bannerMsg, setBannerMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Create Room Form
  const [rmName, setRmName] = useState('');
  const [rmSubject, setRmSubject] = useState('Matematika');
  const [rmGrade, setRmGrade] = useState('VIII-A');
  const [rmSettings, setRmSettings] = useState<RoomSettings>(teacher.defaultSettings);
  const [rmSchedule, setRmSchedule] = useState('');
  const [rmPickManual, setRmPickManual] = useState(false);
  const [rmSelectedQIds, setRmSelectedQIds] = useState<string[]>([]);

  // Bank Soal Filter & Edit
  const [qFilterSubject, setQFilterSubject] = useState('Semua');
  const [qSearch, setQSearch] = useState('');
  const [editingQ, setEditingQ] = useState<QuestionItem | null>(null);

  // Add Question Manual Form
  const [newQSubject, setNewQSubject] = useState('Matematika');
  const [newQGrade, setNewQGrade] = useState('Umum');
  const [newQType, setNewQType] = useState<QuestionType>('multiple_choice');
  const [newQPrompt, setNewQPrompt] = useState('');
  const [newQOpts, setNewQOpts] = useState({ A: '', B: '', C: '', D: '' });
  const [newQCorrect, setNewQCorrect] = useState('A');
  const [newQExp, setNewQExp] = useState('');

  // Word Import State
  const [wordSubject, setWordSubject] = useState('Umum');
  const [wordGrade, setWordGrade] = useState('Umum');
  const [wordPreview, setWordPreview] = useState<WordPreviewItem[] | null>(null);
  const [wordBusy, setWordBusy] = useState(false);

  // Results Viewer State
  const [selectedResultRoomId, setSelectedResultRoomId] = useState<string>('');
  const [resultDetail, setResultDetail] = useState<RoomResultDetail | null>(null);
  const [resultRankMode, setResultRankMode] = useState<'score' | 'finish'>('score');

  // Settings & Profile Form
  const [defaultCfg, setDefaultCfg] = useState<RoomSettings>(teacher.defaultSettings);
  const [profName, setProfName] = useState(teacher.name);
  const [profSchool, setProfSchool] = useState(teacher.schoolName);

  // Direct Excel -> Google Drive upload confirmation state
  const [driveExcelConfirmRoom, setDriveExcelConfirmRoom] = useState<RoomSummary | null>(null);
  const [driveExcelBusyId, setDriveExcelBusyId] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean>(() => Boolean(getDriveAccessToken()));

  useEffect(() => {
    return subscribeDriveToken((tok) => {
      setDriveConnected(Boolean(tok));
    });
  }, []);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    setBannerMsg({ kind, text });
    window.setTimeout(() => setBannerMsg(null), 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    setLoadingData(true);
    try {
      const [rRes, qRes] = await Promise.all([
        fetch('/api/rooms', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/questions', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const rData = await rRes.json();
      const qData = await qRes.json();
      if (rData.rooms) {
        setRooms(rData.rooms);
        if (!selectedResultRoomId && rData.rooms.length > 0) {
          setSelectedResultRoomId(rData.rooms[0].id);
        }
      }
      if (qData.questions) setQuestions(qData.questions);
    } catch {
      notify('err', 'Gagal memuat data dashboard dari server.');
    } finally {
      setLoadingData(false);
    }
  }, [token, notify, selectedResultRoomId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (activeTab === 'results' && selectedResultRoomId) {
      fetch(`/api/rooms/${selectedResultRoomId}/results`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.room) setResultDetail(data);
        })
        .catch(() => {});
    }
  }, [activeTab, selectedResultRoomId, token]);

  if (monitoringRoomId) {
    return (
      <TeacherRoomMonitor
        roomId={monitoringRoomId}
        token={token}
        onBack={() => {
          setMonitoringRoomId(null);
          fetchAll();
        }}
        onOpenResults={(rid) => {
          setMonitoringRoomId(null);
          setSelectedResultRoomId(rid);
          setActiveTab('results');
          fetchAll();
        }}
      />
    );
  }

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    const effectiveSettings =
      rmPickManual && rmSelectedQIds.length > 0
        ? { ...rmSettings, questionCount: rmSelectedQIds.length }
        : rmSettings;
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: rmName,
          subject: rmSubject,
          grade: rmGrade,
          settings: effectiveSettings,
          scheduledAt: rmSchedule || undefined,
          questionIds: rmPickManual ? rmSelectedQIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Gagal membuat room.');
        return;
      }
      notify(
        'ok',
        `Room berhasil dibuat! Kode: ${data.code} (${data.questionCount} soal · ${data.totalLaps ?? calcTotalLaps(data.questionCount)} putaran · ${formatScoreValue(data.pointsPerQuestion ?? calcPointsPerQuestion(data.questionCount))} poin/soal)`
      );
      setRmName('');
      setRmSelectedQIds([]);
      await fetchAll();
      setActiveTab('rooms');
    } catch {
      notify('err', 'Terjadi kesalahan jaringan.');
    }
  }

  async function handleRoomAction(roomId: string, action: 'start' | 'close' | 'delete') {
    try {
      const url = action === 'delete' ? `/api/rooms/${roomId}` : `/api/rooms/${roomId}/${action}`;
      const res = await fetch(url, {
        method: action === 'delete' ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Aksi room gagal.');
        return;
      }
      notify(
        'ok',
        action === 'start'
          ? 'Pertandingan dimulai!'
          : action === 'close'
          ? 'Room telah ditutup dan nilai difinalisasi.'
          : 'Room berhasil dihapus.'
      );
      await fetchAll();
    } catch {
      notify('err', 'Gagal memproses aksi room.');
    }
  }

  async function handleSeedStarterQuestions() {
    try {
      const res = await fetch('/api/questions/seed-starter', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Gagal memuat soal contoh.');
        return;
      }
      notify('ok', data.message);
      await fetchAll();
    } catch {
      notify('err', 'Gagal memuat soal contoh.');
    }
  }

  async function handleCreateManualQuestion(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: newQSubject,
          grade: newQGrade,
          questionType: newQType,
          prompt: newQPrompt,
          options: newQOpts,
          correctAnswer: newQCorrect,
          explanation: newQExp,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Gagal menambah soal.');
        return;
      }
      notify('ok', 'Soal berhasil ditambahkan ke Bank Soal.');
      setNewQPrompt('');
      setNewQOpts({ A: '', B: '', C: '', D: '' });
      setNewQExp('');
      await fetchAll();
      setActiveTab('bank');
    } catch {
      notify('err', 'Gagal menyimpan soal.');
    }
  }

  async function handleUpdateQuestion(e: React.FormEvent) {
    e.preventDefault();
    if (!editingQ) return;
    try {
      const res = await fetch(`/api/questions/${editingQ.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editingQ),
      });
      if (!res.ok) {
        notify('err', 'Gagal memperbarui soal.');
        return;
      }
      notify('ok', 'Soal berhasil diperbarui.');
      setEditingQ(null);
      await fetchAll();
    } catch {
      notify('err', 'Gagal memperbarui soal.');
    }
  }

  async function handleDeleteQuestion(id: string) {
    try {
      const res = await fetch(`/api/questions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        notify('err', 'Gagal menghapus soal.');
        return;
      }
      notify('ok', 'Soal dihapus dari Bank Soal.');
      await fetchAll();
    } catch {
      notify('err', 'Gagal menghapus soal.');
    }
  }

  async function handleWordUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setWordBusy(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/questions/import-word/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Gagal membaca dokumen Word.');
        return;
      }
      const items = (data.items as WordPreviewItem[]).map((item) => ({
        ...item,
        selected: item.valid && !item.isDuplicate,
      }));
      setWordPreview(items);
      if (items.length === 0) {
        notify('err', 'Tidak ditemukan format SOAL 1, SOAL 2, dst di dalam dokumen Word.');
      }
    } catch {
      notify('err', 'Gagal memproses file Word.');
    } finally {
      setWordBusy(false);
      e.target.value = '';
    }
  }

  async function handleCommitWordImport() {
    if (!wordPreview) return;
    const approved = wordPreview.filter((i) => i.selected && i.valid && !i.isDuplicate);
    if (approved.length === 0) {
      notify('err', 'Pilih minimal 1 soal valid yang belum duplikat.');
      return;
    }
    setWordBusy(true);
    try {
      const res = await fetch('/api/questions/import-word/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subject: wordSubject,
          grade: wordGrade,
          items: approved,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Gagal menyimpan soal impor.');
        return;
      }
      notify('ok', data.message);
      setWordPreview(null);
      await fetchAll();
      setActiveTab('bank');
    } catch {
      notify('err', 'Gagal menyimpan hasil impor Word.');
    } finally {
      setWordBusy(false);
    }
  }

  async function handleSaveSettingsAndProfile(isProfile: boolean) {
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: profName,
          schoolName: profSchool,
          defaultSettings: defaultCfg,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('err', data.error || 'Gagal menyimpan pengaturan.');
        return;
      }
      onTeacherUpdated(data.teacher);
      setRmSettings(data.teacher.defaultSettings);
      notify('ok', isProfile ? 'Profil guru berhasil diperbarui.' : 'Pengaturan game default disimpan.');
    } catch {
      notify('err', 'Gagal menyimpan perubahan.');
    }
  }

  const subjects = ['Semua', ...Array.from(new Set(questions.map((q) => q.subject)))];
  const filteredQuestions = questions.filter((q) => {
    if (qFilterSubject !== 'Semua' && q.subject !== qFilterSubject) return false;
    if (qSearch.trim() && !q.prompt.toLowerCase().includes(qSearch.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const totalParticipantsAll = rooms.reduce((acc, r) => acc + r.participantCount, 0);
  const activeRoomsCount = rooms.filter((r) => r.status === 'waiting' || r.status === 'playing').length;

  return (
    <div className="min-h-screen bg-[#081226] text-white flex">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      )}

      {/* Sidebar Navigation (10 Menus) */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 w-64 bg-[#0F2957] border-r border-blue-400/20 flex flex-col transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <AppLogo size="sm" />
            <div className="min-w-0">
              <div className="font-display font-extrabold text-base leading-tight truncate">
                EDU RUN <span className="text-[#FF6B1A]">ARENA 3D</span>
              </div>
              <div className="text-xs text-blue-200/80 truncate">{teacher.schoolName}</div>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-[#1D4ED8] text-white font-semibold'
                    : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#FACC15]' : 'text-blue-300'}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="text-xs font-semibold text-white truncate">{teacher.name}</div>
          <div className="text-[11px] text-slate-300 truncate mb-2.5">{teacher.email}</div>
          {driveConnected && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('cloud');
                setSidebarOpen(false);
              }}
              className="w-full mb-2.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 flex items-center gap-2 text-[11px] font-semibold text-emerald-200 transition-colors cursor-pointer"
              title="Buka Google Drive Pribadi"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <span className="truncate">Google Drive Terhubung</span>
            </button>
          )}
          <button
            onClick={() => {
              clearDriveAccessToken();
              onLogout();
            }}
            className="w-full inline-flex items-center justify-center gap-2 py-2 rounded-xl bg-[#081226] hover:bg-rose-950 border border-white/15 text-xs font-semibold text-rose-200 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Akun</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col">
        <header className="px-4 sm:px-8 py-4 bg-[#0F2957]/70 border-b border-blue-400/20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-[#081226] border border-white/15"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-lg sm:text-xl">
              {MENU_ITEMS.find((m) => m.id === activeTab)?.label}
            </h1>
          </div>

          <button
            onClick={() => setActiveTab('create_room')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] text-sm font-semibold text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <PlusSquare className="w-4 h-4" />
            <span>Buat Room Baru</span>
          </button>
        </header>

        <div className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto space-y-6">
          {bannerMsg && (
            <div
              className={`p-4 rounded-xl border text-sm font-medium flex items-center gap-2.5 ${
                bannerMsg.kind === 'ok'
                  ? 'bg-emerald-950/70 border-emerald-400/40 text-emerald-200'
                  : 'bg-rose-950/70 border-rose-400/40 text-rose-200'
              }`}
            >
              {bannerMsg.kind === 'ok' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0" />
              )}
              <span>{bannerMsg.text}</span>
            </div>
          )}

          {/* ==================== 1. DASHBOARD UTAMA ==================== */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/20">
                  <div className="text-xs text-blue-200 mb-1">Total Room Dibuat</div>
                  <div className="font-mono font-bold text-3xl text-white tabular-nums">{rooms.length}</div>
                </div>
                <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/20">
                  <div className="text-xs text-blue-200 mb-1">Room Aktif / Menunggu</div>
                  <div className="font-mono font-bold text-3xl text-[#FF6B1A] tabular-nums">
                    {activeRoomsCount}
                  </div>
                </div>
                <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/20">
                  <div className="text-xs text-blue-200 mb-1">Koleksi Bank Soal</div>
                  <div className="font-mono font-bold text-3xl text-[#FACC15] tabular-nums">
                    {questions.length}
                  </div>
                </div>
                <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/20">
                  <div className="text-xs text-blue-200 mb-1">Total Peserta Tercatat</div>
                  <div className="font-mono font-bold text-3xl text-cyan-300 tabular-nums">
                    {totalParticipantsAll}
                  </div>
                </div>
              </div>

              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 p-6 rounded-2xl bg-[#0F2957] border border-blue-400/20">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="font-display font-bold text-lg">Room Pertandingan Terbaru</h2>
                    <button
                      onClick={() => setActiveTab('rooms')}
                      className="text-xs font-semibold text-blue-300 hover:text-white cursor-pointer"
                    >
                      Lihat Semua
                    </button>
                  </div>

                  {loadingData ? (
                    <div className="py-8 text-center text-sm text-slate-300">Memuat data...</div>
                  ) : rooms.length === 0 ? (
                    <div className="py-8 text-center space-y-3">
                      <p className="text-sm text-slate-300">
                        Belum ada room pertandingan. Buat room pertama Anda untuk mulai berkompetisi!
                      </p>
                      <button
                        onClick={() => setActiveTab('create_room')}
                        className="px-5 py-2.5 rounded-xl bg-[#FF6B1A] font-semibold text-sm text-white cursor-pointer"
                      >
                        Buat Room Pertama
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/10">
                      {rooms.slice(0, 5).map((r) => (
                        <div key={r.id} className="py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate">{r.name}</div>
                            <div className="text-xs text-slate-300">
                              Kode <span className="font-mono font-bold text-[#FACC15]">{r.code}</span> · {r.subject} · {r.participantCount}/{r.settings.maxPlayers} peserta
                            </div>
                          </div>
                          <button
                            onClick={() => setMonitoringRoomId(r.id)}
                            className="px-3.5 py-1.5 rounded-lg bg-[#1D4ED8] hover:bg-blue-600 text-xs font-semibold text-white cursor-pointer shrink-0"
                          >
                            Buka Room
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-5 p-6 rounded-2xl bg-[#0F2957] border border-blue-400/20 space-y-4">
                  <h2 className="font-display font-bold text-lg">Distribusi Soal per Mata Pelajaran</h2>
                  {subjects.filter((s) => s !== 'Semua').length === 0 ? (
                    <div className="py-6 text-sm text-slate-300">
                      Bank Soal kosong. Klik tombol di bawah untuk memuat 50 soal contoh siap pakai.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {subjects
                        .filter((s) => s !== 'Semua')
                        .map((subj) => {
                          const count = questions.filter((q) => q.subject === subj).length;
                          const pct = questions.length ? Math.round((count / questions.length) * 100) : 0;
                          return (
                            <div key={subj}>
                              <div className="flex justify-between text-xs mb-1">
                                <span className="font-medium text-white">{subj}</span>
                                <span className="font-mono text-blue-200 tabular-nums">
                                  {count} soal ({pct}%)
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-[#081226] overflow-hidden">
                                <div
                                  className="h-full bg-[#FF6B1A]"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  <div className="pt-3 border-t border-white/10 flex flex-wrap gap-2">
                    <button
                      onClick={() => setActiveTab('import_word')}
                      className="px-4 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-blue-400/30 text-xs font-semibold text-white cursor-pointer"
                    >
                      Impor Soal Word (.docx)
                    </button>
                    <button
                      onClick={handleSeedStarterQuestions}
                      className="px-4 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-blue-400/30 text-xs font-semibold text-[#FACC15] cursor-pointer"
                    >
                      Muat 50 Soal Contoh
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 2. BUAT ROOM ==================== */}
          {activeTab === 'create_room' && (
            <form
              onSubmit={handleCreateRoom}
              className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-6"
            >
              <div>
                <h2 className="font-display font-bold text-xl">Buat Room Pertandingan Baru</h2>
                <p className="text-sm text-blue-200/80">
                  Kode room, jumlah putaran lintasan, dan bobot poin per soal (total maksimal 100 poin) menyesuaikan otomatis dengan jumlah soal yang Anda buat.
                </p>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Nama Pertandingan
                  </label>
                  <input
                    type="text"
                    required
                    value={rmName}
                    onChange={(e) => setRmName(e.target.value)}
                    placeholder="Contoh: Olimpiade Sprint Sains VIII"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Mata Pelajaran
                  </label>
                  <input
                    type="text"
                    required
                    value={rmSubject}
                    onChange={(e) => setRmSubject(e.target.value)}
                    placeholder="Contoh: Matematika"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">Kelas</label>
                  <input
                    type="text"
                    required
                    value={rmGrade}
                    onChange={(e) => setRmGrade(e.target.value)}
                    placeholder="Contoh: VIII-A"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Jumlah Soal (1–50)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={rmSettings.questionCount}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, questionCount: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Maks Peserta (2–30)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={rmSettings.maxPlayers}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, maxPlayers: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Waktu/Soal (detik)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={rmSettings.timePerQuestion}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, timePerQuestion: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Kecepatan Normal (m/s)
                  </label>
                  <input
                    type="number"
                    min={1.5}
                    max={15}
                    step={0.5}
                    value={rmSettings.baseSpeed}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, baseSpeed: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Durasi Boost (dtk)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={rmSettings.boostDuration}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, boostDuration: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Durasi Slow (dtk)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={rmSettings.penaltyDuration}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, penaltyDuration: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
              </div>

              {/* Automatic Lap & Scoring Preview */}
              {(() => {
                const effectiveCount = Math.max(
                  1,
                  rmPickManual && rmSelectedQIds.length > 0
                    ? rmSelectedQIds.length
                    : rmSettings.questionCount || 1
                );
                const autoLaps = calcTotalLaps(effectiveCount);
                const autoPts = calcPointsPerQuestion(effectiveCount);
                return (
                  <div className="grid sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-[#081226] border border-cyan-400/30 text-xs">
                    <div>
                      <div className="text-slate-400 uppercase font-semibold text-[10px]">
                        Jumlah Soal Dipakai
                      </div>
                      <div className="font-mono font-bold text-base text-white mt-0.5">
                        {effectiveCount} Soal
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 uppercase font-semibold text-[10px]">
                        Jumlah Putaran Otomatis
                      </div>
                      <div className="font-mono font-bold text-base text-cyan-300 mt-0.5">
                        {autoLaps} Putaran Lintasan
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400 uppercase font-semibold text-[10px]">
                        Bobot Poin Otomatis
                      </div>
                      <div className="font-mono font-bold text-base text-[#FACC15] mt-0.5">
                        {formatScoreValue(autoPts)} Poin/Soal (Maks {MAX_MATCH_SCORE})
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-2">
                  Pilih Tempat Balapan (Arena 3D)
                </label>
                <div className="grid sm:grid-cols-3 gap-3">
                  {RACE_VENUES.map((v) => {
                    const active = (rmSettings.venue || 'stadium_day') === v.id;
                    const Icon =
                      v.id === 'stadium_day' ? Sun : v.id === 'stadium_night' ? Moon : Trees;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setRmSettings((s) => ({ ...s, venue: v.id as RaceVenueId }))
                        }
                        className={`p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#1D4ED8]/35 border-[#FF6B1A] text-white'
                            : 'bg-[#081226] border-blue-400/20 text-slate-300 hover:border-blue-400/50'
                        }`}
                      >
                        <div className="flex items-center gap-2 font-display font-bold text-sm text-white mb-1">
                          <Icon
                            className={`w-4 h-4 ${
                              v.id === 'stadium_day'
                                ? 'text-amber-300'
                                : v.id === 'stadium_night'
                                ? 'text-cyan-300'
                                : 'text-emerald-400'
                            }`}
                          />
                          <span>{v.label}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 leading-snug">{v.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 items-center">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Jadwal Pertandingan (Opsional)
                  </label>
                  <input
                    type="datetime-local"
                    value={rmSchedule}
                    onChange={(e) => setRmSchedule(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
                <label className="flex items-center gap-3 pt-5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rmSettings.allowShortAnswer}
                    onChange={(e) =>
                      setRmSettings((s) => ({ ...s, allowShortAnswer: e.target.checked }))
                    }
                    className="w-4 h-4 accent-[#FF6B1A]"
                  />
                  <span className="text-sm text-slate-200">
                    Sertakan soal tipe Isian Singkat dari Bank Soal
                  </span>
                </label>
              </div>

              {/* Manual vs Automatic Question Selection */}
              <div className="p-4 rounded-xl bg-[#081226] border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm text-white">Pemilihan Soal Pertandingan</div>
                    <div className="text-xs text-slate-300">
                      Tersedia {questions.length} soal di Bank Soal Anda.
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRmPickManual(false)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        !rmPickManual ? 'bg-[#1D4ED8] text-white' : 'bg-[#0F2957] text-slate-300'
                      }`}
                    >
                      Pilih Otomatis ({rmSettings.questionCount} Soal)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRmPickManual(true)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        rmPickManual ? 'bg-[#1D4ED8] text-white' : 'bg-[#0F2957] text-slate-300'
                      }`}
                    >
                      Pilih Manual ({rmSelectedQIds.length} dipilih)
                    </button>
                  </div>
                </div>

                {rmPickManual && (
                  <div className="max-h-60 overflow-y-auto divide-y divide-white/10 border-t border-white/10 pt-2">
                    {questions.map((q) => {
                      const checked = rmSelectedQIds.includes(q.id);
                      return (
                        <label
                          key={q.id}
                          className="py-2 flex items-start gap-3 cursor-pointer text-xs hover:bg-white/5 px-2 rounded"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setRmSelectedQIds((prev) =>
                                checked ? prev.filter((id) => id !== q.id) : [...prev, q.id]
                              )
                            }
                            className="mt-0.5 accent-[#FF6B1A]"
                          />
                          <div className="min-w-0">
                            <div className="text-white font-medium">{q.prompt}</div>
                            <div className="text-slate-400">
                              {q.subject} · {q.questionType}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-7 py-3 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-display font-bold text-white cursor-pointer"
                >
                  Buat Room & Generate Kode Otomatis
                </button>
              </div>
            </form>
          )}

          {/* ==================== 3. DAFTAR ROOM ==================== */}
          {activeTab === 'rooms' && (
            <div className="rounded-2xl bg-[#0F2957] border border-blue-400/25 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-[#081226] text-xs text-blue-200 uppercase">
                    <tr>
                      <th className="py-3.5 px-4">Kode Room</th>
                      <th className="py-3.5 px-4">Nama Pertandingan</th>
                      <th className="py-3.5 px-4">Mapel & Kelas</th>
                      <th className="py-3.5 px-4 text-center">Soal</th>
                      <th className="py-3.5 px-4 text-center">Peserta</th>
                      <th className="py-3.5 px-4 text-center">Status</th>
                      <th className="py-3.5 px-4 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {rooms.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-300">
                          Belum ada room pertandingan. Klik "Buat Room Baru" untuk memulai.
                        </td>
                      </tr>
                    ) : (
                      rooms.map((r) => (
                        <tr key={r.id} className="hover:bg-white/5">
                          <td className="py-3 px-4">
                            <div className="flex flex-col items-start gap-1">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(r.code).catch(() => {});
                                  setCopiedCode(r.code);
                                  window.setTimeout(() => setCopiedCode(null), 1500);
                                }}
                                className="inline-flex items-center gap-1.5 font-mono font-bold text-[#FACC15] hover:underline cursor-pointer"
                                title="Salin Kode Room"
                              >
                                <span>{r.code}</span>
                                {copiedCode === r.code ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  const directUrl = `${window.location.origin}/?join=${encodeURIComponent(r.code)}`;
                                  navigator.clipboard.writeText(directUrl).catch(() => {});
                                  setCopiedCode(`link:${r.code}`);
                                  window.setTimeout(() => setCopiedCode(null), 1800);
                                }}
                                className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 hover:underline cursor-pointer"
                                title="Salin Link Gabung Langsung Peserta"
                              >
                                {copiedCode === `link:${r.code}` ? '✓ Link tersalin' : 'Salin Link Peserta'}
                              </button>
                            </div>
                          </td>
                          <td className="py-3 px-4 font-semibold text-white">{r.name}</td>
                          <td className="py-3 px-4 text-slate-300">
                            {r.subject} · {r.grade}
                          </td>
                          <td className="py-3 px-4 text-center font-mono tabular-nums">
                            <div>{r.questionCount ?? r.settings.questionCount} soal</div>
                            <div className="text-[11px] text-cyan-300">
                              {r.totalLaps ?? calcTotalLaps(r.questionCount ?? r.settings.questionCount)} putaran ·{' '}
                              {formatScoreValue(
                                r.pointsPerQuestion ??
                                  calcPointsPerQuestion(r.questionCount ?? r.settings.questionCount)
                              )}
                              p/soal
                            </div>
                          </td>
                          <td className="py-3 px-4 text-center font-mono tabular-nums">
                            {r.participantCount}/{r.settings.maxPlayers}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`text-xs font-bold ${
                                r.status === 'waiting'
                                  ? 'text-cyan-300'
                                  : r.status === 'playing' || r.status === 'countdown'
                                  ? 'text-[#FF6B1A]'
                                  : 'text-emerald-300'
                              }`}
                            >
                              {r.status === 'waiting'
                                ? 'Menunggu'
                                : r.status === 'finished'
                                ? 'Selesai'
                                : 'Berlangsung'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setMonitoringRoomId(r.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1D4ED8] hover:bg-blue-600 text-xs font-semibold text-white cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Pantau 3D</span>
                              </button>
                              {r.status === 'waiting' && (
                                <button
                                  onClick={() => handleRoomAction(r.id, 'start')}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF6B1A] hover:bg-[#e85d10] text-xs font-semibold text-white cursor-pointer"
                                >
                                  <Play className="w-3.5 h-3.5" />
                                  <span>Mulai</span>
                                </button>
                              )}
                              {r.status === 'finished' && (
                                <a
                                  href={`/api/rooms/${r.id}/export-excel?token=${encodeURIComponent(token)}`}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Excel</span>
                                </a>
                              )}
                              <button
                                onClick={() => handleRoomAction(r.id, 'delete')}
                                className="p-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-700 text-rose-200 cursor-pointer"
                                title="Hapus Room"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ==================== 4. BANK SOAL ==================== */}
          {activeTab === 'bank' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#0F2957] border border-blue-400/25 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 flex-1">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={qSearch}
                      onChange={(e) => setQSearch(e.target.value)}
                      placeholder="Cari pertanyaan..."
                      className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                    />
                  </div>
                  <select
                    value={qFilterSubject}
                    onChange={(e) => setQFilterSubject(e.target.value)}
                    className="px-3.5 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                  >
                    {subjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSeedStarterQuestions}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#081226] border border-[#FACC15]/40 text-xs font-semibold text-[#FACC15] hover:bg-blue-950 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Muat 50 Soal Contoh</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('add_question')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF6B1A] text-xs font-semibold text-white cursor-pointer"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" />
                    <span>Tambah Manual</span>
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {filteredQuestions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-2xl bg-[#0F2957] border border-blue-400/20 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200">
                        <span className="font-mono font-bold text-[#FACC15]">#{idx + 1}</span>
                        <span>{q.subject}</span>
                        <span aria-hidden="true">·</span>
                        <span>Kelas {q.grade}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {q.questionType === 'multiple_choice'
                            ? 'Pilihan Ganda'
                            : q.questionType === 'true_false'
                            ? 'Benar/Salah'
                            : 'Isian Singkat'}
                        </span>
                      </div>
                      <p className="font-medium text-white">{q.prompt}</p>
                      {q.questionType !== 'short_answer' && (
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-300 pt-1">
                          {(['A', 'B', 'C', 'D'] as const)
                            .filter((k) => Boolean(q.options[k]))
                            .map((k) => (
                              <div
                                key={k}
                                className={
                                  q.correctAnswer === k ? 'text-emerald-300 font-semibold' : ''
                                }
                              >
                                {k}. {q.options[k]}
                              </div>
                            ))}
                        </div>
                      )}
                      <div className="text-xs text-emerald-300 pt-1">
                        Kunci: <strong>{q.correctAnswer}</strong>
                        {q.explanation && (
                          <span className="text-slate-300 font-normal"> · {q.explanation}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setEditingQ(q)}
                        className="p-2 rounded-lg bg-[#081226] hover:bg-blue-800 text-blue-200 cursor-pointer"
                        title="Edit Soal"
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteQuestion(q.id)}
                        className="p-2 rounded-lg bg-rose-950/70 hover:bg-rose-700 text-rose-200 cursor-pointer"
                        title="Hapus Soal"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {editingQ && (
                <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
                  <form
                    onSubmit={handleUpdateQuestion}
                    className="w-full max-w-xl p-6 rounded-2xl bg-[#0F2957] border border-blue-400/30 space-y-4 max-h-[90vh] overflow-y-auto"
                  >
                    <h3 className="font-display font-bold text-lg">Edit Soal</h3>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={editingQ.subject}
                        onChange={(e) => setEditingQ({ ...editingQ, subject: e.target.value })}
                        placeholder="Mata Pelajaran"
                        className="px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm"
                      />
                      <input
                        type="text"
                        value={editingQ.grade}
                        onChange={(e) => setEditingQ({ ...editingQ, grade: e.target.value })}
                        placeholder="Kelas"
                        className="px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm"
                      />
                    </div>
                    <textarea
                      rows={3}
                      value={editingQ.prompt}
                      onChange={(e) => setEditingQ({ ...editingQ, prompt: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm"
                    />
                    {editingQ.questionType !== 'short_answer' && (
                      <div className="grid grid-cols-2 gap-2">
                        {(['A', 'B', 'C', 'D'] as const).map((k) => (
                          <input
                            key={k}
                            type="text"
                            placeholder={`Opsi ${k}`}
                            value={editingQ.options[k] || ''}
                            onChange={(e) =>
                              setEditingQ({
                                ...editingQ,
                                options: { ...editingQ.options, [k]: e.target.value },
                              })
                            }
                            className="px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm"
                          />
                        ))}
                      </div>
                    )}
                    <input
                      type="text"
                      value={editingQ.correctAnswer || ''}
                      onChange={(e) => setEditingQ({ ...editingQ, correctAnswer: e.target.value })}
                      placeholder="Kunci Jawaban"
                      className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm"
                    />
                    <textarea
                      rows={2}
                      value={editingQ.explanation || ''}
                      onChange={(e) => setEditingQ({ ...editingQ, explanation: e.target.value })}
                      placeholder="Pembahasan"
                      className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingQ(null)}
                        className="px-4 py-2 rounded-xl bg-[#081226] text-sm cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        className="px-5 py-2 rounded-xl bg-[#FF6B1A] text-sm font-semibold cursor-pointer"
                      >
                        Simpan Perubahan
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* ==================== 5. TAMBAH SOAL MANUAL ==================== */}
          {activeTab === 'add_question' && (
            <form
              onSubmit={handleCreateManualQuestion}
              className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-5 max-w-3xl"
            >
              <h2 className="font-display font-bold text-xl">Tambah Soal Manual ke Bank Soal</h2>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Mata Pelajaran
                  </label>
                  <input
                    type="text"
                    required
                    value={newQSubject}
                    onChange={(e) => setNewQSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">Kelas</label>
                  <input
                    type="text"
                    required
                    value={newQGrade}
                    onChange={(e) => setNewQGrade(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Jenis Pertanyaan
                  </label>
                  <select
                    value={newQType}
                    onChange={(e) => {
                      const t = e.target.value as QuestionType;
                      setNewQType(t);
                      if (t === 'true_false') {
                        setNewQOpts({ A: 'Benar', B: 'Salah', C: '', D: '' });
                        setNewQCorrect('A');
                      } else if (t === 'multiple_choice') {
                        setNewQCorrect('A');
                      } else {
                        setNewQCorrect('');
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  >
                    <option value="multiple_choice">Pilihan Ganda (A, B, C, D)</option>
                    <option value="true_false">Benar / Salah</option>
                    <option value="short_answer">Isian Singkat</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                  Teks Pertanyaan
                </label>
                <textarea
                  required
                  rows={3}
                  value={newQPrompt}
                  onChange={(e) => setNewQPrompt(e.target.value)}
                  placeholder="Tuliskan soal di sini..."
                  className="w-full px-4 py-3 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                />
              </div>

              {newQType === 'multiple_choice' && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {(['A', 'B', 'C', 'D'] as const).map((k) => (
                    <div key={k}>
                      <label className="block text-xs font-semibold text-blue-200 mb-1">
                        Opsi {k}
                      </label>
                      <input
                        type="text"
                        required
                        value={newQOpts[k]}
                        onChange={(e) => setNewQOpts((prev) => ({ ...prev, [k]: e.target.value }))}
                        className="w-full px-3.5 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Kunci Jawaban
                  </label>
                  {newQType === 'short_answer' ? (
                    <input
                      type="text"
                      required
                      value={newQCorrect}
                      onChange={(e) => setNewQCorrect(e.target.value)}
                      placeholder="Masukkan jawaban singkat yang benar"
                      className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                    />
                  ) : (
                    <select
                      value={newQCorrect}
                      onChange={(e) => setNewQCorrect(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                    >
                      <option value="A">A {newQType === 'true_false' ? '(Benar)' : ''}</option>
                      <option value="B">B {newQType === 'true_false' ? '(Salah)' : ''}</option>
                      {newQType === 'multiple_choice' && (
                        <>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </>
                      )}
                    </select>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Pembahasan Soal
                  </label>
                  <input
                    type="text"
                    value={newQExp}
                    onChange={(e) => setNewQExp(e.target.value)}
                    placeholder="Penjelasan jawaban benar (tampil setelah finish)"
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="px-6 py-3 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-display font-bold text-white cursor-pointer"
              >
                Simpan ke Bank Soal
              </button>
            </form>
          )}

          {/* ==================== 6. IMPOR SOAL WORD (.docx) ==================== */}
          {activeTab === 'import_word' && (
            <div className="space-y-6">
              <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="font-display font-bold text-xl">
                      Impor Soal dari Microsoft Word (.docx)
                    </h2>
                    <p className="text-sm text-blue-200/80">
                      Unduh template resmi, isi soal Anda, unggah untuk preview validasi, lalu simpan ke Bank Soal.
                    </p>
                  </div>

                  <a
                    href="/api/questions/word-template"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 font-semibold text-sm text-white whitespace-nowrap shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Template Word</span>
                  </a>
                </div>

                <div className="p-4 rounded-xl bg-[#081226] border border-white/10 font-mono text-xs text-slate-300 whitespace-pre-wrap">
                  {`SOAL 1\nPertanyaan: Berapakah hasil 5 x 6?\nA. 20\nB. 25\nC. 30\nD. 35\nKunci Jawaban: C\nPembahasan: 5 dikalikan 6 sama dengan 30.`}
                </div>

                <div className="grid sm:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                      Mata Pelajaran Tujuan
                    </label>
                    <input
                      type="text"
                      value={wordSubject}
                      onChange={(e) => setWordSubject(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                      Kelas Tujuan
                    </label>
                    <input
                      type="text"
                      value={wordGrade}
                      onChange={(e) => setWordGrade(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                    />
                  </div>
                  <label className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-sm text-white cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>{wordBusy ? 'Membaca Dokumen...' : 'Upload Dokumen Word'}</span>
                    <input
                      type="file"
                      accept=".docx"
                      onChange={handleWordUpload}
                      className="hidden"
                      disabled={wordBusy}
                    />
                  </label>
                </div>
              </div>

              {wordPreview && (
                <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-display font-bold text-lg">
                        Preview Soal ({wordPreview.length} Terdeteksi)
                      </h3>
                      <p className="text-xs text-slate-300">
                        Periksa kelengkapan soal, kunci jawaban, dan peringatan duplikat sebelum disimpan.
                      </p>
                    </div>
                    <button
                      onClick={handleCommitWordImport}
                      disabled={wordBusy}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm text-white cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        Simpan ke Bank Soal ({wordPreview.filter((i) => i.selected).length} dipilih)
                      </span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {wordPreview.map((item, idx) => (
                      <div
                        key={idx}
                        className={`p-4 rounded-xl border ${
                          !item.valid || item.isDuplicate
                            ? 'bg-rose-950/30 border-rose-400/40'
                            : 'bg-[#081226] border-emerald-400/30'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex items-start gap-3 cursor-pointer flex-1">
                            <input
                              type="checkbox"
                              checked={Boolean(item.selected)}
                              disabled={!item.valid || item.isDuplicate}
                              onChange={() =>
                                setWordPreview((prev) =>
                                  prev
                                    ? prev.map((p, i) =>
                                        i === idx ? { ...p, selected: !p.selected } : p
                                      )
                                    : null
                                )
                              }
                              className="mt-1 accent-[#FF6B1A]"
                            />
                            <div className="space-y-1">
                              <div className="font-mono text-xs font-bold text-[#FACC15]">
                                SOAL {item.number} · {item.questionType}
                              </div>
                              <div className="font-medium text-white">{item.prompt}</div>
                              <div className="text-xs text-slate-300">
                                Kunci: <strong className="text-emerald-300">{item.correctAnswer || '-'}</strong>
                                {item.explanation && ` · Pembahasan: ${item.explanation}`}
                              </div>
                              {item.warnings.length > 0 && (
                                <div className="text-xs text-rose-300 font-medium pt-1">
                                  Peringatan: {item.warnings.join(' ')}
                                </div>
                              )}
                            </div>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 7. HASIL PERTANDINGAN ==================== */}
          {activeTab === 'results' && (
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-[#0F2957] border border-blue-400/25 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold text-blue-200">Pilih Room:</label>
                  <select
                    value={selectedResultRoomId}
                    onChange={(e) => setSelectedResultRoomId(e.target.value)}
                    className="px-4 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code}) — {r.status}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedResultRoomId && (
                  <a
                    href={`/api/rooms/${selectedResultRoomId}/export-excel?token=${encodeURIComponent(token)}`}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm text-white"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Rekap Excel (.xlsx)</span>
                  </a>
                )}
              </div>

              {resultDetail && resultDetail.byScore.length > 0 ? (
                <>
                  <VictoryPodium3D players={resultDetail.byScore} className="w-full h-80 sm:h-96" />

                  <div className="rounded-2xl bg-[#0F2957] border border-blue-400/25 overflow-hidden">
                    <div className="p-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-display font-bold text-lg">
                        Tabel Hasil Peserta ({resultDetail.byScore.length} Anak)
                      </h3>
                      <div className="inline-flex p-1 rounded-xl bg-[#081226]">
                        <button
                          onClick={() => setResultRankMode('score')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                            resultRankMode === 'score' ? 'bg-[#1D4ED8] text-white' : 'text-slate-300'
                          }`}
                        >
                          Peringkat Nilai
                        </button>
                        <button
                          onClick={() => setResultRankMode('finish')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                            resultRankMode === 'finish' ? 'bg-[#FF6B1A] text-white' : 'text-slate-300'
                          }`}
                        >
                          Peringkat Finish
                        </button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-[#081226] text-xs text-blue-200 uppercase">
                          <tr>
                            <th className="py-3 px-4">Peringkat</th>
                            <th className="py-3 px-4">Nama Peserta</th>
                            <th className="py-3 px-4">Kelas</th>
                            <th className="py-3 px-4 text-center">Benar</th>
                            <th className="py-3 px-4 text-center">Salah</th>
                            <th className="py-3 px-4 text-center">Kosong</th>
                            <th className="py-3 px-4 text-center">Total Poin</th>
                            <th className="py-3 px-4 text-center">Posisi Finish</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {(resultRankMode === 'score' ? resultDetail.byScore : resultDetail.byFinish).map(
                            (p, i) => (
                              <tr key={p.id}>
                                <td className="py-3 px-4 font-mono font-bold">
                                  #{resultRankMode === 'score' ? p.scoreRank ?? i + 1 : p.finishRank ?? i + 1}
                                </td>
                                <td className="py-3 px-4 font-semibold">{p.name}</td>
                                <td className="py-3 px-4 text-slate-300">{p.className}</td>
                                <td className="py-3 px-4 text-center font-mono text-emerald-300">
                                  {p.correctCount}
                                </td>
                                <td className="py-3 px-4 text-center font-mono text-rose-300">
                                  {p.wrongCount}
                                </td>
                                <td className="py-3 px-4 text-center font-mono text-amber-300">
                                  {p.unansweredCount}
                                </td>
                                <td className="py-3 px-4 text-center font-mono font-bold text-[#FACC15]">
                                  {formatScoreValue(p.score)} / {resultDetail.room.maxScore ?? MAX_MATCH_SCORE}
                                </td>
                                <td className="py-3 px-4 text-center font-mono text-cyan-300">
                                  #{p.finishRank ?? '-'}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Question Difficulty Chart */}
                  <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-3">
                    <h3 className="font-display font-bold text-lg">Grafik Persentase Benar per Soal</h3>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-72 overflow-y-auto pr-1">
                      {resultDetail.questionAnalysis.map((qa) => (
                        <div key={qa.questionNumber} className="p-3 rounded-xl bg-[#081226] border border-white/10">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="font-mono font-bold text-[#FACC15]">
                              Soal {qa.questionNumber}
                            </span>
                            <span className="text-slate-300">
                              {qa.correctPct}% ({qa.difficulty})
                            </span>
                          </div>
                          <div className="text-xs text-slate-300 truncate mb-2">{qa.prompt}</div>
                          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500"
                              style={{ width: `${qa.correctPct}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-12 rounded-2xl bg-[#0F2957] border border-blue-400/25 text-center text-slate-300">
                  Belum ada peserta yang bertanding pada room ini.
                </div>
              )}
            </div>
          )}

          {/* ==================== 8. REKAP NILAI EXCEL ==================== */}
          {activeTab === 'excel' && (
            <div className="rounded-2xl bg-[#0F2957] border border-blue-400/25 overflow-hidden">
              <div className="p-5 border-b border-white/10">
                <h2 className="font-display font-bold text-xl">Ekspor Laporan Nilai Excel (.xlsx)</h2>
                <p className="text-sm text-blue-200/80">
                  Setiap file Excel berisi 3 sheet lengkap: REKAP NILAI, DETAIL JAWABAN, dan ANALISIS HASIL. Bisa diunduh langsung atau disimpan ke Google Drive pribadi Anda.
                </p>
              </div>
              <div className="divide-y divide-white/10">
                {rooms.length === 0 ? (
                  <div className="p-10 text-center text-slate-300">Belum ada room tersedia.</div>
                ) : (
                  rooms.map((r) => (
                    <div
                      key={r.id}
                      className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div>
                        <div className="font-display font-bold text-base text-white">{r.name}</div>
                        <div className="text-xs text-slate-300">
                          Kode <span className="font-mono text-[#FACC15]">{r.code}</span> · {r.subject} · Kelas {r.grade} · {r.participantCount} Peserta · {r.settings.questionCount} Soal
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <a
                          href={`/api/rooms/${r.id}/export-excel?token=${encodeURIComponent(token)}`}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm text-white whitespace-nowrap"
                        >
                          <FileSpreadsheet className="w-4 h-4" />
                          <span>Download Excel</span>
                        </a>
                        <button
                          type="button"
                          disabled={driveExcelBusyId !== null}
                          onClick={() => setDriveExcelConfirmRoom(r)}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 font-semibold text-sm text-white whitespace-nowrap cursor-pointer disabled:opacity-50"
                        >
                          {driveExcelBusyId === r.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <HardDrive className="w-4 h-4" />
                          )}
                          <span>Simpan ke Google Drive</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {driveExcelConfirmRoom && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
                  <div className="max-w-md w-full p-6 rounded-2xl bg-[#0F2957] border border-blue-400/45 shadow-2xl space-y-4">
                    <h4 className="font-display font-bold text-lg text-white">
                      Simpan Rekap Excel ke Google Drive?
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                      File{' '}
                      <strong className="text-[#FACC15]">
                        {buildRoomExcelFileName(driveExcelConfirmRoom)}
                      </strong>{' '}
                      akan disimpan (atau diperbarui jika sudah ada) di folder{' '}
                      <strong className="text-emerald-300">{EDU_RUN_FOLDER_NAME}</strong> pada Google Drive pribadi Anda.
                    </p>
                    <div className="flex items-center justify-end gap-2.5 pt-2">
                      <button
                        type="button"
                        onClick={() => setDriveExcelConfirmRoom(null)}
                        disabled={driveExcelBusyId !== null}
                        className="px-4 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-white/15 text-xs sm:text-sm font-semibold text-slate-200 cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="button"
                        disabled={driveExcelBusyId !== null}
                        onClick={async () => {
                          const targetRoom = driveExcelConfirmRoom;
                          setDriveExcelConfirmRoom(null);
                          setDriveExcelBusyId(targetRoom.id);
                          try {
                            let accessToken = getDriveAccessToken();
                            if (!accessToken) {
                              const signed = await signInWithGoogleDrive();
                              accessToken = signed.accessToken;
                            }
                            const uploaded = await uploadRoomExcelToDrive(
                              accessToken,
                              token,
                              targetRoom
                            );
                            notify(
                              'ok',
                              `Excel "${uploaded.name}" berhasil disimpan ke Google Drive pribadi (${EDU_RUN_FOLDER_NAME})!`
                            );
                          } catch (err) {
                            notify(
                              'err',
                              err instanceof Error
                                ? err.message
                                : 'Gagal menyimpan Excel ke Google Drive.'
                            );
                          } finally {
                            setDriveExcelBusyId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs sm:text-sm font-bold text-white cursor-pointer"
                      >
                        <HardDrive className="w-4 h-4" />
                        <span>Simpan ke Drive</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 9. PENGATURAN GAME ==================== */}
          {activeTab === 'settings' && (
            <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 max-w-2xl space-y-5">
              <h2 className="font-display font-bold text-xl">Pengaturan Default Pertandingan</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Jumlah Soal Default (1–50)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={defaultCfg.questionCount}
                    onChange={(e) =>
                      setDefaultCfg({ ...defaultCfg, questionCount: Number(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Maksimal Peserta Default (2–30)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={defaultCfg.maxPlayers}
                    onChange={(e) =>
                      setDefaultCfg({ ...defaultCfg, maxPlayers: Number(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Waktu per Soal (detik)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={defaultCfg.timePerQuestion}
                    onChange={(e) =>
                      setDefaultCfg({ ...defaultCfg, timePerQuestion: Number(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Kecepatan Normal Karakter (m/s)
                  </label>
                  <input
                    type="number"
                    min={1.5}
                    max={15}
                    step={0.5}
                    value={defaultCfg.baseSpeed}
                    onChange={(e) =>
                      setDefaultCfg({ ...defaultCfg, baseSpeed: Number(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Durasi Speed Boost (detik)
                  </label>
                  <input
                    type="number"
                    min={3}
                    max={60}
                    value={defaultCfg.boostDuration}
                    onChange={(e) =>
                      setDefaultCfg({ ...defaultCfg, boostDuration: Number(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Durasi Slow / Salah Jawab (detik)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={defaultCfg.penaltyDuration}
                    onChange={(e) =>
                      setDefaultCfg({ ...defaultCfg, penaltyDuration: Number(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-2">
                  Tempat Balapan Default
                </label>
                <div className="grid sm:grid-cols-3 gap-3">
                  {RACE_VENUES.map((v) => {
                    const active = (defaultCfg.venue || 'stadium_day') === v.id;
                    const Icon =
                      v.id === 'stadium_day' ? Sun : v.id === 'stadium_night' ? Moon : Trees;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() =>
                          setDefaultCfg({ ...defaultCfg, venue: v.id as RaceVenueId })
                        }
                        className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#1D4ED8]/35 border-[#FF6B1A] text-white'
                            : 'bg-[#081226] border-blue-400/20 text-slate-300 hover:border-blue-400/50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-display font-bold text-xs text-white mb-1">
                          <Icon
                            className={`w-3.5 h-3.5 ${
                              v.id === 'stadium_day'
                                ? 'text-amber-300'
                                : v.id === 'stadium_night'
                                ? 'text-cyan-300'
                                : 'text-emerald-400'
                            }`}
                          />
                          <span>{v.label}</span>
                        </div>
                        <div className="text-[11px] text-slate-300 leading-snug">{v.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => handleSaveSettingsAndProfile(false)}
                className="px-6 py-3 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-white cursor-pointer"
              >
                Simpan Pengaturan Default
              </button>
            </div>
          )}

          {/* ==================== 10. PROFIL GURU ==================== */}
          {activeTab === 'profile' && (
            <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 max-w-xl space-y-5">
              <h2 className="font-display font-bold text-xl">Profil Guru & Sekolah</h2>
              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                  Nama Lengkap Guru
                </label>
                <input
                  type="text"
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                  Nama Sekolah (Tercetak di Header Laporan Excel)
                </label>
                <input
                  type="text"
                  value={profSchool}
                  onChange={(e) => setProfSchool(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                  Email Terdaftar
                </label>
                <input
                  type="email"
                  disabled
                  value={teacher.email}
                  className="w-full px-4 py-2.5 rounded-xl bg-[#081226]/60 border border-white/10 text-slate-400"
                />
              </div>
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => handleSaveSettingsAndProfile(true)}
                  className="px-6 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-white cursor-pointer"
                >
                  Simpan Profil
                </button>
                <button
                  onClick={onLogout}
                  className="px-5 py-2.5 rounded-xl bg-rose-700 hover:bg-rose-600 font-semibold text-white cursor-pointer"
                >
                  Keluar
                </button>
              </div>
            </div>
          )}

          {/* ==================== 11. CLOUD FIREBASE & HEMAT KUOTA ==================== */}
          {activeTab === 'cloud' && (
            <FirebaseCloudPanel
              token={token}
              teacher={teacher}
              questions={questions}
              rooms={rooms}
              onQuestionsRestored={fetchAll}
              onNotify={notify}
            />
          )}
        </div>
      </main>
    </div>
  );
}
