/**
 * foodSortUtils — Logique de tri partagée pour les aliments.
 *
 * getSortedFoodItems() : trie les aliments selon le mode sélectionné :
 * - manual : ordre personnalisé via sort_order
 * - expiration : groupes prioritaires puis tri interne
 *   Groupe 0 : compteur d'ouverture VISIBLE et actif (jours ≥ 1 après résolution badge)
 *   Groupe 1 : ont une date de péremption (sans compteur visible)
 *   Groupe 2 : le reste (pas de date ni compteur visible)
 *   Un counter_start_date orphelin / masqué (badge Timer absent) ne compte PAS
 *   comme groupe 0 — même résolveur que l'UI (`resolveCounterStart`).
 *   Convention dates manquantes : groupe 2 → en fin en croissant, en début en décroissant.
 * - name : tri alphabétique
 * - calories / protein : tri numérique ascendant ou descendant
 */
import { FoodItem } from "@/hooks/useFoodItems";
import { FoodSortMode } from "@/hooks/useSortModes";
import { computeCounterDays } from "@/lib/ingredientUtils";
import { isCountOnlyFoodItem, isFoodItemFullySealed } from "@/lib/stockUtils";

/** Résout la date de début compteur « telle qu'affichée » (badge), ou null si masquée. */
export type FoodExpirationCounterResolver = (fi: FoodItem) => string | null;

/**
 * Normalise une date de péremption en clé YYYY-MM-DD comparable.
 * Sert à éviter les comparaisons lexicographiques faussées (datetime, espaces, invalides).
 * Retourne null si la date est absente ou non interprétable.
 */
export function normalizeExpirationSortKey(dateIso: string | null | undefined): string | null {
  if (!dateIso?.trim()) return null;
  const trimmed = dateIso.trim();
  const day = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  return null;
}

/**
 * Extrait un compteur d'ouverture exploitable pour le tri péremption (groupe 0).
 * Ignore les compteurs que l'UI masque (no_counter, infini, surgelé, paquet scellé)
 * afin d'éviter qu'un counter_start_date orphelin fausse le tri sans badge visible.
 * Si `resolveCounterStart` est fourni (écran Aliments), on s'aligne sur le badge Timer.
 */
export function getActiveCounterDaysForSort(
  fi: FoodItem,
  resolveCounterStart?: FoodExpirationCounterResolver,
): number | null {
  if (resolveCounterStart) {
    const start = resolveCounterStart(fi);
    if (!start) return null;
    const c = computeCounterDays(start);
    return c !== null && c >= 1 ? c : null;
  }

  // Heuristique autonome (planning / extras sans contexte badge) :
  // même famille de masquages que resolveFoodItemCounterStartForDisplay.
  if (fi.no_counter || fi.is_infinite || fi.storage_type === "surgele") return null;
  // Paquet avec grammage encore plein : compteur DB orphelin → pas de badge → ignorer au tri
  if (!isCountOnlyFoodItem(fi) && isFoodItemFullySealed(fi)) return null;

  if (!fi.counter_start_date) return null;
  const c = computeCounterDays(fi.counter_start_date);
  return c !== null && c >= 1 ? c : null;
}

/**
 * Parse la valeur calorique d'un aliment pour les tris numériques / départages.
 */
function parseFoodCalories(fi: FoodItem): number {
  if (!fi.calories) return 0;
  const m = fi.calories.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) || 0 : 0;
}

/**
 * Départage final commun : calories, puis ordre manuel, puis nom.
 */
function compareFoodItemsTieBreak(a: FoodItem, b: FoodItem, asc: boolean): number {
  const cA = parseFoodCalories(a);
  const cB = parseFoodCalories(b);
  if (cA !== cB) return asc ? cA - cB : cB - cA;

  const orderCmp = asc ? a.sort_order - b.sort_order : b.sort_order - a.sort_order;
  if (orderCmp !== 0) return orderCmp;

  return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
}

/**
 * Compare deux aliments en mode « Péremption ».
 * Groupes : 0 = compteur visible actif, 1 = date seule, 2 = reste.
 * Au sein du groupe 0 : jours de compteur décroissants en croissant (ouvert plus longtemps
 * d'abord — priorité UX « à surveiller »), puis date de péremption croissante.
 * Au sein du groupe 1 : dates chronologiques (plus proche d'abord en croissant).
 */
export function compareFoodItemsByExpiration(
  a: FoodItem,
  b: FoodItem,
  asc: boolean,
  resolveCounterStart?: FoodExpirationCounterResolver,
): number {
  const ac = getActiveCounterDaysForSort(a, resolveCounterStart);
  const bc = getActiveCounterDaysForSort(b, resolveCounterStart);
  const aKey = normalizeExpirationSortKey(a.expiration_date);
  const bKey = normalizeExpirationSortKey(b.expiration_date);

  // Groupes : 0 = compteur visible ≥ 1j, 1 = date de péremption, 2 = autre
  const aG = ac !== null ? 0 : aKey !== null ? 1 : 2;
  const bG = bc !== null ? 0 : bKey !== null ? 1 : 2;

  if (aG !== bG) return asc ? aG - bG : bG - aG;

  if (aG === 0) {
    // Les deux ont un compteur visible actif : plus de jours d'abord en croissant
    if (ac !== bc) return asc ? bc! - ac! : ac! - bc!;
    // Même jour de compteur : date de péremption comme sous-priorité
    if (aKey !== bKey) {
      if (aKey === null) return asc ? 1 : -1;
      if (bKey === null) return asc ? -1 : 1;
      const cmp = aKey.localeCompare(bKey);
      return asc ? cmp : -cmp;
    }
  } else if (aG === 1) {
    // Dates seules : chronologique (croissant = plus proche d'abord)
    const cmp = aKey!.localeCompare(bKey!);
    if (cmp !== 0) return asc ? cmp : -cmp;
  }

  return compareFoodItemsTieBreak(a, b, asc);
}

/**
 * Trie et filtre une liste d'aliments selon le mode de tri et la recherche.
 * `resolveCounterStart` (optionnel) aligne le groupe compteur sur le badge UI.
 */
export const getSortedFoodItems = (
  items: FoodItem[],
  mode: FoodSortMode,
  asc: boolean,
  searchQuery: string = "",
  resolveCounterStart?: FoodExpirationCounterResolver,
): FoodItem[] => {
  const normalizeSearch = (text: string) =>
    text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/g, "");

  const filterBySearch = (itemsList: FoodItem[]): FoodItem[] => {
    if (!searchQuery.trim()) return itemsList;
    const q = normalizeSearch(searchQuery);
    return itemsList.filter((item) => normalizeSearch(item.name).includes(q));
  };

  if (mode === "manual") return filterBySearch([...items].sort((a, b) => a.sort_order - b.sort_order));

  let sorted = [...items];

  if (mode === "expiration") {
    sorted.sort((a, b) => compareFoodItemsByExpiration(a, b, asc, resolveCounterStart));
  } else if (mode === "name") {
    sorted.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
      return asc ? cmp : -cmp;
    });
  } else if (mode === "calories") {
    sorted.sort((a, b) => {
      const diff = parseFoodCalories(a) - parseFoodCalories(b);
      return asc ? diff : -diff;
    });
  } else if (mode === "protein") {
    sorted.sort((a, b) => {
      const parsePro = (fi: FoodItem) =>
        parseFloat((fi.protein || "0").replace(",", ".").replace(/[^0-9.]/g, "")) || 0;
      const diff = parsePro(a) - parsePro(b);
      return asc ? diff : -diff;
    });
  }

  return filterBySearch(sorted);
};
