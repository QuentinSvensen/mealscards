/**
 * useMoveToPossible — transfert d'un repas vers la liste Possible
 * (déduction stock, optionnels, macros figées). Extrait de Index.
 */
import type { Dispatch, SetStateAction } from "react";
import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { OptionalIngredientSelection } from "@/hooks/useOptionalIngredientsMoveDialog";
import {
  listRecipeIngredientGroups,
  buildIngredientsOverrideFromSelection,
  parseQty,
  strictNameMatch,
  type OptionalIngredientGroup,
} from "@/lib/ingredientUtils";
import {
  analyzeMealIngredients,
  buildScaledMealForRatio,
  getDisplayedCalories,
  getDisplayedProtein,
  getDisplayedFiber,
  recipeHasFiniteCounterableIngredients,
  type FoodItemIndex,
  type StockInfo,
} from "@/lib/stockUtils";

/** Données métier nécessaires au transfert. */
export type MoveToPossibleData = {
  meals: Meal[];
  possibleMeals: PossibleMeal[];
  foodItems: FoodItem[];
  foodItemIndex: FoodItemIndex;
  stockMap: Map<string, StockInfo>;
};

/** Mutations Supabase / préférences liées au transfert. */
export type MoveToPossibleMutations = {
  moveToPossible: {
    mutateAsync: (args: {
      mealId: string;
      expiration_date?: string | null;
      counter_start_date?: string | null;
    }) => Promise<{ id: string } | null | undefined>;
  };
  addMealToPossibleDirectly: {
    mutateAsync: (args: {
      name: string;
      category: string;
      calories?: string | null;
      protein?: string | null;
      grams?: string | null;
      ingredients?: string | null;
      expiration_date?: string | null;
      counter_start_date?: string | null;
      oven_temp?: string | null;
      oven_minutes?: string | null;
      description?: string | null;
      possible_quantity?: number;
    }) => Promise<{ id: string; meal_id?: string } | null | undefined>;
  };
  updatePlanning: {
    mutate: (args: { id: string; day_of_week: string | null; meal_time: string | null }) => void;
  };
  updatePossibleIngredients: {
    mutate: (args: { id: string; ingredients_override: string | null }) => void;
  };
  getPreference: <T>(key: string, fallback: T) => T;
  setPreference: { mutate: (args: { key: string; value: unknown }) => void };
};

/** Opérations stock liées au transfert. */
export type MoveToPossibleStockOps = {
  deductIngredientsFromStock: (
    meal: Meal,
    forcedCounterDate?: string,
  ) => Promise<{
    snapshots: FoodItem[];
    oldestCounter: string | null;
    consumedIngredients: string | null;
  }>;
  deductNameMatchStock: (
    meal: Meal,
    forcedCounterDate?: string,
    ratio?: number,
  ) => Promise<{ gramsDeducted: number; quantityDeducted: number }>;
  adjustStockForIngredientChange: (
    oldIngredients: string | null,
    newIngredients: string | null,
    snapshots?: FoodItem[],
  ) => Promise<FoodItem[]>;
  updateFoodItemCountersForPlanning: (
    pmId: string | null,
    ingredients: string | null,
    dayOfWeek: string | null,
    mealTime: string | null,
    fallbackDate?: string | null,
    createdAt?: string | null,
    allPossibleMeals?: PossibleMeal[],
  ) => Promise<void>;
  attachFoodDeductionSnapshot: (
    fi: FoodItem,
    portion: { grams: number; quantity: number },
  ) => FoodItem;
};

