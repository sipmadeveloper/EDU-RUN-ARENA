import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit3,
  FilePlus2,
  FolderOpen,
  Layers,
  List,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { QuestionItem, QuestionType } from '../types/game';
import { WORD_FIELD_LIMITS } from '../services/browserWordTools';

type GroupByMode = 'subject' | 'type' | 'none';
type TypeFilterValue = 'Semua' | QuestionType;
type BulkDeleteMode = 'subject' | 'type' | 'combo' | 'all';

interface PendingBulkDelete {
  ids: string[];
  label: string;
}

interface QuestionGroup {
  key: string;
  title: string;
  subtitle: string;
  accentClass: string;
  items: QuestionItem[];
}

interface QuestionBankSectionProps {
  questions: QuestionItem[];
  onSeedStarter: () => Promise<void>;
  onUpdateQuestion: (updated: QuestionItem) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onBulkDeleteQuestions: (ids: string[], label: string) => Promise<void>;
  onGoToImportWord: () => void;
  onGoToAddManual: () => void;
}

const QUESTION_TYPE_META: Record<
  QuestionType,
  { label: string; shortLabel: string; accentClass: string; order: number }
> = {
  multiple_choice: {
    label: 'Pilihan Ganda (A–D)',
    shortLabel: 'Pilihan Ganda',
    accentClass: 'border-blue-400/35 text-blue-200',
    order: 0,
  },
  true_false: {
    label: 'Benar / Salah',
    shortLabel: 'Benar/Salah',
    accentClass: 'border-amber-400/35 text-amber-200',
    order: 1,
  },
  short_answer: {
    label: 'Isian Singkat',
    shortLabel: 'Isian Singkat',
    accentClass: 'border-emerald-400/35 text-emerald-200',
    order: 2,
  },
};

function getQuestionTypeLabel(type: QuestionType): string {
  return QUESTION_TYPE_META[type]?.shortLabel || 'Pilihan Ganda';
}

