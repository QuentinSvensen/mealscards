import {
  extractIngredientMacros,
  applyIngredientMacros,
} from "@/lib/ingredientUtils";

/**
 * Propage les macros d'ingrédients (cal/pro) entre tous les repas partageant les mêmes ingrédients.
 * Retourne les mises à jour à appliquer via mutations.
 */
export function propagateIngredientMacros(
  sourceMealId: string,
  newIngredients: string | null,
  allMeals: { id: string; ingredients: string | null }[]
): { sourceIngredients: string | null; updates: { id: string; ingredients: string }[] } {
  if (!newIngredients) return { sourceIngredients: newIngredients, updates: [] };

  // Construire le dictionnaire global de macros depuis tous les repas
  const globalMacros = new Map<string, { cal: string; pro: string }>();
  for (const m of allMeals) {
    const ingStr = m.id === sourceMealId ? newIngredients : m.ingredients;
    if (!ingStr) continue;
    const mMacros = extractIngredientMacros(ingStr);
    for (const [key, val] of mMacros) {
      const existing = globalMacros.get(key);
      globalMacros.set(key, {
        cal: val.cal || existing?.cal || "",
        pro: val.pro || existing?.pro || "",
      });
    }
  }

  if (globalMacros.size === 0) return { sourceIngredients: newIngredients, updates: [] };

  // Appliquer au repas source
  const selfApplied = applyIngredientMacros(newIngredients, globalMacros);
  const sourceIngredients = selfApplied || newIngredients;

  // Appliquer aux autres repas
  const updates: { id: string; ingredients: string }[] = [];
  for (const m of allMeals) {
    if (m.id === sourceMealId || !m.ingredients) continue;
    const updated = applyIngredientMacros(m.ingredients, globalMacros);
    if (updated) updates.push({ id: m.id, ingredients: updated });
  }

  return { sourceIngredients, updates };
}

