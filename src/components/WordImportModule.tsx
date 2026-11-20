import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Download,
  Edit3,
  FileText,
  Filter,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { QuestionItem, QuestionType } from '../types/game';
import {
  downloadWordTemplateInBrowser,
  parseWordFileInBrowser,
  revalidateParsedWordQuestions,
  WORD_FIELD_LIMITS,
  type DetectedWordFormat,
  type ParsedWordQuestion,
} from '../services/browserWordTools';
import {
  MAX_PACKS_PER_TEACHER,
  MAX_QUESTIONS_PER_PACK,
  syncQuestionBankToCloud,
} from '../services/firebaseCloudStore';
import { mergeQuestionsDeduplicated } from '../services/starterQuestions';
import { formatFriendlyFirestoreError } from '../firebase';

const MAX_FIREBASE_BANK_QUESTIONS = MAX_QUESTIONS_PER_PACK * MAX_PACKS_PER_TEACHER;

interface WordPreviewItem extends ParsedWordQuestion {
  selected: boolean;
}

type PreviewFilter = 'all' | 'ready' | 'warning' | 'duplicate';

interface WordImportModuleProps {
  teacherId: string;
  existingQuestions: QuestionItem[];
  onImported: () => Promise<void>;
  onNotify: (kind: 'ok' | 'err', text: string) => void;
  onGoToBank?: () => void;
}

