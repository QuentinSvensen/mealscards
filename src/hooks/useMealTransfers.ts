/**
 * Hook centralisé pour la logique de transfert de stock entre les listes de repas.
 * 
 * Gère :
 * - Déduction des ingrédients du stock lors du déplacement vers "Possible"
 * - Restauration du stock lors du retour d'un repas
 * - Ajustement delta lors de la modification des ingrédients d'une carte "Possible"
 * - Déduction par correspondance de nom (repas sans ingrédients)
 * - Synchronisation des compteurs d'ouverture avec le planning
 * 
 * Chaque appel Supabase est wrappé dans safeMutate pour gérer les erreurs réseau.
 */

import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { format, parseISO } from "date-fns";
import {
  normalizeForMatch, normalizeKey, strictNameMatch,
  parseQty, formatNumeric, encodeStoredGrams,
  getFoodItemTotalGrams, parseIngredientGroups, parseIngredientLine, parsePartialQty,
  extractIngredientMacros, extractMetrics, parseIngredientLineRaw,
  type ParsedIngredient,
} from "@/lib/ingredientUtils";
import {
  buildStockMap, findStockKey, pickBestAlternative,
  sortStockDeductionPriority,
} from "@/lib/stockUtils";

/** Table de correspondance jour français → index (0=Lun) */
const DAY_KEY_TO_INDEX: Record<string, number> = {
  lundi: 0, mardi: 1, mercredi: 2, jeudi: 3, vendredi: 4, samedi: 5, dimanche: 6,
};

/** Aligné sur getTargetDate (ingredientUtils) : matin 8h, midi 12h, soir 19h */
function setMealTimeHours(d: Date, mealTime: string | null) {
  const low = (mealTime || "").trim().toLowerCase();
  if (low === "soir") d.setHours(19, 0, 0, 0);
  else if (low === "matin") d.setHours(8, 0, 0, 0);
  else if (low === "midi") d.setHours(12, 0, 0, 0);
  // Pas de défaut « midi » si absent : évite une fausse heure (12h) quand le créneau n’est pas encore choisi
}

/**
 * Calcule la date ISO du compteur d'ouverture pour un repas planifié.
 * Matin = 8h, midi = 12h, soir = 19h. Accepte les jours nommés ("lundi") ou les dates ISO.
 */
/**
 * Retourne les noms d’ingrédients (déjà normalisés comme dans `ParsedIngredient.name`) à comparer au stock
 * pour une ligne de recette qui peut contenir des choix « A ou B ou C », souvent entre parenthèses.
 * Sans cela, `updateFoodItemCountersForPlanning` ne trouve jamais le « Jambon blanc » d’un croque, etc.
 */
function expandOrGroupIngredientNames(item: ParsedIngredient): string[] {
  const out = new Set<string>();
  const push = (n: string | null | undefined) => {
    const t = (n ?? "").trim();
    if (t) out.add(t);
  };
  push(item.name);
  const raw = item.name.replace(/^\(+/, "").replace(/\)+$/, "").trim();
  if (/\bou\b/i.test(raw)) {
    for (const chunk of raw.split(/\s+ou\s+/i)) {
      const parsed = parseIngredientLine(chunk.trim());
      if (parsed.name) push(parsed.name);
    }
  }
  return [...out];
}

/**
 * Construit une chaîne d'ingrédients basée uniquement sur les alternatives réellement consommées.
 * Sert à afficher sur la carte "Possible" uniquement les choix "ou" effectivement déduits du stock.
 * Reprend les suffixes {cal} / [pro] depuis la recette maître pour l’éditeur et les calculs.
 * Les quantités unitaires utilisent « 4 Pain » (pas « x4 Pain ») pour rester parsables en colonnes.
 */
