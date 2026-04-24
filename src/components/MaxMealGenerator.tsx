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
 * - Choix glouton : 1) minimiser les restes, 2) si stock final comparable (seuil), préférer
 *   une fiche recette moins souvent choisie pour limiter la répétition (ex. tenders répartis
 *   sur burrito, sandwich, gaufrette plutôt que 3× la même ligne).
 * - Tri par calories (ascendant/descendant) ou par premier ingrédient (regroupe les mêmes têtes de liste).
 * - Persistance des résultats en sessionStorage ; recalcul automatique si aliments / recettes changent
 * - Inclut en second les aliments "is_meal" seulement s'il n'existe pas déjà
 *   une recette plat homonyme dans le catalogue, et si le stock restant le permet.
 * - Sous la liste : comme sur les cartes (#, unité g, → reste) ; péremption / surgelé ; seulement ingrédients de plats.
 *
 */
import { useState, useEffect, useRef } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { ChevronDown, ChevronRight, Loader2, ListOrdered, Package, Zap, ArrowUpDown, ArrowUp, ArrowDown, Hash, Weight } from "lucide-react";
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
  getFoodItemTotalGrams,
  parseQty,
  parseIngredientGroups,
  type StockInfo,
} from "@/lib/stockUtils";
import { computeIngredientCalories, computeIngredientProtein, cleanIngredientText } from "@/lib/ingredientUtils";

/** Modes de tri de la liste générée (calories ou 1er ingrédient). */
type MaxMealSort = "none" | "asc" | "desc" | "first_ingredient";

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
  /** true si la ligne vient d'un aliment is_meal sans recette catalogue (affichage après les recettes). */
  isStandaloneFood?: boolean;
}

const SESSION_KEY = "max_meal_generator_results";

/**
 * Empreinte stable des aliments et des fiches repas : quand elle change, la simulation est
 * recalculée automatiquement pour refléter le stock et les recettes à jour.
 */
function buildMaxMealGeneratorDepsKey(foodItems: FoodItem[], meals: Meal[]): string {
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
  return JSON.stringify({ f, m });
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
  flatLabel?: string;
}

/**
 * Indique si un aliment peut figurer dans le bloc « reste en stock » : exclu si tout est
 * en « extras » ou infini, ou s’il n’y a ni date de péremption (sur une fiche hors extras) ni
 * fiche en surgelé — le casier surgelé est affiché même sans date, comme en usage courant.
 */
