/**
 * Diagnostic console du Planning (dev uniquement).
 * Expose `window.__diagPlanning()` pour inspecter l’état Supabase
 * (backup, snapshots, brouillon Suiv., objectifs).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { resolveCurrentUserId } from "@/lib/authUserId";
import {
  parseWeeklyGoalsHistory,
  upsertWeeklyGoals,
  PLANNING_WEEKLY_GOALS_HISTORY_KEY,
  type WeeklyGoalsHistory,
} from "@/domain/planning/weeklyGoalsHistory";
import { PLANNING_LAST_RESET_REPORT_KEY } from "@/domain/planning/resetReport";

/** Résumé compact d’une préférence clé/valeur. */
type PrefSummary = { key: string; found: boolean; preview: unknown };

/** Filtre les entrées d’un record dont la clé concerne un jour donné (ex. samedi). */
function filterKeysForDay(
  record: Record<string, unknown> | null | undefined,
  dayHint: string,
): Record<string, unknown> {
  if (!record || typeof record !== "object") return {};
  const needle = dayHint.toLowerCase();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k.toLowerCase().includes(needle)) out[k] = v;
  }
  return out;
}

/** Lit une préférence utilisateur par clé. */
async function fetchPref(userId: string, key: string): Promise<unknown> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("user_id", userId)
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

/**
 * Collecte et affiche un diagnostic Planning dans la console.
 * À lancer via `await __diagPlanning()` depuis la console du navigateur.
 */
export async function diagPlanning(): Promise<Record<string, unknown>> {
  const userId = await resolveCurrentUserId();

  const [
    backupRaw,
    snapshotsRaw,
    manualCal,
    nextManualCal,
    manualPro,
    nextManualPro,
    goalLow,
    lastReset,
    extraCal,
    nextExtraCal,
    goalsHistory,
    lastResetReport,
    calorieHistory,
  ] = await Promise.all([
    fetchPref(userId, "possible_meals_backup"),
    fetchPref(userId, "planning_saved_snapshots"),
    fetchPref(userId, "planning_manual_calories"),
    fetchPref(userId, "next_week_manual_calories"),
    fetchPref(userId, "planning_manual_proteins"),
    fetchPref(userId, "next_week_manual_proteins"),
    fetchPref(userId, "planning_daily_goal_low"),
    fetchPref(userId, "last_weekly_reset"),
    fetchPref(userId, "planning_extra_calories"),
    fetchPref(userId, "next_week_extra_calories"),
    fetchPref(userId, PLANNING_WEEKLY_GOALS_HISTORY_KEY),
    fetchPref(userId, PLANNING_LAST_RESET_REPORT_KEY),
    fetchPref(userId, "planning_daily_calorie_history"),
  ]);

  const { data: livePossible, error: pmError } = await supabase
    .from("possible_meals")
    .select("id, day_of_week, meal_time, meals(name)")
    .eq("user_id", userId);
  if (pmError) throw pmError;
  const possibleCount = livePossible?.length ?? 0;

  const backup =
    backupRaw && typeof backupRaw === "object" && !Array.isArray(backupRaw)
      ? (backupRaw as Record<string, unknown>)
      : null;
  const cards = Array.isArray(backup?.cards) ? backup.cards : Array.isArray(backupRaw) ? backupRaw : [];
  const dayOfWeekSet = new Set<string>();
  for (const c of cards as Array<{ day_of_week?: string | null }>) {
    if (c?.day_of_week) dayOfWeekSet.add(String(c.day_of_week));
  }

  const snapshots =
    snapshotsRaw && typeof snapshotsRaw === "object" && !Array.isArray(snapshotsRaw)
      ? (snapshotsRaw as Record<string, unknown>)
      : {};

  const liveByDay: Record<string, string[]> = {};
  for (const pm of (livePossible ?? []) as Array<{
    day_of_week?: string | null;
    meal_time?: string | null;
    meals?: { name?: string | null } | null;
  }>) {
    const day = pm.day_of_week ?? "(vide)";
    (liveByDay[day] ??= []).push(`${pm.meal_time ?? "?"}:${pm.meals?.name ?? "?"}`);
  }

  const summary = {
    userId,
    possible_meals_count: possibleCount ?? 0,
    live_possible_by_day: liveByDay,
    last_weekly_reset: lastReset,
    planning_daily_goal_low: goalLow,
    backup: backup
      ? {
          cardsCount: cards.length,
          day_of_week_distinct: [...dayOfWeekSet].sort(),
          weekStartISO: backup.weekStartISO ?? null,
          weekEndISO: backup.weekEndISO ?? null,
          daily_goal: backup.daily_goal ?? null,
          daily_goal_low: backup.daily_goal_low ?? null,
          protein_goal: backup.protein_goal ?? null,
          fiber_goal: backup.fiber_goal ?? null,
          cardSample: (cards as Array<{ day_of_week?: string; meal_name?: string }>)
            .slice(0, 8)
            .map((c) => `${c.day_of_week}:${c.meal_name ?? "?"}`),
          manualCaloriesKeys: Object.keys((backup.manualCalories as object) ?? {}).length,
          extraCaloriesKeys: Object.keys((backup.extraCalories as object) ?? {}).length,
          extraCaloriesSample: (backup.extraCalories as Record<string, number>) ?? {},
          savedSnapshotsCount: Object.keys((backup.savedSnapshots as object) ?? {}).length,
          manualCaloriesSamedi: filterKeysForDay(
            backup.manualCalories as Record<string, unknown>,
            "samedi",
          ),
        }
      : { cardsCount: Array.isArray(backupRaw) ? (backupRaw as unknown[]).length : 0, rawType: typeof backupRaw },
    snapshots_manual_samedi: filterKeysForDay(snapshots, "samedi"),
    planning_manual_calories_samedi: filterKeysForDay(
      manualCal as Record<string, unknown>,
      "samedi",
    ),
    next_week_manual_calories_samedi: filterKeysForDay(
      nextManualCal as Record<string, unknown>,
      "samedi",
    ),
    planning_manual_proteins_samedi: filterKeysForDay(
      manualPro as Record<string, unknown>,
      "samedi",
    ),
    next_week_manual_proteins_samedi: filterKeysForDay(
      nextManualPro as Record<string, unknown>,
      "samedi",
    ),
    live_manual_calories_keys: Object.keys((manualCal as object) ?? {}),
    live_extra_calories: (extraCal as Record<string, unknown>) ?? {},
    next_week_extra_calories_keys: Object.keys((nextExtraCal as object) ?? {}),
    saved_snapshots_keys: Object.keys(snapshots),
    weekly_goals_history: (goalsHistory as Record<string, unknown>) ?? {},
    last_reset_report: lastResetReport ?? null,
  };

  // Prefs utiles à coller dans le chat (aperçu).
  const prefsPreview: PrefSummary[] = [
    { key: "possible_meals_backup", found: !!backupRaw, preview: summary.backup },
    { key: "planning_daily_goal_low", found: goalLow != null, preview: goalLow },
    { key: "last_weekly_reset", found: lastReset != null, preview: lastReset },
  ];

  console.group("[MealsCards] Diagnostic Planning");
  console.log(summary);
  console.table(prefsPreview);
  console.log("--- COPIER CE BLOC ---\n" + JSON.stringify(summary, null, 2));
  console.groupEnd();

  return summary;
}

