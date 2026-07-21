import type { FoodItem } from "@/types/food";
import { parseQty, parsePartialQty, getFoodItemTotalGrams } from "@/lib/ingredientUtils";
import { parseISO } from "date-fns";

/**
 * Indique si un aliment du garde-manger peut porter un compteur d'ouverture (stock fini, non surgelé).
 */
export function isFoodItemCounterEligible(fi: FoodItem): boolean {
  return !fi.is_infinite && fi.storage_type !== "surgele" && !fi.no_counter;
}

/** True si l'aliment est entièrement scellé (aucune unité entamée). */
export function isFoodItemFullySealed(fi: FoodItem): boolean {
  const perUnit = parseQty(fi.grams);
  if (perUnit <= 0) return true;
  const partial = parsePartialQty(fi.grams);
  if (partial > 0 && partial < perUnit) return false;
  const q = fi.quantity ?? 1;
  const total = getFoodItemTotalGrams(fi);
  return Math.abs(total - q * perUnit) < 0.01;
}

/** Indique si l'aliment est suivi uniquement à l'unité (sans grammage renseigné). */
export function isCountOnlyFoodItem(fi: FoodItem): boolean {
  return parseQty(fi.grams) <= 0;
}

/**
 * Indique si la quantité unitaire a baissé par rapport à la référence enregistrée à l'ajout.
 * Sert aux aliments sans grammes (ex. Blanc de dinde #4 → #2 = paquet entamé).
 */
export function isFoodItemQuantityReduced(
  fi: FoodItem,
  baselineQuantity?: number | null,
): boolean {
  if (!isCountOnlyFoodItem(fi)) return false;
  if (baselineQuantity == null || baselineQuantity <= 0) return false;
  return (fi.quantity ?? 1) < baselineQuantity;
}

/**
 * Résout le poids total de référence (paquet d'origine) pour détecter une entame.
 * Priorité : baseline enregistrée à l'ajout → encodage « unité|reste » → défaut bibliothèque.
 * La bibliothèque n'est utilisée que sans baseline enregistrée, et seulement si le grammage
 * unitaire de la fiche est absent ou compatible (évite 2×400g scellés marqués entamés si
 * la biblio suggère 500g).
 */
export function resolveFoodItemBaselineTotalGrams(
  fi: FoodItem,
  recordedBaseline?: { totalGrams: number } | null,
  libraryUnitGrams?: number | null,
): number | null {
  const current = getFoodItemTotalGrams(fi);
  const candidates: number[] = [];
  if (recordedBaseline?.totalGrams && recordedBaseline.totalGrams > 0) {
    candidates.push(recordedBaseline.totalGrams);
  }
  const raw = fi.grams;
  if (raw?.includes("|")) {
    const unit = parseQty(raw);
    const q = fi.quantity ?? 1;
    if (unit > 0) candidates.push(unit * q);
  }
  if (!recordedBaseline?.totalGrams && libraryUnitGrams && libraryUnitGrams > 0) {
    const cardUnit = parseQty(fi.grams);
    if (cardUnit <= 0 || Math.abs(cardUnit - libraryUnitGrams) < 0.01) {
      candidates.push(libraryUnitGrams * (fi.quantity ?? 1));
    }
  }
  const aboveCurrent = candidates.filter((b) => b > current + 0.01);
  return aboveCurrent.length > 0 ? Math.max(...aboveCurrent) : null;
}

/**
 * Indique si le lot est physiquement entamé (reliquat, quantité unitaire réduite, ou
 * pot unique sans multi-quantité sous le poids d'origine).
 * Les multi-paquets encore scellés (ex. 2×400g ou 1×400g restant après conso d'un autre)
 * ne sont PAS considérés entamés même si le total est sous la baseline d'origine.
 */
export function isFoodItemPhysicallyOpened(
  fi: FoodItem,
  baselineTotalGrams?: number | null,
  baselineQuantity?: number | null,
): boolean {
  if (isCountOnlyFoodItem(fi)) {
    return isFoodItemQuantityReduced(fi, baselineQuantity);
  }
  if (!isFoodItemFullySealed(fi)) return true;
  // Pot unique (pas de #quantité) : poids total baissé sans encodage « unit|reste »
  if (
    baselineTotalGrams != null &&
    baselineTotalGrams > 0 &&
    fi.quantity == null
  ) {
    return getFoodItemTotalGrams(fi) < baselineTotalGrams - 0.01;
  }
  return false;
}

/**
 * Calcule le poids total « par défaut » d'une fiche aliment (quantité × grammage unitaire).
 * Sert de référence pour savoir si le lot a été entamé ou partiellement consommé.
 */
export function getFoodItemDefaultTotalGrams(fi: FoodItem): number {
  const perUnit = parseQty(fi.grams);
  if (perUnit <= 0) return 0;
  return (fi.quantity ?? 1) * perUnit;
}

/**
 * Indique si le stock actuel est en dessous du total par défaut (lot entamé ou partiellement consommé).
 */
export function isFoodItemBelowDefaultTotal(fi: FoodItem): boolean {
  const baseline = getFoodItemDefaultTotalGrams(fi);
  if (baseline <= 0) return false;
  return getFoodItemTotalGrams(fi) < baseline - 0.01;
}

/**
 * Indique si un aliment a un compteur d’ouverture déjà démarré et affichable sur une recette.
 * Les articles au grammage avec compteur auto désactivé (`no_counter`) sont exclus :
 * seuls les articles « à l’unité » sans grammes gardent un compteur manuel visible.
 */
export function hasActiveFoodItemCounter(fi: FoodItem, fixedNow?: Date): boolean {
  if (fi.is_infinite || fi.storage_type === "surgele" || !fi.counter_start_date?.trim()) return false;
  if (fi.no_counter && parseQty(fi.grams) > 0) return false;
  const nowMs = (fixedNow ?? new Date()).getTime();
  const startMs = parseISO(fi.counter_start_date).getTime();
  return !Number.isNaN(startMs) && startMs <= nowMs;
}

/**
 * Choisit la date de départ du badge compteur parmi plusieurs candidates.
 * Priorise les ouvertures passées réelles (stock / snapshot) aux dates « prog. » futures de la carte.
 */
export function pickEarliestPastCounterStart(
  ...candidates: (string | null | undefined)[]
): string | undefined {
  const nowMs = Date.now();
  const valid = candidates
    .filter((iso): iso is string => !!iso?.trim())
    .filter((iso) => !Number.isNaN(new Date(iso).getTime()));
  const past = valid.filter((iso) => new Date(iso).getTime() <= nowMs);
  if (past.length > 0) {
    return past.reduce((best, iso) => (new Date(iso).getTime() < new Date(best).getTime() ? iso : best));
  }
  return valid[0];
}

