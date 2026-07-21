/**
 * Handlers Index : déplacement name-match / aliment is_meal depuis « Au choix » vers Possible.
 * Extrait des blocs JSX volumineux — comportement inchangé.
 */
import { useCallback } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizeKey,
  parseQty,
  getFoodItemTotalGrams,
} from "@/lib/ingredientUtils";
import { scaleIngredientStringExact } from "@/lib/stockUtils";

/** Mutations / helpers nécessaires aux déplacements stock → Possible. */
export type IndexStockMoveHandlerDeps = {
  qc: QueryClient;
  foodItems: FoodItem[];
  macroLookup: Map<string, { cal: string; pro: string; fiber?: string }>;
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
      fiber?: string | null;
      grams?: string | null;
      ingredients?: string | null;
      expiration_date?: string | null;
      counter_start_date?: string | null;
      oven_temp?: string | null;
      oven_minutes?: string | null;
      description?: string | null;
    }) => Promise<{ id: string } | null | undefined>;
  };
  updatePossibleIngredients: {
    mutate: (args: { id: string; ingredients_override: string | null }) => void;
  };
  deductNameMatchStock: (
    meal: Meal,
    forcedCounterDate?: string,
    ratio?: number,
  ) => Promise<{ gramsDeducted: number; quantityDeducted: number }>;
  attachFoodDeductionSnapshot: (
    fi: FoodItem,
    portion: { grams: number; quantity: number },
  ) => FoodItem;
  updateSnapshots: (updater: (prev: Record<string, FoodItem[]>) => Record<string, FoodItem[]>) => void;
  freezePossibleBadgeCounter: (
    pmId: string,
    ingredients: string | null | undefined,
    dayKey?: string | null,
    mealTime?: string | null,
    createdAt?: string,
    foodItemsForFreeze?: FoodItem[],
    baseStartDate?: string | null,
  ) => void;
};

/**
 * Retourne les callbacks stables pour name-match et aliment → Possible (par catégorie).
 */
