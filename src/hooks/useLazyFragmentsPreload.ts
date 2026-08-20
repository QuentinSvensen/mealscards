import { useEffect, useRef } from "react";

export interface LazyFragmentImporters {
  importShoppingList: () => Promise<unknown>;
  importMealPlanGenerator: () => Promise<unknown>;
  importFoodItems: () => Promise<unknown>;
  importWeeklyPlanning: () => Promise<unknown>;
  importMasterList: () => Promise<unknown>;
  importPossibleList: () => Promise<unknown>;
  importAvailableList: () => Promise<unknown>;
  importUnParUnSection: () => Promise<unknown>;
  importMacroIngredients: () => Promise<unknown>;
  importEnergyDrinksList: () => Promise<unknown>;
  importNinjaCreamiSection?: () => Promise<unknown>;
  importZeroCalorieBonusSection?: () => Promise<unknown>;
}

/**
 * Précharge les fragments lazy (JS) une fois déverrouillé, via requestIdleCallback.
 */
export function useLazyFragmentsPreload(
  unlocked: boolean,
  importers: LazyFragmentImporters,
) {
  const preloadDone = useRef(false);

  useEffect(() => {
    if (!unlocked || preloadDone.current) return;
    preloadDone.current = true;

    /** Lance tous les imports dynamiques en parallèle pendant l'idle. */
    const preload = () => {
      importers.importShoppingList();
      importers.importMealPlanGenerator();
      importers.importFoodItems();
      importers.importWeeklyPlanning();
      importers.importMasterList();
      importers.importPossibleList();
      importers.importAvailableList();
      importers.importUnParUnSection();
      importers.importMacroIngredients();
      importers.importEnergyDrinksList();
      importers.importNinjaCreamiSection?.();
      importers.importZeroCalorieBonusSection?.();
    };

    if ("requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(
        preload,
      );
    } else {
      setTimeout(preload, 200);
    }
    // Les importers sont stables (imports module) — on ne les met pas en deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);
}
