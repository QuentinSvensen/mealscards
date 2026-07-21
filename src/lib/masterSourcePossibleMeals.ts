/** Clé user_preferences : ids des cartes Possible issues de « Tous ». */
export const MASTER_SOURCE_PM_IDS_PREF_KEY = "possible_master_source_pm_ids";

/**
 * Indique si une carte Possible vient de la section « Tous ».
 */
export function isMasterSourcePossibleMeal(
  pmId: string | null | undefined,
  masterSourcePmIds: ReadonlySet<string> | readonly string[] | null | undefined,
): boolean {
  if (!pmId?.trim() || !masterSourcePmIds) return false;
  if (masterSourcePmIds instanceof Set) return masterSourcePmIds.has(pmId);
  return masterSourcePmIds.includes(pmId);
}
