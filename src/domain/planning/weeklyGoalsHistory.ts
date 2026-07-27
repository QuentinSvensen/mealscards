/** Clé de préférence stockant les objectifs appliqués semaine par semaine. */
export const PLANNING_WEEKLY_GOALS_HISTORY_KEY = "planning_weekly_goals_history";

/** Objectifs journaliers en vigueur pour une semaine donnée. */
export interface WeeklyGoalsEntry {
  dailyGoal: number;
  dailyGoalLow: number;
  proteinGoal: number;
  fiberGoal: number;
}

export type WeeklyGoalsHistory = Record<string, WeeklyGoalsEntry>;

/** Valide une entrée d’historique lue depuis les préférences (JSON non typé). */
function parseEntry(raw: unknown): WeeklyGoalsEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
  const entry: WeeklyGoalsEntry = {
    dailyGoal: num(obj.dailyGoal),
    dailyGoalLow: num(obj.dailyGoalLow),
    proteinGoal: num(obj.proteinGoal),
    fiberGoal: num(obj.fiberGoal),
  };
  return entry.dailyGoal > 0 ? entry : null;
}

/** Convertit une valeur de préférence brute en historique d’objectifs exploitable. */
export function parseWeeklyGoalsHistory(raw: unknown): WeeklyGoalsHistory {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: WeeklyGoalsHistory = {};
  for (const [weekStartISO, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (entry) out[weekStartISO] = entry;
  }
  return out;
}

/** Retourne les objectifs enregistrés pour une semaine (ou null si absents). */
export function readWeeklyGoals(
  history: WeeklyGoalsHistory,
  weekStartISO: string,
): WeeklyGoalsEntry | null {
  return history[weekStartISO] ?? null;
}

/**
 * Enregistre les objectifs d’une semaine.
 * Retourne `null` quand rien ne change, pour éviter une écriture inutile en base.
 */
export function upsertWeeklyGoals(
  history: WeeklyGoalsHistory,
  weekStartISO: string,
  entry: WeeklyGoalsEntry,
): WeeklyGoalsHistory | null {
  if (!weekStartISO || entry.dailyGoal <= 0) return null;
  const current = history[weekStartISO];
  if (
    current &&
    current.dailyGoal === entry.dailyGoal &&
    current.dailyGoalLow === entry.dailyGoalLow &&
    current.proteinGoal === entry.proteinGoal &&
    current.fiberGoal === entry.fiberGoal
  ) {
    return null;
  }
  return { ...history, [weekStartISO]: entry };
}
