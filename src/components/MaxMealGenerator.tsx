/**
 * MaxMealGenerator — Générateur de plats maximum réalisables.
 *
 * Simule un algorithme glouton (greedy) : sélectionne séquentiellement
 * les plats faisables en déduisant le stock virtuel à chaque itération.
 * La même recette peut apparaître plusieurs fois (une ligne par portion) tant
 * qu'il reste assez d'ingrédients (ex. 5× 200 g de tenders → jusqu'à 5 plats
 * nécessitant 200 g de tenders, pas seulement 5 noms de plats distincts).
 * Résultat : la liste de plats produite par la simulation gloutonne.
 *
 * Fonctionnalités :
 * - Choix glouton déterministe : à chaque étape, compare le reste SI l’on prenait
 *   toutes les portions entières possibles de chaque recette (ex. 2×3 œufs plutôt que 1×4),
 *   puis n’en consomme qu’une pour laisser de la variété aux tours suivants ;
 *   départage sans tirage au sort (variété / calories / ordre alphabétique).
 * - Tri par calories (ascendant/descendant) ou par premier ingrédient (regroupe les mêmes têtes de liste).
 * - Persistance des résultats en sessionStorage ; recalcul automatique si aliments / recettes changent
 * - Exclut les aliments marqués « Matin » (petit-déj. autonome, pas un plat du soir).
 * - Exclut les fiches plat « raccourci » (un seul ingrédient obligatoire = le nom du plat, ex. Fuet).
 * - Inclut en second les aliments "is_meal" seulement s'il n'existe pas déjà
 *   une recette plat homonyme dans le catalogue, et si le stock restant le permet.
 * - Sous la liste : comme sur les cartes (#, unité g, → reste) ; péremption / surgelé ; seulement ingrédients de plats.
 *
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { ChevronDown, ChevronRight, Loader2, ListOrdered, Package, Zap, ArrowUpDown, ArrowUp, ArrowDown, Hash, Weight, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import {
  buildStockMap,
  getMealMultiple,
  buildScaledMealForRatio,
  deductMealServingFromVirtualStock,
  findStockKey,
  normalizeKey,
  parseQty,
  parseIngredientGroups,
  type StockInfo,
} from "@/lib/stockUtils";
import {
  computeIngredientCalories,
  computeIngredientProtein,
  cleanIngredientText,
  strictNameMatch,
} from "@/lib/ingredientUtils";

/** Modes de tri de la liste générée (calories, 1er ingrédient, ou péremption). */
type MaxMealSort = "none" | "asc" | "desc" | "first_ingredient" | "expiration";

interface Props {
  foodItems: FoodItem[];
  meals: Meal[];
}

interface GeneratedMeal {
  name: string;
  calories: number | null;
  protein: number | null;
  ingredients: string;
  ratio: number;
  /**
   * Nombre de portions planifiées pour cette ligne (ex. 2 = deux repas de la même recette).
   * Distinct du ratio partiel (&lt; 1) qui reste dans `ratio`.
   */
  portionCount?: number;
  /** true si la ligne vient d'un aliment is_meal sans recette catalogue (affichage après les recettes). */
  isStandaloneFood?: boolean;
}

const SESSION_KEY = "max_meal_generator_results";
const MORNING_MEAL_PREF_KEY = "morning_meal_food_item_ids";

/**
 * Indique si une fiche plat correspond à un aliment marqué « Matin » (homonyme).
 */
export function isMorningMealPlat(meal: Meal, morningFoodItems: FoodItem[]): boolean {
  return morningFoodItems.some((fi) => strictNameMatch(fi.name, meal.name));
}

/**
 * Empreinte stable des aliments et des fiches repas : quand elle change, la simulation est
 * recalculée automatiquement pour refléter le stock et les recettes à jour.
 */
function buildMaxMealGeneratorDepsKey(
  foodItems: FoodItem[],
  meals: Meal[],
  morningMealFoodItemIds: string[] = [],
): string {
  const f = [...foodItems]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((fi) => ({
      id: fi.id,
      name: fi.name,
      grams: fi.grams,
      calories: fi.calories,
      protein: fi.protein,
      quantity: fi.quantity,
      storage_type: fi.storage_type,
      is_infinite: fi.is_infinite,
      is_indivisible: fi.is_indivisible,
      is_meal: fi.is_meal,
      expiration_date: fi.expiration_date,
      no_counter: fi.no_counter,
      food_type: fi.food_type,
    }));
  const m = [...meals]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((me) => ({
      id: me.id,
      name: me.name,
      category: me.category,
      ingredients: me.ingredients,
    }));
  return JSON.stringify({ f, m, morning: [...morningMealFoodItemIds].sort() });
}

/**
 * Ligne « reste en stock » : # (quantités au départ), unité en g (ex. 500g), → (g restants).
 * flatLabel = cache hérité (texte seul).
 */
interface RemainingFoodLine {
  displayName: string;
  originalCount: number | null;
  unitGramsDisplay: string | null;
  remainingGramsDisplay: string | null;
  hideUnitGramsWhenSingle?: boolean;
  storageGroup: "frigo" | "sec" | "surgele";
  flatLabel?: string;
}

/**
 * Indique si un aliment peut figurer dans le bloc « reste en stock » : exclu si tout est
 * en « extras »/« test » ou infini, ou s’il n’y a ni date de péremption (sur une fiche hors extras/test) ni
 * fiche en surgelé — le casier surgelé est affiché même sans date, comme en usage courant.
 */
function foodKeyIsShownInRemainingSimulation(key: string, foodItems: FoodItem[]): boolean {
  const matches = foodItems.filter((fi) => normalizeKey(fi.name) === key);
  if (matches.length === 0) return false;
  const nonExtra = matches.filter((fi) => fi.storage_type !== "extras" && fi.storage_type !== "test");
  if (nonExtra.length === 0) return false;
  if (nonExtra.every((fi) => fi.is_infinite)) return false;
  const hasExpiration = nonExtra.some(
    (fi) => fi.expiration_date != null && String(fi.expiration_date).trim() !== ""
  );
  const hasSurgele = nonExtra.some((fi) => fi.storage_type === "surgele");
  return hasExpiration || hasSurgele;
}

