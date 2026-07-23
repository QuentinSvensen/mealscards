import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Ancien hook de refetch au resume — désactivé pour limiter l’egress Supabase Free Plan.
 * Conservé comme no-op pour ne pas casser les appels existants (WeeklyPlanning).
 */
export function useSyncPlanningQueriesOnResume(_qc: QueryClient, _enabled = true) {
  useEffect(() => {
    // Intentionnellement vide : Index / React Query gèrent déjà le cache sans
    // re-télécharger user_preferences + possible_meals à chaque visibilitychange.
  }, []);
}
