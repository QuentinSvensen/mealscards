/**
 * useProgCounterReconcile — effet unique de synchro Prog. / démarrage compteurs.
 * Remplace le useEffect dupliqué Index ↔ FoodItems (snapshot + debounce 150 ms).
 */
import { useEffect, useRef } from "react";
import type { PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { isCountOnlyFoodItem, isFoodItemFullySealed } from "@/lib/stockUtils";
import { buildPossiblePlanningSnapshot } from "@/hooks/useMealTransfers";
import { isFoodCounterManuallyStopped } from "@/lib/counters/manualCounterOverrides";

export interface UseProgCounterReconcileOptions {
  /** Index : `unlocked` ; FoodItems : true par défaut. */
  enabled?: boolean;
  isLoading: boolean;
  possibleMeals: PossibleMeal[];
  foodItems: FoodItem[];
  foodStockBaselines: Record<string, { quantity?: number | null; totalGrams?: number } | null | undefined>;
  reconcileMissedProgCounters: (
    allPossibleMeals: PossibleMeal[],
    stockBaselines?: Record<string, { quantity?: number | null; totalGrams?: number } | null>,
  ) => Promise<void>;
}

/**
 * Déclenche `reconcileMissedProgCounters` quand le planning change
 * ou qu'un lot ouvert n'a pas encore de compteur.
 */
export function useProgCounterReconcile({
  enabled = true,
  isLoading,
  possibleMeals,
  foodItems,
  foodStockBaselines,
  reconcileMissedProgCounters,
}: UseProgCounterReconcileOptions) {
  const lastPlanningSnapshotRef = useRef<string>("");
  const progReconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || isLoading) return;
    const snapshot = buildPossiblePlanningSnapshot(possibleMeals);
    const needsCounterStart = foodItems.some((fi) => {
      if (fi.is_infinite || fi.storage_type === "surgele" || fi.no_counter) return false;
      if (fi.counter_start_date?.trim()) return false;
      // Stop manuel : ne pas relancer le reconcile en boucle sur ce lot.
      if (isFoodCounterManuallyStopped(fi.id)) return false;
      if (isCountOnlyFoodItem(fi)) {
        const b = foodStockBaselines[fi.id]?.quantity;
        return b != null && b > 0 && (fi.quantity ?? 1) < b;
      }
      return !isFoodItemFullySealed(fi);
    });
    const planningChanged = snapshot !== lastPlanningSnapshotRef.current;
    if (!planningChanged && !needsCounterStart) return;
    if (planningChanged) lastPlanningSnapshotRef.current = snapshot;
    if (progReconcileTimerRef.current) clearTimeout(progReconcileTimerRef.current);
    progReconcileTimerRef.current = setTimeout(() => {
      void reconcileMissedProgCounters(possibleMeals, foodStockBaselines);
    }, 150);
    return () => {
      if (progReconcileTimerRef.current) clearTimeout(progReconcileTimerRef.current);
    };
  }, [enabled, isLoading, possibleMeals, foodItems, foodStockBaselines, reconcileMissedProgCounters]);
}