/**
 * Formate un nombre pour l’affichage comme sur les cartes aliment (virgule décimale FR).
 * Aligné sur FoodItemCard / FoodItems.
 */
function formatNumericFR(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(Math.trunc(rounded));
  return String(rounded).replace(/\.0$/, "").replace(".", ",");
}

/**
 * Clés d'ingrédients (noms normalisés) présentes dans au moins une recette de catégorie « plat ».
 * Évite d'afficher en « reste » des aliments utilisés seulement hors plats (petit-déj., dessert, etc.).
 */
function buildNormalizedKeysFromPlatRecipes(meals: Meal[]): Set<string> {
  const keys = new Set<string>();
  for (const m of meals) {
    if (m.category !== "plat" || !m.ingredients?.trim()) continue;
    const groups = parseIngredientGroups(m.ingredients);
    for (const group of groups) {
      for (const alt of group) {
        for (const item of alt) {
          if (item.optional) continue;
          keys.add(normalizeKey(item.name));
        }
      }
    }
  }
  return keys;
}

/**
 * Clés d'ingrédients (noms normalisés) présentes dans au moins une fiche repas (toutes catégories).
 * Sert à distinguer : jamais cité en recette (on affiche) vs cité seulement hors plats (on masque).
 */
function buildNormalizedKeysFromAllMeals(meals: Meal[]): Set<string> {
  const keys = new Set<string>();
  for (const m of meals) {
    if (!m.ingredients?.trim()) continue;
    const groups = parseIngredientGroups(m.ingredients);
    for (const group of groups) {
      for (const alt of group) {
        for (const item of alt) {
          if (item.optional) continue;
          keys.add(normalizeKey(item.name));
        }
      }
    }
  }
  return keys;
}

/**
 * Décode un libellé type « #2 500g » (comme produit par l’ancien format cache) en # + grammes.
 * Sert à migrer le sessionStorage vers le modèle { count, gramsDisplay }.
 */
function parseSnapshotTextToRemaining(s: string): { count: number | null; gramsDisplay: string | null } {
  const t = s.trim();
  if (!t) return { count: null, gramsDisplay: null };
  const m = t.match(/^#([\d.,]+)\s*(.*)$/);
  if (m) {
    const n = parseFloat(m[1].replace(",", "."));
    const tail = m[2]?.trim() ?? "";
    return {
      count: Number.isFinite(n) && n > 0 ? n : null,
      gramsDisplay: tail.length > 0 ? tail : null,
    };
  }
  if (/\d/.test(t) && /g\s*$/i.test(t.trim())) {
    return { count: null, gramsDisplay: t.trim() };
  }
  return { count: null, gramsDisplay: null };
}

/**
 * Formate uniquement le grammage pour une pastille « balance + …g » (comme sur les cartes).
 */
function formatGramsQty(grams: number): string {
  const g =
    Math.abs(grams - Math.round(grams)) < 0.05
      ? Math.round(grams)
      : Math.round(grams * 10) / 10;
  return `${formatNumericFR(g)}g`;
}

/**
 * Poids d’**une** unité comme sur la fiche (ex. 100g par tablette de chocolat), aligné sur la carte.
 * Ne calcule plus la moyenne « total/quantité » (qui donnait 96,7g au lieu de 100g) : on lit
 * le grammage d’aliment, puis repli moyen si les fiches diffèrent.
 */
function displayUnitGramsForRemaining(key: string, foodItems: FoodItem[], orig: StockInfo): number | null {
  if (orig.indivisibleUnit > 0) return orig.indivisibleUnit;
  const nonExtra = foodItems.filter(
    (fi) => fi.storage_type !== "extras" && fi.storage_type !== "test" && normalizeKey(fi.name) === key
  );
  const byFiche: number[] = [];
  for (const fi of nonExtra) {
    const g = parseQty(fi.grams);
    if (g > 0) byFiche.push(g);
  }
  if (byFiche.length > 0) {
    const first = byFiche[0]!;
    const allSame = byFiche.every((g) => Math.abs(g - first) < 0.5);
    if (allSame) return first;
  }
  if (orig.count > 0 && orig.grams > 0) {
    const u = orig.grams / orig.count;
    if (u > 0.0001) return u;
  }
  return null;
}

/**
 * Partie de grammes sur l’unité entamée (équivalent « 312 » d’une fiche `500|312`), et pas le
 * total en stock. On enlève d’abord le poids des unités entières : reste = total % poids d’une unité.
 * Si l’aliment tient en moins d’une unité, `total` est déjà le reste sur cette unité.
 */
function remainingGramsOnLastOpenedUnit(totalRem: number, unitG: number): number | null {
  if (unitG <= 0.0001 || totalRem <= 0.05) return null;
  const t = Math.round(totalRem * 10) / 10;
  const u = Math.round(unitG * 10) / 10;
  const mod = t % u;
  if (mod < 0.5) {
    if (t < u - 0.5) return t > 0.05 ? t : null;
    return null;
  }
  return mod;
}

/**
 * Reconstruit une ligne de reste depuis le sessionStorage (formats successifs ou texte seul).
 */
function emptyRemainingFields(): Pick<RemainingFoodLine, "originalCount" | "unitGramsDisplay" | "remainingGramsDisplay"> {
  return { originalCount: null, unitGramsDisplay: null, remainingGramsDisplay: null };
}

function remainingLineFromCache(raw: unknown): RemainingFoodLine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const displayName = typeof o.displayName === "string" ? o.displayName : "";
  if (!displayName) return null;
  const storageGroup =
    o.storageGroup === "frigo" || o.storageGroup === "surgele" || o.storageGroup === "sec"
      ? o.storageGroup
      : "sec";
  if (typeof o.flatLabel === "string" && o.flatLabel.length > 0) {
    return { displayName, storageGroup, ...emptyRemainingFields(), flatLabel: o.flatLabel };
  }
  if (o.quantityLabel != null && o.remainingGramsDisplay === undefined && o.gramsDisplay === undefined) {
    return { displayName, storageGroup, ...emptyRemainingFields(), flatLabel: String(o.quantityLabel) };
  }
  if (
    o.originalCount != null ||
    o.unitGramsDisplay != null ||
    o.remainingGramsDisplay != null ||
    o.hideUnitGramsWhenSingle != null
  ) {
    const oc =
      typeof o.originalCount === "number" && !Number.isNaN(o.originalCount) && o.originalCount > 0
        ? o.originalCount
        : null;
    const ug = typeof o.unitGramsDisplay === "string" && o.unitGramsDisplay.length > 0 ? o.unitGramsDisplay : null;
    const rg =
      typeof o.remainingGramsDisplay === "string" && o.remainingGramsDisplay.length > 0 ? o.remainingGramsDisplay : null;
    if (oc != null || ug != null || rg != null) {
      return {
        displayName,
        storageGroup,
        originalCount: oc,
        unitGramsDisplay: ug,
        remainingGramsDisplay: rg,
        hideUnitGramsWhenSingle: o.hideUnitGramsWhenSingle === true,
      };
    }
  }
  if (typeof o.gramsDisplay === "string" || (typeof o.count === "number" && o.originalCount === undefined)) {
    const c = typeof o.count === "number" && !Number.isNaN(o.count) && o.count > 0 ? o.count : null;
    const g = typeof o.gramsDisplay === "string" && o.gramsDisplay.length > 0 ? o.gramsDisplay : null;
    if (c != null || g != null) {
      const parts = [c != null ? `#${formatCountForHash(c)}` : "", g ?? ""].filter(Boolean);
      return { displayName, storageGroup, ...emptyRemainingFields(), flatLabel: parts.join(" ") };
    }
  }
  const after = o.afterPillText != null ? String(o.afterPillText) : "";
  if (after) {
    const p = parseSnapshotTextToRemaining(after);
    if (p.count != null || p.gramsDisplay != null) {
      const parts = [p.count != null ? `#${formatCountForHash(p.count)}` : "", p.gramsDisplay ?? ""].filter(Boolean);
      return { displayName, storageGroup, ...emptyRemainingFields(), flatLabel: parts.join(" ") };
    }
  }
  return null;
}

