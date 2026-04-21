import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import {
  NEXT_WEEK_PROMOTION_PREF_KEYS,
  PLANNING_RESET_PREF_KEYS,
  type PlanningPrefMap,
  type PlanningSnapshotEntry,
} from "@/domain/planning/types";

/** Charge `planning_saved_snapshots` depuis Supabase pour l’utilisateur donné. */
export async function fetchPlanningSnapshotsFromDb(
  userId: string
): Promise<Record<string, PlanningSnapshotEntry>> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("key", "planning_saved_snapshots")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.value as Record<string, PlanningSnapshotEntry>) ?? {};
}

/** Charge toutes les préférences listées dans `PLANNING_RESET_PREF_KEYS` pour un utilisateur. */
export async function fetchPlanningPrefsMapFromDb(userId: string): Promise<PlanningPrefMap> {
  const { data: prefRows, error } = await supabase
    .from("user_preferences")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", [...PLANNING_RESET_PREF_KEYS, ...NEXT_WEEK_PROMOTION_PREF_KEYS]);
  if (error) throw error;
  const prefMap: PlanningPrefMap = {};
  for (const row of prefRows ?? []) {
    prefMap[row.key] = row.value as Json;
  }
  return prefMap;
}

/** Charge snapshots + prefs en parallèle (réseau mobile / tunnel). */
export async function fetchSnapshotsAndPrefsParallel(
  userId: string
): Promise<{
  snapshots: Record<string, PlanningSnapshotEntry>;
  prefMap: PlanningPrefMap;
}> {
  const [snapshots, prefMap] = await Promise.all([
    fetchPlanningSnapshotsFromDb(userId),
    fetchPlanningPrefsMapFromDb(userId),
  ]);
  return { snapshots, prefMap };
}

/** Retourne la valeur brute de `last_weekly_reset` en base, ou `null`. */
export async function fetchLastWeeklyResetFromDb(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("value")
    .eq("key", "last_weekly_reset")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data?.value === undefined || data?.value === null) return null;
  return String(data.value);
}