/** UI / état local liés au transfert. */
export type MoveToPossibleUi = {
  askOptionalIngredientInclusions: (
    mealName: string,
    groups: OptionalIngredientGroup[],
    ingredients?: string | null,
    stockMap?: Map<string, StockInfo>,
  ) => Promise<OptionalIngredientSelection | null>;
  updateSnapshots: (updater: (prev: Record<string, FoodItem[]>) => Record<string, FoodItem[]>) => void;
  freezePossibleBadgeCounter: (
    pmId: string,
    ingredients: string | null | undefined,
    dayKey?: string | null,
    mealTime?: string | null,
    createdAt?: string,
    foodItemsSnapshot?: FoodItem[],
  ) => void;
  setMasterSourcePmIds: Dispatch<SetStateAction<Set<string>>>;
  setCollapsedSections: Dispatch<SetStateAction<Record<string, boolean>>>;
};

export interface UseMoveToPossibleDeps {
  data: MoveToPossibleData;
  mutations: MoveToPossibleMutations;
  stockOps: MoveToPossibleStockOps;
  ui: MoveToPossibleUi;
}

/**
 * Retourne les handlers de transfert vers Possible (complet + partiel / ratio).
 */
export function useMoveToPossible(deps: UseMoveToPossibleDeps) {
  const { data, mutations, stockOps, ui } = deps;
  const { meals, possibleMeals, foodItems, foodItemIndex, stockMap } = data;
  const {
    moveToPossible,
    addMealToPossibleDirectly,
    updatePlanning,
    updatePossibleIngredients,
    getPreference,
    setPreference,
  } = mutations;
  const {
    deductIngredientsFromStock,
    deductNameMatchStock,
    updateFoodItemCountersForPlanning,
    attachFoodDeductionSnapshot,
  } = stockOps;
  const {
    askOptionalIngredientInclusions,
    updateSnapshots,
    freezePossibleBadgeCounter,
    setMasterSourcePmIds,
    setCollapsedSections,
  } = ui;

  /** Transfère un repas vers Possible, ou déplanifie si `pmId` est fourni. */
  const handleMoveToPossibleGeneral = async (
    mealId: string,
    source?: string,
    pmId?: string | null,
  ) => {
    if (pmId) {
      const pm = possibleMeals.find((p) => p.id === pmId);
      updatePlanning.mutate({ id: pmId, day_of_week: null, meal_time: null });
      // Resync compteurs : ce créneau ne doit plus maintenir un Prog. orphelin.
      if (pm) {
        const ing = pm.ingredients_override ?? pm.meals?.ingredients;
        const remainingMeals = possibleMeals.map((p) =>
          p.id === pmId ? { ...p, day_of_week: null, meal_time: null } : p,
        );
        void updateFoodItemCountersForPlanning(
          null,
          ing ?? null,
          null,
          null,
          pm.counter_start_date ?? null,
          null,
          remainingMeals,
        );
      }
      return;
    }

    const meal = meals.find((m) => m.id === mealId);
    if (!meal) return;

    // Pop-up pour chaque carte Tous / Au choix → Possible (même sans optionnels)
    let selectionOverride: string | null = null;
    const fromMasterOrAvailable = source === "master" || source === "available";
    if (fromMasterOrAvailable) {
      const groups = listRecipeIngredientGroups(meal.ingredients);
      if (groups.length > 0) {
        const choice = await askOptionalIngredientInclusions(
          meal.name,
          groups,
          meal.ingredients,
          stockMap,
          meal.category,
        );
        if (choice === null) return;
        selectionOverride = buildIngredientsOverrideFromSelection(
          meal.ingredients,
          choice.includeKeys,
          choice.qtyEdits,
        );
      }
    }

    const mealForTransfer =
      selectionOverride && selectionOverride !== meal.ingredients
        ? { ...meal, ingredients: selectionOverride }
        : meal;

    // 1. Analyser le stock avant déduction pour l'expiration (sans déduire)
    const anBefore = analyzeMealIngredients(mealForTransfer, foodItems, foodItemIndex);

    let snapshots: FoodItem[] = [];
    let nameMatch: FoodItem | undefined;
    let oldestCounterFromDeduction: string | null = null;
    let consumedIngredientsFromDeduction: string | null = null;

    // 2. Déduire les ingrédients du stock UNIQUEMENT si ça ne vient pas de "Tous" (master)
    if (source !== "master") {
      const deductionResult = await deductIngredientsFromStock(mealForTransfer, undefined);
      snapshots = deductionResult.snapshots;
      oldestCounterFromDeduction = deductionResult.oldestCounter || null;
      consumedIngredientsFromDeduction = deductionResult.consumedIngredients || null;
      nameMatch = foodItems.find((fi) => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
      if (nameMatch && !snapshots.find((s) => s.id === nameMatch!.id)) {
        if (!mealForTransfer.ingredients?.trim()) {
          const portion = await deductNameMatchStock(mealForTransfer);
          snapshots.push(attachFoodDeductionSnapshot(nameMatch, {
            grams: portion.gramsDeducted,
            quantity: portion.quantityDeducted,
          }));
        } else {
          snapshots.push({ ...nameMatch });
        }
      }
    }

    // Override Possible : sélection cochée dans la pop-up (recette maître inchangée)
    let ingredientsOverride: string | null = null;
    if (consumedIngredientsFromDeduction && consumedIngredientsFromDeduction !== meal.ingredients) {
      ingredientsOverride = consumedIngredientsFromDeduction;
    } else if (selectionOverride && selectionOverride !== meal.ingredients) {
      ingredientsOverride = selectionOverride;
    }

    // 3. Calculer les calories/protéines AVANT déduction pour les « figer » sur la nouvelle carte
    const isAvailBefore = (name: string) => {
      const fi = foodItems.find((f) => strictNameMatch(f.name, name));
      return !!fi && (fi.is_infinite || (fi.quantity ?? 0) > 0 || parseQty(fi.grams) > 0);
    };
    const mealForMacros =
      ingredientsOverride && ingredientsOverride !== meal.ingredients
        ? { ...meal, ingredients: ingredientsOverride }
        : meal;
    const preCal = getDisplayedCalories(mealForMacros, undefined, undefined, isAvailBefore);
    const prePro = getDisplayedProtein(mealForMacros, undefined, undefined, isAvailBefore, foodItems, foodItemIndex);
    // Fibres depuis la recette maître d’abord (l’override post-déduction pouvait omettre <fibres>).
    const preFiber =
      getDisplayedFiber(meal, undefined, undefined, isAvailBefore, foodItems, foodItemIndex)
      ?? getDisplayedFiber(mealForMacros, undefined, undefined, isAvailBefore, foodItems, foodItemIndex);

    // 4. Carte « Possible » = copie logique avant déduction stock
    const finalCounterDate =
      source === "master" || !recipeHasFiniteCounterableIngredients(meal.ingredients, foodItems, foodItemIndex)
        ? null
        : oldestCounterFromDeduction || anBefore.earliestCounterDate || null;

    const result = await moveToPossible.mutateAsync({
      mealId,
      expiration_date: anBefore.earliestExpiration,
      counter_start_date: finalCounterDate,
    });

    if (result?.id) {
      if (snapshots.length > 0) updateSnapshots((prev) => ({ ...prev, [result.id]: snapshots }));

      if (ingredientsOverride && ingredientsOverride !== meal.ingredients) {
        updatePossibleIngredients.mutate({ id: result.id, ingredients_override: ingredientsOverride });
      }
      if (source === "master") setMasterSourcePmIds((prev) => new Set([...prev, result.id]));
      if (source === "available" && typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
        setCollapsedSections((prev) => ({ ...prev, [`available-${meal.category}`]: true }));
      }

      // 5. Sauvegarder les macros "figées" dans les préférences pour cette carte
      if (preCal !== null) {
        const currentCals = getPreference<Record<string, string>>("planning_cal_overrides", {});
        setPreference.mutate({ key: "planning_cal_overrides", value: { ...currentCals, [result.id]: String(preCal) } });
      }
      if (prePro !== null) {
        const currentPros = getPreference<Record<string, string>>("planning_pro_overrides", {});
        setPreference.mutate({ key: "planning_pro_overrides", value: { ...currentPros, [result.id]: String(prePro) } });
      }
      if (preFiber !== null) {
        const currentFibers = getPreference<Record<string, string>>("planning_fiber_overrides", {});
        setPreference.mutate({ key: "planning_fiber_overrides", value: { ...currentFibers, [result.id]: String(preFiber) } });
      }

      // 6. Figer le badge compteur à l’arrivée (stock capturé avant déduction via closure foodItems).
      freezePossibleBadgeCounter(
        result.id,
        ingredientsOverride ?? meal.ingredients,
        null,
        null,
        undefined,
        foodItems,
      );
    }
  };

  /**
   * Transfert partiel Au choix → Possible (ratio / %) avec pop-up optionnels
   * et création directe d'une carte Possible (copie logique).
   */
  const handleMovePartialToPossible = async (meal: Meal, ratio: number, category: string) => {
    const partialMeal = buildScaledMealForRatio(meal, ratio, stockMap);

    let selectionOverride: string | null = null;
    const recipeGroups = listRecipeIngredientGroups(partialMeal.ingredients);
    if (recipeGroups.length > 0) {
      const choice = await askOptionalIngredientInclusions(
        meal.name,
        recipeGroups,
        partialMeal.ingredients,
        stockMap,
        meal.category,
      );
      if (choice === null) return;
      selectionOverride = buildIngredientsOverrideFromSelection(
        partialMeal.ingredients,
        choice.includeKeys,
        choice.qtyEdits,
      );
    }

    const mealForTransfer =
      selectionOverride && selectionOverride !== partialMeal.ingredients
        ? { ...partialMeal, ingredients: selectionOverride }
        : partialMeal;

    const anBefore = analyzeMealIngredients(mealForTransfer, foodItems, foodItemIndex);

    const { snapshots, oldestCounter, consumedIngredients } = await deductIngredientsFromStock(mealForTransfer);

    let finalCounterDate: string | null = null;
    if (recipeHasFiniteCounterableIngredients(meal.ingredients, foodItems, foodItemIndex)) {
      if (oldestCounter) finalCounterDate = oldestCounter;
      else if (anBefore.earliestCounterDate) finalCounterDate = anBefore.earliestCounterDate;
    }

    // xN entier → quantité Possible = N (permet de diviser ensuite)
    const integerMultiple =
      Number.isFinite(ratio) && ratio >= 2 && Math.abs(ratio - Math.round(ratio)) < 1e-6
        ? Math.round(ratio)
        : undefined;

    const result = await addMealToPossibleDirectly.mutateAsync({
      name: meal.name,
      category,
      calories: meal.calories,
      protein: meal.protein,
      grams: meal.grams,
      ingredients: meal.ingredients,
      expiration_date: anBefore.earliestExpiration,
      counter_start_date: finalCounterDate,
      oven_temp: meal.oven_temp,
      oven_minutes: meal.oven_minutes,
      description: meal.description ?? null,
      ...(integerMultiple ? { possible_quantity: integerMultiple } : {}),
    });

    if (result?.id) {
      updateSnapshots((prev) => ({ ...prev, [result.id]: snapshots }));
      const finalOverride =
        consumedIngredients
        || (selectionOverride && selectionOverride !== meal.ingredients
          ? selectionOverride
          : null)
        || (partialMeal.ingredients && partialMeal.ingredients !== meal.ingredients
          ? partialMeal.ingredients
          : null);
      if (finalOverride && finalOverride !== meal.ingredients) {
        updatePossibleIngredients.mutate({ id: result.id, ingredients_override: finalOverride });
      }
      freezePossibleBadgeCounter(
        result.id,
        finalOverride ?? meal.ingredients,
        null,
        null,
        undefined,
        foodItems,
      );
    }
  };

  return { handleMoveToPossibleGeneral, handleMovePartialToPossible };
}
