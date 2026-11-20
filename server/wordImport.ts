import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import mammoth from 'mammoth';

export interface ParsedWordQuestion {
  number: number;
  prompt: string;
  questionType: 'multiple_choice' | 'true_false' | 'short_answer';
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
  valid: boolean;
  warnings: string[];
  isDuplicate: boolean;
}

export async function generateWordTemplateBuffer(): Promise<Buffer> {
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
      explanation: 'NKRI adalah singkatan resmi Negara Kesatuan Republik Indonesia (contoh isian singkat).',
    },
  ];

  const children: Paragraph[] = [
    new Paragraph({
      text: 'TEMPLATE IMPOR SOAL — EDU RUN ARENA 3D',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'Petunjuk: Gunakan format SOAL 1, SOAL 2, dst. Sertakan "Pertanyaan:", opsi A-D (atau A-B untuk Benar/Salah, atau tanpa opsi untuk Isian Singkat), "Kunci Jawaban:", dan "Pembahasan:".',
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
      })
    );
    children.push(
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
      })
    );
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Pembahasan: ${b.explanation}`, size: 22 })],
        spacing: { after: 200 },
      })
    );
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

export async function parseWordDocument(
  fileBuffer: Buffer,
  existingPromptsLower: Set<string>
): Promise<ParsedWordQuestion[]> {
  const { value: rawText } = await mammoth.extractRawText({ buffer: fileBuffer });
  const normalizedText = rawText.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ');

  // Split by SOAL <number> headers
  const blockRegex = /(?:^|\n)\s*SOAL\s+(\d+)\s*[:.]?\s*\n([\s\S]*?)(?=(?:\n\s*SOAL\s+\d+\s*[:.]?\s*(?:\n|$))|$)/gi;
  const results: ParsedWordQuestion[] = [];
  const seenInUpload = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(normalizedText)) !== null) {
    const num = Number.parseInt(match[1], 10);
    const body = match[2].trim();
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let prompt = '';
    const options: { A?: string; B?: string; C?: string; D?: string } = {};
    let correctAnswer = '';
    let explanation = '';
    let mode: 'prompt' | 'options' | 'answer' | 'explanation' = 'prompt';

    for (const line of lines) {
      const promptMatch = line.match(/^Pertanyaan\s*:\s*(.*)$/i);
      const optMatch = line.match(/^([A-D])\s*[.)]\s*(.+)$/i);
      const ansMatch = line.match(/^Kunci(?:\s+Jawaban)?\s*:\s*(.+)$/i);
      const expMatch = line.match(/^Pembahasan\s*:\s*(.*)$/i);

      if (promptMatch) {
        mode = 'prompt';
        prompt = promptMatch[1].trim();
      } else if (ansMatch) {
        mode = 'answer';
        correctAnswer = ansMatch[1].trim();
      } else if (expMatch) {
        mode = 'explanation';
        explanation = expMatch[1].trim();
      } else if (optMatch) {
        mode = 'options';
        const key = optMatch[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
        options[key] = optMatch[2].trim();
      } else {
        if (mode === 'prompt') {
          prompt = prompt ? `${prompt} ${line}` : line;
        } else if (mode === 'explanation') {
          explanation = explanation ? `${explanation} ${line}` : line;
        }
      }
    }

    const warnings: string[] = [];
    if (!prompt) {
      warnings.push('Teks pertanyaan kosong atau tidak terdeteksi.');
    }

    const optKeys = Object.keys(options);
    let questionType: 'multiple_choice' | 'true_false' | 'short_answer' = 'multiple_choice';

    if (optKeys.length === 0) {
      questionType = 'short_answer';
    } else if (
      optKeys.length === 2 &&
      options.A &&
      options.B &&
      !options.C &&
      !options.D
    ) {
      questionType = 'true_false';
    } else if (optKeys.length < 4) {
      warnings.push(`Opsi pilihan ganda baru ${optKeys.length} (diharapkan A, B, C, D).`);
    }

    if (!correctAnswer) {
      warnings.push('Kunci Jawaban tidak ditemukan.');
    } else if (questionType === 'multiple_choice' || questionType === 'true_false') {
      const cleanKey = correctAnswer.charAt(0).toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(cleanKey) || !options[cleanKey as 'A' | 'B' | 'C' | 'D']) {
        warnings.push(`Kunci jawaban "${correctAnswer}" tidak cocok dengan opsi yang tersedia.`);
      } else {
        correctAnswer = cleanKey;
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

    const valid =
      prompt.length > 0 &&
      correctAnswer.length > 0 &&
      (questionType === 'short_answer' ||
        (questionType === 'true_false' && Boolean(options.A && options.B)) ||
        (questionType === 'multiple_choice' &&
          Boolean(options.A && options.B && options.C && options.D))) &&
      !warnings.some((w) => w.includes('tidak cocok'));

    results.push({
      number: num,
      prompt,
      questionType,
      options,
      correctAnswer,
      explanation,
      valid,
      warnings,
      isDuplicate,
    });
  }

  return results;
}