export function useIndexStockMoveHandlers(deps: IndexStockMoveHandlerDeps) {
  const {
    qc,
    foodItems,
    macroLookup,
    moveToPossible,
    addMealToPossibleDirectly,
    updatePossibleIngredients,
    deductNameMatchStock,
    attachFoodDeductionSnapshot,
    updateSnapshots,
    freezePossibleBadgeCounter,
  } = deps;

  /**
   * Déplace un repas name-match (fiche sans ingrédients ↔ aliment) vers Possible,
   * avec macros/grammes éventuellement mis à l’échelle et déduction stock.
   */
  const onMoveNameMatchToPossible = useCallback(
    async (category: string, meal: Meal, fi: FoodItem, ratio?: number) => {
      const r = ratio ?? 1;

      // Calcul des macros de base (soit depuis le repas, soit depuis l'aliment)
      const hasCal = meal.calories && meal.calories !== "0";
      const hasPro = meal.protein && meal.protein !== "0" && meal.protein !== "0%";
      let baseCal = hasCal ? parseFloat(meal.calories!.replace(",", ".")) : 0;
      let basePro = hasPro ? parseFloat(meal.protein!.replace(",", ".")) : 0;

      if (!hasCal || !hasPro) {
        if (!hasCal && fi.calories) {
          const fiCal = parseFloat(fi.calories.replace(",", "."));
          if (fi.grams) {
            const totalG = getFoodItemTotalGrams(fi);
            baseCal = (fiCal * totalG) / 100;
          } else {
            baseCal = fiCal * (fi.quantity ?? 1);
          }
        }
        if (!hasPro && fi.protein) {
          const fiPro = parseFloat(fi.protein.replace(",", "."));
          if (fi.grams) {
            const totalG = getFoodItemTotalGrams(fi);
            basePro = (fiPro * totalG) / 100;
          } else {
            basePro = fiPro * (fi.quantity ?? 1);
          }
        }
      }

      // Valeurs finales à envoyer en DB
      const baseGStr = fi.quantity && fi.quantity > 1 && fi.grams
        ? `${parseQty(fi.grams) * fi.quantity}g`
        : (meal.grams ?? (fi.is_infinite ? "∞" : fi.grams ?? null));
      const finalGrams = baseGStr ? (r !== 1 && baseGStr !== "∞" ? `${Math.round(parseQty(baseGStr) * r)}g` : baseGStr) : null;
      const finalCal = baseCal > 0 ? String(Math.round(baseCal * r)) : meal.calories;
      const finalPro = basePro > 0 ? String(Math.round(basePro * r)) : meal.protein;

      if (fi.is_infinite) {
        const baseIng = meal.ingredients ? meal.ingredients : (parseQty(meal.grams) > 0 ? `${meal.grams} ${meal.name}` : null);
        const scaledIng = baseIng && r !== 1 ? scaleIngredientStringExact(baseIng, r) : null;

        const result = await addMealToPossibleDirectly.mutateAsync({
          name: meal.name, category,
          calories: finalCal, protein: finalPro, grams: finalGrams,
          ingredients: baseIng,
          expiration_date: fi.expiration_date,
          counter_start_date: null,
          oven_temp: meal.oven_temp,
          oven_minutes: meal.oven_minutes,
          description: meal.description ?? null,
        });
        if (result?.id && scaledIng) {
          updatePossibleIngredients.mutate({ id: result.id, ingredients_override: scaledIng });
        }
        if (result?.id) {
          freezePossibleBadgeCounter(
            result.id,
            scaledIng ?? baseIng,
            null,
            null,
            undefined,
            foodItems,
          );
        }
      } else {
        const portion = await deductNameMatchStock(meal, undefined, r);
        const shouldStartOnMove = fi.storage_type !== "surgele" && !fi.no_counter;
        const finalCd = fi.counter_start_date || (shouldStartOnMove ? new Date().toISOString() : null);
        const liveAfterDeduct = qc.getQueryData<FoodItem[]>(["food_items"])?.find((x) => x.id === fi.id);
        const snapshot = [
          attachFoodDeductionSnapshot(
            {
              ...fi,
              counter_start_date:
                liveAfterDeduct?.counter_start_date ?? finalCd ?? fi.counter_start_date,
            },
            {
              grams: portion.gramsDeducted,
              quantity: portion.quantityDeducted,
            },
          ),
        ];

        // Si ratio != 1 ou macros calculées, on crée un repas "indépendant" au lieu de juste lier au master
        if (r !== 1 || !hasCal || !hasPro) {
          const result = await addMealToPossibleDirectly.mutateAsync({
            name: meal.name, category,
            calories: finalCal, protein: finalPro, grams: finalGrams,
            ingredients: meal.ingredients || (parseQty(finalGrams) > 0 ? `${finalGrams} ${meal.name}` : null),
            expiration_date: fi.expiration_date,
            counter_start_date: finalCd,
            oven_temp: meal.oven_temp,
            oven_minutes: meal.oven_minutes,
            description: meal.description ?? null,
          });
          if (result?.id) {
            updateSnapshots((prev) => ({ ...prev, [result.id]: snapshot }));
            freezePossibleBadgeCounter(
              result.id,
              meal.ingredients || (parseQty(finalGrams) > 0 ? `${finalGrams} ${meal.name}` : null),
              null,
              null,
              undefined,
              foodItems,
            );
          }
        } else {
          const result = await moveToPossible.mutateAsync({
            mealId: meal.id,
            expiration_date: fi.expiration_date,
            counter_start_date: finalCd,
          });
          if (result?.id) {
            updateSnapshots((prev) => ({ ...prev, [result.id]: snapshot }));
            freezePossibleBadgeCounter(
              result.id,
              meal.ingredients,
              null,
              null,
              undefined,
              foodItems,
            );
          }
        }
      }
    },
    [
      addMealToPossibleDirectly,
      attachFoodDeductionSnapshot,
      deductNameMatchStock,
      foodItems,
      freezePossibleBadgeCounter,
      moveToPossible,
      qc,
      updatePossibleIngredients,
      updateSnapshots,
    ],
  );

  /**
   * Déplace un aliment (is_meal / fiche stock) vers Possible en consommant une portion.
   */
  const onMoveFoodItemToPossible = useCallback(
    async (category: string, fi: FoodItem) => {
      const perUnit = parseQty(fi.grams);
      let portionGrams = 0;
      let portionQty = 0;
      if (!fi.is_infinite) {
        if (perUnit > 0) {
          portionGrams =
            fi.quantity && fi.quantity > 1
              ? perUnit
              : getFoodItemTotalGrams(fi);
        } else {
          portionQty = 1;
        }
      }
      const snapshot = [
        attachFoodDeductionSnapshot(fi, { grams: portionGrams, quantity: portionQty }),
      ];
      const shouldStart = fi.storage_type !== "surgele" && !fi.no_counter;
      const movedCounterDate = fi.counter_start_date || (shouldStart ? new Date().toISOString() : null);
      if (!fi.is_infinite) {
        const currentQty = fi.quantity ?? 1;
        if (currentQty <= 1) {
          await supabase.from("food_items").delete().eq("id", fi.id);
        } else {
          // Unitaire avec compteur auto : démarrer le compteur sur le stock restant.
          // Paquets grammes scellés restants : pas de compteur (boîte intacte).
          const isCountOnly = parseQty(fi.grams) <= 0;
          const startOnRemaining = isCountOnly && !!movedCounterDate;
          await supabase.from("food_items").update({
            quantity: currentQty - 1,
            ...(startOnRemaining ? { counter_start_date: movedCounterDate } : {}),
          } as any).eq("id", fi.id);
        }
        qc.invalidateQueries({ queryKey: ["food_items"] });
      }
      const fiKey = normalizeKey(fi.name);
      const fiMacro = macroLookup.get(fiKey);
      let calories = fi.calories || fiMacro?.cal || null;
      let protein = fi.protein || fiMacro?.pro || null;
      let fiber = fi.fiber || fiMacro?.fiber || null;

      if (fi.grams) {
        // Un déplacement depuis "Au choix" consomme une seule portion, pas tout le stock disponible.
        const movedGrams = portionGrams > 0 ? portionGrams : perUnit;
        if (movedGrams > 0) {
          if (calories) calories = String(Math.round(parseFloat(calories.replace(",", ".")) * movedGrams / 100));
          if (protein) protein = String(Math.round(parseFloat(protein.replace(",", ".")) * movedGrams / 100));
          if (fiber) fiber = String(Math.round(parseFloat(fiber.replace(",", ".")) * movedGrams / 100));
        }
      }

      const pmResult = await addMealToPossibleDirectly.mutateAsync({
        name: fi.name, category,
        calories, protein, fiber, grams: fi.grams,
        expiration_date: fi.expiration_date,
        counter_start_date: movedCounterDate,
      });
      if (pmResult?.id) {
        updateSnapshots((prev) => ({ ...prev, [pmResult.id]: snapshot }));
        // Gel à partir de l’état aliment avant consommation (snapshot / fi).
        freezePossibleBadgeCounter(
          pmResult.id,
          fi.grams ? `${fi.grams} ${fi.name}` : `1 ${fi.name}`,
          null,
          null,
          undefined,
          [{ ...fi, counter_start_date: movedCounterDate }],
        );
      }
    },
    [
      addMealToPossibleDirectly,
      attachFoodDeductionSnapshot,
      freezePossibleBadgeCounter,
      macroLookup,
      qc,
      updateSnapshots,
    ],
  );

  return { onMoveNameMatchToPossible, onMoveFoodItemToPossible };
}
