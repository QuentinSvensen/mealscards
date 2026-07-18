import type { FoodItem } from "@/hooks/useFoodItems";
import { computeCounterDays } from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

/** Formate une date d'expiration en label court (ex: "15 mars") */
export function formatExpirationLabel(dateStr: string | null): string | null {
  if (!dateStr) return null;
  try { return format(parseISO(dateStr), 'd MMM', { locale: fr }); } catch { return null; }
}

/**
 * Compare deux items pour le tri par expiration+compteur.
 * Groupes de priorité : 0=compteur actif, 1=sans date ni compteur, 2=avec date
 */
export function compareExpirationWithCounter(
  aDate: string | null, bDate: string | null,
  aCounter: number | null, bCounter: number | null
): number {
  const aEffective = aCounter !== null && aCounter > 0;
  const bEffective = bCounter !== null && bCounter > 0;

  const aGroup = aEffective ? 0 : (!aDate && (aCounter === null || aCounter === 0) ? 1 : 2);
  const bGroup = bEffective ? 0 : (!bDate && (bCounter === null || bCounter === 0) ? 1 : 2);

  if (aGroup !== bGroup) return aGroup - bGroup;
  if (aGroup === 0) {
    if (aCounter !== bCounter) return bCounter! - aCounter!;
    if (aDate && bDate) return aDate.localeCompare(bDate);
    if (aDate) return -1;
    if (bDate) return 1;
    return 0;
  }
  if (aGroup === 2) return aDate!.localeCompare(bDate!);
  return 0;
}

/**
 * Tri de priorité pour la déduction de stock : les items déjà ouverts (avec compteur)
 * sont consommés en premier, puis ceux avec la date de péremption la plus proche.
 */
export function sortStockDeductionPriority(a: FoodItem, b: FoodItem): number {
  const aHas = !!a.counter_start_date;
  const bHas = !!b.counter_start_date;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  if (aHas && bHas) {
    const aD = computeCounterDays(a.counter_start_date!) ?? 0;
    const bD = computeCounterDays(b.counter_start_date!) ?? 0;
    if (aD !== bD) return bD - aD;
  }
  if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
  if (a.expiration_date) return -1;
  if (b.expiration_date) return 1;
  return 0;
}

