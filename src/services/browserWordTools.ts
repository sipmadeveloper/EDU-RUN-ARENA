import type { QuestionType } from '../types/game';

export const MAX_DOCX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// Synchronized with firebase-blueprint.json & firebaseCloudStore.ts bounds
export const WORD_FIELD_LIMITS = {
  prompt: 400,
  option: 180,
  correctAnswer: 120,
  explanation: 300,
  subject: 60,
  grade: 30,
} as const;

export type DetectedWordFormat = 'template_soal' | 'numbered_list' | 'none';

export interface ParsedWordQuestion {
  id: string;
  number: number;
  prompt: string;
  questionType: QuestionType;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
  subjectOverride?: string;
  gradeOverride?: string;
  valid: boolean;
  warnings: string[];
  isDuplicate: boolean;
}

export interface WordParseResult {
  items: ParsedWordQuestion[];
  rawText: string;
  detectedFormat: DetectedWordFormat;
  fileName: string;
  fileSizeBytes: number;
  answerKeySectionCount: number;
}

function clampField(value: string, maxLen: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

export async function downloadWordTemplateInBrowser(): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

  const sampleBlocks = [
    {
      num: 1,
      prompt: 'Berapakah hasil 5 x 6?',
      options: ['A. 20', 'B. 25', 'C. 30', 'D. 35'],
      answer: 'C',
      explanation: '5 dikalikan 6 sama dengan 30.',
    },
    {
      num: 2,
      prompt: 'Ibu kota negara Indonesia adalah ....',
      options: ['A. Bandung', 'B. Jakarta', 'C. Surabaya', 'D. Semarang'],
      answer: 'B',
      explanation: 'Jakarta merupakan ibu kota Indonesia sesuai soal ini.',
    },
    {
      num: 3,
      prompt: 'Planet terdekat dengan Matahari adalah ....',
      options: ['A. Venus', 'B. Mars', 'C. Merkurius', 'D. Bumi'],
      answer: 'C',
      explanation: 'Merkurius adalah planet pertama yang paling dekat dengan Matahari.',
    },
    {
      num: 4,
      prompt: 'Benar atau Salah: Air mendidih pada suhu 100 derajat Celcius pada tekanan 1 atm.',
      options: ['A. Benar', 'B. Salah'],
      answer: 'A',
      explanation: 'Titik didih air pada tekanan 1 atmosfer adalah 100 derajat Celcius.',
    },
    {
      num: 5,
      prompt: 'Singkatan dari Negara Kesatuan Republik Indonesia adalah ....',
      options: [],
      answer: 'NKRI',
      explanation:
        'NKRI adalah singkatan resmi Negara Kesatuan Republik Indonesia (contoh isian singkat).',
    },
  ];

  const children = [
    new Paragraph({
      text: 'TEMPLATE IMPOR SOAL — EDU RUN ARENA 3D',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'Petunjuk: Gunakan format SOAL 1, SOAL 2, dst. Sertakan "Pertanyaan:", opsi A-D (atau A-B untuk Benar/Salah, atau tanpa opsi untuk Isian Singkat), "Kunci Jawaban:", dan "Pembahasan:". Anda juga dapat menggunakan format daftar bernomor (1. ..., A. ..., B. ..., C. ..., D. ...) dengan bagian "KUNCI JAWABAN" di bagian akhir dokumen.',
          italics: true,
          size: 20,
        }),
      ],
      spacing: { after: 280 },
    }),
  ];

  for (const b of sampleBlocks) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `SOAL ${b.num}`, bold: true, size: 24 })],
        spacing: { before: 160, after: 80 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `Pertanyaan: ${b.prompt}`, size: 22 })],
        spacing: { after: 80 },
      })
    );
    for (const opt of b.options) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: opt, size: 22 })],
          spacing: { after: 40 },
        })
      );
    }
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Kunci Jawaban: ${b.answer}`, bold: true, size: 22 })],
        spacing: { before: 60, after: 40 },
      }),
      new Paragraph({
        children: [new TextRun({ text: `Pembahasan: ${b.explanation}`, size: 22 })],
        spacing: { after: 200 },
      })
    );
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Template-Soal-EduRunArena3D.docx';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Splits a single line containing multiple inline options such as:
 * "A. 20   B. 25   C. 30   D. 35" or "a) Bandung  b) Jakarta"
 * into individual option entries.
 */
function extractOptionsFromLine(
  line: string
): Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string; starred: boolean }> {
  const results: Array<{ key: 'A' | 'B' | 'C' | 'D'; text: string; starred: boolean }> = [];

  // Check if line starts with an option marker (optionally preceded by *)
  const startPattern = /^\*?\s*([A-D])\s*[.)]\s+/i;
  if (!startPattern.test(line)) {
    return results;
  }

  // Split when another option letter appears after at least 2 spaces/tab OR after a space before B./C./D.
  const tokenRegex = /(?:^|\s{2,}|\t|(?<=\s)(?=\*?[B-D]\s*[.)]\s+))(\*?)\s*([A-D])\s*[.)]\s+/gi;
  const matches: Array<{ index: number; end: number; key: 'A' | 'B' | 'C' | 'D'; starred: boolean }> =
    [];

  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(line)) !== null) {
    const key = m[2].toUpperCase() as 'A' | 'B' | 'C' | 'D';
    // Prevent splitting on single-letter words inside an option unless it follows order (e.g. A -> B -> C -> D)
    const prev = matches[matches.length - 1];
    if (prev && key.charCodeAt(0) <= prev.key.charCodeAt(0)) {
      continue;
    }
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      key,
      starred: m[1] === '*',
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const curr = matches[i];
    const nextStart = i + 1 < matches.length ? matches[i + 1].index : line.length;
    let text = line.slice(curr.end, nextStart).trim();
    let starred = curr.starred;

    // Detect trailing asterisk or "(benar)" marker e.g. "30 *" or "30 (benar)"
    if (/\s*\*+$/.test(text)) {
      starred = true;
      text = text.replace(/\s*\*+$/, '').trim();
    } else if (/\s*\((?:benar|kunci|jawaban)\)\s*$/i.test(text)) {
      starred = true;
      text = text.replace(/\s*\((?:benar|kunci|jawaban)\)\s*$/i, '').trim();
    }

    if (text) {
      results.push({ key: curr.key, text, starred });
    }
  }

  return results;
}

/**
 * Separates an optional trailing "KUNCI JAWABAN" section at the bottom of a .docx file
 * and extracts a map of questionNumber -> answer string.
 */
function extractTrailingAnswerKeySection(text: string): {
  bodyText: string;
  answerMap: Map<number, string>;
} {
  const answerMap = new Map<number, string>();
  const lines = text.split('\n');

  let headingIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (
      /^(?:KUNCI\s+JAWABAN|KUNCI\s+SOAL|KUNCI|ANSWER\s+KEY|JAWABAN\s+BENAR)\s*[:.]?\s*$/i.test(
        trimmed
      )
    ) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    return { bodyText: text, answerMap };
  }

  const keyLines = lines.slice(headingIdx + 1);
  for (const rawLine of keyLines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Multi-entry line: "1. C   2. B   3. A   4. D" or "1) C  2) A"
    const multiRegex = /(?:(?:No\.?|Soal)\s*)?(\d{1,3})\s*[.):\-=]\s*([A-D])(?=\s|$|,|;)/gi;
    const multiHits: Array<{ num: number; ans: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = multiRegex.exec(line)) !== null) {
      multiHits.push({
        num: Number.parseInt(m[1], 10),
        ans: m[2].toUpperCase(),
      });
    }

    if (multiHits.length >= 2) {
      for (const hit of multiHits) {
        if (!answerMap.has(hit.num)) answerMap.set(hit.num, hit.ans);
      }
      continue;
    }

    // Single-entry line (supports both letter A-D and short answer text e.g. "5. NKRI")
    const singleMatch = line.match(/^(?:(?:No\.?|Soal)\s*)?(\d{1,3})\s*[.):\-=]\s*(.+)$/i);
    if (singleMatch) {
      const num = Number.parseInt(singleMatch[1], 10);
      let ans = singleMatch[2].trim();
      // Strip optional explanation after " - " or " (" if the answer starts with a single letter A-D
      const letterLead = ans.match(/^([A-D])(?:\s*[.)\-–:]|\s+\(|\s*$)/i);
      if (letterLead) {
        ans = letterLead[1].toUpperCase();
      }
      if (ans && !answerMap.has(num)) {
        answerMap.set(num, ans);
      }
    }
  }

  if (answerMap.size === 0) {
    // Heading didn't actually contain parseable keys; keep full document intact
    return { bodyText: text, answerMap };
  }

  return {
    bodyText: lines.slice(0, headingIdx).join('\n'),
    answerMap,
  };
}

/**
 * Best-effort extraction of bold-highlighted option answers from HTML output of mammoth.
 * Only records a hint when a paragraph containing an option letter A-D has its text wrapped
 * inside <strong>/<b> so teachers who bold the correct choice in Word can get auto-detection.
 */
function extractBoldOptionHintsFromHtml(html: string): Map<number, 'A' | 'B' | 'C' | 'D'> {
  const hints = new Map<number, 'A' | 'B' | 'C' | 'D'>();
  if (!html) return hints;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blocks = Array.from(doc.querySelectorAll('p, li'));

    let currentNum: number | null = null;
    const boldByQuestion = new Map<number, Set<'A' | 'B' | 'C' | 'D'>>();

    for (const el of blocks) {
      const text = (el.textContent || '').replace(/\u00A0/g, ' ').trim();
      if (!text) continue;

      const soalHeader = text.match(/^SOAL\s*(?:No\.?\s*)?#?(\d{1,3})\b/i);
      if (soalHeader) {
        currentNum = Number.parseInt(soalHeader[1], 10);
        continue;
      }

      const numberedStart = text.match(/^(?:No\.?\s*)?(\d{1,3})\s*[.)]\s+\S/);
      if (numberedStart) {
        currentNum = Number.parseInt(numberedStart[1], 10);
        continue;
      }

      const optMatch = text.match(/^([A-D])\s*[.)]\s+(.+)$/i);
      if (optMatch && currentNum !== null) {
        const key = optMatch[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
        const optionBody = optMatch[2].trim();
        const strongTexts = Array.from(el.querySelectorAll('strong, b'))
          .map((s) => (s.textContent || '').trim())
          .join(' ')
          .trim();

        // Treat as bold answer hint only if the option body itself (not just "A.") is bolded
        if (strongTexts.length >= Math.max(2, Math.floor(optionBody.length * 0.75))) {
          const set = boldByQuestion.get(currentNum) || new Set<'A' | 'B' | 'C' | 'D'>();
          set.add(key);
          boldByQuestion.set(currentNum, set);
        }
      }
    }

    // Only accept unambiguous hints (exactly ONE option bolded for that question)
    for (const [qNum, keys] of boldByQuestion.entries()) {
      if (keys.size === 1) {
        const [onlyKey] = Array.from(keys);
        hints.set(qNum, onlyKey);
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return hints;
}

interface RawExtractedQuestion {
  number: number;
  prompt: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
  subjectOverride?: string;
  gradeOverride?: string;
}

function parseSingleQuestionLines(
  num: number,
  lines: string[],
  trailingAnswerMap: Map<number, string>,
  boldOptionHints: Map<number, 'A' | 'B' | 'C' | 'D'>
): RawExtractedQuestion {
  let prompt = '';
  const options: { A?: string; B?: string; C?: string; D?: string } = {};
  let correctAnswer = '';
  let starredAnswer = '';
  let explanation = '';
  let subjectOverride: string | undefined;
  let gradeOverride: string | undefined;

  let mode: 'prompt' | 'options' | 'answer' | 'explanation' = 'prompt';
  let lastOptionKey: 'A' | 'B' | 'C' | 'D' | null = null;

  for (const line of lines) {
    const subjectMatch = line.match(/^(?:Mata\s+Pelajaran|Mapel)\s*:\s*(.+)$/i);
    const gradeMatch = line.match(/^Kelas\s*:\s*(.+)$/i);
    const promptMatch = line.match(/^Pertanyaan\s*:\s*(.*)$/i);
    const ansMatch = line.match(
      /^(?:Kunci(?:\s+Jawaban)?|Jawaban(?:\s+Benar)?|KJ|Answer(?:\s+Key)?)\s*[:=-]\s*(.+)$/i
    );
    const expMatch = line.match(/^(?:Pembahasan|Penjelasan|Alasan)\s*[:=-]\s*(.*)$/i);

    if (subjectMatch) {
      subjectOverride = clampField(subjectMatch[1], WORD_FIELD_LIMITS.subject);
      continue;
    }
    if (gradeMatch) {
      gradeOverride = clampField(gradeMatch[1], WORD_FIELD_LIMITS.grade);
      continue;
    }
    if (promptMatch) {
      mode = 'prompt';
      prompt = promptMatch[1].trim();
      continue;
    }
    if (ansMatch) {
      mode = 'answer';
      correctAnswer = ansMatch[1].trim();
      continue;
    }
    if (expMatch) {
      mode = 'explanation';
      explanation = expMatch[1].trim();
      continue;
    }

    const lineOptions = extractOptionsFromLine(line);
    if (lineOptions.length > 0) {
      mode = 'options';
      for (const opt of lineOptions) {
        options[opt.key] = opt.text;
        lastOptionKey = opt.key;
        if (opt.starred && !starredAnswer) {
          starredAnswer = opt.key;
        }
      }
      continue;
    }

    // Continuation lines
    if (mode === 'prompt') {
      prompt = prompt ? `${prompt} ${line}` : line;
    } else if (mode === 'explanation') {
      explanation = explanation ? `${explanation} ${line}` : line;
    } else if (mode === 'options' && lastOptionKey) {
      options[lastOptionKey] = `${options[lastOptionKey]} ${line}`.trim();
    }
  }

  // Fallback priority for answer key:
  // 1) Explicit inline Kunci Jawaban / Jawaban / KJ
  // 2) Starred option (*C. ... or C. ... *)
  // 3) Trailing "KUNCI JAWABAN" section matched by question number
  // 4) Unambiguous single bold option from Word formatting
  if (!correctAnswer && starredAnswer) {
    correctAnswer = starredAnswer;
  }
  if (!correctAnswer && trailingAnswerMap.has(num)) {
    correctAnswer = trailingAnswerMap.get(num) || '';
  }
  if (!correctAnswer && boldOptionHints.has(num)) {
    correctAnswer = boldOptionHints.get(num) || '';
  }

  return {
    number: num,
    prompt,
    options,
    correctAnswer,
    explanation,
    subjectOverride,
    gradeOverride,
  };
}

function parseTemplateSoalBlocks(
  bodyText: string,
  trailingAnswerMap: Map<number, string>,
  boldOptionHints: Map<number, 'A' | 'B' | 'C' | 'D'>
): RawExtractedQuestion[] {
  const blockRegex =
    /(?:^|\n)\s*SOAL\s*(?:No\.?\s*)?#?(\d{1,3})\s*[:.)-]?\s*\n([\s\S]*?)(?=(?:\n\s*SOAL\s*(?:No\.?\s*)?#?\d{1,3}\s*[:.)-]?\s*(?:\n|$))|$)/gi;

  const extracted: RawExtractedQuestion[] = [];
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(bodyText)) !== null) {
    const num = Number.parseInt(match[1], 10);
    const body = match[2].trim();
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    extracted.push(parseSingleQuestionLines(num, lines, trailingAnswerMap, boldOptionHints));
  }

  return extracted;
}

function parseNumberedListBlocks(
  bodyText: string,
  trailingAnswerMap: Map<number, string>,
  boldOptionHints: Map<number, 'A' | 'B' | 'C' | 'D'>
): RawExtractedQuestion[] {
  const lines = bodyText.split('\n');
  const blocks: Array<{ num: number; lines: string[] }> = [];

  let currentBlock: { num: number; lines: string[] } | null = null;
  let lastNum = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Match "1. Berapakah...", "1) Ibu kota...", "No. 1 ..."
    const startMatch = trimmed.match(/^(?:No\.?\s*)?(\d{1,3})\s*[.)]\s+(.+)$/i);
    if (startMatch) {
      const candidateNum = Number.parseInt(startMatch[1], 10);
      const restText = startMatch[2].trim();

      // Guard against false-positive numbered headers (e.g. years like "1945.")
      const isPlausibleNext =
        (blocks.length === 0 && candidateNum >= 1 && candidateNum <= 20) ||
        (candidateNum > lastNum && candidateNum <= lastNum + 10);

      if (isPlausibleNext) {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        currentBlock = { num: candidateNum, lines: [restText] };
        lastNum = candidateNum;
        continue;
      }
    }

    if (currentBlock) {
      currentBlock.lines.push(trimmed);
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  // Filter out non-question numbered lists (e.g. exam instructions "1. Berdoalah sebelum...")
  // Keep blocks that have options OR an explicit/mapped answer key OR look like questions
  const extracted: RawExtractedQuestion[] = [];
  for (const block of blocks) {
    const parsed = parseSingleQuestionLines(
      block.num,
      block.lines,
      trailingAnswerMap,
      boldOptionHints
    );
    const hasOptions = Object.keys(parsed.options).length > 0;
    const hasAnswer = Boolean(parsed.correctAnswer);
    const looksLikeQuestion =
      /\?|\.{3,}|_{3,}/.test(parsed.prompt) || parsed.explanation.length > 0;

    if (hasOptions || hasAnswer || looksLikeQuestion) {
      extracted.push(parsed);
    }
  }

  return extracted;
}

/**
 * Revalidates a list of ParsedWordQuestion items (e.g. right after extraction OR after
 * the teacher inline-edits a question in the preview UI). Clamps strings to Firebase limits.
 */
export function revalidateParsedWordQuestions(
  items: Array<
    Omit<ParsedWordQuestion, 'valid' | 'warnings' | 'isDuplicate'> & {
      valid?: boolean;
      warnings?: string[];
      isDuplicate?: boolean;
    }
  >,
  existingPromptsLower: Set<string>
): ParsedWordQuestion[] {
  const seenInUpload = new Set<string>();

  return items.map((item) => {
    const prompt = clampField(item.prompt, WORD_FIELD_LIMITS.prompt);
    const explanation = clampField(item.explanation || '', WORD_FIELD_LIMITS.explanation);
    const options: { A?: string; B?: string; C?: string; D?: string } = {};

    for (const key of ['A', 'B', 'C', 'D'] as const) {
      const val = item.options[key];
      if (val && val.trim()) {
        options[key] = clampField(val, WORD_FIELD_LIMITS.option);
      }
    }

    let correctAnswer = clampField(item.correctAnswer || '', WORD_FIELD_LIMITS.correctAnswer);
    const warnings: string[] = [];

    if (!prompt) {
      warnings.push('Teks pertanyaan kosong atau tidak terdeteksi.');
    }

    const optKeys = (['A', 'B', 'C', 'D'] as const).filter((k) => Boolean(options[k]));
    let questionType: QuestionType = item.questionType;

    // Infer/reconcile questionType cleanly from options when appropriate
    if (optKeys.length === 0) {
      questionType = 'short_answer';
    } else if (optKeys.length === 2 && options.A && options.B && !options.C && !options.D) {
      questionType = 'true_false';
    } else {
      questionType = 'multiple_choice';
      if (optKeys.length < 4) {
        warnings.push(`Opsi pilihan ganda baru ${optKeys.length} (diharapkan A, B, C, D).`);
      }
    }

    let answerMismatch = false;
    if (!correctAnswer) {
      warnings.push('Kunci Jawaban tidak ditemukan (klik "Edit Cepat" untuk melengkapi).');
    } else if (questionType === 'multiple_choice' || questionType === 'true_false') {
      // Allow formats like "C", "C.", "C. 30", or matching option text directly
      const leadLetterMatch = correctAnswer.match(/^([A-D])(?:\s*[.):\-–]|\s+|$)/i);
      const cleanKey = leadLetterMatch ? leadLetterMatch[1].toUpperCase() : '';

      if (cleanKey && options[cleanKey as 'A' | 'B' | 'C' | 'D']) {
        correctAnswer = cleanKey;
      } else {
        // Check if correctAnswer matches one of the option texts verbatim (case-insensitive)
        const lowerAns = correctAnswer.toLowerCase();
        const matchedOptKey = optKeys.find(
          (k) => (options[k] || '').trim().toLowerCase() === lowerAns
        );
        if (matchedOptKey) {
          correctAnswer = matchedOptKey;
        } else {
          answerMismatch = true;
          warnings.push(`Kunci jawaban "${correctAnswer}" tidak cocok dengan opsi yang tersedia.`);
        }
      }
    }

    const normalizedPrompt = prompt.trim().toLowerCase();
    const isDuplicate =
      normalizedPrompt.length > 0 &&
      (existingPromptsLower.has(normalizedPrompt) || seenInUpload.has(normalizedPrompt));

    if (isDuplicate) {
      warnings.push('Soal terdeteksi ganda (sudah ada di Bank Soal atau duplikat di dokumen).');
    }
    if (normalizedPrompt.length > 0) {
      seenInUpload.add(normalizedPrompt);
    }

    const optionsComplete =
      questionType === 'short_answer' ||
      (questionType === 'true_false' && Boolean(options.A && options.B)) ||
      (questionType === 'multiple_choice' &&
        Boolean(options.A && options.B && options.C && options.D));

    const valid = prompt.length > 0 && correctAnswer.length > 0 && optionsComplete && !answerMismatch;

    return {
      id: item.id,
      number: item.number,
      prompt,
      questionType,
      options,
      correctAnswer,
      explanation,
      subjectOverride: item.subjectOverride
        ? clampField(item.subjectOverride, WORD_FIELD_LIMITS.subject)
        : undefined,
      gradeOverride: item.gradeOverride
        ? clampField(item.gradeOverride, WORD_FIELD_LIMITS.grade)
        : undefined,
      valid,
      warnings,
      isDuplicate,
    };
  });
}

export async function parseWordFileInBrowser(
  file: File,
  existingPromptsLower: Set<string>
): Promise<WordParseResult> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.doc') && !lowerName.endsWith('.docx')) {
    throw new Error(
      'Format .doc lama tidak didukung. Buka file di Microsoft Word / Google Docs lalu pilih "Save As / Unduh sebagai .docx".'
    );
  }
  if (!lowerName.endsWith('.docx')) {
    throw new Error('File harus berformat Microsoft Word (.docx).');
  }
  if (file.size === 0) {
    throw new Error('File Word kosong (0 byte).');
  }
  if (file.size > MAX_DOCX_FILE_BYTES) {
    throw new Error('Ukuran file .docx terlalu besar (maksimal 10 MB).');
  }

  const arrayBuffer = await file.arrayBuffer();
  const mammothMod = await import('mammoth');
  const mammothDefault = (
    mammothMod as unknown as {
      default?: {
        extractRawText?: typeof mammothMod.extractRawText;
        convertToHtml?: typeof mammothMod.convertToHtml;
      };
    }
  ).default;

  const extractRawTextFn =
    typeof mammothMod.extractRawText === 'function'
      ? mammothMod.extractRawText
      : mammothDefault?.extractRawText;

  const convertToHtmlFn =
    typeof mammothMod.convertToHtml === 'function'
      ? mammothMod.convertToHtml
      : mammothDefault?.convertToHtml;

  if (typeof extractRawTextFn !== 'function') {
    throw new Error('Pustaka pengolah teks Word (.docx) tidak tersedia di browser ini.');
  }

  let rawText = '';
  try {
    const rawRes = await extractRawTextFn({ arrayBuffer });
    rawText = rawRes.value || '';
  } catch {
    throw new Error(
      'Gagal membaca file .docx. Pastikan file tidak rusak, tidak diproteksi sandi, dan benar-benar berformat .docx.'
    );
  }

  let boldOptionHints = new Map<number, 'A' | 'B' | 'C' | 'D'>();
  if (typeof convertToHtmlFn === 'function') {
    try {
      const htmlRes = await convertToHtmlFn({ arrayBuffer });
      boldOptionHints = extractBoldOptionHintsFromHtml(htmlRes.value || '');
    } catch {
      // Ignore HTML fallback failure; rawText extraction is primary
    }
  }

  const normalizedText = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ');

  const { bodyText, answerMap } = extractTrailingAnswerKeySection(normalizedText);

  let detectedFormat: DetectedWordFormat = 'none';
  let rawItems = parseTemplateSoalBlocks(bodyText, answerMap, boldOptionHints);

  if (rawItems.length > 0) {
    detectedFormat = 'template_soal';
  } else {
    rawItems = parseNumberedListBlocks(bodyText, answerMap, boldOptionHints);
    if (rawItems.length > 0) {
      detectedFormat = 'numbered_list';
    }
  }

  const draftItems = rawItems.map((raw, idx) => {
    const optCount = Object.keys(raw.options).length;
    const questionType: QuestionType =
      optCount === 0
        ? 'short_answer'
        : optCount === 2 && raw.options.A && raw.options.B && !raw.options.C && !raw.options.D
        ? 'true_false'
        : 'multiple_choice';

    return {
      id: `word-${Date.now().toString(36)}-${idx}`,
      number: raw.number,
      prompt: raw.prompt,
      questionType,
      options: raw.options,
      correctAnswer: raw.correctAnswer,
      explanation: raw.explanation,
      subjectOverride: raw.subjectOverride,
      gradeOverride: raw.gradeOverride,
    };
  });

  const validatedItems = revalidateParsedWordQuestions(draftItems, existingPromptsLower);

  return {
    items: validatedItems,
    rawText: normalizedText.trim(),
    detectedFormat,
    fileName: file.name,
    fileSizeBytes: file.size,
    answerKeySectionCount: answerMap.size,
  };
}
