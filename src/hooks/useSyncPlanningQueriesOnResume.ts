import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalide le cache React Query (`user_preferences`, `possible_meals`) lorsque l’app
 * repasse au premier plan ou que le réseau revient (utile en mobile / tunnel).
 */
export function useSyncPlanningQueriesOnResume(qc: QueryClient, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const refresh = () => {
      qc.invalidateQueries({ queryKey: ["user_preferences"] });
      qc.invalidateQueries({ queryKey: ["possible_meals"] });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [qc, enabled]);
}
