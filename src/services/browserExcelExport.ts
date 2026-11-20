import type ExcelJS from 'exceljs';

export interface ExcelRoomMeta {
  schoolName: string;
  teacherName: string;
  roomName: string;
  subject: string;
  grade: string;
  roomCode: string;
  matchDate: string;
  questionCount: number;
  totalLaps?: number;
  pointsPerQuestion?: number;
  maxScore?: number;
  participantCount: number;
}

export interface ExcelParticipantRow {
  name: string;
  className: string;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  totalPoints: number;
  finalScore: number;
  scoreRank: number;
  finishRank: number | null;
  durationMs: number | null;
}

export interface ExcelAnswerDetailRow {
  questionNumber: number;
  participantName: string;
  className: string;
  prompt: string;
  submittedAnswer: string;
  correctAnswer: string;
  status: 'Benar' | 'Salah' | 'Tidak Dijawab';
  points: number;
  responseTimeSec: number;
}

export interface ExcelQuestionAnalysisRow {
  questionNumber: number;
  prompt: string;
  subject: string;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  correctPct: number;
  difficulty: 'Mudah' | 'Sedang' | 'Sulit';
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '-';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function applyThinBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };
}

function autoFitColumns(sheet: ExcelJS.Worksheet, minWidth = 10, maxWidth = 55) {
  sheet.columns.forEach((col) => {
    let longest = minWidth;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const val = cell.value == null ? '' : String(cell.value);
      const len = val.length + 3;
      if (len > longest) longest = len;
    });
    col.width = Math.min(longest, maxWidth);
  });
}

