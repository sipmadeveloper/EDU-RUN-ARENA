export const MAX_MATCH_SCORE = 100;
export const QUESTIONS_PER_LAP = 5;
export const SECONDS_BETWEEN_QUESTION_GATES = 120;
export const DEFAULT_BASE_SPEED = 3;
export const TRACK_UNITS_PER_QUESTION = DEFAULT_BASE_SPEED * SECONDS_BETWEEN_QUESTION_GATES;

export function calcTotalLaps(questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  return Math.max(1, Math.ceil(safeCount / QUESTIONS_PER_LAP));
}

export function calcGatesPerLap(questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  return Math.min(QUESTIONS_PER_LAP, safeCount);
}

/**
 * Exact normalized race progress (0..1) where the runner crosses the painted
 * 3D "GERBANG SOAL" ground line for the given 0-based question index.
 * Matches createStadium.ts gateFractions = (gateInLap + 1) / (gatesOnLap + 1).
 */
export function calcQuestionGateProgress(questionIndex: number, questionCount: number): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  const safeIdx = Math.max(0, Math.min(safeCount - 1, Math.floor(questionIndex || 0)));
  const totalLaps = calcTotalLaps(safeCount);
  const gatesOnLap = calcGatesPerLap(safeCount);
  const lapIndex = Math.floor(safeIdx / gatesOnLap);
  const gateInLap = safeIdx % gatesOnLap;
  const lapFrac = (gateInLap + 1) / (gatesOnLap + 1);
  return Math.min(0.985, (lapIndex + lapFrac) / totalLaps);
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

/**
 * Computes track length so that the distance between consecutive question gates
 * takes SECONDS_BETWEEN_QUESTION_GATES (120s) to traverse at the relaxed baseSpeed.
 */
export function calcTrackLength(questionCount: number, baseSpeed = DEFAULT_BASE_SPEED): number {
  const safeCount = Math.max(1, Math.round(questionCount || 1));
  const safeSpeed = Number.isFinite(baseSpeed) && baseSpeed > 0 ? baseSpeed : DEFAULT_BASE_SPEED;
  const totalLaps = calcTotalLaps(safeCount);
  const gatesOnLap = calcGatesPerLap(safeCount);
  return Math.round(totalLaps * (gatesOnLap + 1) * safeSpeed * SECONDS_BETWEEN_QUESTION_GATES);
}

export function formatScoreValue(value: number): string {
  const rounded = Number((value || 0).toFixed(2));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
}
