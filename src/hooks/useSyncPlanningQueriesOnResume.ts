import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Invalide les requêtes principales lors du retour sur l’application (visibilitychange / focus)
 * et au montage initial pour garantir que les données affichées sont toujours à jour.
 */
export function useSyncPlanningQueriesOnResume(qc: QueryClient, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    let lastSync = 0;
    const syncQueries = () => {
      const now = Date.now();
      // Limite le refetch à 1 fois toutes les 3 secondes max pour éviter le spam
      if (now - lastSync < 3000) return;
      lastSync = now;

      qc.invalidateQueries({ queryKey: ["user_preferences"] });
      qc.invalidateQueries({ queryKey: ["possible_meals"] });
      qc.invalidateQueries({ queryKey: ["food_items"] });
      qc.invalidateQueries({ queryKey: ["meals"] });
      qc.invalidateQueries({ queryKey: ["shopping_list"] });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        syncQueries();
      }
    };

    // Refetch initial en arrière-plan au montage
    syncQueries();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", syncQueries);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", syncQueries);
    };
  }, [qc, enabled]);
}
