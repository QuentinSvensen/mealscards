import type { PossibleMealsFullBackup } from "./types";
import { reconcileBackupWeekRange } from "./backupWeekAlignment";

/**
 * Indique si une sauvegarde est « vide » (aucune carte et aucune saisie manuelle / extra / petit-déj).
 * Sert de garde pour ne pas écraser une archive utile lors d’un reset à vide.
 */
export function isBackupEffectivelyEmpty(
  backup: PossibleMealsFullBackup | null | undefined,
): boolean {
  if (!backup) return true;
  if (Array.isArray(backup.cards) && backup.cards.length > 0) return false;
  const records: Array<Record<string, unknown> | undefined> = [
    backup.manualCalories,
    backup.manualProteins,
    backup.manualFibers,
    backup.extraCalories,
    backup.extraProteins,
    backup.extraFibers,
    backup.extraSelections,
    backup.extraSlotAssignments,
    backup.breakfastManualCalories,
    backup.breakfastManualProteins,
    backup.breakfastSelections,
    backup.drinkChecks,
  ];
  for (const rec of records) {
    if (rec && typeof rec === "object" && Object.keys(rec).length > 0) return false;
  }
  return true;
}

/**
 * Décide si la nouvelle sauvegarde peut remplacer l’existante.
 * On refuse d’écraser une archive non vide par une sauvegarde vide.
 */
export function shouldReplaceBackup(
  existing: PossibleMealsFullBackup | null | undefined,
  next: PossibleMealsFullBackup,
): boolean {
  if (isBackupEffectivelyEmpty(existing)) return true;
  if (isBackupEffectivelyEmpty(next)) return false;
  return true;
}

/**
 * Complète weekStartISO / weekEndISO seulement s’ils sont absents ou incohérents.
 * Déduit la plage des dates réellement présentes dans la sauvegarde.
 */
export function fillMissingBackupWeekRange(
  backup: PossibleMealsFullBackup,
): PossibleMealsFullBackup {
  return reconcileBackupWeekRange(backup);
}
