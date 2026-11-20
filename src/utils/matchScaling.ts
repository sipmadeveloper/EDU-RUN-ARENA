export const MAX_MATCH_SCORE = 100;
export const QUESTIONS_PER_LAP = 5;
export const TRACK_UNITS_PER_QUESTION = 360;

export function calcTotalLaps(questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  return Math.max(1, Math.ceil(safeCount / QUESTIONS_PER_LAP));
}

export function calcPointsPerQuestion(questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  return Number((MAX_MATCH_SCORE / safeCount).toFixed(2));
}

export function calcScoreFromCorrect(correctCount: number, questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  const safeCorrect = Math.max(0, Math.min(safeCount, correctCount || 0));
  return Number(((safeCorrect * MAX_MATCH_SCORE) / safeCount).toFixed(2));
}

export function calcTrackLength(questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  return safeCount * TRACK_UNITS_PER_QUESTION;
}

export function formatScoreValue(value: number): string {
  const rounded = Number((value || 0).toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
}
