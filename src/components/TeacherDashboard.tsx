import { useEffect, useState, useCallback, useRef } from 'react';
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
  Eye,
  AlertCircle,
  CheckCircle2,
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
import { WordImportModule } from './WordImportModule';
import { QuestionBankSection } from './QuestionBankSection';
import { AppLogo } from './AppLogo';
import {
  clearDriveAccessToken,
  formatFriendlyFirestoreError,
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
  loadQuestionBankFromCloud,
  syncQuestionBankToCloud,
  updateTeacherCloudProfileFull,
} from '../services/firebaseCloudStore';
import {
  createFirebaseRoom,
  deleteFirebaseRoom,
  downloadRoomExcelFromFirebase,
  finishFirebaseRoom,
  getFirebaseRoomResults,
  listTeacherRooms,
  startFirebaseRoom,
} from '../services/firebaseRaceService';
import { buildStarterQuestionItems } from '../services/starterQuestions';
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

  // Add Question Manual Form
  const [newQSubject, setNewQSubject] = useState('Matematika');
  const [newQGrade, setNewQGrade] = useState('Umum');
  const [newQType, setNewQType] = useState<QuestionType>('multiple_choice');
  const [newQPrompt, setNewQPrompt] = useState('');
  const [newQOpts, setNewQOpts] = useState({ A: '', B: '', C: '', D: '' });
  const [newQCorrect, setNewQCorrect] = useState('A');
  const [newQExp, setNewQExp] = useState('');

  // Results Viewer State
  const [selectedResultRoomId, setSelectedResultRoomId] = useState<string>('');
  const [resultDetail, setResultDetail] = useState<RoomResultDetail | null>(null);
  const [resultRankMode, setResultRankMode] = useState<'score' | 'finish'>('score');

  // Settings & Profile Form
  const [defaultCfg, setDefaultCfg] = useState<RoomSettings>(teacher.defaultSettings);
  const [profName, setProfName] = useState(teacher.name);
  const [profSchool, setProfSchool] = useState(teacher.schoolName);

  // Direct Excel -> Google Drive upload confirmation & browser Excel download busy state
  const [driveExcelConfirmRoom, setDriveExcelConfirmRoom] = useState<RoomSummary | null>(null);
  const [driveExcelBusyId, setDriveExcelBusyId] = useState<string | null>(null);
  const [excelDownloadBusyId, setExcelDownloadBusyId] = useState<string | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean>(() => Boolean(getDriveAccessToken()));

  useEffect(() => {
    return subscribeDriveToken((tok) => {
      setDriveConnected(Boolean(tok));
    });
  }, []);

  const isMountedRef = useRef(true);
  const bannerTimerRef = useRef<number | null>(null);
  const selectedResultRoomIdRef = useRef(selectedResultRoomId);
  selectedResultRoomIdRef.current = selectedResultRoomId;
  const [resultsRefreshTick, setResultsRefreshTick] = useState(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (bannerTimerRef.current !== null) {
        window.clearTimeout(bannerTimerRef.current);
      }
    };
  }, []);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    if (!isMountedRef.current) return;
    if (bannerTimerRef.current !== null) {
      window.clearTimeout(bannerTimerRef.current);
    }
    setBannerMsg({ kind, text });
    bannerTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) setBannerMsg(null);
    }, 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!isMountedRef.current) return;
    setLoadingData(true);
    try {
      const [roomList, cloudBank] = await Promise.all([
        listTeacherRooms(teacher.id),
        loadQuestionBankFromCloud(teacher.id),
      ]);
      if (!isMountedRef.current) return;
      setRooms(roomList);
      const currentSelected = selectedResultRoomIdRef.current;
      if ((!currentSelected || !roomList.some((r) => r.id === currentSelected)) && roomList.length > 0) {
        setSelectedResultRoomId(roomList[0].id);
      }
      const mappedQuestions: QuestionItem[] = cloudBank.questions.map((q) => ({
        id: q.id,
        subject: q.subject,
        grade: q.grade,
        questionType: q.questionType,
        prompt: q.prompt,
        options: q.options,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
      }));
      setQuestions(mappedQuestions);
    } catch (err) {
      if (isMountedRef.current) {
        notify('err', formatFriendlyFirestoreError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingData(false);
      }
    }
  }, [teacher.id, notify]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (monitoringRoomId || activeTab !== 'results' || !selectedResultRoomId) return;
    let cancelled = false;
    getFirebaseRoomResults(selectedResultRoomId)
      .then((data) => {
        if (!cancelled && isMountedRef.current) {
          setResultDetail(data);
        }
      })
      .catch(() => {
        if (!cancelled && isMountedRef.current) {
          setResultDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [monitoringRoomId, activeTab, selectedResultRoomId, resultsRefreshTick]);

  if (monitoringRoomId) {
    return (
      <TeacherRoomMonitor
        roomId={monitoringRoomId}
        token={token}
        onBack={() => {
          setMonitoringRoomId(null);
          setResultsRefreshTick((n) => n + 1);
          void fetchAll();
        }}
        onOpenResults={(rid) => {
          setMonitoringRoomId(null);
          setSelectedResultRoomId(rid);
          setActiveTab('results');
          setResultsRefreshTick((n) => n + 1);
          void fetchAll();
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
      const created = await createFirebaseRoom({
        ownerId: teacher.id,
        teacher,
        name: rmName,
        subject: rmSubject,
        grade: rmGrade,
        settings: effectiveSettings,
        allQuestions: questions,
        questionIds: rmPickManual ? rmSelectedQIds : undefined,
        scheduledAt: rmSchedule || undefined,
      });
      notify(
        'ok',
        `Room berhasil dibuat! Kode: ${created.code} (${created.questionCount} soal · ${created.totalLaps ?? calcTotalLaps(created.questionCount)} putaran · ${formatScoreValue(created.pointsPerQuestion ?? calcPointsPerQuestion(created.questionCount))} poin/soal)`
      );
      setRmName('');
      setRmSelectedQIds([]);
      await fetchAll();
      setActiveTab('rooms');
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleRoomAction(roomId: string, action: 'start' | 'close' | 'delete') {
    try {
      if (action === 'start') {
        await startFirebaseRoom(roomId);
      } else if (action === 'close') {
        await finishFirebaseRoom(roomId);
      } else {
        await deleteFirebaseRoom(roomId);
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
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleDownloadRoomExcel(roomCode: string) {
    if (excelDownloadBusyId) return;
    setExcelDownloadBusyId(roomCode);
    try {
      await downloadRoomExcelFromFirebase(roomCode);
      notify('ok', `Rekap Excel (.xlsx) untuk room ${roomCode} berhasil diunduh!`);
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    } finally {
      setExcelDownloadBusyId(null);
    }
  }

  async function handleSeedStarterQuestions() {
    try {
      const { merged, added, skipped } = buildStarterQuestionItems(questions);
      if (added === 0) {
        notify('ok', `Semua 50 soal contoh sudah ada di Bank Soal Anda (${skipped} dilewati).`);
        return;
      }
      await syncQuestionBankToCloud(teacher.id, merged);
      notify('ok', `${added} soal contoh berhasil ditambahkan ke Bank Soal (${skipped} sudah ada).`);
      await fetchAll();
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleCreateManualQuestion(e: React.FormEvent) {
    e.preventDefault();
    try {
      const newItem: QuestionItem = {
        id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        subject: newQSubject.trim() || 'Umum',
        grade: newQGrade.trim() || 'Umum',
        questionType: newQType,
        prompt: newQPrompt.trim(),
        options: newQType === 'short_answer' ? {} : newQOpts,
        correctAnswer: newQCorrect.trim(),
        explanation: newQExp.trim(),
        createdAt: new Date().toISOString(),
      };
      const nextList = [newItem, ...questions];
      await syncQuestionBankToCloud(teacher.id, nextList);
      notify('ok', 'Soal berhasil ditambahkan ke Bank Soal.');
      setNewQPrompt('');
      setNewQOpts({ A: '', B: '', C: '', D: '' });
      setNewQExp('');
      await fetchAll();
      setActiveTab('bank');
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleUpdateQuestion(updatedItem: QuestionItem) {
    try {
      const nextList = questions.map((q) => (q.id === updatedItem.id ? updatedItem : q));
      await syncQuestionBankToCloud(teacher.id, nextList);
      notify('ok', 'Soal berhasil diperbarui.');
      await fetchAll();
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleDeleteQuestion(id: string) {
    try {
      const nextList = questions.filter((q) => q.id !== id);
      await syncQuestionBankToCloud(teacher.id, nextList);
      notify('ok', 'Soal dihapus dari Bank Soal.');
      await fetchAll();
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleBulkDeleteQuestions(idsToDelete: string[], label: string) {
    if (idsToDelete.length === 0) return;
    try {
      const idSet = new Set(idsToDelete);
      const nextList = questions.filter((q) => !idSet.has(q.id));
      await syncQuestionBankToCloud(teacher.id, nextList);
      notify('ok', `${idsToDelete.length} soal (${label}) berhasil dihapus dari Bank Soal Firebase.`);
      await fetchAll();
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  async function handleSaveSettingsAndProfile(isProfile: boolean) {
    try {
      const updated = await updateTeacherCloudProfileFull(teacher.id, {
        name: profName,
        schoolName: profSchool,
        email: teacher.email,
        defaultSettings: defaultCfg,
      });
      onTeacherUpdated(updated);
      setRmSettings(updated.defaultSettings);
      notify('ok', isProfile ? 'Profil guru berhasil diperbarui.' : 'Pengaturan game default disimpan.');
    } catch (err) {
      notify('err', formatFriendlyFirestoreError(err));
    }
  }

  const subjects = ['Semua', ...Array.from(new Set(questions.map((q) => q.subject)))];

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
                                <button
                                  type="button"
                                  onClick={() => handleDownloadRoomExcel(r.code)}
                                  disabled={excelDownloadBusyId !== null}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-semibold text-white cursor-pointer"
                                >
                                  {excelDownloadBusyId === r.code ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Download className="w-3.5 h-3.5" />
                                  )}
                                  <span>Excel</span>
                                </button>
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
            <QuestionBankSection
              questions={questions}
              onSeedStarter={handleSeedStarterQuestions}
              onUpdateQuestion={handleUpdateQuestion}
              onDeleteQuestion={handleDeleteQuestion}
              onBulkDeleteQuestions={handleBulkDeleteQuestions}
              onGoToImportWord={() => setActiveTab('import_word')}
              onGoToAddManual={() => setActiveTab('add_question')}
            />
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
            <WordImportModule
              teacherId={teacher.id}
              existingQuestions={questions}
              onImported={fetchAll}
              onNotify={notify}
              onGoToBank={() => setActiveTab('bank')}
            />
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
                  <button
                    type="button"
                    onClick={() => handleDownloadRoomExcel(selectedResultRoomId)}
                    disabled={excelDownloadBusyId !== null}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-semibold text-sm text-white cursor-pointer"
                  >
                    {excelDownloadBusyId === selectedResultRoomId ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    <span>
                      {excelDownloadBusyId === selectedResultRoomId
                        ? 'Menyiapkan Excel...'
                        : 'Download Rekap Excel (.xlsx)'}
                    </span>
                  </button>
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
                        <button
                          type="button"
                          onClick={() => handleDownloadRoomExcel(r.code)}
                          disabled={excelDownloadBusyId !== null}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-semibold text-sm text-white whitespace-nowrap cursor-pointer"
                        >
                          {excelDownloadBusyId === r.code ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <FileSpreadsheet className="w-4 h-4" />
                          )}
                          <span>{excelDownloadBusyId === r.code ? 'Menyiapkan...' : 'Download Excel'}</span>
                        </button>
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