export function QuestionBankSection({
  questions,
  onSeedStarter,
  onUpdateQuestion,
  onDeleteQuestion,
  onBulkDeleteQuestions,
  onGoToImportWord,
  onGoToAddManual,
}: QuestionBankSectionProps) {
  const [groupBy, setGroupBy] = useState<GroupByMode>('subject');
  const [filterSubject, setFilterSubject] = useState<string>('Semua');
  const [filterType, setFilterType] = useState<TypeFilterValue>('Semua');
  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [editingQ, setEditingQ] = useState<QuestionItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Bulk delete modal & direct group-delete confirmation state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<BulkDeleteMode>('subject');
  const [bulkTargetSubject, setBulkTargetSubject] = useState<string>('');
  const [bulkTargetType, setBulkTargetType] = useState<QuestionType>('multiple_choice');
  const [pendingDelete, setPendingDelete] = useState<PendingBulkDelete | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Subject counts across all questions
  const subjectStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of questions) {
      const subj = (q.subject || 'Umum').trim() || 'Umum';
      counts.set(subj, (counts.get(subj) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [questions]);

  // Question type counts across all questions
  const typeStats = useMemo(() => {
    const counts: Record<QuestionType, number> = {
      multiple_choice: 0,
      true_false: 0,
      short_answer: 0,
    };
    for (const q of questions) {
      if (q.questionType in counts) {
        counts[q.questionType]++;
      }
    }
    return (['multiple_choice', 'true_false', 'short_answer'] as const).map((type) => ({
      type,
      label: QUESTION_TYPE_META[type].shortLabel,
      fullLabel: QUESTION_TYPE_META[type].label,
      count: counts[type],
    }));
  }, [questions]);

  const filteredQuestions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return questions.filter((q) => {
      const subj = (q.subject || 'Umum').trim() || 'Umum';
      if (filterSubject !== 'Semua' && subj !== filterSubject) return false;
      if (filterType !== 'Semua' && q.questionType !== filterType) return false;
      if (term) {
        const hay = `${q.prompt} ${subj} ${q.grade} ${q.correctAnswer} ${q.explanation || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [questions, filterSubject, filterType, search]);

  const groupedSections = useMemo<QuestionGroup[]>(() => {
    if (groupBy === 'none') return [];

    if (groupBy === 'subject') {
      const map = new Map<string, QuestionItem[]>();
      for (const q of filteredQuestions) {
        const subj = (q.subject || 'Umum').trim() || 'Umum';
        const list = map.get(subj) || [];
        list.push(q);
        map.set(subj, list);
      }

      return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'id'))
        .map(([subj, items]) => {
          const mc = items.filter((i) => i.questionType === 'multiple_choice').length;
          const tf = items.filter((i) => i.questionType === 'true_false').length;
          const sa = items.filter((i) => i.questionType === 'short_answer').length;
          const parts: string[] = [];
          if (mc > 0) parts.push(`${mc} Pilihan Ganda`);
          if (tf > 0) parts.push(`${tf} Benar/Salah`);
          if (sa > 0) parts.push(`${sa} Isian Singkat`);

          return {
            key: `subject:${subj}`,
            title: subj,
            subtitle: parts.join(' · '),
            accentClass: 'border-blue-400/30',
            items,
          };
        });
    }

    // groupBy === 'type'
    const map = new Map<QuestionType, QuestionItem[]>();
    for (const q of filteredQuestions) {
      const list = map.get(q.questionType) || [];
      list.push(q);
      map.set(q.questionType, list);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => QUESTION_TYPE_META[a].order - QUESTION_TYPE_META[b].order)
      .map(([type, items]) => {
        const uniqSubjects = Array.from(
          new Set(items.map((i) => (i.subject || 'Umum').trim() || 'Umum'))
        ).sort((a, b) => a.localeCompare(b, 'id'));
        const subjectPreview =
          uniqSubjects.length <= 3
            ? uniqSubjects.join(', ')
            : `${uniqSubjects.slice(0, 3).join(', ')} +${uniqSubjects.length - 3} mapel lain`;

        return {
          key: `type:${type}`,
          title: QUESTION_TYPE_META[type].label,
          subtitle: `${uniqSubjects.length} Mapel: ${subjectPreview}`,
          accentClass: QUESTION_TYPE_META[type].accentClass,
          items,
        };
      });
  }, [filteredQuestions, groupBy]);

  const hasActiveFilters =
    filterSubject !== 'Semua' || filterType !== 'Semua' || search.trim().length > 0;

  const effectiveBulkSubject =
    bulkTargetSubject && subjectStats.some((s) => s.name === bulkTargetSubject)
      ? bulkTargetSubject
      : subjectStats[0]?.name || '';

  const bulkTargetInfo = useMemo(() => {
    if (bulkMode === 'all') {
      return {
        items: questions,
        label: 'Semua Soal di Bank Soal',
      };
    }
    if (bulkMode === 'subject') {
      const items = questions.filter(
        (q) => ((q.subject || 'Umum').trim() || 'Umum') === effectiveBulkSubject
      );
      return {
        items,
        label: `Mapel ${effectiveBulkSubject || '-'}`,
      };
    }
    if (bulkMode === 'type') {
      const items = questions.filter((q) => q.questionType === bulkTargetType);
      return {
        items,
        label: `Jenis ${QUESTION_TYPE_META[bulkTargetType].label}`,
      };
    }
    // combo: subject + type
    const items = questions.filter(
      (q) =>
        ((q.subject || 'Umum').trim() || 'Umum') === effectiveBulkSubject &&
        q.questionType === bulkTargetType
    );
    return {
      items,
      label: `Mapel ${effectiveBulkSubject || '-'} · ${QUESTION_TYPE_META[bulkTargetType].shortLabel}`,
    };
  }, [bulkMode, questions, effectiveBulkSubject, bulkTargetType]);

  function openBulkModal() {
    setBulkMode(groupBy === 'type' ? 'type' : 'subject');
    if (filterSubject !== 'Semua' && subjectStats.some((s) => s.name === filterSubject)) {
      setBulkTargetSubject(filterSubject);
    } else if (subjectStats[0]) {
      setBulkTargetSubject(subjectStats[0].name);
    }
    if (filterType !== 'Semua') {
      setBulkTargetType(filterType);
    }
    setBulkModalOpen(true);
  }

  function requestDeleteGroup(group: QuestionGroup) {
    if (group.items.length === 0) return;
    const extraScope: string[] = [];
    if (groupBy === 'subject' && filterType !== 'Semua') {
      extraScope.push(getQuestionTypeLabel(filterType));
    }
    if (groupBy === 'type' && filterSubject !== 'Semua') {
      extraScope.push(`Mapel ${filterSubject}`);
    }
    if (search.trim()) {
      extraScope.push(`pencarian "${search.trim()}"`);
    }

    const baseLabel =
      groupBy === 'subject' ? `Mapel ${group.title}` : `Jenis ${group.title}`;
    const label =
      extraScope.length > 0 ? `${baseLabel} (filter: ${extraScope.join(', ')})` : baseLabel;

    setPendingDelete({
      ids: group.items.map((q) => q.id),
      label,
    });
  }

  async function executeBulkDelete(ids: string[], label: string) {
    if (ids.length === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    try {
      await onBulkDeleteQuestions(ids, label);
      setPendingDelete(null);
      setBulkModalOpen(false);
      // Reset active subject filter if all questions in that subject were removed
      if (filterSubject !== 'Semua') {
        const idSet = new Set(ids);
        const stillHasSubject = questions.some(
          (q) => !idSet.has(q.id) && ((q.subject || 'Umum').trim() || 'Umum') === filterSubject
        );
        if (!stillHasSubject) {
          setFilterSubject('Semua');
        }
      }
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function setAllGroupsCollapsed(collapsed: boolean) {
    const next: Record<string, boolean> = {};
    for (const grp of groupedSections) {
      next[grp.key] = collapsed;
    }
    setCollapsedGroups(next);
  }

  function handleResetFilters() {
    setFilterSubject('Semua');
    setFilterType('Semua');
    setSearch('');
  }

  async function handleSubmitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingQ || savingEdit) return;
    setSavingEdit(true);
    try {
      const cleaned: QuestionItem = {
        ...editingQ,
        subject: editingQ.subject.trim().slice(0, WORD_FIELD_LIMITS.subject) || 'Umum',
        grade: editingQ.grade.trim().slice(0, WORD_FIELD_LIMITS.grade) || 'Umum',
        prompt: editingQ.prompt.trim().slice(0, WORD_FIELD_LIMITS.prompt),
        correctAnswer: (editingQ.correctAnswer || '').trim().slice(0, WORD_FIELD_LIMITS.correctAnswer),
        explanation: (editingQ.explanation || '').trim().slice(0, WORD_FIELD_LIMITS.explanation),
        options:
          editingQ.questionType === 'short_answer'
            ? {}
            : editingQ.questionType === 'true_false'
            ? {
                A: (editingQ.options.A || 'Benar').trim().slice(0, WORD_FIELD_LIMITS.option),
                B: (editingQ.options.B || 'Salah').trim().slice(0, WORD_FIELD_LIMITS.option),
              }
            : {
                A: (editingQ.options.A || '').trim().slice(0, WORD_FIELD_LIMITS.option),
                B: (editingQ.options.B || '').trim().slice(0, WORD_FIELD_LIMITS.option),
                C: (editingQ.options.C || '').trim().slice(0, WORD_FIELD_LIMITS.option),
                D: (editingQ.options.D || '').trim().slice(0, WORD_FIELD_LIMITS.option),
              },
      };
      await onUpdateQuestion(cleaned);
      setEditingQ(null);
    } finally {
      setSavingEdit(false);
    }
  }

  function renderQuestionCard(q: QuestionItem, displayIdx: number) {
    return (
      <div
        key={q.id}
        className="p-4 rounded-xl bg-[#081226]/90 border border-blue-400/20 flex flex-col sm:flex-row sm:items-start justify-between gap-4"
      >
        <div className="space-y-1.5 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-blue-200">
            <span className="font-mono font-bold text-[#FACC15]">#{displayIdx + 1}</span>
            <span className="font-semibold text-white">{q.subject || 'Umum'}</span>
            <span aria-hidden="true">·</span>
            <span>Kelas {q.grade || 'Umum'}</span>
            <span aria-hidden="true">·</span>
            <span className="text-sky-300">{getQuestionTypeLabel(q.questionType)}</span>
          </div>

          <p className="font-medium text-white break-words">{q.prompt}</p>

          {q.questionType !== 'short_answer' && (
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-300 pt-1">
              {(['A', 'B', 'C', 'D'] as const)
                .filter((k) => Boolean(q.options[k]))
                .map((k) => (
                  <div
                    key={k}
                    className={q.correctAnswer === k ? 'text-emerald-300 font-semibold' : ''}
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
            type="button"
            onClick={() => setEditingQ({ ...q, options: { ...q.options } })}
            className="p-2 rounded-lg bg-[#0F2957] hover:bg-blue-800 text-blue-200 cursor-pointer"
            title="Edit Soal / Ubah Golongan"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              void onDeleteQuestion(q.id);
            }}
            className="p-2 rounded-lg bg-rose-950/70 hover:bg-rose-700 text-rose-200 cursor-pointer"
            title="Hapus Soal"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ==================== TOP CONTROLS & GROUPING SWITCHER ==================== */}
      <div className="p-4 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Group-by Segmented Control */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-blue-200 mr-1">Golongkan:</span>
            <div className="inline-flex rounded-xl bg-[#081226] p-1 border border-blue-400/25">
              <button
                type="button"
                onClick={() => setGroupBy('subject')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  groupBy === 'subject'
                    ? 'bg-[#1D4ED8] text-white'
                    : 'text-blue-200/80 hover:text-white'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Per Mapel</span>
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('type')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  groupBy === 'type'
                    ? 'bg-[#1D4ED8] text-white'
                    : 'text-blue-200/80 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Per Jenis Soal</span>
              </button>
              <button
                type="button"
                onClick={() => setGroupBy('none')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  groupBy === 'none'
                    ? 'bg-[#1D4ED8] text-white'
                    : 'text-blue-200/80 hover:text-white'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                <span>Semua</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void onSeedStarter();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#081226] border border-[#FACC15]/40 text-xs font-semibold text-[#FACC15] hover:bg-blue-950 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Muat 50 Soal Contoh</span>
            </button>
            <button
              type="button"
              onClick={onGoToImportWord}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 text-xs font-semibold text-white cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Impor .docx</span>
            </button>
            <button
              type="button"
              onClick={onGoToAddManual}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] text-xs font-semibold text-white cursor-pointer"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Tambah Manual</span>
            </button>
            {questions.length > 0 && (
              <button
                type="button"
                onClick={openBulkModal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-950/75 hover:bg-rose-700 border border-rose-400/35 text-xs font-semibold text-rose-100 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus per Mapel / Jenis</span>
              </button>
            )}
          </div>
        </div>

        {/* Search + Subject Filter + Type Filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari pertanyaan, mapel, atau kunci jawaban..."
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
            />
          </div>

          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            aria-label="Filter Mata Pelajaran"
            className="px-3.5 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
          >
            <option value="Semua">Semua Mapel ({questions.length})</option>
            {subjectStats.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.count})
              </option>
            ))}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as TypeFilterValue)}
            aria-label="Filter Jenis Soal"
            className="px-3.5 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
          >
            <option value="Semua">Semua Jenis Soal ({questions.length})</option>
            {typeStats.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label} ({t.count})
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#081226] hover:bg-blue-950 border border-blue-400/25 text-xs font-semibold text-blue-200 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filter</span>
            </button>
          )}
        </div>

        {/* Quick Clickable Category Overview */}
        {questions.length > 0 && (
          <div className="pt-1 border-t border-white/10">
            {groupBy === 'type' ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setFilterType('Semua')}
                  className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    filterType === 'Semua'
                      ? 'bg-[#1D4ED8]/35 border-[#1D4ED8] text-white'
                      : 'bg-[#081226] border-blue-400/20 text-blue-200 hover:border-blue-400/40'
                  }`}
                >
                  <div className="text-[11px] opacity-80">Semua Jenis</div>
                  <div className="font-mono font-bold text-base tabular-nums">
                    {questions.length} soal
                  </div>
                </button>
                {typeStats.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => setFilterType(filterType === t.type ? 'Semua' : t.type)}
                    className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                      filterType === t.type
                        ? 'bg-[#1D4ED8]/35 border-[#1D4ED8] text-white'
                        : 'bg-[#081226] border-blue-400/20 text-blue-200 hover:border-blue-400/40'
                    }`}
                  >
                    <div className="text-[11px] opacity-80 truncate">{t.label}</div>
                    <div className="font-mono font-bold text-base tabular-nums">
                      {t.count} soal
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFilterSubject('Semua')}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    filterSubject === 'Semua'
                      ? 'bg-[#1D4ED8] border-blue-400/50 text-white'
                      : 'bg-[#081226] border-blue-400/20 text-blue-200 hover:border-blue-400/45'
                  }`}
                >
                  Semua Mapel ({questions.length})
                </button>
                {subjectStats.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => setFilterSubject(filterSubject === s.name ? 'Semua' : s.name)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      filterSubject === s.name
                        ? 'bg-[#1D4ED8] border-blue-400/50 text-white'
                        : 'bg-[#081226] border-blue-400/20 text-blue-200 hover:border-blue-400/45'
                    }`}
                  >
                    {s.name} ({s.count})
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ==================== RESULTS SUMMARY & EXPAND/COLLAPSE ==================== */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-blue-200/80">
        <div>
          Menampilkan <strong className="text-white">{filteredQuestions.length}</strong> dari{' '}
          <strong className="text-white">{questions.length}</strong> soal
          {groupBy === 'subject' && groupedSections.length > 0 && (
            <span> · {groupedSections.length} golongan mata pelajaran</span>
          )}
          {groupBy === 'type' && groupedSections.length > 0 && (
            <span> · {groupedSections.length} golongan jenis soal</span>
          )}
        </div>

        {groupBy !== 'none' && groupedSections.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAllGroupsCollapsed(false)}
              className="text-blue-300 hover:text-white font-semibold cursor-pointer"
            >
              Buka Semua
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setAllGroupsCollapsed(true)}
              className="text-blue-300 hover:text-white font-semibold cursor-pointer"
            >
              Tutup Semua
            </button>
          </div>
        )}
      </div>

      {/* ==================== QUESTION LIST (GROUPED OR FLAT) ==================== */}
      {filteredQuestions.length === 0 ? (
        <div className="p-8 rounded-2xl bg-[#0F2957] border border-blue-400/20 text-center space-y-3">
          <p className="text-sm text-blue-200">
            {questions.length === 0
              ? 'Bank Soal masih kosong. Tambahkan soal manual, impor dari file Word (.docx), atau muat 50 soal contoh.'
              : 'Tidak ada soal yang cocok dengan filter atau kata kunci pencarian saat ini.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D4ED8] text-xs font-semibold text-white cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Tampilkan Semua Soal</span>
            </button>
          )}
        </div>
      ) : groupBy === 'none' ? (
        <div className="space-y-3">
          {filteredQuestions.map((q, idx) => renderQuestionCard(q, idx))}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedSections.map((group) => {
            const isCollapsed = Boolean(collapsedGroups[group.key]);
            return (
              <section
                key={group.key}
                className={`rounded-2xl bg-[#0F2957] border ${group.accentClass} overflow-hidden`}
              >
                <div className="px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#081226] border border-blue-400/25 flex items-center justify-center text-[#FACC15] shrink-0">
                      {groupBy === 'subject' ? (
                        <FolderOpen className="w-4 h-4" />
                      ) : (
                        <Layers className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display font-bold text-base text-white truncate">
                          {group.title}
                        </h3>
                        <span className="font-mono text-xs font-bold text-[#FACC15]">
                          {group.items.length} soal
                        </span>
                      </div>
                      {group.subtitle && (
                        <p className="text-xs text-blue-200/75 truncate">{group.subtitle}</p>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => requestDeleteGroup(group)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/75 hover:bg-rose-700 border border-rose-400/30 text-xs font-semibold text-rose-100 cursor-pointer"
                      title={`Hapus semua ${group.items.length} soal pada golongan ${group.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Hapus Golongan</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="p-1.5 rounded-lg hover:bg-white/10 text-blue-200 cursor-pointer"
                      aria-label={isCollapsed ? 'Buka golongan' : 'Tutup golongan'}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="w-5 h-5" />
                      ) : (
                        <ChevronDown className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="px-4 pb-4 pt-1 space-y-2.5 border-t border-white/10">
                    {group.items.map((q, idx) => renderQuestionCard(q, idx))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ==================== EDIT SOAL MODAL (TERMASUK MAPEL & JENIS SOAL) ==================== */}
      {editingQ && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitEdit}
            className="w-full max-w-xl p-6 rounded-2xl bg-[#0F2957] border border-blue-400/30 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="font-display font-bold text-lg text-white">Edit Soal & Golongan</h3>

            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1">
                  Mata Pelajaran
                </label>
                <input
                  type="text"
                  required
                  list="bank-subject-suggestions"
                  maxLength={WORD_FIELD_LIMITS.subject}
                  value={editingQ.subject}
                  onChange={(e) => setEditingQ({ ...editingQ, subject: e.target.value })}
                  placeholder="Mata Pelajaran"
                  className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                />
                <datalist id="bank-subject-suggestions">
                  {subjectStats.map((s) => (
                    <option key={s.name} value={s.name} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1">Kelas</label>
                <input
                  type="text"
                  required
                  maxLength={WORD_FIELD_LIMITS.grade}
                  value={editingQ.grade}
                  onChange={(e) => setEditingQ({ ...editingQ, grade: e.target.value })}
                  placeholder="Kelas"
                  className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-blue-200 mb-1">Jenis Soal</label>
                <select
                  value={editingQ.questionType}
                  onChange={(e) => {
                    const nextType = e.target.value as QuestionType;
                    setEditingQ((prev) => {
                      if (!prev) return null;
                      if (nextType === 'true_false') {
                        return {
                          ...prev,
                          questionType: nextType,
                          options: {
                            A: prev.options.A || 'Benar',
                            B: prev.options.B || 'Salah',
                          },
                          correctAnswer: prev.correctAnswer === 'B' ? 'B' : 'A',
                        };
                      }
                      if (nextType === 'short_answer') {
                        return {
                          ...prev,
                          questionType: nextType,
                          options: {},
                        };
                      }
                      return {
                        ...prev,
                        questionType: nextType,
                        options: {
                          A: prev.options.A || '',
                          B: prev.options.B || '',
                          C: prev.options.C || '',
                          D: prev.options.D || '',
                        },
                        correctAnswer:
                          prev.correctAnswer && ['A', 'B', 'C', 'D'].includes(prev.correctAnswer)
                            ? prev.correctAnswer
                            : 'A',
                      };
                    });
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                >
                  <option value="multiple_choice">Pilihan Ganda</option>
                  <option value="true_false">Benar / Salah</option>
                  <option value="short_answer">Isian Singkat</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1">Pertanyaan</label>
              <textarea
                rows={3}
                required
                maxLength={WORD_FIELD_LIMITS.prompt}
                value={editingQ.prompt}
                onChange={(e) => setEditingQ({ ...editingQ, prompt: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
              />
            </div>

            {editingQ.questionType !== 'short_answer' && (
              <div className="grid grid-cols-2 gap-2">
                {(editingQ.questionType === 'true_false'
                  ? (['A', 'B'] as const)
                  : (['A', 'B', 'C', 'D'] as const)
                ).map((k) => (
                  <input
                    key={k}
                    type="text"
                    required
                    maxLength={WORD_FIELD_LIMITS.option}
                    placeholder={`Opsi ${k}`}
                    value={editingQ.options[k] || ''}
                    onChange={(e) =>
                      setEditingQ({
                        ...editingQ,
                        options: { ...editingQ.options, [k]: e.target.value },
                      })
                    }
                    className="px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                  />
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1">
                Kunci Jawaban
              </label>
              {editingQ.questionType === 'short_answer' ? (
                <input
                  type="text"
                  required
                  maxLength={WORD_FIELD_LIMITS.correctAnswer}
                  value={editingQ.correctAnswer || ''}
                  onChange={(e) => setEditingQ({ ...editingQ, correctAnswer: e.target.value })}
                  placeholder="Kunci Jawaban"
                  className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                />
              ) : (
                <select
                  value={editingQ.correctAnswer || 'A'}
                  onChange={(e) => setEditingQ({ ...editingQ, correctAnswer: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                >
                  <option value="A">A {editingQ.questionType === 'true_false' ? '(Benar)' : ''}</option>
                  <option value="B">B {editingQ.questionType === 'true_false' ? '(Salah)' : ''}</option>
                  {editingQ.questionType === 'multiple_choice' && (
                    <>
                      <option value="C">C</option>
                      <option value="D">D</option>
                    </>
                  )}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-blue-200 mb-1">Pembahasan</label>
              <textarea
                rows={2}
                maxLength={WORD_FIELD_LIMITS.explanation}
                value={editingQ.explanation || ''}
                onChange={(e) => setEditingQ({ ...editingQ, explanation: e.target.value })}
                placeholder="Pembahasan"
                className="w-full px-3 py-2 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingQ(null)}
                disabled={savingEdit}
                className="px-4 py-2 rounded-xl bg-[#081226] text-sm text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingEdit}
                className="px-5 py-2 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-60 text-sm font-semibold text-white cursor-pointer"
              >
                {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ==================== MODAL HAPUS MASSAL PER MAPEL / JENIS SOAL ==================== */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl bg-[#0F2957] border border-rose-400/35 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-950/80 border border-rose-400/40 flex items-center justify-center text-rose-300 shrink-0">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-lg text-white">
                    Hapus Soal per Mapel / Jenis Soal
                  </h3>
                  <p className="text-xs text-blue-200/80">
                    Pilih golongan soal yang ingin dihapus sekaligus dari Bank Soal Firebase.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !bulkDeleting && setBulkModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Selector */}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: 'subject', label: 'Berdasarkan Mapel' },
                  { id: 'type', label: 'Berdasarkan Jenis Soal' },
                  { id: 'combo', label: 'Mapel + Jenis Soal' },
                  { id: 'all', label: 'Semua Bank Soal' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBulkMode(opt.id)}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-colors cursor-pointer ${
                    bulkMode === opt.id
                      ? 'bg-rose-600/30 border-rose-400 text-white'
                      : 'bg-[#081226] border-blue-400/20 text-blue-200 hover:border-blue-400/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Target Selectors */}
            <div className="space-y-3">
              {(bulkMode === 'subject' || bulkMode === 'combo') && (
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Pilih Mata Pelajaran yang Akan Dihapus
                  </label>
                  <select
                    value={effectiveBulkSubject}
                    onChange={(e) => setBulkTargetSubject(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                  >
                    {subjectStats.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} ({s.count} soal)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(bulkMode === 'type' || bulkMode === 'combo') && (
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Pilih Jenis Soal yang Akan Dihapus
                  </label>
                  <select
                    value={bulkTargetType}
                    onChange={(e) => setBulkTargetType(e.target.value as QuestionType)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-sm text-white"
                  >
                    {typeStats.map((t) => (
                      <option key={t.type} value={t.type}>
                        {t.fullLabel} ({t.count} soal)
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Live Impact Summary */}
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-400/35 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-300 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-100 space-y-1">
                <p className="font-semibold">
                  Target: <span className="text-white">{bulkTargetInfo.label}</span>
                </p>
                <p>
                  Sebanyak{' '}
                  <strong className="text-[#FACC15]">{bulkTargetInfo.items.length} soal</strong>{' '}
                  akan dihapus permanen dari Firebase Firestore (tersisa{' '}
                  <strong>{questions.length - bulkTargetInfo.items.length} soal</strong> di Bank
                  Soal).
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                disabled={bulkDeleting}
                className="px-4 py-2.5 rounded-xl bg-[#081226] text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={bulkDeleting || bulkTargetInfo.items.length === 0}
                onClick={() => {
                  void executeBulkDelete(
                    bulkTargetInfo.items.map((q) => q.id),
                    bulkTargetInfo.label
                  );
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
              >
                {bulkDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>
                  {bulkDeleting
                    ? 'Menghapus dari Firebase...'
                    : `Hapus ${bulkTargetInfo.items.length} Soal`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== KONFIRMASI HAPUS LANGSUNG 1 GOLONGAN ==================== */}
      {pendingDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="w-full max-w-md p-6 rounded-2xl bg-[#0F2957] border border-rose-400/40 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-950/80 border border-rose-400/40 flex items-center justify-center text-rose-300 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display font-bold text-base text-white">
                  Konfirmasi Hapus Golongan Soal
                </h3>
                <p className="text-xs text-blue-100/85 leading-relaxed">
                  Anda yakin ingin menghapus{' '}
                  <strong className="text-[#FACC15]">{pendingDelete.ids.length} soal</strong> pada{' '}
                  <strong className="text-white">{pendingDelete.label}</strong> secara permanen dari
                  Bank Soal Firebase?
                </p>
                <p className="text-[11px] text-rose-200/80">
                  Sisa soal di Bank Soal setelah dihapus:{' '}
                  <strong>{questions.length - pendingDelete.ids.length} soal</strong>.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={bulkDeleting}
                className="px-4 py-2 rounded-xl bg-[#081226] text-xs font-semibold text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={bulkDeleting}
                onClick={() => {
                  void executeBulkDelete(pendingDelete.ids, pendingDelete.label);
                }}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-xs font-semibold text-white cursor-pointer"
              >
                {bulkDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>
                  {bulkDeleting
                    ? 'Menghapus...'
                    : `Ya, Hapus ${pendingDelete.ids.length} Soal`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