function foodKeyIsShownInRemainingSimulation(key: string, foodItems: FoodItem[]): boolean {
  const matches = foodItems.filter((fi) => normalizeKey(fi.name) === key);
  if (matches.length === 0) return false;
  const nonExtra = matches.filter((fi) => fi.storage_type !== "extras");
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
    (fi) => fi.storage_type !== "extras" && normalizeKey(fi.name) === key
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
  if (typeof o.flatLabel === "string" && o.flatLabel.length > 0) {
    return { displayName, ...emptyRemainingFields(), flatLabel: o.flatLabel };
  }
  if (o.quantityLabel != null && o.remainingGramsDisplay === undefined && o.gramsDisplay === undefined) {
    return { displayName, ...emptyRemainingFields(), flatLabel: String(o.quantityLabel) };
  }
  if (o.originalCount != null || o.unitGramsDisplay != null || o.remainingGramsDisplay != null) {
    const oc =
      typeof o.originalCount === "number" && !Number.isNaN(o.originalCount) && o.originalCount > 0
        ? o.originalCount
        : null;
    const ug = typeof o.unitGramsDisplay === "string" && o.unitGramsDisplay.length > 0 ? o.unitGramsDisplay : null;
    const rg =
      typeof o.remainingGramsDisplay === "string" && o.remainingGramsDisplay.length > 0 ? o.remainingGramsDisplay : null;
    if (oc != null || ug != null || rg != null) {
      return { displayName, originalCount: oc, unitGramsDisplay: ug, remainingGramsDisplay: rg };
    }
  }
  if (typeof o.gramsDisplay === "string" || (typeof o.count === "number" && o.originalCount === undefined)) {
    const c = typeof o.count === "number" && !Number.isNaN(o.count) && o.count > 0 ? o.count : null;
    const g = typeof o.gramsDisplay === "string" && o.gramsDisplay.length > 0 ? o.gramsDisplay : null;
    if (c != null || g != null) {
      const parts = [c != null ? `#${formatCountForHash(c)}` : "", g ?? ""].filter(Boolean);
      return { displayName, ...emptyRemainingFields(), flatLabel: parts.join(" ") };
    }
  }
  const after = o.afterPillText != null ? String(o.afterPillText) : "";
  if (after) {
    const p = parseSnapshotTextToRemaining(after);
    if (p.count != null || p.gramsDisplay != null) {
      const parts = [p.count != null ? `#${formatCountForHash(p.count)}` : "", p.gramsDisplay ?? ""].filter(Boolean);
      return { displayName, ...emptyRemainingFields(), flatLabel: parts.join(" ") };
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
 * relevant exclusivement d’ « extras », du stock infini, ou sans date de péremption sur
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
  for (const fi of foodItems) {
    if (fi.storage_type === "extras") continue;
    const k = normalizeKey(fi.name);
    if (!displayNameByKey.has(k)) displayNameByKey.set(k, fi.name.trim());
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
    const originalCount = orig.count > 0 ? orig.count : null;
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
    if (remainingGramsDisplay == null && originalCount == null && unitGramsDisplay == null) continue;
    out.push({
      displayName: displayNameByKey.get(key) ?? key,
      originalCount,
      unitGramsDisplay,
      remainingGramsDisplay,
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
 * Tente de retirer du stock virtuel l'équivalent d'un aliment autonome (is_meal) lorsqu'il
 * n'a pas d'équivalent en recette : une portion = l'item aliment (grammes totaux ou unités).
 * Sert à n'ajouter la ligne "repas seul" que si le stock restant suffit après la simulation.
 */
function tryConsumeStandaloneIsMealFood(fi: FoodItem, virtualStock: Map<string, StockInfo>): boolean {
  const key = findStockKey(virtualStock, fi.name);
  if (!key) return false;
  const stock = virtualStock.get(key)!;
  if (stock.infinite) return true;
  const unitGrams = parseQty(fi.grams);
  if (unitGrams > 0) {
    const need = getFoodItemTotalGrams(fi);
    if (need <= 0) return false;
    if (stock.grams < need) return false;
    stock.grams = Math.max(0, stock.grams - need);
    return true;
  }
  if (fi.quantity != null && fi.quantity > 0) {
    if (stock.count < fi.quantity) return false;
    stock.count -= fi.quantity;
    return true;
  }
  if (stock.count > 0) {
    stock.count -= 1;
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

/** Marge (score « invendus ») en dessous de laquelle deux plats sont considérés équivalents côté stock. */
const WASTE_TIE_EPS = 35;

/**
 * Indique si le candidat A est préférable à B : d'abord moins de restes, puis moins d’utilisations
 * de la même fiche recette (variété) si le stock final reste comparable.
 */
function isPreferredMaxMealChoice(
  wasteA: number,
  timesPickedA: number,
  wasteB: number,
  timesPickedB: number
): boolean {
  if (wasteA < wasteB - WASTE_TIE_EPS) return true;
  if (wasteA > wasteB + WASTE_TIE_EPS) return false;
  if (timesPickedA < timesPickedB) return true;
  if (timesPickedA > timesPickedB) return false;
  return Math.random() < 0.5;
}

/**
 * Exécute la simulation gloutonne (même logique que le bouton « Générer ») : liste de plats
 * et blocs reste en stock, à partir des aliments et repas actuels.
 */
function runMaxPlatSimulation(foodItems: FoodItem[], meals: Meal[]): {
  results: GeneratedMeal[];
  remaining: RemainingFoodLine[];
} {
  const originalStock = buildStockMap(foodItems);
  const virtualStock = new Map<string, StockInfo>();
  for (const [key, info] of originalStock.entries()) {
    virtualStock.set(key, { ...info });
  }

  const platMeals = meals.filter((m) => {
    if (m.category !== "plat" || !m.ingredients?.trim()) return false;
    const n = m.name.toLowerCase().replace(/\s+/g, " ");
    if (n.includes("avant grimpe")) return false;
    if (n.includes("pain + fuet") || n.includes("pain+fuet")) return false;
    return true;
  });
  const fromRecipes: GeneratedMeal[] = [];
  const usedMealIdCounts = new Map<string, number>();
  const shuffled = [...platMeals].sort(() => Math.random() - 0.5);
  let changed = true;
  let guard = 0;
  const maxIterations = 2000;
  while (changed && guard < maxIterations) {
    guard++;
    changed = false;
    let bestPick: { meal: Meal; ratio: number; waste: number; timesPicked: number } | null = null;

    for (const meal of shuffled) {
      const multiple = getMealMultiple(meal, virtualStock);
      if (multiple !== null && multiple > 0 && multiple !== Infinity) {
        const ratio = Math.min(multiple, 1);
        if (ratio >= 0.5) {
          const trial = cloneVirtualStock(virtualStock);
          if (!deductMealServingFromVirtualStock(meal, trial, ratio)) continue;
          const wasteAfter = measureLeftoverWaste(trial);
          const timesPicked = usedMealIdCounts.get(meal.id) ?? 0;
          if (
            !bestPick ||
            isPreferredMaxMealChoice(wasteAfter, timesPicked, bestPick.waste, bestPick.timesPicked)
          ) {
            bestPick = { meal, ratio, waste: wasteAfter, timesPicked };
          }
        }
      }
    }

    if (bestPick) {
      const { meal: bestMeal, ratio: bestRatio } = bestPick;
      usedMealIdCounts.set(bestMeal.id, (usedMealIdCounts.get(bestMeal.id) ?? 0) + 1);
      const scaledMeal =
        bestRatio !== 1 ? buildScaledMealForRatio(bestMeal, bestRatio, virtualStock) : bestMeal;
      deductMealServingFromVirtualStock(bestMeal, virtualStock, bestRatio);

      const cal = computeIngredientCalories(scaledMeal.ingredients);
      const pro = computeIngredientProtein(scaledMeal.ingredients);
      fromRecipes.push({
        name: bestMeal.name,
        calories: cal,
        protein: pro,
        ingredients: cleanIngredientText(scaledMeal.ingredients || ""),
        ratio: bestRatio,
        isStandaloneFood: false,
      });
      changed = true;
    }
  }

  const recipeNameKeys = new Set(platMeals.map((m) => normalizeKey(m.name)));
  const fromIsMeal: GeneratedMeal[] = [];
  const isMealItems = foodItems.filter((fi) => fi.is_meal);
  for (const fi of isMealItems) {
    if (recipeNameKeys.has(normalizeKey(fi.name))) continue;
    if (!tryConsumeStandaloneIsMealFood(fi, virtualStock)) continue;
    const calVal = fi.calories ? parseFloat(fi.calories.replace(/[^0-9.]/g, "")) || null : null;
    const proVal = fi.protein ? parseFloat(fi.protein.replace(/[^0-9.]/g, "")) || null : null;
    fromIsMeal.push({
      name: `🍱 ${fi.name}`,
      calories: calVal ? Math.round(calVal) : null,
      protein: proVal ? Math.round(proVal) : null,
      ingredients: "",
      ratio: 1,
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
  const uneSeuleQuantite =
    row.originalCount != null && Math.abs(row.originalCount - 1) < 0.001;
  if (uneSeuleQuantite && row.remainingGramsDisplay) {
    return (
      <div className="flex flex-wrap items-center gap-0.5 min-w-0">
        <span className="text-[10px] font-semibold text-white bg-yellow-500/40 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <span aria-hidden>→</span>
          {row.remainingGramsDisplay}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 min-w-0">
      {row.originalCount != null && row.originalCount > 0 && (
        <span className="text-[10px] font-bold text-foreground/90 bg-white/25 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 dark:text-white/90">
          <Hash className="h-2.5 w-2.5 shrink-0" />
          {formatCountForHash(row.originalCount)}
        </span>
      )}
      {row.unitGramsDisplay ? (
        <span className="text-[10px] text-foreground/80 bg-white/20 px-1.5 py-0.5 rounded-full flex items-center gap-0.5 dark:text-white/70">
          <Weight className="h-2.5 w-2.5 shrink-0" />
          {row.unitGramsDisplay}
        </span>
      ) : null}
      {row.remainingGramsDisplay ? (
        <span className="text-[10px] font-semibold text-white bg-yellow-500/40 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <span aria-hidden>→</span>
          {row.remainingGramsDisplay}
        </span>
      ) : null}
    </div>
  );
}

export default function MaxMealGenerator({ foodItems, meals }: Props) {
  const { getPreference, setPreference } = usePreferences();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedMeal[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [sortBy, setSortBy] = useState<MaxMealSort>("desc");
  const [remainingAfterSimulation, setRemainingAfterSimulation] = useState<RemainingFoodLine[]>([]);
  const lastRunDepsKeyRef = useRef<string | null>(null);
  const depsKey = buildMaxMealGeneratorDepsKey(foodItems, meals);

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
            const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals);
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
              setHasGenerated(true);
              setResults(p.results);
              setRemainingAfterSimulation(
                Array.isArray(p.remaining)
                  ? p.remaining.map(remainingLineFromCache).filter((x): x is RemainingFoodLine => x != null)
                  : []
              );
              lastRunDepsKeyRef.current = depsKey;
              return;
            }
            if (Array.isArray(p.results)) {
              const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals);
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
    if (lastRunDepsKeyRef.current === depsKey) return;
    try {
      const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals);
      lastRunDepsKeyRef.current = depsKey;
      setResults(r);
      setRemainingAfterSimulation(rem);
      setHasGenerated(true);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ results: r, remaining: rem, depsKey }));
    } catch {
      toast({ title: "Erreur", description: "Impossible de générer les plats.", variant: "destructive" });
    }
  }, [depsKey, hasGenerated]);

  // Synchroniser le mode de tri de la DB avec l'état local
  useEffect(() => {
    const dbSort = getPreference<MaxMealSort>("max_meal_sort_by", null as any);
    if (dbSort) setSortBy(dbSort);
  }, [getPreference]);

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
        const { results: r, remaining: rem } = runMaxPlatSimulation(foodItems, meals);
        const k = buildMaxMealGeneratorDepsKey(foodItems, meals);
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

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4 mt-4">
      <div className="flex items-center gap-2 w-full">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Plats max faisables
          </h2>
          {hasGenerated && <span className="text-sm font-normal text-muted-foreground">{results.length}</span>}
        </button>
      </div>

      {open && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-3">
            <Button size="sm" onClick={generate} disabled={loading} className="gap-1 text-xs rounded-xl">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Générer
            </Button>
            {results.length > 0 && (
              <>
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
            <span className="text-[10px] text-muted-foreground ml-1">Enchaînements qui vident le stock d’abord, puis variété (éviter la même recette si une autre option laisse un stock comparable)</span>
          </div>

          {hasGenerated && results.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4 italic">
              Aucun plat réalisable avec les aliments disponibles.
            </p>
          )}

          {sortedResults.length > 0 && (
            <div className="flex flex-col gap-2">
              {sortedResults.map((r, i) => (
                <div key={i} className="flex flex-col rounded-2xl px-3 py-2.5 bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm text-foreground flex-1 truncate">{r.name}</p>
                    <span className="text-[10px] font-black text-amber-600 dark:text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                      {r.ratio >= 1 && Number.isInteger(r.ratio) ? `x${r.ratio}` : `${Math.round(r.ratio * 100)}%`}
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
                  {r.ingredients && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {r.ingredients}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasGenerated && results.length > 0 && (
            <div className="mt-4 rounded-2xl border border-dashed border-border/60 bg-muted/20 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5">
                <Package className="h-3.5 w-3.5 shrink-0" />
                Reste en stock (si tu fais cette liste, simulation)
              </p>
              {remainingAfterSimulation.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Aucun reste à afficher : tout le stock simulé est utilisé, ou seuls des aliments « infinis » restent (non listés).
                </p>
              ) : (
                <ul className="flex w-full flex-col gap-1.5 text-xs text-foreground">
                  {remainingAfterSimulation.map((row, j) => (
                    <li
                      key={j}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground"
                    >
                      <span className="font-medium shrink-0">{row.displayName}</span>
                      <RemainingStockPills row={row} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