export function WordImportModule({
  teacherId,
  existingQuestions,
  onImported,
  onNotify,
  onGoToBank,
}: WordImportModuleProps) {
  const [wordSubject, setWordSubject] = useState('Umum');
  const [wordGrade, setWordGrade] = useState('Umum');
  const [autoSaveToFirebase, setAutoSaveToFirebase] = useState(false);

  const [extractBusy, setExtractBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [fileMeta, setFileMeta] = useState<{
    fileName: string;
    fileSizeBytes: number;
    detectedFormat: DetectedWordFormat;
    answerKeySectionCount: number;
  } | null>(null);
  const [rawText, setRawText] = useState('');
  const [showRawText, setShowRawText] = useState(false);
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const [previewItems, setPreviewItems] = useState<WordPreviewItem[] | null>(null);
  const [activeFilter, setActiveFilter] = useState<PreviewFilter>('all');

  // Inline quick-edit state for a single extracted item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<WordPreviewItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const existingPromptsLower = useMemo(
    () => new Set(existingQuestions.map((q) => q.prompt.trim().toLowerCase())),
    [existingQuestions]
  );

  const remainingCapacity = Math.max(0, MAX_FIREBASE_BANK_QUESTIONS - existingQuestions.length);

  const stats = useMemo(() => {
    const items = previewItems || [];
    let ready = 0;
    let duplicate = 0;
    let needsFix = 0;
    let selected = 0;

    for (const item of items) {
      if (item.isDuplicate) duplicate++;
      else if (item.valid) ready++;
      else needsFix++;

      if (item.selected && item.valid && !item.isDuplicate) selected++;
    }

    return {
      total: items.length,
      ready,
      duplicate,
      needsFix,
      selected,
    };
  }, [previewItems]);

  const filteredItems = useMemo(() => {
    if (!previewItems) return [];
    if (activeFilter === 'ready') {
      return previewItems.filter((i) => i.valid && !i.isDuplicate);
    }
    if (activeFilter === 'warning') {
      return previewItems.filter((i) => !i.valid && !i.isDuplicate);
    }
    if (activeFilter === 'duplicate') {
      return previewItems.filter((i) => i.isDuplicate);
    }
    return previewItems;
  }, [previewItems, activeFilter]);

  async function persistItemsToFirebase(
    approved: WordPreviewItem[],
    clearPreviewOnSuccess: boolean
  ): Promise<{ added: number; skipped: number } | null> {
    if (approved.length === 0) {
      onNotify('err', 'Pilih minimal 1 soal valid yang belum duplikat untuk disimpan ke Firebase.');
      return null;
    }

    if (remainingCapacity <= 0) {
      onNotify(
        'err',
        `Kapasitas Bank Soal Firebase penuh (${MAX_FIREBASE_BANK_QUESTIONS} soal). Hapus sebagian soal lama terlebih dahulu.`
      );
      return null;
    }

    const cappedApproved = approved.slice(0, remainingCapacity);
    const trimmedByCapacity = approved.length - cappedApproved.length;

    setSaveBusy(true);
    try {
      const fallbackSubject = wordSubject.trim().slice(0, WORD_FIELD_LIMITS.subject) || 'Umum';
      const fallbackGrade = wordGrade.trim().slice(0, WORD_FIELD_LIMITS.grade) || 'Umum';

      const incoming = cappedApproved.map((item) => ({
        subject: item.subjectOverride || fallbackSubject,
        grade: item.gradeOverride || fallbackGrade,
        questionType: item.questionType,
        prompt: item.prompt,
        options: item.options,
        correctAnswer: item.correctAnswer,
        explanation: item.explanation,
      }));

      const { merged, added, skipped } = mergeQuestionsDeduplicated(existingQuestions, incoming);
      await syncQuestionBankToCloud(teacherId, merged);

      const extraParts: string[] = [];
      if (skipped > 0) extraParts.push(`${skipped} duplikat dilewati`);
      if (trimmedByCapacity > 0) {
        extraParts.push(`${trimmedByCapacity} melebihi batas ${MAX_FIREBASE_BANK_QUESTIONS} soal`);
      }
      const suffix = extraParts.length > 0 ? ` (${extraParts.join(', ')})` : '';

      onNotify(
        'ok',
        `${added} soal dari Word (.docx) berhasil diekstrak dan disimpan ke Bank Soal Firebase${suffix}.`
      );

      await onImported();
      if (clearPreviewOnSuccess) {
        setPreviewItems(null);
        setEditingId(null);
        setEditDraft(null);
        if (onGoToBank) onGoToBank();
      }
      return { added, skipped };
    } catch (err) {
      onNotify('err', formatFriendlyFirestoreError(err));
      return null;
    } finally {
      setSaveBusy(false);
    }
  }

  async function processWordFile(file: File) {
    setExtractBusy(true);
    setEditingId(null);
    setEditDraft(null);
    setShowRawText(false);
    setActiveFilter('all');

    try {
      const parsed = await parseWordFileInBrowser(file, existingPromptsLower);
      setFileMeta({
        fileName: parsed.fileName,
        fileSizeBytes: parsed.fileSizeBytes,
        detectedFormat: parsed.detectedFormat,
        answerKeySectionCount: parsed.answerKeySectionCount,
      });
      setRawText(parsed.rawText);

      const items: WordPreviewItem[] = parsed.items.map((item) => ({
        ...item,
        selected: item.valid && !item.isDuplicate,
      }));
      setPreviewItems(items);

      if (items.length === 0) {
        setShowRawText(true);
        onNotify(
          'err',
          'Belum ada soal yang terdeteksi di file .docx. Cek "Lihat Teks Mentah" atau gunakan Template Word resmi.'
        );
        return;
      }

      const validNonDup = items.filter((i) => i.valid && !i.isDuplicate);

      if (autoSaveToFirebase) {
        if (validNonDup.length === 0) {
          onNotify(
            'err',
            `${items.length} soal ditemukan, tetapi belum ada yang siap simpan otomatis (periksa kunci jawaban atau duplikat di bawah).`
          );
          return;
        }
        const saved = await persistItemsToFirebase(validNonDup, false);
        if (saved) {
          // Keep any warning/unimported items visible so the teacher can see what was skipped or fix them
          const savedIds = new Set(validNonDup.slice(0, remainingCapacity).map((i) => i.id));
          const remainingForReview = items
            .filter((i) => !savedIds.has(i.id))
            .map((i) => ({ ...i, selected: false }));
          setPreviewItems(remainingForReview.length > 0 ? remainingForReview : null);
          if (remainingForReview.length === 0 && onGoToBank) {
            onGoToBank();
          }
        }
      } else {
        onNotify(
          'ok',
          `${items.length} soal berhasil diekstrak (${validNonDup.length} siap disimpan ke Firebase). Periksa lalu klik Simpan.`
        );
      }
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Gagal memproses file Word (.docx).');
    } finally {
      setExtractBusy(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void processWordFile(file);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (extractBusy || saveBusy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processWordFile(file);
    }
  }

  async function handleDownloadTemplate() {
    if (templateBusy) return;
    setTemplateBusy(true);
    try {
      await downloadWordTemplateInBrowser();
      onNotify('ok', 'Template Word (.docx) berhasil diunduh!');
    } catch (err) {
      onNotify('err', err instanceof Error ? err.message : 'Gagal membuat template Word.');
    } finally {
      setTemplateBusy(false);
    }
  }

  function handleToggleSelect(id: string) {
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) =>
            item.id === id && item.valid && !item.isDuplicate
              ? { ...item, selected: !item.selected }
              : item
          )
        : null
    );
  }

  function handleSelectAllValid(checked: boolean) {
    setPreviewItems((prev) =>
      prev
        ? prev.map((item) =>
            item.valid && !item.isDuplicate ? { ...item, selected: checked } : { ...item, selected: false }
          )
        : null
    );
  }

  function handleRemovePreviewItem(id: string) {
    setPreviewItems((prev) => {
      if (!prev) return null;
      const filtered = prev.filter((item) => item.id !== id);
      const revalidated = revalidateParsedWordQuestions(filtered, existingPromptsLower);
      const selectionMap = new Map(filtered.map((item) => [item.id, item.selected]));
      return revalidated.map((item) => ({
        ...item,
        selected: item.valid && !item.isDuplicate && Boolean(selectionMap.get(item.id)),
      }));
    });
    if (editingId === id) {
      setEditingId(null);
      setEditDraft(null);
    }
  }

  function handleStartEdit(item: WordPreviewItem) {
    setEditingId(item.id);
    setEditDraft({
      ...item,
      options: { ...item.options },
    });
  }

  function handleSaveInlineEdit() {
    if (!editDraft || !previewItems) return;
    const replaced = previewItems.map((item) => (item.id === editDraft.id ? editDraft : item));
    const revalidated = revalidateParsedWordQuestions(replaced, existingPromptsLower);
    const prevSelected = new Map(replaced.map((i) => [i.id, i.selected]));

    const nextItems: WordPreviewItem[] = revalidated.map((item) => {
      const wasEdited = item.id === editDraft.id;
      return {
        ...item,
        selected:
          item.valid && !item.isDuplicate
            ? wasEdited
              ? true
              : Boolean(prevSelected.get(item.id))
            : false,
      };
    });

    setPreviewItems(nextItems);
    setEditingId(null);
    setEditDraft(null);
  }

  function handleResetSession() {
    setPreviewItems(null);
    setFileMeta(null);
    setRawText('');
    setShowRawText(false);
    setEditingId(null);
    setEditDraft(null);
    setActiveFilter('all');
  }

  function formatSizeKb(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  const formatLabel =
    fileMeta?.detectedFormat === 'template_soal'
      ? 'Format Template SOAL'
      : fileMeta?.detectedFormat === 'numbered_list'
      ? 'Format Daftar Bernomor Otomatis'
      : 'Format Tidak Dikenali';

  return (
    <div className="space-y-6">
      {/* ==================== CARD 1: UPLOAD & EXTRACTION CONTROLS ==================== */}
      <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#FACC15]" />
              <h2 className="font-display font-bold text-xl text-white">
                Impor & Ekstrak Soal Word (.docx) ke Firebase
              </h2>
            </div>
            <p className="text-sm text-blue-200/80">
              Unggah file Microsoft Word (.docx). Mesin pengolah teks akan mengekstrak pertanyaan, opsi A–D, kunci jawaban, dan pembahasan secara otomatis ke Bank Soal Firebase Anda.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowFormatGuide((v) => !v)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#081226] hover:bg-blue-950 border border-blue-400/30 text-xs font-semibold text-blue-100 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#FACC15]" />
              <span>{showFormatGuide ? 'Sembunyikan Panduan' : 'Format yang Didukung'}</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={templateBusy}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 disabled:opacity-60 font-semibold text-sm text-white whitespace-nowrap cursor-pointer"
            >
              {templateBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span>{templateBusy ? 'Membuat Template...' : 'Download Template .docx'}</span>
            </button>
          </div>
        </div>

        {/* Collapsible Format Guide */}
        {showFormatGuide && (
          <div className="grid md:grid-cols-2 gap-4 pt-1">
            <div className="p-4 rounded-xl bg-[#081226] border border-blue-400/20 space-y-2">
              <div className="text-xs font-bold text-[#FACC15] uppercase tracking-wide">
                Opsi 1 · Template Resmi (SOAL 1, SOAL 2, dst.)
              </div>
              <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
{`SOAL 1
Pertanyaan: Berapakah hasil 5 x 6?
A. 20
B. 25
C. 30
D. 35
Kunci Jawaban: C
Pembahasan: 5 dikalikan 6 sama dengan 30.`}
              </pre>
            </div>

            <div className="p-4 rounded-xl bg-[#081226] border border-emerald-400/20 space-y-2">
              <div className="text-xs font-bold text-emerald-300 uppercase tracking-wide">
                Opsi 2 · Naskah Ujian Bernomor + Kunci di Akhir / Tebal
              </div>
              <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
{`1. Ibu kota negara Indonesia adalah ....
A. Bandung   B. Jakarta   C. Surabaya   D. Semarang
2. Planet terdekat dengan Matahari adalah ....
A. Venus
B. Mars
*C. Merkurius
D. Bumi

KUNCI JAWABAN
1. B
2. C`}
              </pre>
            </div>
          </div>
        )}

        {/* Target Subject, Grade & Auto-Save Toggle */}
        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-blue-200 mb-1.5">
              Mata Pelajaran Default
            </label>
            <input
              type="text"
              maxLength={WORD_FIELD_LIMITS.subject}
              value={wordSubject}
              onChange={(e) => setWordSubject(e.target.value)}
              placeholder="Contoh: Matematika"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-blue-200 mb-1.5">
              Kelas Default
            </label>
            <input
              type="text"
              maxLength={WORD_FIELD_LIMITS.grade}
              value={wordGrade}
              onChange={(e) => setWordGrade(e.target.value)}
              placeholder="Contoh: VIII-A"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#081226] border border-blue-400/30 text-white text-sm"
            />
          </div>

          <label className="flex items-start gap-3 p-3 rounded-xl bg-[#081226] border border-blue-400/25 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSaveToFirebase}
              onChange={(e) => setAutoSaveToFirebase(e.target.checked)}
              className="mt-0.5 accent-[#FF6B1A] w-4 h-4 shrink-0"
            />
            <span className="text-xs leading-snug">
              <strong className="block text-white">Simpan Otomatis ke Firebase</strong>
              <span className="text-blue-200/75">
                Langsung simpan soal valid begitu file .docx selesai diekstrak
              </span>
            </span>
          </label>
        </div>

        {/* Drag-and-Drop .docx Upload Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!extractBusy && !saveBusy) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => {
            if (!extractBusy && !saveBusy) fileInputRef.current?.click();
          }}
          className={`relative rounded-2xl border-2 border-dashed p-7 text-center transition-colors cursor-pointer ${
            isDragging
              ? 'border-[#FF6B1A] bg-[#FF6B1A]/15'
              : 'border-blue-400/35 bg-[#081226]/80 hover:border-[#FF6B1A]/70 hover:bg-[#081226]'
          } ${extractBusy || saveBusy ? 'opacity-70 pointer-events-none' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileInputChange}
            className="hidden"
            disabled={extractBusy || saveBusy}
          />

          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#FF6B1A]/20 border border-[#FF6B1A]/40 flex items-center justify-center text-[#FF6B1A]">
              {extractBusy || saveBusy ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <Upload className="w-6 h-6" />
              )}
            </div>

            <div className="space-y-1">
              <p className="font-display font-bold text-base text-white">
                {extractBusy
                  ? 'Mengekstrak teks pertanyaan & kunci jawaban...'
                  : saveBusy
                  ? 'Menyimpan soal ke Bank Soal Firebase...'
                  : 'Seret & lepas file .docx di sini, atau klik untuk memilih file'}
              </p>
              <p className="text-xs text-blue-200/75">
                Mendukung format Template SOAL, daftar bernomor (1. 2. 3.), opsi sejajar/bertumpuk, kunci jawaban inline maupun daftar di akhir dokumen · Maks 10 MB
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-slate-300 pt-1">
              <span>
                Kuota Bank Soal Firebase:{' '}
                <strong className={remainingCapacity < 20 ? 'text-amber-300' : 'text-emerald-300'}>
                  {existingQuestions.length} / {MAX_FIREBASE_BANK_QUESTIONS}
                </strong>{' '}
                (sisa {remainingCapacity})
              </span>
              {fileMeta && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-blue-200">
                    File terakhir: <strong>{fileMeta.fileName}</strong> ({formatSizeKb(fileMeta.fileSizeBytes)})
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ==================== CARD 2: EXTRACTION RESULTS & INLINE EDITOR ==================== */}
      {previewItems && (
        <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-5">
          {/* Header & Primary Save CTA */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-display font-bold text-lg text-white">
                Hasil Ekstraksi Soal ({stats.total} Terdeteksi)
              </h3>
              <p className="text-xs text-blue-200/80">
                {fileMeta && (
                  <>
                    <span>{formatLabel}</span>
                    {fileMeta.answerKeySectionCount > 0 && (
                      <span> · {fileMeta.answerKeySectionCount} kunci terbaca dari bagian Kunci Jawaban</span>
                    )}
                    <span> · </span>
                  </>
                )}
                Periksa hasil ekstraksi, gunakan <strong>Edit Cepat</strong> bila kunci jawaban perlu dilengkapi, lalu simpan ke Firebase.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleResetSession}
                disabled={saveBusy}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#081226] hover:bg-blue-950 border border-blue-400/25 text-xs font-semibold text-blue-200 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const approved = previewItems.filter((i) => i.selected && i.valid && !i.isDuplicate);
                  void persistItemsToFirebase(approved, true);
                }}
                disabled={saveBusy || stats.selected === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold text-sm text-white cursor-pointer"
              >
                {saveBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CloudUpload className="w-4 h-4" />
                )}
                <span>
                  {saveBusy
                    ? 'Menyimpan ke Firebase...'
                    : `Simpan ke Bank Soal Firebase (${stats.selected})`}
                </span>
              </button>
            </div>
          </div>

          {/* Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-[#081226] border border-blue-400/20">
              <div className="text-xs text-blue-200/75">Total Terdeteksi</div>
              <div className="font-display font-bold text-xl text-white">{stats.total}</div>
            </div>
            <div className="p-3 rounded-xl bg-[#081226] border border-emerald-400/25">
              <div className="text-xs text-emerald-300/80">Valid Siap Simpan</div>
              <div className="font-display font-bold text-xl text-emerald-300">{stats.ready}</div>
            </div>
            <div className="p-3 rounded-xl bg-[#081226] border border-amber-400/25">
              <div className="text-xs text-amber-300/80">Perlu Perbaikan</div>
              <div className="font-display font-bold text-xl text-amber-300">{stats.needsFix}</div>
            </div>
            <div className="p-3 rounded-xl bg-[#081226] border border-rose-400/25">
              <div className="text-xs text-rose-300/80">Duplikat</div>
              <div className="font-display font-bold text-xl text-rose-300">{stats.duplicate}</div>
            </div>
          </div>

          {/* Filter & Bulk Selection Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-blue-200/70 mr-1" />
              {(
                [
                  { id: 'all', label: `Semua (${stats.total})` },
                  { id: 'ready', label: `Siap Simpan (${stats.ready})` },
                  { id: 'warning', label: `Perlu Perbaikan (${stats.needsFix})` },
                  { id: 'duplicate', label: `Duplikat (${stats.duplicate})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    activeFilter === tab.id
                      ? 'bg-[#1D4ED8] text-white'
                      : 'bg-[#081226] text-blue-200/80 hover:bg-blue-950'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleSelectAllValid(true)}
                className="px-3 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-blue-400/20 text-blue-200 cursor-pointer"
              >
                Pilih Semua Valid
              </button>
              <button
                type="button"
                onClick={() => handleSelectAllValid(false)}
                className="px-3 py-1.5 rounded-lg bg-[#081226] hover:bg-blue-950 border border-blue-400/20 text-blue-200 cursor-pointer"
              >
                Batal Pilih
              </button>
            </div>
          </div>

          {/* Question Cards List */}
          {filteredItems.length === 0 ? (
            <div className="p-6 rounded-xl bg-[#081226] border border-blue-400/15 text-center text-sm text-blue-200/75">
              Tidak ada soal pada kategori filter ini.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const isEditing = editingId === item.id && editDraft !== null;
                const typeLabel =
                  item.questionType === 'multiple_choice'
                    ? 'Pilihan Ganda'
                    : item.questionType === 'true_false'
                    ? 'Benar / Salah'
                    : 'Isian Singkat';

                return (
                  <div
                    key={item.id}
                    className={`p-4 rounded-xl border transition-colors ${
                      item.isDuplicate
                        ? 'bg-rose-950/25 border-rose-400/35'
                        : !item.valid
                        ? 'bg-amber-950/25 border-amber-400/40'
                        : 'bg-[#081226] border-emerald-400/30'
                    }`}
                  >
                    {isEditing && editDraft ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-bold text-[#FACC15]">
                            EDIT CEPAT · SOAL {editDraft.number}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft(null);
                            }}
                            className="p-1 rounded-lg hover:bg-white/10 text-slate-300 cursor-pointer"
                            title="Batal Edit"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-2">
                          <select
                            value={editDraft.questionType}
                            onChange={(e) => {
                              const nextType = e.target.value as QuestionType;
                              setEditDraft((prev) => {
                                if (!prev) return null;
                                if (nextType === 'short_answer') {
                                  return { ...prev, questionType: nextType, options: {} };
                                }
                                if (nextType === 'true_false') {
                                  return {
                                    ...prev,
                                    questionType: nextType,
                                    options: {
                                      A: prev.options.A || 'Benar',
                                      B: prev.options.B || 'Salah',
                                    },
                                  };
                                }
                                return { ...prev, questionType: nextType };
                              });
                            }}
                            className="px-3 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-xs text-white"
                          >
                            <option value="multiple_choice">Pilihan Ganda (A–D)</option>
                            <option value="true_false">Benar / Salah (A–B)</option>
                            <option value="short_answer">Isian Singkat</option>
                          </select>

                          <input
                            type="text"
                            maxLength={WORD_FIELD_LIMITS.correctAnswer}
                            value={editDraft.correctAnswer}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, correctAnswer: e.target.value })
                            }
                            placeholder={
                              editDraft.questionType === 'short_answer'
                                ? 'Kunci Jawaban (teks)'
                                : 'Kunci Jawaban (A / B / C / D)'
                            }
                            className="sm:col-span-2 px-3 py-2 rounded-xl bg-[#0F2957] border border-emerald-400/40 text-xs text-white"
                          />
                        </div>

                        <textarea
                          rows={2}
                          maxLength={WORD_FIELD_LIMITS.prompt}
                          value={editDraft.prompt}
                          onChange={(e) => setEditDraft({ ...editDraft, prompt: e.target.value })}
                          placeholder="Teks pertanyaan..."
                          className="w-full px-3 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-sm text-white"
                        />

                        {editDraft.questionType !== 'short_answer' && (
                          <div className="grid sm:grid-cols-2 gap-2">
                            {(editDraft.questionType === 'true_false'
                              ? (['A', 'B'] as const)
                              : (['A', 'B', 'C', 'D'] as const)
                            ).map((k) => (
                              <input
                                key={k}
                                type="text"
                                maxLength={WORD_FIELD_LIMITS.option}
                                value={editDraft.options[k] || ''}
                                onChange={(e) =>
                                  setEditDraft({
                                    ...editDraft,
                                    options: { ...editDraft.options, [k]: e.target.value },
                                  })
                                }
                                placeholder={`Opsi ${k}`}
                                className="px-3 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-xs text-white"
                              />
                            ))}
                          </div>
                        )}

                        <input
                          type="text"
                          maxLength={WORD_FIELD_LIMITS.explanation}
                          value={editDraft.explanation}
                          onChange={(e) =>
                            setEditDraft({ ...editDraft, explanation: e.target.value })
                          }
                          placeholder="Pembahasan (opsional)"
                          className="w-full px-3 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-xs text-white"
                        />

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditDraft(null);
                            }}
                            className="px-3.5 py-1.5 rounded-lg bg-white/10 text-xs text-slate-200 cursor-pointer"
                          >
                            Batal
                          </button>
                          <button
                            type="button"
                            onClick={handleSaveInlineEdit}
                            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#FF6B1A] hover:bg-[#e85d10] text-xs font-semibold text-white cursor-pointer"
                          >
                            <Save className="w-3.5 h-3.5" />
                            <span>Terapkan Perubahan</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={item.selected}
                            disabled={!item.valid || item.isDuplicate}
                            onChange={() => handleToggleSelect(item.id)}
                            className="mt-1 accent-[#FF6B1A] w-4 h-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                          />

                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-bold text-[#FACC15]">
                                SOAL {item.number}
                              </span>
                              <span className="text-blue-200/80">{typeLabel}</span>
                              {item.subjectOverride && (
                                <span className="text-sky-300">· {item.subjectOverride}</span>
                              )}
                              {item.gradeOverride && (
                                <span className="text-sky-300">· Kelas {item.gradeOverride}</span>
                              )}
                              {item.valid && !item.isDuplicate ? (
                                <span className="inline-flex items-center gap-1 text-emerald-300 font-semibold">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Siap Simpan
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                                  <AlertTriangle className="w-3.5 h-3.5" />
                                  {item.isDuplicate ? 'Duplikat' : 'Perlu Perbaikan'}
                                </span>
                              )}
                            </div>

                            <p className="font-medium text-white text-sm leading-relaxed break-words">
                              {item.prompt || '(Pertanyaan kosong)'}
                            </p>

                            {item.questionType !== 'short_answer' && (
                              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-slate-300 pt-0.5">
                                {(['A', 'B', 'C', 'D'] as const)
                                  .filter((k) => Boolean(item.options[k]))
                                  .map((k) => (
                                    <div
                                      key={k}
                                      className={
                                        item.correctAnswer === k
                                          ? 'text-emerald-300 font-semibold'
                                          : ''
                                      }
                                    >
                                      {k}. {item.options[k]}
                                    </div>
                                  ))}
                              </div>
                            )}

                            <div className="text-xs text-slate-300 pt-0.5">
                              Kunci Jawaban:{' '}
                              <strong
                                className={
                                  item.correctAnswer ? 'text-emerald-300' : 'text-amber-300'
                                }
                              >
                                {item.correctAnswer || 'Belum terdeteksi'}
                              </strong>
                              {item.explanation && (
                                <span className="text-slate-400">
                                  {' '}
                                  · Pembahasan: {item.explanation}
                                </span>
                              )}
                            </div>

                            {item.warnings.length > 0 && (
                              <div className="text-xs text-rose-300 font-medium pt-0.5">
                                {item.warnings.join(' ')}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleStartEdit(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0F2957] hover:bg-blue-800 border border-blue-400/25 text-xs text-blue-100 cursor-pointer"
                            title="Edit cepat soal sebelum disimpan"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Edit Cepat</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovePreviewItem(item.id)}
                            className="p-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-700 text-rose-200 cursor-pointer"
                            title="Hapus dari daftar impor"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* ==================== DIAGNOSTIC RAW TEXT VIEWER ==================== */}
      {rawText && (
        <div className="rounded-2xl bg-[#0F2957] border border-blue-400/20 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowRawText((v) => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-white/5 cursor-pointer"
          >
            <span className="text-xs font-semibold text-blue-200">
              Lihat Teks Mentah Hasil Ekstraksi .docx ({rawText.length.toLocaleString('id-ID')} karakter)
            </span>
            {showRawText ? (
              <ChevronUp className="w-4 h-4 text-blue-200" />
            ) : (
              <ChevronDown className="w-4 h-4 text-blue-200" />
            )}
          </button>
          {showRawText && (
            <div className="px-5 pb-5">
              <pre className="p-4 rounded-xl bg-[#081226] border border-white/10 font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-72 overflow-y-auto">
                {rawText.length > 8000
                  ? `${rawText.slice(0, 8000)}\n\n... (dipotong untuk pratinjau)`
                  : rawText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
