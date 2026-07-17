import type { FoodItem } from "@/hooks/useFoodItems";

/**
 * Extrait un nombre depuis une valeur de macro saisie librement (virgule, unité, texte).
 * Conserve le signe moins (ex. « -316 kcal » → -316) pour les ajustements type « Négatif ».
 */
export function parseFoodMacroValue(value: string | null | undefined): number {
  if (!value) return 0;
  // Normalise les tirets typographiques (U+2212, en-dash) vers le moins ASCII.
  const normalized = value.replace(",", ".").replace(/[\u2212\u2013\u2014]/g, "-");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : 0;
}

/** Indique si une macro numérique est utilisable (non nulle), y compris les valeurs négatives. */
export function hasNonZeroMacro(value: number): boolean {
  return Number.isFinite(value) && value !== 0;
}

// Extrait le grammage de référence d'un extra, même si le stock garde un reste au format "unité|reste".
export function getExtraReferenceGrams(grams: string | null | undefined): number | null {
  if (!grams?.trim()) return null;
  const base = grams.split("|")[0];
  const match = base.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = parseFloat(match[0]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Indique comment interpréter les macros notées sur un extra : au 100g, par quantité, ou produit entier.
export function getExtraMacroMode(foodItem: Pick<FoodItem, "grams" | "quantity">): "per100g" | "perQuantity" | "wholeProduct" {
  if (getExtraReferenceGrams(foodItem.grams) !== null) return "per100g";
  if (foodItem.quantity != null && foodItem.quantity > 0) return "perQuantity";
  return "wholeProduct";
}

// Fournit le libellé utilisateur qui précise la base des macros saisies pour un extra.
export function getExtraMacroBasisLabel(foodItem: Pick<FoodItem, "grams" | "quantity">): string {
  const mode = getExtraMacroMode(foodItem);
  if (mode === "per100g") return "100g";
  if (mode === "perQuantity") return "Quantité";
  return "Produit";
}

// Calcule les calories/protéines/fibres pour une occurrence d'extra (planning ou affichage).
// Par défaut, en mode « par quantité », multiplie par le stock (ex. x3 → total des 3 unités).
// Avec perUnit: true, renvoie les macros d'une seule unité (badge xN affiché à part).
export function getExtraPortionMacros(
  foodItem: Pick<FoodItem, "grams" | "quantity" | "calories" | "protein"> & { fiber?: string | null },
  options?: { perUnit?: boolean },
): { cal: number; pro: number; fiber: number } {
  const cal = parseFoodMacroValue(foodItem.calories);
  const pro = parseFoodMacroValue(foodItem.protein);
  const fiber = parseFoodMacroValue(foodItem.fiber);
  const grams = getExtraReferenceGrams(foodItem.grams);

  if (grams !== null) {
    return {
      cal: Math.round((cal * grams) / 100),
      pro: Math.round((pro * grams) / 100),
      fiber: Math.round((fiber * grams) / 100),
    };
  }

  if (foodItem.quantity != null && foodItem.quantity > 0) {
    const factor = options?.perUnit ? 1 : foodItem.quantity;
    return {
      cal: Math.round(cal * factor),
      pro: Math.round(pro * factor),
      fiber: Math.round(fiber * factor),
    };
  }

  return { cal: Math.round(cal), pro: Math.round(pro), fiber: Math.round(fiber) };
}

// Retourne les macros de référence saisies sur la fiche aliment pour les afficher dans l'onglet Macro.
export function getExtraMacroReferenceMacros(
  foodItem: Pick<FoodItem, "storage_type" | "grams" | "quantity" | "calories" | "protein"> & { fiber?: string | null },
): { cal: string; pro: string; fiber: string } {
  return {
    cal: foodItem.calories?.trim() || "",
    pro: foodItem.protein?.trim() || "",
    fiber: foodItem.fiber?.trim() || "",
  };
}

// Prépare les macros de référence de l'onglet Macro pour les stocker sur la fiche aliment.
export function getExtraStoredMacrosFromReference(
  foodItem: Pick<FoodItem, "storage_type" | "grams" | "quantity">,
  caloriesReference: string,
  proteinReference: string,
  fiberReference: string = "",
): { calories: string | null; protein: string | null; fiber: string | null } {
  const calRef = caloriesReference.trim();
  const proRef = proteinReference.trim();
  const fiberRef = fiberReference.trim();

  return {
    calories: calRef || null,
    protein: proRef || null,
    fiber: fiberRef || null,
  };
}