function buildConsumedIngredientsOverride(pickedAlternatives: ParsedIngredient[][], mealIngredients: string): string | null {
  /** Remet une majuscule initiale pour un affichage propre côté carte Possible. */
  const withLeadingUppercase = (value: string): string => {
    const trimmed = (value || "").trim();
    if (!trimmed) return "";
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  };

  const macroMap = extractIngredientMacros(mealIngredients);

  /** Associe chaque nom normalisé au nom original de la recette pour préserver apostrophes et accents. */
  const buildOriginalDisplayNameMap = (ingredients: string): Map<string, string> => {
    const out = new Map<string, string>();
    ingredients
      .split(/(?:\n|,(?!\d))/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((group) => {
        group
          .split(/\|/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((alt) => {
            alt
              .split(/\+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .forEach((rawItem) => {
                const cleanItem = rawItem.startsWith("?") ? rawItem.slice(1).trim() : rawItem;
                const { text: withoutMetrics } = extractMetrics(cleanItem);
                const parsed = parseIngredientLineRaw(withoutMetrics);
                if (parsed.rawName?.trim()) out.set(normalizeKey(parsed.name), withLeadingUppercase(parsed.rawName));
              });
          });
      });
    return out;
  };
  const originalDisplayNameByKey = buildOriginalDisplayNameMap(mealIngredients);

  /** Réinjecte les macros par nom (clé normalisée), comme serializeIngredients. */
  const macroSuffixForDisplayName = (displayName: string): string => {
    const m = macroMap.get(normalizeKey(displayName));
    if (!m) return "";
    let s = "";
    if (m.cal) s += `{${m.cal}}`;
    if (m.pro) s += ` [${m.pro}]`;
    return s;
  };

  const lines: string[] = [];
  for (const altBundle of pickedAlternatives) {
    const parts = altBundle
      .filter((item) => !item.optional)
      .map((item) => {
        const displayName = originalDisplayNameByKey.get(normalizeKey(item.name)) ?? withLeadingUppercase(item.name || "");
        if (!displayName) return "";
        const macros = macroSuffixForDisplayName(displayName);
        if (item.qty > 0) return `${formatNumeric(item.qty)}g ${displayName}${macros}`.trim();
        if (item.count > 0) return `${formatNumeric(item.count)} ${displayName}${macros}`.trim();
        return `${displayName}${macros}`;
      })
      .filter(Boolean);
    if (parts.length > 0) lines.push(parts.join(" + "));
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function computePlannedCounterDate(dayOfWeek: string, mealTime: string | null): string {
  // Si c'est déjà une date ISO (YYYY-MM-DD), l'utiliser directement
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayOfWeek)) {
    const d = parseISO(dayOfWeek);
    setMealTimeHours(d, mealTime);
    return d.toISOString();
  }

  const today = new Date();
  const todayDow = today.getDay(); // 0=Dim
  const todayIdx = todayDow === 0 ? 6 : todayDow - 1; // 0=Lun
  const targetIdx = DAY_KEY_TO_INDEX[dayOfWeek] ?? 0;
  const diff = targetIdx - todayIdx;

  const d = new Date(today);
  d.setDate(d.getDate() + diff);
  setMealTimeHours(d, mealTime);
  return d.toISOString();
}

/** True si l'aliment est entièrement scellé (aucune unité entamée). */
function isFoodFullySealed(fi: FoodItem): boolean {
  const perUnit = parseQty(fi.grams);
  if (perUnit <= 0) return true;
  const partial = parsePartialQty(fi.grams);
  if (partial > 0 && partial < perUnit) return false;
  const q = fi.quantity ?? 1;
  const total = getFoodItemTotalGrams(fi);
  return Math.abs(total - q * perUnit) < 0.01;
}

/**
 * Hook principal de transfert de stock.
 * Fournit toutes les opérations de mutation du stock liées aux repas.
 */
export function useMealTransfers(foodItems: FoodItem[]) {
  const qc = useQueryClient();

  /**
   * Retourne la version la plus récente du stock depuis le cache React Query.
   * Sert à éviter d'utiliser une fermeture stale de `foodItems` pendant les déductions.
   */
  const getLiveFoodItems = (): FoodItem[] => {
    const cached = qc.getQueryData<FoodItem[]>(["food_items"]);
    if (Array.isArray(cached)) return cached;
    return foodItems;
  };

  /** Invalide puis re-fetch le stock pour synchroniser immédiatement l'UI. */
  const invalidateStock = async () => {
    await qc.invalidateQueries({ queryKey: ["food_items"] });
    await qc.refetchQueries({ queryKey: ["food_items"], type: "active" });
  };

  // Signale à la subscription realtime globale qu'un update optimiste vient d'être appliqué :
  // elle doit ignorer son invalidation automatique pendant plusieurs secondes pour laisser la
  // réplique Supabase rattraper son retard et ne pas écraser notre cache local.
  const suppressStockRealtimeBriefly = () => {
    try {
      (window as any).__suppressStockRealtimeUntil = Date.now() + 6000;
    } catch {
      // no-op
    }
  };

  /** Exécute une mutation Supabase avec gestion d'erreur centralisée */
  const safeMutate = async (label: string, fn: () => any): Promise<any> => {
    try {
      const res = await fn();
      if (res && res.error) throw new Error(res.error.message);
      if (Array.isArray(res)) {
        const err = res.find(r => r?.error);
        if (err) throw new Error(err.error.message);
      }
      return res;
    } catch (err: any) {
      console.error(`${label} Error:`, err);
      toast({ title: "Erreur réseau", description: `${label} : ${err?.message ?? "erreur inconnue"}`, variant: "destructive" });
      return null;
    }
  };

  // ─── Helpers internes pour la gestion des compteurs ──────────────────────

  /**
   * Détermine si un aliment doit recevoir un compteur d'ouverture.
   * Conditions : stock fini, non surgelé, pas marqué no_counter.
   */
  const shouldStartCounter = (fi: FoodItem) =>
    !fi.is_infinite && fi.storage_type !== "surgele" && !fi.no_counter;

  /**
   * Vérifie si le compteur doit être mis à jour (pas déjà en cours ou forcé).
   * Protège les compteurs manuels existants qui sont déjà dans le passé.
   */
  const needsCounterUpdate = (fi: FoodItem, counterToSet: string, forcedCounterDate?: string) => {
    if (!shouldStartCounter(fi)) return false;
    if (!fi.counter_start_date) return true;
    const isFuture = new Date(fi.counter_start_date) > new Date(counterToSet);
    return isFuture || !!forcedCounterDate;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // DÉDUCTION DU STOCK (déplacement vers "Possible")
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Déduit les ingrédients du stock lors du déplacement d'un repas vers "Possible".
   * 
   * Pour chaque ingrédient requis :
   * 1. Choisit la meilleure alternative en stock
   * 2. Déduit la quantité nécessaire (grammes ou unités)
   * 3. Démarre un compteur d'ouverture si applicable
   * 4. Sauvegarde un snapshot de l'état avant déduction (pour restauration)
   * 
   * @returns snapshots (état avant déduction), consumedIds (items supprimés), oldestCounter (compteur le plus ancien)
   */
  const deductIngredientsFromStock = async (meal: Meal, forcedCounterDate?: string): Promise<{ snapshots: FoodItem[]; consumedIds: string[]; oldestCounter: string | null; consumedIngredients: string | null }> => {
    if (!meal.ingredients?.trim()) return { snapshots: [], consumedIds: [], oldestCounter: null, consumedIngredients: null };
    const liveFoodItems = getLiveFoodItems();
    const groups = parseIngredientGroups(meal.ingredients);
    const pickedAlternatives: ParsedIngredient[][] = [];
    const stockMap = buildStockMap(liveFoodItems);
    const snapshotsById = new Map<string, FoodItem>();
    const updatesById = new Map<string, { id: string; grams?: string | null; quantity?: number | null; delete?: boolean; counter_start_date?: string | null }>();
    const rememberSnapshot = (fi: FoodItem) => { if (!snapshotsById.has(fi.id)) snapshotsById.set(fi.id, { ...fi }); };
    let oldestCounter: string | null = null;
    /** Date ISO d’ouverture réellement appliquée sur le stock pendant cette déduction (ex. « maintenant »). */
    let openedAtDeduction: string | null = null;

    /**
     * Enregistre la date utilisée pour démarrer ou avancer le compteur lors de cette déduction.
     * Sert quand aucun lot n’avait encore un compteur « passé » à réutiliser (ex. lot seulement programmé jeudi).
     */
    const registerDeductionOpenDate = (iso: string) => {
      if (!openedAtDeduction || new Date(iso) < new Date(openedAtDeduction)) openedAtDeduction = iso;
    };

    /**
     * Collecte le compteur le plus ancien parmi les items déjà ouverts.
     * Ne prend en compte que les compteurs déjà actifs (pas dans le futur).
     * `referenceDate` doit être la date effective (souvent « maintenant »), pas `forcedCounter` seul.
     */
    const trackOldestCounter = (fi: FoodItem, referenceDate: string) => {
      if (fi.counter_start_date && new Date(fi.counter_start_date) <= new Date(referenceDate)) {
        if (!oldestCounter || new Date(fi.counter_start_date) < new Date(oldestCounter)) {
          oldestCounter = fi.counter_start_date;
        }
      }
    };

    for (const group of groups) {
      // Ignorer les groupes entièrement optionnels
      if (group.every(alt => alt.every(item => item.optional))) continue;
      const altBundle = pickBestAlternative(group, stockMap);
      if (!altBundle) continue;
      pickedAlternatives.push(altBundle);

      for (const alt of altBundle) {
        if (alt.optional) continue;
        const { qty: neededGrams, count: neededCount, name } = alt;
        const key = findStockKey(stockMap, name);
        if (!key) continue;
        const stockInfo = stockMap.get(key);
        if (!stockInfo || stockInfo.infinite) continue;

        // Trier pour consommer en priorité les items déjà ouverts
        const matchingItems = liveFoodItems
          .filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite)
          .sort(sortStockDeductionPriority);

        if (neededCount > 0) {
          // --- Déduction par comptage (ex: "2 oeufs") ---
          let toDeduct = neededCount;
          for (const fi of matchingItems) {
            if (toDeduct <= 0) break;
            const fiCount = fi.quantity ?? 1;
            const deduct = Math.min(fiCount, toDeduct);
            const remaining = fiCount - deduct;
            toDeduct -= deduct;
            rememberSnapshot(fi);

            const counterToSet = forcedCounterDate;
            const effectiveCounterDate = counterToSet || new Date().toISOString();
            trackOldestCounter(fi, effectiveCounterDate);

            // Stock épuisé : toujours supprimer la ligne (même si compteur planifié).
            // Sinon une carte 0g reste visible ; le "programmé demain" vit sur la carte repas, pas sur un aliment fantôme.
            if (remaining <= 0) {
              updatesById.set(fi.id, { id: fi.id, delete: true });
            } else {
              const bumpCounter = needsCounterUpdate(fi, effectiveCounterDate, forcedCounterDate);
              const clearCtr = !bumpCounter && fi.counter_start_date && isFoodFullySealed({ ...fi, quantity: remaining } as FoodItem);
              if (bumpCounter) registerDeductionOpenDate(effectiveCounterDate);
              updatesById.set(fi.id, {
                id: fi.id,
                quantity: Math.ceil(remaining),
                ...(bumpCounter ? { counter_start_date: effectiveCounterDate } : {}),
                ...(clearCtr ? { counter_start_date: null } : {}),
              });
            }
          }
        } else if (neededGrams > 0) {
          // --- Déduction par grammes (ex: "150g poulet") ---
          let toDeduct = neededGrams;
          for (const fi of matchingItems) {
            if (toDeduct <= 0) break;
            const perUnit = parseQty(fi.grams);
            if (perUnit <= 0) continue;
            const totalAvailable = getFoodItemTotalGrams(fi);
            const deduct = Math.min(totalAvailable, toDeduct);
            const remaining = totalAvailable - deduct;
            toDeduct -= deduct;
            rememberSnapshot(fi);

            const counterToSet = forcedCounterDate;
            const effectiveCounterDate = counterToSet || new Date().toISOString();
            trackOldestCounter(fi, effectiveCounterDate);

            if (remaining <= 0) {
              updatesById.set(fi.id, { id: fi.id, delete: true });
              continue;
            }

            if (fi.quantity && fi.quantity >= 1) {
              // Item multi-unités : recalculer unités complètes + reliquat
              const fullUnits = Math.floor(remaining / perUnit);
              const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              if (remainder > 0) {
                // Ouverture d'une nouvelle unité (reliquat > 0)
                const partialBefore = parsePartialQty(fi.grams);
                const hadOpenPartial = partialBefore > 0 && partialBefore < perUnit;
                const consumedPastFirstPartial = hadOpenPartial && deduct > partialBefore;
                const restartForNewPack =
                  consumedPastFirstPartial && shouldStartCounter(fi);
                const bumpCounter =
                  restartForNewPack || needsCounterUpdate(fi, effectiveCounterDate, forcedCounterDate);
                const counterUpdate = bumpCounter ? { counter_start_date: effectiveCounterDate } : {};
                if (bumpCounter) registerDeductionOpenDate(effectiveCounterDate);
                updatesById.set(fi.id, {
                  id: fi.id,
                  quantity: Math.max(1, fullUnits + 1),
                  grams: encodeStoredGrams(perUnit, remainder),
                  ...counterUpdate,
                });
              } else if (fullUnits > 0) {
                // Unités complètes restantes → pas d'ouverture, reset du compteur
                updatesById.set(fi.id, { id: fi.id, quantity: fullUnits, grams: formatNumeric(perUnit), ...(fi.counter_start_date ? { counter_start_date: null } : {}) });
              } else {
                updatesById.set(fi.id, { id: fi.id, delete: true });
              }
            } else {
              // Item simple (sans multi-unités)
              const isNewUnit = remaining > 0 && remaining < perUnit;
              const bumpCounter =
                needsCounterUpdate(fi, effectiveCounterDate, forcedCounterDate) && isNewUnit;
              if (bumpCounter) registerDeductionOpenDate(effectiveCounterDate);
              updatesById.set(fi.id, {
                id: fi.id,
                grams: formatNumeric(remaining),
                ...(bumpCounter ? { counter_start_date: effectiveCounterDate } : {}),
              });
            }
          }
        }
      }
    }

    // Désactiver la subscription realtime AVANT les writes : sinon l'événement Supabase peut
    // déclencher un refetch avec une version répliquée en retard qui annule notre update.
    suppressStockRealtimeBriefly();

    // Identifiants des lignes concernées (avant exécution des writes).
    const updatedIds = Array.from(updatesById.values()).map((u) => u.id);
    const deletedIds = new Set(
      Array.from(updatesById.values()).filter((u) => u.delete).map((u) => u.id),
    );

    // Applique les UPDATE / DELETE en parallèle.
    // Chaque UPDATE chaîne `.select("*").single()` : on récupère la ligne renvoyée PAR LE PRIMAIRE
    // après écriture (fortement cohérente). Ça évite qu'une relecture séparée tape une réplique en
    // retard et réaffiche un stock périmé (bug « badge xN reste à x7 après déplacement »).
    const results = await safeMutate("Déduction du stock", () =>
      Promise.all(Array.from(updatesById.values()).map((u) =>
        u.delete
          ? supabase.from("food_items").delete().eq("id", u.id)
          : supabase.from("food_items").update({
            ...(u.grams !== undefined ? { grams: u.grams } : {}),
            ...(u.quantity !== undefined ? { quantity: u.quantity } : {}),
            ...(u.counter_start_date !== undefined ? { counter_start_date: u.counter_start_date } : {}),
          } as any).eq("id", u.id).select("*").single()
      ))
    );

    // Construit un index id → ligne authoritative renvoyée par l'UPDATE (avant DELETE).
    const authoritativeById = new Map<string, FoodItem>();
    if (Array.isArray(results)) {
      for (const res of results) {
        if (!res || res.error) continue;
        const row = (res as { data?: FoodItem | null }).data;
        if (row && row.id && !deletedIds.has(row.id)) {
          authoritativeById.set(row.id, row as FoodItem);
        }
      }
    }

    // Mise à jour synchronisée du cache "food_items" :
    // 1) Optimistic update (instantané) pour que l'UI recalcule tout de suite (badge xN, etc.).
    // 2) Remplacement par les lignes authoritatives renvoyées par l'UPDATE lui-même.
    await qc.cancelQueries({ queryKey: ["food_items"] });
    const applyOptimistic = (old: FoodItem[] | undefined): FoodItem[] | undefined => {
      if (!Array.isArray(old)) return old;
      const next: FoodItem[] = [];
      for (const fi of old) {
        const u = updatesById.get(fi.id);
        if (!u) { next.push(fi); continue; }
        if (u.delete) continue;
        // Privilégier la ligne authoritative si disponible, sinon appliquer nos deltas.
        const auth = authoritativeById.get(fi.id);
        if (auth) { next.push(auth); continue; }
        next.push({
          ...fi,
          ...(u.grams !== undefined ? { grams: u.grams } : {}),
          ...(u.quantity !== undefined ? { quantity: u.quantity as number | null } : {}),
          ...(u.counter_start_date !== undefined ? { counter_start_date: u.counter_start_date } : {}),
        } as FoodItem);
      }
      return next;
    };
    qc.setQueryData<FoodItem[]>(["food_items"], applyOptimistic);
    suppressStockRealtimeBriefly();
    const consumedIngredients = buildConsumedIngredientsOverride(pickedAlternatives, meal.ingredients);
    return {
      snapshots: Array.from(snapshotsById.values()),
      consumedIds: Array.from(updatesById.values()).filter(u => u.delete).map(u => u.id),
      oldestCounter: oldestCounter || openedAtDeduction,
      consumedIngredients,
    };
  };

  // ═════════════════════════════════════════════════════════════════════════
  // RESTAURATION DU STOCK (retour d'un repas)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Restaure les ingrédients dans le stock.
   * 
   * Deux modes :
   * 1. Avec snapshots → upsert exact de l'état sauvegardé (préféré, précis)
   * 2. Sans snapshots → estimation en ajoutant les quantités de la recette
   */
  const restoreIngredientsToStock = async (meal: Meal, snapshots?: FoodItem[]) => {
    // Mode 1 : restauration depuis les snapshots (état exact)
    if (snapshots && snapshots.length > 0) {
      await safeMutate("Restauration du stock", () =>
        Promise.all(snapshots.map((fi) => {
          const sealed = isFoodFullySealed(fi);
          return (supabase as any).from("food_items").upsert({
            id: fi.id, name: fi.name, grams: fi.grams, calories: fi.calories,
            protein: fi.protein, is_indivisible: fi.is_indivisible,
            expiration_date: fi.expiration_date,
            counter_start_date: sealed ? null : fi.counter_start_date,
            no_counter: fi.no_counter,
            sort_order: fi.sort_order, created_at: fi.created_at, is_meal: fi.is_meal,
            is_infinite: fi.is_infinite, is_dry: fi.is_dry, storage_type: fi.storage_type,
            quantity: fi.quantity, food_type: fi.food_type,
          });
        }))
      );
      await invalidateStock();
      return;
    }

    // Mode 2 : restauration estimée depuis la recette
    if (!meal.ingredients?.trim()) return;

    // IMPORTANT : Récupérer les données fraîches de Supabase pour éviter les erreurs dues au cache React périmé
    const { data: freshItems } = await supabase.from("food_items").select("*").order("sort_order", { ascending: true });
    const currentFoodItems: FoodItem[] = (freshItems ?? []).map((d: any) => ({
      ...d,
      is_meal: d.is_meal ?? false,
      is_infinite: d.is_infinite ?? false,
      is_dry: d.is_dry ?? false,
      is_indivisible: d.is_indivisible ?? false,
      no_counter: d.no_counter ?? false,
      storage_type: d.storage_type ?? (d.is_dry ? "sec" : "frigo"),
      quantity: d.quantity ?? null,
      food_type: d.food_type ?? null,
      protein: d.protein ?? null,
    })) as FoodItem[];

    const groups = parseIngredientGroups(meal.ingredients);
    for (const group of groups) {
      // Pour la restauration on prend le premier bundle (celui qui a été déduit à l'origine),
      // PAS pickBestAlternative qui choisirait en fonction du stock actuel (post-déduction).
      const altBundle = group[0];
      if (!altBundle) continue;

      for (const alt of altBundle) {
        const { qty: neededGrams, count: neededCount, name } = alt;
        if (neededGrams <= 0 && neededCount <= 0) continue;
        const hasInfiniteMatch = currentFoodItems.some((fi) => strictNameMatch(fi.name, name) && fi.is_infinite);
        if (hasInfiniteMatch) continue;
        const matchingItems = currentFoodItems.filter((fi) => strictNameMatch(fi.name, name) && !fi.is_infinite).sort(sortStockDeductionPriority);

        if (matchingItems.length === 0) {
          // Aliment entièrement consommé et supprimé du stock → le recréer à partir de la
          // bibliothèque ou en créant un minimum viable pour que le stock soit cohérent.
          const templateFi = foodItems.find(fi => strictNameMatch(fi.name, name) && !fi.is_infinite);
          const storageFallback = templateFi?.storage_type ?? 'frigo';
          const unitGrams = templateFi ? parseQty(templateFi.grams) : 0;

          if (neededCount > 0) {
            await safeMutate("Restauration stock (recréation count)", () =>
              (supabase as any).from("food_items").insert({
                name: templateFi?.name ?? name,
                quantity: neededCount,
                grams: templateFi?.grams ?? null,
                calories: templateFi?.calories ?? null,
                protein: templateFi?.protein ?? null,
                is_indivisible: templateFi?.is_indivisible ?? false,
                expiration_date: templateFi?.expiration_date ?? null,
                counter_start_date: null,
                no_counter: templateFi?.no_counter ?? false,
                is_meal: templateFi?.is_meal ?? false,
                is_infinite: false,
                is_dry: templateFi?.is_dry ?? false,
                storage_type: storageFallback,
                food_type: templateFi?.food_type ?? null,
              })
            );
          } else if (neededGrams > 0 && unitGrams > 0) {
            const fullUnits = Math.floor(neededGrams / unitGrams);
            const rem = Math.round((neededGrams - fullUnits * unitGrams) * 10) / 10;
            await safeMutate("Restauration stock (recréation grams)", () =>
              (supabase as any).from("food_items").insert({
                name: templateFi?.name ?? name,
                quantity: rem > 0 ? fullUnits + 1 : Math.max(1, fullUnits),
                grams: encodeStoredGrams(unitGrams, rem > 0 ? rem : null),
                calories: templateFi?.calories ?? null,
                protein: templateFi?.protein ?? null,
                is_indivisible: templateFi?.is_indivisible ?? false,
                expiration_date: templateFi?.expiration_date ?? null,
                counter_start_date: null,
                no_counter: templateFi?.no_counter ?? false,
                is_meal: templateFi?.is_meal ?? false,
                is_infinite: false,
                is_dry: templateFi?.is_dry ?? false,
                storage_type: storageFallback,
                food_type: templateFi?.food_type ?? null,
              })
            );
          } else if (neededGrams > 0) {
            await safeMutate("Restauration stock (recréation simple)", () =>
              (supabase as any).from("food_items").insert({
                name: templateFi?.name ?? name,
                grams: formatNumeric(neededGrams),
                calories: templateFi?.calories ?? null,
                protein: templateFi?.protein ?? null,
                is_indivisible: templateFi?.is_indivisible ?? false,
                expiration_date: templateFi?.expiration_date ?? null,
                counter_start_date: null,
                no_counter: templateFi?.no_counter ?? false,
                is_meal: templateFi?.is_meal ?? false,
                is_infinite: false,
                is_dry: templateFi?.is_dry ?? false,
                storage_type: storageFallback,
                food_type: templateFi?.food_type ?? null,
              })
            );
          }
          continue;
        }

        const fi = matchingItems[0];
        if (neededCount > 0) {
          const newQty = (fi.quantity ?? 1) + neededCount;
          await safeMutate("Restauration stock (count)", () =>
            supabase.from("food_items").update({ quantity: Math.ceil(newQty) } as any).eq("id", fi.id)
          );
        } else if (neededGrams > 0) {
          const fiGrams = parseQty(fi.grams);
          if (fi.quantity && fi.quantity >= 1 && fiGrams > 0) {
            const currentTotal = getFoodItemTotalGrams(fi);
            const newTotal = currentTotal + neededGrams;
            const fullUnits = Math.floor(newTotal / fiGrams);
            const remainder = Math.round((newTotal - fullUnits * fiGrams) * 10) / 10;
            const newQty = remainder > 0 ? fullUnits + 1 : fullUnits;
            const newGramsStr = encodeStoredGrams(fiGrams, remainder > 0 ? remainder : null);
            const synthetic = { ...fi, quantity: newQty, grams: newGramsStr } as FoodItem;
            const clearCtr = isFoodFullySealed(synthetic);
            await safeMutate("Restauration stock (grams)", () =>
              supabase.from("food_items").update({
                quantity: newQty,
                grams: newGramsStr,
                ...(clearCtr ? { counter_start_date: null } : {}),
              } as any).eq("id", fi.id)
            );
          } else {
            const currentTotal = fiGrams;
            const newG = formatNumeric(currentTotal + neededGrams);
            const synthetic = { ...fi, grams: newG } as FoodItem;
            const clearCtr = isFoodFullySealed(synthetic);
            await safeMutate("Restauration stock (simple)", () =>
              supabase.from("food_items").update({
                grams: newG,
                ...(clearCtr ? { counter_start_date: null } : {}),
              } as any).eq("id", fi.id)
            );
          }
        }
      }
    }
    // Restauration par correspondance de nom (repas sans ingrédients)
    const mealGrams = parseQty(meal.grams);
    if (mealGrams > 0) {
      const nameMatch = currentFoodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
      if (nameMatch) {
        const unit = parseQty(nameMatch.grams);
        if (nameMatch.quantity && nameMatch.quantity >= 1 && unit > 0) {
          const currentTotal = getFoodItemTotalGrams(nameMatch);
          const newTotal = currentTotal + mealGrams;
          const fullUnits = Math.floor(newTotal / unit);
          const remainder = Math.round((newTotal - fullUnits * unit) * 10) / 10;
          const newQty = remainder > 0 ? fullUnits + 1 : fullUnits;
          const newGramsStr = encodeStoredGrams(unit, remainder > 0 ? remainder : null);
          const synthetic = { ...nameMatch, quantity: newQty, grams: newGramsStr } as FoodItem;
          const clearCtr = isFoodFullySealed(synthetic);
          await safeMutate("Restauration nom", () =>
            supabase.from("food_items").update({
              quantity: newQty,
              grams: newGramsStr,
              ...(clearCtr ? { counter_start_date: null } : {}),
            } as any).eq("id", nameMatch.id)
          );
        } else {
          const newG = formatNumeric(unit + mealGrams);
          const synthetic = { ...nameMatch, grams: newG } as FoodItem;
          const clearCtr = isFoodFullySealed(synthetic);
          await safeMutate("Restauration nom (simple)", () =>
            supabase.from("food_items").update({
              grams: newG,
              ...(clearCtr ? { counter_start_date: null } : {}),
            } as any).eq("id", nameMatch.id)
          );
        }
      }
    }
    await invalidateStock();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // AJUSTEMENT DELTA (modification des ingrédients d'une carte Possible)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Ajuste le stock quand les ingrédients d'un repas "Possible" sont modifiés.
   * 
   * Calcule le delta entre ancien et nouveau pour chaque ingrédient :
   * - Delta positif → déduire plus du stock
   * - Delta négatif → rendre au stock
   * 
   * Récupère les données fraîches de Supabase pour éviter les erreurs de concurrence.
   * Retourne les nouveaux snapshots créés pour les items nouvellement affectés.
   */
  const adjustStockForIngredientChange = async (oldIngredients: string | null, newIngredients: string | null, snapshots?: FoodItem[]): Promise<FoodItem[]> => {
    const newSnapshots: FoodItem[] = [];
    const existingSnapshotIds = new Set(snapshots?.map(s => s.id) ?? []);

    // Récupérer les données fraîches pour éviter les doubles déductions
    const { data: freshItems } = await supabase.from("food_items").select("*").order("sort_order", { ascending: true });
    const currentFoodItems: FoodItem[] = (freshItems ?? []).map((d: any) => ({
      ...d,
      is_meal: d.is_meal ?? false,
      is_infinite: d.is_infinite ?? false,
      is_dry: d.is_dry ?? false,
      is_indivisible: d.is_indivisible ?? false,
      no_counter: d.no_counter ?? false,
      storage_type: d.storage_type ?? (d.is_dry ? "sec" : "frigo"),
      quantity: d.quantity ?? null,
      food_type: d.food_type ?? null,
      protein: d.protein ?? null,
    })) as FoodItem[];

    // Construire les maps d'utilisation ancien vs nouveau
    const oldGroups = oldIngredients ? parseIngredientGroups(oldIngredients) : [];
    const newGroups = newIngredients ? parseIngredientGroups(newIngredients) : [];

    /** Construit une map nom → { grams, count } des quantités utilisées */
    const buildUsageMap = (groups: any[][][]) => {
      const map = new Map<string, { grams: number; count: number }>();
      for (const group of groups) {
        if (group.every(alt => alt.every((item: any) => item.optional))) continue;
        if (group.length > 0) {
          const bundle = group[0]; // On prend la première alternative par défaut pour le delta
          for (const item of bundle) {
            const prev = map.get(item.name) ?? { grams: 0, count: 0 };
            map.set(item.name, { grams: prev.grams + (item.qty || 0), count: prev.count + (item.count || 0) });
          }
        }
      }
      return map;
    };

    const oldUsage = buildUsageMap(oldGroups);
    const newUsage = buildUsageMap(newGroups);
    const allKeys = new Set([...oldUsage.keys(), ...newUsage.keys()]);

    for (const ingName of allKeys) {
      const oldU = oldUsage.get(ingName) ?? { grams: 0, count: 0 };
      const newU = newUsage.get(ingName) ?? { grams: 0, count: 0 };
      const deltaGrams = newU.grams - oldU.grams;
      const deltaCount = newU.count - oldU.count;
      if (deltaGrams === 0 && deltaCount === 0) continue;

      const matchingItems = currentFoodItems.filter(fi => strictNameMatch(fi.name, ingName) && !fi.is_infinite).sort(sortStockDeductionPriority);

      // --- Delta grammes positif : déduire plus ---
      if (deltaGrams > 0) {
        let toDeduct = deltaGrams;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const totalAvail = getFoodItemTotalGrams(fi);
          if (totalAvail <= 0) continue;
          const deduct = Math.min(totalAvail, toDeduct);
          const remaining = totalAvail - deduct;
          toDeduct -= deduct;
          if (!existingSnapshotIds.has(fi.id)) {
            newSnapshots.push({ ...fi });
            existingSnapshotIds.add(fi.id);
          }
          if (remaining <= 0) {
            await safeMutate("Ajustement stock", () => supabase.from("food_items").delete().eq("id", fi.id));
          } else {
            const perUnit = parseQty(fi.grams);
            if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
              const fullUnits = Math.floor(remaining / perUnit);
              const rem = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
              const shouldStart = rem > 0 && !fi.counter_start_date && shouldStartCounter(fi);
              const shouldClear = rem <= 0 && fi.counter_start_date;
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ quantity: rem > 0 ? Math.max(1, fullUnits + 1) : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null), ...(shouldStart ? { counter_start_date: new Date().toISOString() } : {}), ...(shouldClear ? { counter_start_date: null } : {}) } as any).eq("id", fi.id)
              );
            } else {
              const shouldStart = remaining > 0 && remaining < parseQty(fi.grams) && !fi.counter_start_date && shouldStartCounter(fi);
              await safeMutate("Ajustement stock", () =>
                supabase.from("food_items").update({ grams: formatNumeric(remaining), ...(shouldStart ? { counter_start_date: new Date().toISOString() } : {}) } as any).eq("id", fi.id)
              );
            }
          }
        }
      }
      // --- Delta grammes négatif : rendre au stock ---
      else if (deltaGrams < 0) {
        const toAdd = -deltaGrams;
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null) : (matchingItems[0] ?? null);

        if (fi) {
          const perUnit = parseQty(fi.grams);
          if (fi.quantity && fi.quantity >= 1 && perUnit > 0) {
            const currentTotal = getFoodItemTotalGrams(fi);
            const newTotal = currentTotal + toAdd;
            const fullUnits = Math.floor(newTotal / perUnit);
            const rem = Math.round((newTotal - fullUnits * perUnit) * 10) / 10;
            const shouldClear = rem <= 0 && fi.counter_start_date;
            await safeMutate("Ajustement stock", () =>
              supabase.from("food_items").update({ quantity: rem > 0 ? fullUnits + 1 : fullUnits, grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null), ...(shouldClear ? { counter_start_date: null } : {}) } as any).eq("id", fi.id)
            );
          } else {
            const current = parseQty(fi.grams);
            await safeMutate("Ajustement stock", () =>
              supabase.from("food_items").update({ grams: formatNumeric(current + toAdd) } as any).eq("id", fi.id)
            );
          }
        } else if (snapshotFi) {
          // Item entièrement consommé et supprimé → le recréer depuis le snapshot
          const { created_at, quantity, grams, ...rest } = snapshotFi as Record<string, any>;
          const perUnit = parseQty(snapshotFi.grams);
          if (snapshotFi.quantity !== null && snapshotFi.quantity >= 1 && perUnit > 0) {
            const fullUnits = Math.floor(toAdd / perUnit);
            const rem = Math.round((toAdd - fullUnits * perUnit) * 10) / 10;
            await safeMutate("Ajustement stock (recréation)", () =>
              supabase.from("food_items").insert({
                ...rest,
                quantity: rem > 0 ? fullUnits + 1 : Math.max(1, fullUnits),
                grams: encodeStoredGrams(perUnit, rem > 0 ? rem : null),
                counter_start_date: snapshotFi.counter_start_date,
              } as any)
            );
          } else {
            await safeMutate("Ajustement stock (recréation)", () =>
              supabase.from("food_items").insert({ ...rest, grams: formatNumeric(toAdd), counter_start_date: snapshotFi.counter_start_date } as any)
            );
          }
        }
      }

      // --- Delta comptage positif : déduire plus ---
      if (deltaCount > 0) {
        let toDeduct = deltaCount;
        for (const fi of matchingItems) {
          if (toDeduct <= 0) break;
          const fiCount = fi.quantity ?? 1;
          const deduct = Math.min(fiCount, toDeduct);
          toDeduct -= deduct;
          const remaining = fiCount - deduct;
          if (!existingSnapshotIds.has(fi.id)) {
            newSnapshots.push({ ...fi });
            existingSnapshotIds.add(fi.id);
          }
          if (remaining <= 0) {
            await safeMutate("Ajustement stock (count)", () => supabase.from("food_items").delete().eq("id", fi.id));
          } else {
            const clearCtr = fi.counter_start_date && isFoodFullySealed({ ...fi, quantity: remaining } as FoodItem);
            await safeMutate("Ajustement stock (count)", () => supabase.from("food_items").update({ quantity: remaining, ...(clearCtr ? { counter_start_date: null } : {}) } as any).eq("id", fi.id));
          }
        }
      }
      // --- Delta comptage négatif : rendre au stock ---
      else if (deltaCount < 0) {
        const toAdd = -deltaCount;
        const snapshotFi = snapshots?.find(s => strictNameMatch(s.name, ingName));
        const fi = snapshotFi ? (currentFoodItems.find(f => f.id === snapshotFi.id) ?? null) : (matchingItems[0] ?? null);

        if (fi) {
          await safeMutate("Ajustement stock (count)", () =>
            supabase.from("food_items").update({ quantity: (fi.quantity ?? 1) + toAdd } as any).eq("id", fi.id)
          );
        } else if (snapshotFi) {
          const { created_at, quantity, grams, ...rest } = snapshotFi as Record<string, any>;
          await safeMutate("Ajustement stock (recréation count)", () =>
            supabase.from("food_items").insert({
              ...rest,
              quantity: toAdd,
              grams: grams,
              counter_start_date: snapshotFi.counter_start_date
            } as any)
          );
        }
      }
    }
    await invalidateStock();
    return newSnapshots;
  };

  // ═════════════════════════════════════════════════════════════════════════
  // DÉDUCTION PAR NOM (repas sans ingrédients détaillés)
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Déduit du stock par correspondance de nom (pour les repas sans liste d'ingrédients).
   * Cherche un aliment portant le même nom que le repas et déduit les grammes ou 1 unité.
   */
  const deductNameMatchStock = async (meal: Meal, forcedCounterDate?: string, ratio: number = 1) => {
    const liveFoodItems = getLiveFoodItems();
    const nameMatch = liveFoodItems.find(fi => strictNameMatch(fi.name, meal.name) && !fi.is_infinite);
    if (!nameMatch) return;

    // Calculer le poids de base à déduire. Si le repas n'a pas de poids, on prend celui de l'aliment.
    let baseG = parseQty(meal.grams);
    if (baseG <= 0 && nameMatch.grams) {
      baseG = parseQty(nameMatch.grams) * (nameMatch.quantity || 1);
    }
    const mealGrams = baseG * ratio;

    const counterToSet = forcedCounterDate || new Date().toISOString();
    const canStartCounter = shouldStartCounter(nameMatch);

    if (mealGrams <= 0) {
      // Pas de grammes spécifiés → déduire 1 unité
      const currentQty = nameMatch.quantity ?? 1;
      if (currentQty <= 1) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        const clearCtr = nameMatch.counter_start_date && isFoodFullySealed({ ...nameMatch, quantity: currentQty - 1 } as FoodItem);
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({ quantity: currentQty - 1, ...(clearCtr ? { counter_start_date: null } : {}) } as any).eq("id", nameMatch.id));
      }
      await invalidateStock();
      return;
    }

    // Déduction par grammes
    const perUnit = parseQty(nameMatch.grams);
    if (nameMatch.quantity && nameMatch.quantity >= 1 && perUnit > 0) {
      const totalAvailable = getFoodItemTotalGrams(nameMatch);
      const remaining = totalAvailable - mealGrams;
      if (remaining <= 0) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        const fullUnits = Math.floor(remaining / perUnit);
        const remainder = Math.round((remaining - fullUnits * perUnit) * 10) / 10;
        if (remainder > 0) {
          await safeMutate("Déduction nom", () => supabase.from("food_items").update({
            quantity: Math.max(1, fullUnits + 1),
            grams: encodeStoredGrams(perUnit, remainder),
            ...(canStartCounter ? { counter_start_date: counterToSet } : {})
          } as any).eq("id", nameMatch.id));
        } else if (fullUnits > 0) {
          await safeMutate("Déduction nom", () => supabase.from("food_items").update({
            quantity: fullUnits,
            grams: formatNumeric(perUnit),
            ...(nameMatch.counter_start_date ? { counter_start_date: null } : {})
          } as any).eq("id", nameMatch.id));
        } else {
          await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
        }
      }
    } else {
      const current = parseQty(nameMatch.grams);
      const remaining = Math.max(0, current - mealGrams);
      if (remaining <= 0) {
        await safeMutate("Déduction nom", () => supabase.from("food_items").delete().eq("id", nameMatch.id));
      } else {
        const isNewUnit = remaining > 0 && remaining < current;
        await safeMutate("Déduction nom", () => supabase.from("food_items").update({
          grams: formatNumeric(remaining),
          ...(canStartCounter && isNewUnit ? { counter_start_date: counterToSet } : {})
        } as any).eq("id", nameMatch.id));
      }
    }
    await invalidateStock();
  };

  // ═════════════════════════════════════════════════════════════════════════
  // SYNCHRONISATION DES COMPTEURS AVEC LE PLANNING
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Met à jour les counter_start_date des aliments quand le planning d'un repas change.
   * 
   * Pour chaque ingrédient affecté :
   * 1. Collecte toutes les dates de planification des repas utilisant cet ingrédient
   * 2. Détermine la date la plus ancienne
   * 3. Met à jour le compteur de l'aliment en conséquence
   * 
   * Protège les compteurs manuels (ouverts manuellement avant toute planification).
   */
  const updateFoodItemCountersForPlanning = async (
    pmId: string | null,
    ingredients: string | null,
    dayOfWeek: string | null,
    mealTime: string | null,
    fallbackDate?: string | null,
    createdAt?: string | null,
    allPossibleMeals: any[] = []
  ) => {
    if (!ingredients?.trim()) return;
    /** Jour + créneau (matin/midi/soir) : on synchronise toujours sur l’horaire du repas planifié. */
    const fullPlanningSlot =
      Boolean(dayOfWeek) && String(mealTime ?? "").trim().length > 0;
    const groups = parseIngredientGroups(ingredients);

    // Updates à appliquer en une seule passe : on les collecte d'abord, puis on les écrit
    // en batch avec .select().single() pour récupérer la ligne authoritative et patcher le cache.
    // Cela évite qu'un événement realtime sur replica en retard ré-écrase notre update.
    const pendingUpdates = new Map<string, string | null>();

    for (const group of groups) {
      // group : ParsedIngredient[][] — chaque entrée est une branche « OU », chaque branche un bundle « + ».
      if (group.every(altBundle => altBundle.every((item) => item.optional))) continue;

      for (const bundle of group) {
        for (const item of bundle) {
          if (item.optional || !item.name) continue;
          const nameTokens = expandOrGroupIngredientNames(item);
          for (const nameToken of nameTokens) {
      // Aliments en stock correspondant à cet ingrédient (hors infini, compteur autorisé).
          const liveFoodItems = getLiveFoodItems();
          const nameMatches = liveFoodItems.filter(
        (fi) => strictNameMatch(fi.name, nameToken) && !fi.is_infinite && shouldStartCounter(fi),
      );

      // La planification ne doit pas "ouvrir" un lot scellé : on ne touche qu'aux lots
      // qui portent déjà un compteur réel. Les compteurs futurs existants sont des reliquats
      // de l'ancien mode "prog." et seront nettoyés plus bas.
      const matchingItems = nameMatches.filter((fi) => fi.counter_start_date !== null);

      for (const fi of matchingItems) {
        const currentCounterMs = fi.counter_start_date ? new Date(fi.counter_start_date).getTime() : NaN;
        if (fullPlanningSlot && Number.isFinite(currentCounterMs) && currentCounterMs > new Date().getTime()) {
          pendingUpdates.set(fi.id, null);
          continue;
        }

        // Objectif : faire pointer le compteur de l’aliment sur la date FUTURE LA PLUS PROCHE
        // parmi tous les repas planifiés qui l’utilisent. Un repas planifié dans le passé
        // (en retard, non consommé) ne doit pas écraser cette date future ; sinon le compteur
        // reste bloqué sur un créneau déjà passé au lieu d’afficher « Prog. ».
        let earliestDateStr: string | null = null;
        let earliestDateMs = Infinity;
        const nowMsRef = new Date().getTime();

        /** Candidat pour earliest : on garde le min des dates futures rencontrées. */
        const considerCandidate = (iso: string, ms: number) => {
          if (ms <= nowMsRef) return; // créneau passé ignoré
          if (ms < earliestDateMs) {
            earliestDateMs = ms;
            earliestDateStr = iso;
          }
        };

        // Repas en cours de mise à jour (pmId courant).
        // Cas particulier : si fullPlanningSlot est faux (ex. carte Possible sans créneau choisi),
        // on accepte un fallback « maintenant » comme avant pour maintenir l’ouverture immédiate.
        if (pmId) {
          const targetDate = dayOfWeek ? computePlannedCounterDate(dayOfWeek, mealTime) : null;
          if (fullPlanningSlot && targetDate) {
            const targetMs = new Date(targetDate).getTime();
            considerCandidate(targetDate, targetMs);
          } else {
            const candidateDate = targetDate ?? fallbackDate ?? new Date().toISOString();
            earliestDateStr = candidateDate;
            earliestDateMs = new Date(candidateDate).getTime();
          }
        }

        let hasAnyMatchingMeal = pmId !== null;

        // Parcourir les autres repas **entièrement planifiés** (jour + créneau).
        // Seuls les créneaux FUTURS sont retenus : le compteur reflète la prochaine ouverture.
        for (const pm of allPossibleMeals) {
          if (pm.id === pmId) continue;
          if (!pm.day_of_week || !String(pm.meal_time ?? "").trim()) continue;
          const pmIngs = pm.ingredients_override ?? pm.meals?.ingredients;
          if (!pmIngs?.trim()) continue;

          if (!pmIngs.toLowerCase().includes(fi.name.toLowerCase())) continue;

          const pmG = parseIngredientGroups(pmIngs);
          const hasMatch = pmG.some((g) =>
            g.some((altBundle) =>
              altBundle.some(
                (it) =>
                  !it.optional &&
                  expandOrGroupIngredientNames(it).some((t) => strictNameMatch(fi.name, t)),
              ),
            ),
          );
          if (!hasMatch) continue;

          const siblingTarget = computePlannedCounterDate(pm.day_of_week, pm.meal_time);
          const pmMs = new Date(siblingTarget).getTime();
          // Filtre fondamental : sibling au créneau passé → on l’ignore complètement.
          // Il représente un repas en retard et ne doit pas dicter la date d’ouverture future.
          if (pmMs <= nowMsRef) continue;

          hasAnyMatchingMeal = true;
          considerCandidate(siblingTarget, pmMs);
        }

        // Ne pas ramener une date de créneau planifié (futur, mode « prog. ») à « maintenant »
        // juste parce que le lot est entamé : sinon la planification d’un repas possible n’écrit jamais
        // la date du repas sur food_items et le compteur reste « déjà ouvert » au lieu de programmé.

        // Mettre à jour seulement si on a trouvé une date valide
        if (hasAnyMatchingMeal && earliestDateStr) {
          const isSettingFutureDate = new Date(earliestDateStr).getTime() > new Date().getTime();
          if (fullPlanningSlot && isSettingFutureDate) continue;

          // Protéger les compteurs manuels seulement hors planification complète (jour + créneau).
          if (!fullPlanningSlot && !isSettingFutureDate && fi.counter_start_date) {
            const fiStart = new Date(fi.counter_start_date).getTime();
            const nowMs = new Date().getTime();
            const isStartedBeforeNow = fiStart <= nowMs;
            const isManualOrOld = isStartedBeforeNow && !allPossibleMeals.some(pm => pm.created_at && Math.abs(fiStart - new Date(pm.created_at).getTime()) < 60000);
            if (isManualOrOld && (!pmId || (createdAt && Math.abs(fiStart - new Date(createdAt).getTime()) >= 60000))) {
              continue; // Compteur manuel → ne pas écraser
            }
          }

          pendingUpdates.set(fi.id, earliestDateStr);
        }
      }
          }
        }
      }
    }

    if (pendingUpdates.size === 0) return;

    // 1. Patch optimiste immédiat : l'UI reflète le compteur programmé sans attendre le réseau.
    await qc.cancelQueries({ queryKey: ["food_items"] });
    qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
      if (!Array.isArray(old)) return old;
      return old.map((fi) => {
        const newDate = pendingUpdates.get(fi.id);
        return newDate !== undefined ? { ...fi, counter_start_date: newDate } : fi;
      });
    });

    // 2. Suspendre le realtime : un événement Supabase sur réplique en retard ne doit pas
    //    ré-écraser notre cache (bug « 0j » au lieu de « Prog. » après planification).
    suppressStockRealtimeBriefly();

    // 3. Écriture batch en base avec récupération de la ligne authoritative.
    const updateResults = await safeMutate("Mise à jour compteur", () =>
      Promise.all(
        Array.from(pendingUpdates.entries()).map(([id, dateIso]) =>
          supabase
            .from("food_items")
            .update({ counter_start_date: dateIso } as any)
            .eq("id", id)
            .select("*")
            .single(),
        ),
      ),
    );

    // 4. Patcher le cache avec les lignes authoritatives renvoyées par le primaire.
    //    NE PAS appeler invalidateStock() ensuite : le refetch irait sur une réplique en retard
    //    et écraserait notre mise à jour par l'ancienne valeur « maintenant ».
    if (Array.isArray(updateResults)) {
      const authoritativeById = new Map<string, FoodItem>();
      for (const res of updateResults) {
        if (!res || (res as any).error) continue;
        const row = (res as { data?: FoodItem | null }).data;
        if (row?.id) authoritativeById.set(row.id, row as FoodItem);
      }
      if (authoritativeById.size > 0) {
        await qc.cancelQueries({ queryKey: ["food_items"] });
        qc.setQueryData<FoodItem[]>(["food_items"], (old) => {
          if (!Array.isArray(old)) return old;
          return old.map((fi) => authoritativeById.get(fi.id) ?? fi);
        });
      }
    }
  };

  return {
    deductIngredientsFromStock,
    restoreIngredientsToStock,
    adjustStockForIngredientChange,
    deductNameMatchStock,
    updateFoodItemCountersForPlanning,
  };
}

