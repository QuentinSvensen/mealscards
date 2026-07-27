import type { PossibleMealsFullBackup } from "./types";
import { isBackupEffectivelyEmpty } from "./backupSafety";

/** Clé de préférence conservant le compte rendu du dernier reset hebdomadaire. */
export const PLANNING_LAST_RESET_REPORT_KEY = "planning_last_reset_report";

/** Compte rendu d’un reset : permet de diagnostiquer après coup ce qui a été archivé. */
export interface PlanningResetReport {
  at: string;
  source: "auto_sunday" | "manual_button";
  archivedWeekStartISO: string;
  archivedWeekEndISO: string;
  archivedCards: number;
  archivedExtraKeys: number;
  archivedManualKeys: number;
  backupReplaced: boolean;
}

/** Construit le compte rendu d’un reset à partir de la sauvegarde qui vient d’être calculée. */
export function buildPlanningResetReport(
  backup: PossibleMealsFullBackup,
  source: PlanningResetReport["source"],
  backupReplaced: boolean,
  at: string = new Date().toISOString(),
): PlanningResetReport {
  return {
    at,
    source,
    archivedWeekStartISO: backup.weekStartISO ?? "",
    archivedWeekEndISO: backup.weekEndISO ?? "",
    archivedCards: Array.isArray(backup.cards) ? backup.cards.length : 0,
    archivedExtraKeys: Object.keys(backup.extraCalories ?? {}).length,
    archivedManualKeys: Object.keys(backup.manualCalories ?? {}).length,
    backupReplaced,
  };
}

/**
 * Vérifie qu’un reset peut se poursuivre sans détruire de données.
 * Refuse de purger la semaine en cours quand la nouvelle archive est vide
 * alors qu’une archive antérieure existe : la semaine écoulée serait perdue.
 */
export function assertResetCanProceed(
  existing: PossibleMealsFullBackup | null | undefined,
  next: PossibleMealsFullBackup,
): void {
  if (!isBackupEffectivelyEmpty(next)) return;
  if (isBackupEffectivelyEmpty(existing)) return;
  throw new Error(
    "Reset annulé : aucune carte ni saisie n’a pu être archivée pour la semaine écoulée. " +
      "Le planning n’a pas été purgé afin de ne rien perdre.",
  );
}