export async function generateMatchExcelBlob(
  meta: ExcelRoomMeta,
  participants: ExcelParticipantRow[],
  answerDetails: ExcelAnswerDetailRow[],
  questionAnalysis: ExcelQuestionAnalysisRow[]
): Promise<Blob> {
  const excelMod = await import('exceljs');
  const WorkbookCtor =
    excelMod.Workbook ||
    (excelMod as unknown as { default?: { Workbook?: typeof excelMod.Workbook } }).default?.Workbook;

  if (!WorkbookCtor) {
    throw new Error('Library Excel tidak tersedia di browser.');
  }

  const workbook = new WorkbookCtor();
  workbook.creator = 'EDU RUN ARENA 3D';
  workbook.created = new Date();

  // ======================== SHEET 1: REKAP NILAI ========================
  const sheet1 = workbook.addWorksheet('REKAP NILAI', {
    views: [{ state: 'frozen', ySplit: 12 }],
  });

  sheet1.mergeCells('A1:K1');
  const titleCell = sheet1.getCell('A1');
  titleCell.value = 'LAPORAN REKAP NILAI PERTANDINGAN — EDU RUN ARENA 3D';
  titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2957' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet1.getRow(1).height = 30;

  const laps = meta.totalLaps ?? Math.max(1, Math.ceil(Math.max(1, meta.questionCount) / 5));
  const pointsPerQ =
    meta.pointsPerQuestion ?? Number((100 / Math.max(1, meta.questionCount)).toFixed(2));
  const maxScoreVal = meta.maxScore ?? 100;

  const metaRows: Array<[string, string, string, string]> = [
    ['Nama Sekolah', meta.schoolName, 'Kode Room', meta.roomCode],
    ['Nama Guru', meta.teacherName, 'Tanggal Pertandingan', meta.matchDate],
    ['Nama Pertandingan', meta.roomName, 'Jumlah Peserta', `${meta.participantCount} Peserta`],
    ['Mata Pelajaran', meta.subject, 'Soal & Putaran', `${meta.questionCount} Soal · ${laps} Putaran`],
    ['Kelas', meta.grade, 'Skor Maksimal', `${maxScoreVal} Poin (${pointsPerQ} Poin/Soal)`],
  ];

  metaRows.forEach((r, idx) => {
    const rowNum = 3 + idx;
    const row = sheet1.getRow(rowNum);
    row.getCell(1).value = r[0];
    row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
    sheet1.mergeCells(rowNum, 2, rowNum, 5);
    row.getCell(2).value = r[1];
    row.getCell(2).font = { size: 10 };

    row.getCell(7).value = r[2];
    row.getCell(7).font = { bold: true, size: 10, color: { argb: 'FF1E293B' } };
    sheet1.mergeCells(rowNum, 8, rowNum, 11);
    row.getCell(8).value = r[3];
    row.getCell(8).font = { size: 10 };
    row.height = 20;
  });

  const headers1 = [
    'NO',
    'NAMA PESERTA',
    'KELAS',
    'JUMLAH BENAR',
    'JUMLAH SALAH',
    'TIDAK DIJAWAB',
    'TOTAL POIN',
    'NILAI AKHIR',
    'PERINGKAT NILAI',
    'POSISI FINISH',
    'DURASI PERMAINAN',
  ];

  const headerRow1 = sheet1.getRow(10);
  headerRow1.height = 26;
  headers1.forEach((h, i) => {
    const cell = headerRow1.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    applyThinBorder(cell);
  });

  const sortedByScore = [...participants].sort((a, b) => a.scoreRank - b.scoreRank);

  sortedByScore.forEach((p, idx) => {
    const row = sheet1.getRow(11 + idx);
    row.height = 22;
    const values = [
      idx + 1,
      p.name,
      p.className,
      p.correctCount,
      p.wrongCount,
      p.unansweredCount,
      p.totalPoints,
      Number(p.finalScore.toFixed(1)),
      p.scoreRank,
      p.finishRank ?? '-',
      formatDuration(p.durationMs),
    ];

    let rankFill: string | null = null;
    if (p.scoreRank === 1) rankFill = 'FFFEF3C7';
    else if (p.scoreRank === 2) rankFill = 'FFE2E8F0';
    else if (p.scoreRank === 3) rankFill = 'FFFFEDD5';

    values.forEach((val, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = val;
      cell.font = {
        size: 10,
        bold: p.scoreRank <= 3 && (colIdx === 1 || colIdx === 8),
        color: { argb: 'FF0F172A' },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colIdx === 1 ? 'left' : 'center',
      };
      if (rankFill) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rankFill } };
      }
      applyThinBorder(cell);
    });
  });

  const summaryStart = 12 + sortedByScore.length;
  const scores = sortedByScore.map((p) => p.finalScore);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const minScore = scores.length ? Math.min(...scores) : 0;

  const summaries: Array<[string, string | number]> = [
    ['Total Peserta', sortedByScore.length],
    ['Rata-rata Nilai Akhir', Number(avgScore.toFixed(2))],
    ['Nilai Tertinggi', Number(maxScore.toFixed(2))],
    ['Nilai Terendah', Number(minScore.toFixed(2))],
  ];

  summaries.forEach(([label, val], i) => {
    const r = sheet1.getRow(summaryStart + i);
    r.height = 21;
    sheet1.mergeCells(summaryStart + i, 1, summaryStart + i, 2);
    const lc = r.getCell(1);
    lc.value = label;
    lc.font = { bold: true, size: 10, color: { argb: 'FF0F2957' } };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    applyThinBorder(lc);
    applyThinBorder(r.getCell(2));

    const vc = r.getCell(3);
    vc.value = val;
    vc.font = { bold: true, size: 10 };
    vc.alignment = { horizontal: 'center', vertical: 'middle' };
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    applyThinBorder(vc);
  });

  autoFitColumns(sheet1, 12, 42);
  sheet1.getColumn(2).width = Math.max(sheet1.getColumn(2).width || 24, 28);

  // ======================== SHEET 2: DETAIL JAWABAN ========================
  const sheet2 = workbook.addWorksheet('DETAIL JAWABAN', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  sheet2.mergeCells('A1:I1');
  const t2 = sheet2.getCell('A1');
  t2.value = `DETAIL JAWABAN PESERTA — ${meta.roomName} (${meta.roomCode})`;
  t2.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  t2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2957' } };
  t2.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet2.getRow(1).height = 26;

  const headers2 = [
    'NO SOAL',
    'NAMA PESERTA',
    'KELAS',
    'PERTANYAAN',
    'JAWABAN PESERTA',
    'KUNCI JAWABAN',
    'STATUS',
    'POIN',
    'WAKTU JAWAB (DETIK)',
  ];
  const hr2 = sheet2.getRow(2);
  hr2.height = 24;
  headers2.forEach((h, i) => {
    const c = hr2.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    applyThinBorder(c);
  });

  answerDetails.forEach((item, idx) => {
    const row = sheet2.getRow(3 + idx);
    row.height = 20;
    const vals = [
      item.questionNumber,
      item.participantName,
      item.className,
      item.prompt,
      item.submittedAnswer || '-',
      item.correctAnswer,
      item.status,
      item.points,
      Number(item.responseTimeSec.toFixed(1)),
    ];
    vals.forEach((v, colIdx) => {
      const c = row.getCell(colIdx + 1);
      c.value = v;
      c.font = { size: 10 };
      c.alignment = {
        vertical: 'middle',
        horizontal: colIdx === 1 || colIdx === 3 ? 'left' : 'center',
      };
      if (colIdx === 6) {
        if (item.status === 'Benar') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
          c.font = { size: 10, bold: true, color: { argb: 'FF166534' } };
        } else if (item.status === 'Salah') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
          c.font = { size: 10, bold: true, color: { argb: 'FF991B1B' } };
        } else {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          c.font = { size: 10, bold: true, color: { argb: 'FF92400E' } };
        }
      }
      applyThinBorder(c);
    });
  });

  autoFitColumns(sheet2, 12, 55);
  sheet2.getColumn(2).width = Math.max(sheet2.getColumn(2).width || 22, 26);

  // ======================== SHEET 3: ANALISIS HASIL ========================
  const sheet3 = workbook.addWorksheet('ANALISIS HASIL', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });

  sheet3.mergeCells('A1:H1');
  const t3 = sheet3.getCell('A1');
  t3.value = `ANALISIS BUTIR SOAL — ${meta.roomName} (${meta.subject})`;
  t3.font = { size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  t3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2957' } };
  t3.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet3.getRow(1).height = 26;

  const headers3 = [
    'NO SOAL',
    'PERTANYAAN',
    'MATA PELAJARAN',
    'BENAR',
    'SALAH',
    'TIDAK DIJAWAB',
    'PERSENTASE BENAR (%)',
    'TINGKAT KESULITAN',
  ];
  const hr3 = sheet3.getRow(2);
  hr3.height = 24;
  headers3.forEach((h, i) => {
    const c = hr3.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
    applyThinBorder(c);
  });

  questionAnalysis.forEach((q, idx) => {
    const row = sheet3.getRow(3 + idx);
    row.height = 22;
    const vals = [
      q.questionNumber,
      q.prompt,
      q.subject,
      q.correctCount,
      q.wrongCount,
      q.unansweredCount,
      Number(q.correctPct.toFixed(1)),
      q.difficulty,
    ];
    vals.forEach((v, colIdx) => {
      const c = row.getCell(colIdx + 1);
      c.value = v;
      c.font = { size: 10 };
      c.alignment = {
        vertical: 'middle',
        horizontal: colIdx === 1 ? 'left' : 'center',
      };
      if (colIdx === 7) {
        if (q.difficulty === 'Mudah') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        } else if (q.difficulty === 'Sedang') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
        } else {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        }
      }
      applyThinBorder(c);
    });
  });

  autoFitColumns(sheet3, 14, 58);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
