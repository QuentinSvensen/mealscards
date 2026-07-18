import { PLANNING_DAILY_CALORIE_HISTORY_KEY } from "./dailyCalorieHistory";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import { POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY } from "@/lib/stockUtils";

/**
 * Clés de préférences client (hors payload semaine) à inclure dans un export/import JSON.
 * Couvre les ajouts récents : masquer calories, fourchette basse, fibres, compteur figé, historique.
 */
export const CLIENT_PREFS_BACKUP_KEYS = [
  PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY,
  "planning_daily_goal",
  "planning_daily_goal_low",
  "next_week_daily_goal",
  "next_week_daily_goal_low",
  "planning_protein_goal",
  "next_week_protein_goal",
  "planning_fiber_goal",
  "next_week_fiber_goal",
  POSSIBLE_FROZEN_COUNTER_DAYS_PREF_KEY,
  PLANNING_DAILY_CALORIE_HISTORY_KEY,
] as const;

export type ClientPrefsBackupKey = (typeof CLIENT_PREFS_BACKUP_KEYS)[number];

export interface ClientPrefsBackupPayload {
  version: 1;
  kind: "mealscards_client_prefs";
  exportedAt: string;
  prefs: Partial<Record<ClientPrefsBackupKey, unknown>>;
}

/** Construit le payload JSON des préférences client à partir d’une map clé → valeur. */
export function buildClientPrefsBackupPayload(
  getValue: (key: string) => unknown,
): ClientPrefsBackupPayload {
  const prefs: ClientPrefsBackupPayload["prefs"] = {};
  for (const key of CLIENT_PREFS_BACKUP_KEYS) {
    const value = getValue(key);
    if (value !== undefined) prefs[key] = value;
  }
  return {
    version: 1,
    kind: "mealscards_client_prefs",
    exportedAt: new Date().toISOString(),
    prefs,
  };
}

/**
 * Valide et extrait les entrées à écrire lors d’un import JSON de préférences client.
 * Retourne `null` si le fichier n’est pas un backup reconnu.
 */
export function parseClientPrefsBackupPayload(
  raw: unknown,
): Array<{ key: ClientPrefsBackupKey; value: unknown }> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== "mealscards_client_prefs") return null;
  const prefs = obj.prefs;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return null;

  const entries: Array<{ key: ClientPrefsBackupKey; value: unknown }> = [];
  const prefRecord = prefs as Record<string, unknown>;
  for (const key of CLIENT_PREFS_BACKUP_KEYS) {
    if (Object.prototype.hasOwnProperty.call(prefRecord, key)) {
      entries.push({ key, value: prefRecord[key] });
    }
  }
  return entries;
}