/**
 * Renseigne manuellement les objectifs d’une semaine (lundi ISO) dans l’historique.
 * Sert à corriger une semaine déjà archivée dont les objectifs n’avaient pas été mémorisés.
 */
export async function setWeekGoals(
  weekStartISO: string,
  dailyGoalLow: number,
  dailyGoal: number,
  proteinGoal = 0,
  fiberGoal = 0,
): Promise<WeeklyGoalsHistory> {
  const userId = await resolveCurrentUserId();
  const history = parseWeeklyGoalsHistory(
    await fetchPref(userId, PLANNING_WEEKLY_GOALS_HISTORY_KEY),
  );
  const next =
    upsertWeeklyGoals(history, weekStartISO, {
      dailyGoal,
      dailyGoalLow,
      proteinGoal,
      fiberGoal,
    }) ?? history;
  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        key: PLANNING_WEEKLY_GOALS_HISTORY_KEY,
        value: next as unknown as Json,
      },
      { onConflict: "user_id,key" },
    );
  if (error) throw error;
  console.info("[MealsCards] Objectifs enregistrés pour", weekStartISO, next[weekStartISO]);
  return next;
}

declare global {
  interface Window {
    __diagPlanning?: () => Promise<Record<string, unknown>>;
    __setWeekGoals?: typeof setWeekGoals;
  }
}

/** Enregistre `window.__diagPlanning` uniquement en développement. */
export function installPlanningDiagnostics(): void {
  if (!import.meta.env.DEV) return;
  window.__diagPlanning = diagPlanning;
  window.__setWeekGoals = setWeekGoals;
  console.info(
    "[MealsCards] Diagnostic Planning prêt : tape `await __diagPlanning()` dans la console.",
  );
}
