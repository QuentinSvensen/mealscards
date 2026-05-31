import type { FoodItem } from "@/hooks/useFoodItems";

/** Clés internes (non persistées en base) pour la portion retirée lors d'un déplacement vers Possible. */
export const PORTION_GRAMS_KEY = "_portionGrams";
export const PORTION_QUANTITY_KEY = "_portionQuantity";

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
export function attachPortionDeduction(
  fi: FoodItem,
  portion: Partial<PortionDeduction>
): FoodItem {
  const grams = portion.grams ?? 0;
  const quantity = portion.quantity ?? 0;
  return {
    ...fi,
    [PORTION_GRAMS_KEY]: grams,
    [PORTION_QUANTITY_KEY]: quantity,
  } as FoodItem;
}

/**
 * Retire les métadonnées de portion avant un upsert Supabase (ancien mode restauration).
 */
export function stripPortionDeductionMeta(fi: FoodItem): FoodItem {
  const raw = { ...fi } as Record<string, unknown>;
  delete raw[PORTION_GRAMS_KEY];
  delete raw[PORTION_QUANTITY_KEY];
  return raw as FoodItem;
}
