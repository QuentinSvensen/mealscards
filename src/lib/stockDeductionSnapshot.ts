import type { FoodItem } from "@/hooks/useFoodItems";
import { strictNameMatch } from "@/lib/ingredientUtils";

/** Clés internes (non persistées en base) pour la portion retirée lors d'un déplacement vers Possible. */
export const PORTION_GRAMS_KEY = "_portionGrams";
export const PORTION_QUANTITY_KEY = "_portionQuantity";
/** Indique que la fiche source était un « repas matin » (préférence utilisateur). */
export const PORTION_MORNING_MEAL_KEY = "_wasMorningMeal";

export type PortionDeduction = {
  grams: number;
  quantity: number;
};

/**
 * Indique si le snapshot encode une restauration par portion (delta) plutôt qu'un état complet.
 */
export function hasPortionDeductionMeta(snapshot: FoodItem): boolean {
  return (
    PORTION_GRAMS_KEY in (snapshot as Record<string, unknown>) ||
    PORTION_QUANTITY_KEY in (snapshot as Record<string, unknown>)
  );
}

/**
 * Lit les grammes et unités à rendre au stock pour une carte Possible donnée.
 */
export function getPortionDeduction(snapshot: FoodItem): PortionDeduction {
  const raw = snapshot as Record<string, unknown>;
  const grams = Number(raw[PORTION_GRAMS_KEY] ?? 0);
  const quantity = Number(raw[PORTION_QUANTITY_KEY] ?? 0);
  return {
    grams: Number.isFinite(grams) && grams > 0 ? grams : 0,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0,
  };
}

/**
 * Attache au snapshot la portion réellement déduite (une carte = un delta indépendant).
 */
export function wasMorningMealSnapshot(snapshot: FoodItem): boolean {
  return (snapshot as Record<string, unknown>)[PORTION_MORNING_MEAL_KEY] === true;
}

/**
 * Réattribue la préférence « repas matin » après recréation d'une fiche aliment
 * (ex. retour Possible → Au choix quand l'ancienne ligne a été supprimée).
 */
export function remapMorningMealPreferenceIds(
  snapshots: FoodItem[],
  currentFoodItems: FoodItem[],
  morningMealIds: string[],
): string[] {
  let nextIds = [...morningMealIds];
  for (const snap of snapshots) {
    const wasMorning = wasMorningMealSnapshot(snap) || morningMealIds.includes(snap.id);
    if (!wasMorning) continue;
    const oldId = snap.id;
    nextIds = nextIds.filter((id) => id !== oldId);
    const restored =
      currentFoodItems.find((fi) => fi.id === oldId) ??
      currentFoodItems.find((fi) => fi.is_meal && strictNameMatch(fi.name, snap.name));
    if (restored && !nextIds.includes(restored.id)) {
      nextIds.push(restored.id);
    }
  }
  return nextIds;
}

export function attachPortionDeduction(
  fi: FoodItem,
  portion: Partial<PortionDeduction>,
  meta?: { wasMorningMeal?: boolean },
): FoodItem {
  const grams = portion.grams ?? 0;
  const quantity = portion.quantity ?? 0;
  const out: Record<string, unknown> = {
    ...fi,
    [PORTION_GRAMS_KEY]: grams,
    [PORTION_QUANTITY_KEY]: quantity,
  };
  if (meta?.wasMorningMeal) {
    out[PORTION_MORNING_MEAL_KEY] = true;
  }
  return out as FoodItem;
}

/**
 * Retire les métadonnées de portion avant un upsert Supabase (ancien mode restauration).
 */
export function stripPortionDeductionMeta(fi: FoodItem): FoodItem {
  const raw = { ...fi } as Record<string, unknown>;
  delete raw[PORTION_GRAMS_KEY];
  delete raw[PORTION_QUANTITY_KEY];
  delete raw[PORTION_MORNING_MEAL_KEY];
  return raw as FoodItem;
}

/**
 * Fusionne les snapshots persistés et l'état local (le local écrase les clés communes).
 * Évite de perdre des snapshots au retour Possible → Au choix.
 */
export function mergeDeductionSnapshotMaps(
  persisted: Record<string, FoodItem[]>,
  local: Record<string, FoodItem[]>,
): Record<string, FoodItem[]> {
  return { ...persisted, ...local };
}
