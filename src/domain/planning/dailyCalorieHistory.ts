import { format, subDays } from "date-fns";
import type { Meal } from "@/types/meals";
import type { FoodItem } from "@/types/food";
import type { FoodItemMacroIndex } from "@/lib/ingredientUtils";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import type { PlanningWeekDayInfo } from "@/lib/planningWeekUtils";
import type { PossibleMealsFullBackup } from "./types";
import {
  buildLiveWeekDayTotalsForHistory,
  computeLiveStyleBackupWeekDayTotals,
} from "./planningDayCalories";
import type { BackupCalorieDayContext } from "./rollingCalorieAverage";

/** Clé de préférence : historique des totaux kcal/jour (ISO → kcal). */
export const PLANNING_DAILY_CALORIE_HISTORY_KEY = "planning_daily_calorie_history";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Indique si une chaîne est une date ISO (yyyy-MM-dd). */
export function isIsoDateString(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

/** Indique si une date ISO est comprise dans une plage fermée. */
export function isIsoWithinRange(iso: string, startISO: string, endISO: string): boolean {
  return iso >= startISO && iso <= endISO;
}

/**
 * Fusionne de nouveaux totaux journaliers dans l'historique existant.
 * Avec `overwrite`, remplace les valeurs déjà présentes (y compris à la baisse
 * pour corriger un historique surévalué). Sans overwrite, ne remplit que les trous.
 */
export function mergeDailyCalorieHistory(
  history: Record<string, number>,
  dayTotals: Record<string, number>,
  options?: { overwrite?: boolean },
): Record<string, number> {
  const next = { ...history };
  for (const [iso, cal] of Object.entries(dayTotals)) {
    if (!isIsoDateString(iso) || cal <= 0) continue;
    if (options?.overwrite) {
      next[iso] = cal;
    } else if (next[iso] == null || next[iso] <= 0) {
      next[iso] = cal;
    }
  }
  return next;
}

/**
 * Retire les entrées plus anciennes que `keepDays` par rapport à `refDate`.
 */
export function pruneDailyCalorieHistory(
  history: Record<string, number>,
  refDate: Date = new Date(),
  keepDays = 30,
): Record<string, number> {
  const cutoff = format(subDays(refDate, keepDays), "yyyy-MM-dd");
  const next: Record<string, number> = {};
  for (const [iso, cal] of Object.entries(history)) {
    if (iso >= cutoff && cal > 0) next[iso] = cal;
  }
  return next;
}

/**
 * Extrait les dates ISO présentes dans une sauvegarde planning
 * (cartes, saisies manuelles, extras, petit-déj).
 */
export function collectIsoDatesFromBackup(backup: PossibleMealsFullBackup): string[] {
  const isos = new Set<string>();

  for (const card of backup.cards) {
    if (card.day_of_week && isIsoDateString(card.day_of_week)) isos.add(card.day_of_week);
  }

  const recordKeys = [
    ...Object.keys(backup.manualCalories),
    ...Object.keys(backup.manualProteins),
    ...Object.keys(backup.extraCalories),
    ...Object.keys(backup.extraSelections),
    ...Object.keys(backup.breakfastManualCalories),
    ...Object.keys(backup.breakfastSelections),
    ...Object.keys(backup.drinkChecks),
    ...Object.keys(backup.extraSlotAssignments),
  ];

  for (const key of recordKeys) {
    const direct = key.match(/^(\d{4}-\d{2}-\d{2})(?:-|$)/);
    if (direct) isos.add(direct[1]);
    const slot = key.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (slot) isos.add(slot[1]);
  }

  return [...isos].sort();
}

/**
 * Détermine la plage ISO couverte par une sauvegarde
 * (champs explicites ou dates trouvées dans les clés).
 */
export function resolveBackupWeekRange(
  backup: PossibleMealsFullBackup | null | undefined,
): { startISO: string; endISO: string } | null {
  if (!backup) return null;
  if (backup.weekStartISO && backup.weekEndISO) {
    return { startISO: backup.weekStartISO, endISO: backup.weekEndISO };
  }
  const isos = collectIsoDatesFromBackup(backup);
  if (isos.length === 0) return null;
  return { startISO: isos[0], endISO: isos[isos.length - 1] };
}

/** Construit la liste des jours ISO d'une plage de sauvegarde. */
export function buildWeekDatesFromBackupRange(
  range: { startISO: string; endISO: string },
): PlanningWeekDayInfo[] {
  const start = new Date(`${range.startISO}T12:00:00`);
  const end = new Date(`${range.endISO}T12:00:00`);
  const weekDates: PlanningWeekDayInfo[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = format(d, "yyyy-MM-dd");
    const dow = d.getDay();
    const key = dow === 0 ? "dimanche" : ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][dow - 1];
    weekDates.push({
      iso,
      key: key as PlanningWeekDayInfo["key"],
      display: iso,
    });
  }
  return weekDates;
}