/**
 * Affiche le # comme sur les cartes (entier ou décimal FR).
 */
function formatCountForHash(n: number): string {
  return n % 1 === 0 ? String(n) : formatNumericFR(n);
}

/**
 * Liste les aliments encore en stock après simulation (état final uniquement), en excluant les lignes
 * relevant exclusivement d’ « extras »/« test », du stock infini, ou sans date de péremption sur
 * une fiche utile. Masque les ingrédients cités seulement hors plats (dessert, petit-déj., etc.) ;
 * un aliment absent de toute recette reste affiché.
 */
function buildRemainingFoodLines(
  virtualStock: Map<string, StockInfo>,
  foodItems: FoodItem[],
  originalStock: Map<string, StockInfo>,
  meals: Meal[]
): RemainingFoodLine[] {
  const keysInPlatRecipes = buildNormalizedKeysFromPlatRecipes(meals);
  const keysInAnyMeal = buildNormalizedKeysFromAllMeals(meals);
  const displayNameByKey = new Map<string, string>();
  const storageGroupByKey = new Map<string, "frigo" | "sec" | "surgele">();
  for (const fi of foodItems) {
    if (fi.storage_type === "extras" || fi.storage_type === "test") continue;
    const k = normalizeKey(fi.name);
    if (!displayNameByKey.has(k)) displayNameByKey.set(k, fi.name.trim());
    if (!storageGroupByKey.has(k)) {
      const g: "frigo" | "sec" | "surgele" =
        fi.storage_type === "surgele" ? "surgele" : fi.storage_type === "frigo" ? "frigo" : "sec";
      storageGroupByKey.set(k, g);
    } else if (fi.storage_type === "surgele") {
      storageGroupByKey.set(k, "surgele");
    }
  }
  const out: RemainingFoodLine[] = [];
  for (const [key, rem] of virtualStock) {
    if (rem.infinite) continue;
    // Exclut uniquement les ingrédients cités en recette uniquement hors plats (dessert, petit-déj., etc.) ;
    // un aliment jamais cité dans une recette reste listé.
    if (keysInAnyMeal.has(key) && !keysInPlatRecipes.has(key)) continue;
    if (!foodKeyIsShownInRemainingSimulation(key, foodItems)) continue;
    if (rem.grams <= 0.05 && rem.count <= 0) continue;
    const orig = originalStock.get(key);
    if (!orig) continue;
    const originalCount = rem.count > 0 ? rem.count : null;
    const unitG = displayUnitGramsForRemaining(key, foodItems, orig);
    const unitGramsDisplay = unitG != null && unitG > 0 ? formatGramsQty(unitG) : null;
    const partialG =
      unitG != null && unitG > 0 ? remainingGramsOnLastOpenedUnit(rem.grams, unitG) : null;
    const remainingGramsDisplay =
      partialG != null && partialG > 0.05
        ? formatGramsQty(partialG)
        : unitG == null && rem.grams > 0.05
          ? formatGramsQty(rem.grams)
          : null;
    const looksLikeSingleOpenedUnit =
      originalCount == null && unitG != null && unitG > 0 && rem.grams <= unitG + 0.5;
    const hideUnitGramsWhenSingle =
      remainingGramsDisplay != null &&
      ((originalCount != null && Math.abs(originalCount - 1) < 0.001) || looksLikeSingleOpenedUnit);
    if (remainingGramsDisplay == null && originalCount == null && unitGramsDisplay == null) continue;
    out.push({
      displayName: displayNameByKey.get(key) ?? key,
      originalCount,
      unitGramsDisplay,
      remainingGramsDisplay,
      hideUnitGramsWhenSingle,
      storageGroup: storageGroupByKey.get(key) ?? "sec",
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" }));
  return out;
}

/**
 * Clé de tri pour regrouper les plats par « premier ingrédient » : premier groupe, première
 * alternative OU, premier élément du lot. Sans ingrédients (ex. 🍱 seul) : nom du plat.
 */
function getFirstIngredientSortKey(row: GeneratedMeal): string {
  const ing = row.ingredients?.trim();
  if (!ing) {
    const n = row.name.replace(/^\s*🍱\s*/u, "").trim();
    return normalizeKey(n);
  }
  const groups = parseIngredientGroups(ing);
  const first = groups[0]?.[0]?.[0];
  if (!first) {
    const n = row.name.replace(/^\s*🍱\s*/u, "").trim();
    return normalizeKey(n);
  }
  return normalizeKey(first.name);
}

/**
 * Retourne la date de péremption la plus proche pour une ligne générée.
 * Utilise d'abord les ingrédients du plat, puis replie sur le nom du repas autonome (🍱 ...).
 */
function getGeneratedMealEarliestExpiration(row: GeneratedMeal, foodItems: FoodItem[]): string | null {
  const candidateKeys = new Set<string>();
  if (row.ingredients?.trim()) {
    const groups = parseIngredientGroups(row.ingredients);
    for (const group of groups) {
      for (const alt of group) {
        for (const item of alt) {
          if (item.optional) continue;
          candidateKeys.add(normalizeKey(item.name));
        }
      }
    }
  } else {
    const fallbackName = row.name.replace(/^\s*🍱\s*/u, "").trim();
    if (fallbackName) candidateKeys.add(normalizeKey(fallbackName));
  }

  let earliest: string | null = null;
  for (const fi of foodItems) {
    if (fi.storage_type === "extras" || fi.storage_type === "test") continue;
    if (!fi.expiration_date?.trim()) continue;
    if (!candidateKeys.has(normalizeKey(fi.name))) continue;
    if (earliest == null || fi.expiration_date < earliest) earliest = fi.expiration_date;
  }
  return earliest;
}

/**
 * Formate une date ISO (YYYY-MM-DD) en affichage court FR discret.
 */
function formatExpirationLabel(dateIso: string | null): string | null {
  if (!dateIso) return null;
  const m = dateIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[3]}/${m[2]}`;
}

/** Clé de regroupement pour fusionner les lignes identiques (tri indépendant). */
function generatedMealGroupKey(row: GeneratedMeal): string {
  return [
    row.name,
    row.calories ?? "",
    row.protein ?? "",
    row.ingredients ?? "",
    row.ratio,
    row.isStandaloneFood ? 1 : 0,
  ].join("||");
}

/** Nombre de portions représentées par une ligne générée. */
export function getGeneratedMealPortionCount(row: GeneratedMeal): number {
  if (row.portionCount != null && row.portionCount >= 1) return Math.floor(row.portionCount);
  return 1;
}

/**
 * Regroupe les lignes générées identiques et cumule leurs portions planifiées.
 */
export function groupGeneratedMealRows(
  rows: GeneratedMeal[],
): Array<{ row: GeneratedMeal; count: number }> {
  const map = new Map<string, { row: GeneratedMeal; count: number }>();
  for (const row of rows) {
    const key = generatedMealGroupKey(row);
    const portions = getGeneratedMealPortionCount(row);
    const existing = map.get(key);
    if (existing) {
      existing.count += portions;
    } else {
      map.set(key, { row: { ...row, portionCount: portions }, count: portions });
    }
  }
  return Array.from(map.values());
}

/**
 * Formate la pastille de quantité (xN ou %) pour une ligne générée.
 * `groupedCount` = total de portions après fusion des doublons.
 */
export function formatGeneratedMealQuantityBadge(row: GeneratedMeal, groupedCount: number): string {
  if (row.ratio > 0 && row.ratio < 1) return `${Math.round(row.ratio * 100)}%`;
  const n = Math.max(1, groupedCount);
  return `x${n}`;
}

/** Somme des portions affichées (alignée sur les pastilles xN). */
export function sumGroupedMealPortions(
  grouped: Array<{ row: GeneratedMeal; count: number }>,
): number {
  return grouped.reduce((sum, g) => {
    if (g.row.ratio > 0 && g.row.ratio < 1) return sum + 1;
    return sum + Math.max(1, g.count);
  }, 0);
}

/**
 * Calcule combien de portions d’un aliment-repas autonome restent dans le stock virtuel.
 * Priorité : stock.grammes / grammage unitaire de la fiche, sinon stock.count.
 * Si une fiche catalogue homonyme a un grammage portion, on s’en sert pour découper un pack (ex. 750g → 2×375g).
 */
export function resolveStandalonePortionCount(
  fi: FoodItem,
  virtualStock: Map<string, StockInfo>,
  meals: Meal[] = [],
): number {
  const key = findStockKey(virtualStock, fi.name);
  if (!key) return 0;
  const stock = virtualStock.get(key)!;
  if (stock.infinite) return 1;

  const unitGrams = parseQty(fi.grams);
  const matchingMeal = meals.find((m) => strictNameMatch(m.name, fi.name));
  const recipeGrams = parseQty(matchingMeal?.grams ?? null);

  let best = 0;
  if (unitGrams > 0) {
    best = Math.max(best, Math.floor((stock.grams + 1e-6) / unitGrams));
  }
  // Pack unique (ex. 750g) découpé via la portion catalogue (375g) → x2.
  if (recipeGrams > 0 && stock.grams > 0) {
    best = Math.max(best, Math.floor((stock.grams + 1e-6) / recipeGrams));
  }
  if (stock.count > 0) {
    best = Math.max(best, Math.floor(stock.count));
  }
  return best;
}

/**
 * Retire `portions` unités d’un aliment autonome du stock virtuel.
 * Retourne false si le stock ne suffit pas.
 */
function tryConsumeStandaloneIsMealFood(
  fi: FoodItem,
  virtualStock: Map<string, StockInfo>,
  portions: number,
  meals: Meal[] = [],
): boolean {
  if (portions < 1) return false;
  const key = findStockKey(virtualStock, fi.name);
  if (!key) return false;
  const stock = virtualStock.get(key)!;
  if (stock.infinite) return true;

  const unitGrams = parseQty(fi.grams);
  const matchingMeal = meals.find((m) => strictNameMatch(m.name, fi.name));
  const recipeGrams = parseQty(matchingMeal?.grams ?? null);
  // Même logique que resolveStandalonePortionCount : portion = fiche ou grammage catalogue.
  let portionGrams = 0;
  if (unitGrams > 0 && recipeGrams > 0) {
    const byUnit = Math.floor((stock.grams + 1e-6) / unitGrams);
    const byRecipe = Math.floor((stock.grams + 1e-6) / recipeGrams);
    portionGrams = byRecipe > byUnit ? recipeGrams : unitGrams;
  } else {
    portionGrams = unitGrams > 0 ? unitGrams : recipeGrams > 0 ? recipeGrams : 0;
  }

  if (portionGrams > 0) {
    const need = portionGrams * portions;
    if (need <= 0 || stock.grams < need - 1e-6) return false;
    stock.grams = Math.max(0, stock.grams - need);
    if (stock.count > 0) {
      stock.count = Math.max(0, stock.count - portions);
    }
    return true;
  }
  if (stock.count >= portions) {
    stock.count -= portions;
    return true;
  }
  return false;
}

/**
 * Copie la carte de stock pour simuler l’effet d’un repas sans modifier le stock réel.
 */
function cloneVirtualStock(m: Map<string, StockInfo>): Map<string, StockInfo> {
  return new Map([...m.entries()].map(([k, v]) => [k, { ...v }]));
}

/**
 * Mesure un coût de « gaspillage » sur le stock restant : grammes + unités (œufs, etc.)
 * avec une pénalité supplémentaire pour les tout petits restes (ex. 1 œuf), afin de
 * favoriser les enchaînements qui vident au mieux le stock.
 */
function measureLeftoverWaste(stock: Map<string, StockInfo>): number {
  const COUNT_UNIT = 100;
  const TINY_COUNT_EXTRA = 85;
  let w = 0;
  for (const [, info] of stock) {
    if (info.infinite) continue;
    w += info.grams;
    w += info.count * COUNT_UNIT;
    if (info.count > 0 && info.count <= 2) w += info.count * TINY_COUNT_EXTRA;
  }
  return w;
}

/**
 * Indique si une fiche plat est un « raccourci » (snack / aliment seul) : un seul ingrédient
 * obligatoire dont le nom correspond au titre. Exclu du générateur car ce n'est pas une recette.
 */
export function isShortcutStandalonePlat(meal: Meal): boolean {
  if (!meal.ingredients?.trim()) return false;
  const groups = parseIngredientGroups(meal.ingredients);
  const mandatory: string[] = [];
  for (const group of groups) {
    for (const alt of group) {
      for (const item of alt) {
        if (item.optional) continue;
        mandatory.push(item.name);
      }
    }
  }
  if (mandatory.length !== 1) return false;
  return strictNameMatch(mandatory[0], meal.name);
}

/** Marge (score « invendus ») en dessous de laquelle deux plats sont considérés équivalents côté stock. */
const WASTE_TIE_EPS = 40;
/** Pénalité douce par répétition de recette pour favoriser la diversité à restes comparables. */
const DIVERSITY_REPEAT_PENALTY = 18;

/**
 * Indique si le candidat A est préférable à B : d'abord moins de restes, puis plus de portions
 * consommées d’un coup (vider le stock), puis variété, puis calories — sans tirage au sort.
 */
export function isPreferredMaxMealChoice(
  wasteA: number,
  servingsA: number,
  timesPickedA: number,
  caloriesA: number | null,
  nameA: string,
  wasteB: number,
  servingsB: number,
  timesPickedB: number,
  caloriesB: number | null,
  nameB: string,
): boolean {
  const adjustedA = wasteA + timesPickedA * DIVERSITY_REPEAT_PENALTY;
  const adjustedB = wasteB + timesPickedB * DIVERSITY_REPEAT_PENALTY;
  if (adjustedA < adjustedB - WASTE_TIE_EPS) return true;
  if (adjustedA > adjustedB + WASTE_TIE_EPS) return false;
  if (wasteA < wasteB - WASTE_TIE_EPS) return true;
  if (wasteA > wasteB + WASTE_TIE_EPS) return false;
  // À restes comparables, on préfère la recette qui consomme plus de portions d’un coup
  // (ex. 2×3 œufs vide mieux le stock que 1×4 œufs).
  if (servingsA !== servingsB) return servingsA > servingsB;
  if (timesPickedA !== timesPickedB) return timesPickedA < timesPickedB;
  const calA = caloriesA ?? Number.POSITIVE_INFINITY;
  const calB = caloriesB ?? Number.POSITIVE_INFINITY;
  if (calA !== calB) return calA < calB;
  return nameA.localeCompare(nameB, "fr", { sensitivity: "base" }) < 0;
}

/**
 * Exécute la simulation gloutonne (même logique que le bouton « Générer ») : liste de plats
 * et blocs reste en stock, à partir des aliments et repas actuels.
 * À chaque étape, on évalue le reste APRÈS avoir pris toutes les portions entières possibles
 * de la recette candidate (pas une seule), pour privilégier les recettes qui vident le stock.
 */
function runMaxPlatSimulation(
  foodItems: FoodItem[],
  meals: Meal[],
  morningMealFoodItemIds: Set<string> = new Set(),
): {
  results: GeneratedMeal[];
  remaining: RemainingFoodLine[];
} {
  const morningFoodItems = foodItems.filter((fi) => morningMealFoodItemIds.has(fi.id));
  const originalStock = buildStockMap(foodItems);
  const virtualStock = new Map<string, StockInfo>();
  for (const [key, info] of originalStock.entries()) {
    virtualStock.set(key, { ...info });
  }

  const platMeals = meals.filter((m) => {
    if (m.category !== "plat" || !m.ingredients?.trim()) return false;
    if (isShortcutStandalonePlat(m)) return false;
    if (isMorningMealPlat(m, morningFoodItems)) return false;
    const n = m.name.toLowerCase().replace(/\s+/g, " ");
    if (n.includes("avant grimpe")) return false;
    if (n.includes("pain + fuet") || n.includes("pain+fuet")) return false;
    return true;
  });
  // Ordre stable (pas de shuffle) : le choix se fait uniquement sur le score de reste.
  const candidates = [...platMeals].sort((a, b) =>
    a.name.localeCompare(b.name, "fr", { sensitivity: "base" }),
  );
  const fromRecipes: GeneratedMeal[] = [];
  const usedMealIdCounts = new Map<string, number>();
  let changed = true;
  let guard = 0;
  const maxIterations = 2000;
  while (changed && guard < maxIterations) {
    guard++;
    changed = false;
    let bestPick: {
      meal: Meal;
      ratio: number;
      servings: number;
      waste: number;
      timesPicked: number;
    } | null = null;

    for (const meal of candidates) {
      const multiple = getMealMultiple(meal, virtualStock);
      if (multiple === null || multiple <= 0 || multiple === Infinity) continue;

      const fullServings = Math.floor(multiple);
      const partialRatio = multiple >= 0.5 && multiple < 1 ? multiple : null;
      if (fullServings < 1 && !partialRatio) continue;

      const servings = fullServings >= 1 ? fullServings : 1;
      const ratio = fullServings >= 1 ? 1 : (partialRatio as number);

      const trial = cloneVirtualStock(virtualStock);
      let ok = true;
      for (let i = 0; i < servings; i++) {
        if (!deductMealServingFromVirtualStock(meal, trial, ratio)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const wasteAfter = measureLeftoverWaste(trial);
      const timesPicked = usedMealIdCounts.get(meal.id) ?? 0;
      const candidateCalories = computeIngredientCalories(meal.ingredients);
      if (
        !bestPick ||
        isPreferredMaxMealChoice(
          wasteAfter,
          servings,
          timesPicked,
          candidateCalories,
          meal.name,
          bestPick.waste,
          bestPick.servings,
          bestPick.timesPicked,
          computeIngredientCalories(bestPick.meal.ingredients),
          bestPick.meal.name,
        )
      ) {
        bestPick = { meal, ratio, servings, waste: wasteAfter, timesPicked };
      }
    }

    if (bestPick) {
      const { meal: bestMeal, ratio: bestRatio } = bestPick;
      // On n’applique qu’une portion à la fois : la variété entre recettes reste possible
      // aux itérations suivantes (ex. tenders répartis sur plusieurs plats).
      const servingsToCommit = 1;
      usedMealIdCounts.set(bestMeal.id, (usedMealIdCounts.get(bestMeal.id) ?? 0) + 1);
      const scaledMeal =
        bestRatio !== 1 ? buildScaledMealForRatio(bestMeal, bestRatio, virtualStock) : bestMeal;
      deductMealServingFromVirtualStock(bestMeal, virtualStock, bestRatio);

      const cal = computeIngredientCalories(scaledMeal.ingredients);
      const pro = computeIngredientProtein(scaledMeal.ingredients);
      fromRecipes.push({
        name: bestMeal.name,
        calories: cal != null ? Math.round(cal) : null,
        protein: pro != null ? Math.round(pro) : null,
        ingredients: cleanIngredientText(scaledMeal.ingredients || ""),
        ratio: bestRatio,
        portionCount: servingsToCommit,
        isStandaloneFood: false,
      });
      changed = true;
    }
  }

  const recipeNameKeys = new Set(platMeals.map((m) => normalizeKey(m.name)));
  const fromIsMeal: GeneratedMeal[] = [];
  const seenStandaloneKeys = new Set<string>();
  const isMealItems = foodItems.filter((fi) => fi.is_meal && !morningMealFoodItemIds.has(fi.id));
  for (const fi of isMealItems) {
    if (recipeNameKeys.has(normalizeKey(fi.name))) continue;
    const stockKey = findStockKey(virtualStock, fi.name);
    if (!stockKey || seenStandaloneKeys.has(stockKey)) continue;
    const portions = resolveStandalonePortionCount(fi, virtualStock, meals);
    if (portions < 1) continue;
    if (!tryConsumeStandaloneIsMealFood(fi, virtualStock, portions, meals)) continue;
    seenStandaloneKeys.add(stockKey);

    const calVal = fi.calories ? parseFloat(fi.calories.replace(/[^0-9.,]/g, "").replace(",", ".")) || null : null;
    const proVal = fi.protein ? parseFloat(fi.protein.replace(/[^0-9.,]/g, "").replace(",", ".")) || null : null;
    fromIsMeal.push({
      name: `🍱 ${fi.name}`,
      calories: calVal ? Math.round(calVal) : null,
      protein: proVal ? Math.round(proVal) : null,
      ingredients: "",
      ratio: 1,
      portionCount: portions,
      isStandaloneFood: true,
    });
  }

  fromRecipes.sort((a, b) => (b.calories ?? 0) - (a.calories ?? 0));
  fromIsMeal.sort((a, b) => (b.calories ?? 0) - (a.calories ?? 0));
  const results = [...fromRecipes, ...fromIsMeal];
  const remaining = buildRemainingFoodLines(virtualStock, foodItems, originalStock, meals);
  return { results, remaining };
}

/**
 * Affiche les pastilles comme FoodItemCard (#, unité g, → reste). Si une seule unité au départ
 * et qu’il reste un entamé, n’affiche que la pastille jaune (→ g) pour alléger la ligne.
 */
function RemainingStockPills({ row }: { row: RemainingFoodLine }) {
  if (row.flatLabel) {
    return (
      <span className="shrink-0 text-muted-foreground tabular-nums text-[10px] sm:text-xs">
        {row.flatLabel}
      </span>
    );
  }
  const uneSeuleQuantite = row.hideUnitGramsWhenSingle === true;
  const hideSingleCount =
    row.originalCount != null &&
    Math.abs(row.originalCount - 1) < 0.001 &&
    (row.unitGramsDisplay != null || row.remainingGramsDisplay != null);
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0">
      {row.originalCount != null && row.originalCount > 0 && !hideSingleCount && (
        <span className="text-[10px] font-semibold text-foreground/90 bg-white/20 border border-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 dark:text-white/90">
          <Hash className="h-2.5 w-2.5 shrink-0 opacity-80" />
          {formatCountForHash(row.originalCount)}
        </span>
      )}
      {!uneSeuleQuantite && row.unitGramsDisplay ? (
        <span className="text-[10px] text-foreground/80 bg-white/15 border border-white/15 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 dark:text-white/70">
          <Weight className="h-2.5 w-2.5 shrink-0 opacity-80" />
          {row.unitGramsDisplay}
        </span>
      ) : null}
      {row.remainingGramsDisplay ? (
        <span className="text-[10px] font-semibold text-amber-50 bg-amber-500/35 border border-amber-300/30 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-[0_0_0_1px_rgba(0,0,0,0.05)]">
          <span aria-hidden>→</span>
          {row.remainingGramsDisplay}
        </span>
      ) : null}
    </div>
  );
}

export default function MaxMealGenerator({ foodItems, meals }: Props) {
  const { setPreference, getPreference } = usePreferences();
  const morningMealFoodItemIds = getPreference<string[]>(MORNING_MEAL_PREF_KEY, []);
  const morningMealFoodItemIdSet = useMemo(
    () => new Set(morningMealFoodItemIds),
    [morningMealFoodItemIds],
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedMeal[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [sortBy, setSortBy] = useState<MaxMealSort>("expiration");
  const [remainingAfterSimulation, setRemainingAfterSimulation] = useState<RemainingFoodLine[]>([]);
  const lastRunDepsKeyRef = useRef<string | null>(null);
  const depsKey = buildMaxMealGeneratorDepsKey(foodItems, meals, morningMealFoodItemIds);

  /**
   * Restaure la session si elle correspond au stock / recettes actuels, sinon relance la simulation
   * dès qu’une génération a déjà eu lieu, pour ne pas exiger de recliquer sur « Générer ».
   */
  useEffect(() => {
    if (lastRunDepsKeyRef.current !== depsKey) {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals, morningMealFoodItemIdSet);
            setHasGenerated(true);
            setResults(r);
            setRemainingAfterSimulation(rem);
            lastRunDepsKeyRef.current = depsKey;
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results: r, remaining: rem, depsKey }));
            return;
          }
          if (parsed && typeof parsed === "object" && "results" in parsed) {
            const p = parsed as { results: GeneratedMeal[]; remaining?: unknown[]; depsKey?: string };
            if (p.depsKey === depsKey && Array.isArray(p.results)) {
              const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals, morningMealFoodItemIdSet);
              setHasGenerated(true);
              setResults(r);
              setRemainingAfterSimulation(rem);
              lastRunDepsKeyRef.current = depsKey;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results: r, remaining: rem, depsKey }));
              return;
            }
            if (Array.isArray(p.results)) {
              const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals, morningMealFoodItemIdSet);
              setHasGenerated(true);
              setResults(r);
              setRemainingAfterSimulation(rem);
              lastRunDepsKeyRef.current = depsKey;
              sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results: r, remaining: rem, depsKey }));
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (!hasGenerated) return;
    try {
      const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals, morningMealFoodItemIdSet);
      lastRunDepsKeyRef.current = depsKey;
      setResults(r);
      setRemainingAfterSimulation(rem);
      setHasGenerated(true);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results: r, remaining: rem, depsKey }));
    } catch {
      toast({ title: "Erreur", description: "Impossible de générer les plats.", variant: "destructive" });
    }
  }, [depsKey, hasGenerated]);

  // Persister dans la DB
  const dbSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dbSyncRef.current) clearTimeout(dbSyncRef.current);
    dbSyncRef.current = setTimeout(() => {
      setPreference.mutate({ key: 'max_meal_sort_by', value: sortBy });
    }, 1000);
  }, [sortBy, setPreference]);

  const generate = () => {
    setLoading(true);
    setTimeout(() => {
      try {
        const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals, morningMealFoodItemIdSet);
        const k = buildMaxMealGeneratorDepsKey(foodItems, meals, morningMealFoodItemIds);
        lastRunDepsKeyRef.current = k;
        setResults(r);
        setRemainingAfterSimulation(rem);
        setHasGenerated(true);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results: r, remaining: rem, depsKey: k }));
      } catch {
        toast({ title: "Erreur", description: "Impossible de générer les plats.", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === "none") return 0;
    const pri = (a.isStandaloneFood ? 1 : 0) - (b.isStandaloneFood ? 1 : 0);
    if (pri !== 0) return pri;
    if (sortBy === "expiration") {
      const ea = getGeneratedMealEarliestExpiration(a, foodItems);
      const eb = getGeneratedMealEarliestExpiration(b, foodItems);
      if (ea && eb) {
        const cmp = ea.localeCompare(eb);
        if (cmp !== 0) return cmp;
      } else if (ea) return -1;
      else if (eb) return 1;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    }
    if (sortBy === "first_ingredient") {
      const ka = getFirstIngredientSortKey(a);
      const kb = getFirstIngredientSortKey(b);
      const cmp = ka.localeCompare(kb, "fr", { sensitivity: "base" });
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    }
    const valA = a.calories ?? 0;
    const valB = b.calories ?? 0;
    return sortBy === "desc" ? valB - valA : valA - valB;
  });
  const groupedResults = groupGeneratedMealRows(sortedResults);
  const totalPortions = sumGroupedMealPortions(groupedResults);

  const toggleCaloriesSort = () => {
    setSortBy((prev) => {
      if (prev === "first_ingredient") return "desc";
      if (prev === "desc") return "asc";
      if (prev === "asc") return "none";
      return "desc";
    });
  };

  const toggleFirstIngredientSort = () => {
    setSortBy((prev) => (prev === "first_ingredient" ? "desc" : "first_ingredient"));
  };
  const toggleExpirationSort = () => {
    setSortBy((prev) => (prev === "expiration" ? "desc" : "expiration"));
  };
  const remainingByStorage = {
    frigo: remainingAfterSimulation.filter((r) => r.storageGroup === "frigo"),
    sec: remainingAfterSimulation.filter((r) => r.storageGroup === "sec"),
    surgele: remainingAfterSimulation.filter((r) => r.storageGroup === "surgele"),
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Plats max faisables
          </h2>
          {hasGenerated && <span className="text-sm font-normal text-muted-foreground">{totalPortions}</span>}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          <div className="mb-3 space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={generate} disabled={loading} className="gap-1 text-xs rounded-xl">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Générer
              </Button>
              {results.length > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleExpirationSort}
                    className={`gap-1.5 text-[10px] h-8 rounded-xl border-dashed ${
                      sortBy === "expiration" ? "bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400" : ""
                    }`}
                  >
                    <CalendarDays className="h-3 w-3" />
                    Péremption
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleCaloriesSort}
                    className={`gap-1.5 text-[10px] h-8 rounded-xl border-dashed ${
                      sortBy === "desc" || sortBy === "asc"
                        ? "bg-orange-500/10 border-orange-500/30 text-orange-600"
                        : ""
                    }`}
                  >
                    {sortBy === "first_ingredient" ? (
                      <ArrowUpDown className="h-3 w-3 opacity-40" />
                    ) : sortBy === "none" ? (
                      <ArrowUpDown className="h-3 w-3" />
                    ) : sortBy === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    Calories
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleFirstIngredientSort}
                    className={`gap-1.5 text-[10px] h-8 rounded-xl border-dashed ${
                      sortBy === "first_ingredient" ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400" : ""
                    }`}
                  >
                    <ListOrdered className="h-3 w-3" />
                    1er ingr.
                  </Button>
                </>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Enchaînements qui vident le stock d’abord (préfère la recette qui peut tout utiliser, ex. 2×3 œufs plutôt que 1×4), puis variété — sans tirage au sort
            </p>
          </div>

          {hasGenerated && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              Aucun plat réalisable avec les aliments disponibles.
            </p>
          )}

          {groupedResults.length > 0 && (
            <div className="flex flex-col gap-2">
              {groupedResults.map(({ row: r, count }, i) => (
                <div key={i} className="flex flex-col rounded-2xl px-3 py-2.5 bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground flex-1 truncate">{r.name}</p>
                    <span
                      className={`font-black text-amber-600 dark:text-amber-400 bg-amber-500/20 rounded-full shrink-0 ${
                        count > 1 ? "text-sm px-2 py-0.5" : "text-[10px] px-1.5 py-0.5"
                      }`}
                    >
                      {formatGeneratedMealQuantityBadge(r, count)}
                    </span>
                    {r.calories !== null && (
                      <span className="text-[10px] font-bold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        🔥 {r.calories}
                      </span>
                    )}
                    {r.protein !== null && (
                      <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                        🍗 {r.protein}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const exp = formatExpirationLabel(getGeneratedMealEarliestExpiration(r, foodItems));
                    if (!r.ingredients && !exp) return null;
                    return (
                      <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground break-words whitespace-normal">
                        {r.ingredients}
                        {exp ? (
                          <span className="ml-1 text-muted-foreground/75 tabular-nums whitespace-nowrap">
                            {exp}
                          </span>
                        ) : null}
                      </p>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}

          {hasGenerated && results.length > 0 && (
            <div className="mt-4 rounded-2xl border border-border/60 bg-gradient-to-b from-muted/30 to-muted/10 px-3.5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1.5 mb-2.5">
                <Package className="h-3.5 w-3.5 shrink-0" />
                Reste en stock (si tu fais cette liste, simulation)
              </p>
              {remainingAfterSimulation.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Aucun reste à afficher : tout le stock simulé est utilisé, ou seuls des aliments « infinis » restent (non listés).
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-2 rounded-xl border border-sky-300/20 bg-sky-500/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-300/80">Frigo</p>
                    {remainingByStorage.frigo.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">Aucun</p>
                    ) : (
                      <ul className="flex w-full flex-col gap-1.5 text-xs text-foreground">
                        {remainingByStorage.frigo.map((row, j) => (
                          <li
                            key={`frigo-${j}`}
                            className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-foreground rounded-lg bg-background/20 px-2 py-1.5"
                          >
                            <span className="font-medium shrink-0">{row.displayName}</span>
                            <RemainingStockPills row={row} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="space-y-2 rounded-xl border border-amber-300/20 bg-amber-500/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-300/80">Sec</p>
                    {remainingByStorage.sec.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">Aucun</p>
                    ) : (
                      <ul className="flex w-full flex-col gap-1.5 text-xs text-foreground">
                        {remainingByStorage.sec.map((row, j) => (
                          <li
                            key={`sec-${j}`}
                            className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-foreground rounded-lg bg-background/20 px-2 py-1.5"
                          >
                            <span className="font-medium shrink-0">{row.displayName}</span>
                            <RemainingStockPills row={row} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="space-y-2 rounded-xl border border-indigo-300/20 bg-indigo-500/5 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-300/80">Surgelée</p>
                    {remainingByStorage.surgele.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">Aucun</p>
                    ) : (
                      <ul className="flex w-full flex-col gap-1.5 text-xs text-foreground">
                        {remainingByStorage.surgele.map((row, j) => (
                          <li
                            key={`surgele-${j}`}
                            className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-foreground rounded-lg bg-background/20 px-2 py-1.5"
                          >
                            <span className="font-medium shrink-0">{row.displayName}</span>
                            <RemainingStockPills row={row} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