/**
 * Recalcule l'historique de la semaine archivée avec la logique live
 * (répare les totaux sous-évalués après un reset).
 */
export function refreshDailyCalorieHistoryFromBackup(
  history: Record<string, number>,
  backupCtx: BackupCalorieDayContext,
  weekDates: PlanningWeekDayInfo[],
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>,
  ingredientMacroLibrary: IngredientMacroLibraryItem[],
  isAvailable?: (name: string) => boolean,
): Record<string, number> {
  const recomputed = computeLiveStyleBackupWeekDayTotals(
    backupCtx,
    weekDates,
    mealsById,
    foodItems,
    dessertFoodItemIds,
    dessertExtraStockSnapshots,
    ingredientMacroLibrary,
    isAvailable,
  );
  return mergeDailyCalorieHistory(history, recomputed, { overwrite: true });
}

/**
 * Complète et corrige l'historique à partir de la sauvegarde courante.
 */
export function backfillDailyCalorieHistoryFromBackup(
  history: Record<string, number>,
  backup: PossibleMealsFullBackup | null | undefined,
  backupCtx: BackupCalorieDayContext | null,
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>,
  ingredientMacroLibrary: IngredientMacroLibraryItem[],
  isAvailable?: (name: string) => boolean,
  _foodMacroIndex?: FoodItemMacroIndex,
): Record<string, number> {
  if (!backup || !backupCtx) return history;
  const range = resolveBackupWeekRange(backup);
  if (!range) return history;
  const weekDates = buildWeekDatesFromBackupRange(range);
  return refreshDailyCalorieHistoryFromBackup(
    history,
    backupCtx,
    weekDates,
    mealsById,
    foodItems,
    dessertFoodItemIds,
    dessertExtraStockSnapshots,
    ingredientMacroLibrary,
    isAvailable,
  );
}

/**
 * Met à jour l'historique après reset : fige les totaux live affichés
 * avant bascule vers la nouvelle semaine.
 */
export function buildUpdatedDailyCalorieHistory(
  existingHistory: Record<string, number>,
  liveDayTotals: Record<string, number>,
): Record<string, number> {
  return pruneDailyCalorieHistory(
    mergeDailyCalorieHistory(existingHistory, liveDayTotals, { overwrite: true }),
  );
}

/**
 * Archive la semaine précédente (lun→dim) dans l'historique calorique
 * en recalculant les totaux live depuis la sauvegarde planning.
 */
export function ensurePreviousWeekCalorieHistory(
  history: Record<string, number>,
  backup: PossibleMealsFullBackup | null | undefined,
  backupCtx: BackupCalorieDayContext | null,
  previousWeekDates: PlanningWeekDayInfo[],
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>,
  ingredientMacroLibrary: IngredientMacroLibraryItem[],
  isAvailable?: (name: string) => boolean,
): Record<string, number> {
  if (!backup || !backupCtx || previousWeekDates.length === 0) return history;
  return pruneDailyCalorieHistory(
    refreshDailyCalorieHistoryFromBackup(
      history,
      backupCtx,
      previousWeekDates,
      mealsById,
      foodItems,
      dessertFoodItemIds,
      dessertExtraStockSnapshots,
      ingredientMacroLibrary,
      isAvailable,
    ),
  );
}

/**
 * Complète la plage ISO explicite d'une sauvegarde si elle est absente ou incomplète.
 */
export function withExplicitBackupWeekRange(
  backup: PossibleMealsFullBackup,
  startISO: string,
  endISO: string,
): PossibleMealsFullBackup {
  if (backup.weekStartISO === startISO && backup.weekEndISO === endISO) return backup;
  return { ...backup, weekStartISO: startISO, weekEndISO: endISO };
}

/** Alias explicite pour le reset hebdomadaire. */
export function captureLiveWeekTotalsForHistory(
  weekDates: PlanningWeekDayInfo[],
  getLiveDayCalories: (dayKey: string, isoDate?: string) => number,
): Record<string, number> {
  return buildLiveWeekDayTotalsForHistory(weekDates, getLiveDayCalories);
}
