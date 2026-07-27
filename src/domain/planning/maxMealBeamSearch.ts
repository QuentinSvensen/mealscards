/**
 * Recherche beam du plan de plats maximisant le nombre de portions
 * (vivier aligné sur « Au choix »), pour « Plats max faisables ».
 */
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import { filterMealsByStockAvailability } from "@/lib/availableListPipeline";
import {
  buildStockMap,
  getMealMultiple,
  getMealFractionalRatio,
  deductMealServingFromVirtualStock,
  buildScaledMealForRatio,
  type StockInfo,
} from "@/lib/stockUtils";
import {
  computeIngredientCalories,
  computeIngredientProtein,
  cleanIngredientText,
  parseIngredientGroups,
  strictNameMatch,
} from "@/lib/ingredientUtils";

/** Portion choisie dans un plan beam (1 ligne = 1 portion, éventuellement partielle). */
export interface MaxMealBeamPick {
  meal: Meal;
  ratio: number;
}

/** Meilleur plan trouvé à un instant donné. */
export interface MaxMealBeamResult {
  picks: MaxMealBeamPick[];
  stock: Map<string, StockInfo>;
  totalPortions: number;
  waste: number;
}

export interface MaxMealBeamSearchOptions {
  beamWidth?: number;
  maxDepth?: number;
  /** Appelé après chaque profondeur avec le meilleur plan connu. */
  onProgress?: (best: MaxMealBeamResult) => void;
  /** Si true, arrête la recherche. */
  shouldCancel?: () => boolean;
  /** Pause async entre profondeurs (background UI). Défaut true pour l’async. */
  yieldBetweenDepths?: boolean;
}

/** État interne d’un chemin du beam. */
interface BeamState {
  stock: Map<string, StockInfo>;
  picks: MaxMealBeamPick[];
  usedCounts: Map<string, number>;
  waste: number;
  portions: number;
}

/** Copie profonde d’une carte de stock virtuel. */
export function cloneStockMap(m: Map<string, StockInfo>): Map<string, StockInfo> {
  return new Map([...m.entries()].map(([k, v]) => [k, { ...v }]));
}

/**
 * Mesure le « gaspillage » restant (grammes + unités, malus petits restes).
 * Sert à départager deux plans à nombre de portions égal.
 */
export function measureLeftoverWaste(stock: Map<string, StockInfo>): number {
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
 * Indique si une fiche plat est un raccourci (1 ingrédient = nom du plat).
 */
export function isMaxMealShortcutPlat(meal: Meal): boolean {
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

/**
 * Filtre les plats éligibles au générateur (hors Matin, raccourcis, noms exclus).
 */
export function filterMaxMealPlatCatalogue(
  meals: Meal[],
  morningFoodItems: FoodItem[],
): Meal[] {
  return meals.filter((m) => {
    if (m.category !== "plat" || !m.ingredients?.trim()) return false;
    if (isMaxMealShortcutPlat(m)) return false;
    if (morningFoodItems.some((fi) => strictNameMatch(fi.name, m.name))) return false;
    const n = m.name.toLowerCase().replace(/\s+/g, " ");
    if (n.includes("avant grimpe")) return false;
    if (n.includes("pain + fuet") || n.includes("pain+fuet")) return false;
    return true;
  });
}

/**
 * Vivier Au choix : plats catalogue filtrés ∩ (disponibles + partiels stock).
 */
export function buildMaxMealCandidatePool(
  meals: Meal[],
  foodItems: FoodItem[],
  morningMealFoodItemIds: Set<string> = new Set(),
): Meal[] {
  const morningFoodItems = foodItems.filter((fi) => morningMealFoodItemIds.has(fi.id));
  const catalogue = filterMaxMealPlatCatalogue(meals, morningFoodItems);
  const { available, partial } = filterMealsByStockAvailability(catalogue, foodItems);
  const ids = new Set<string>([
    ...available.map((a) => a.meal.id),
    ...partial.map((p) => p.meal.id),
  ]);
  return catalogue
    .filter((m) => ids.has(m.id))
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

/** Compare deux plans : plus de portions, puis moins de reste, puis variété, puis nom. */
export function isBetterBeamPlan(a: MaxMealBeamResult, b: MaxMealBeamResult): boolean {
  if (a.totalPortions !== b.totalPortions) return a.totalPortions > b.totalPortions;
  if (Math.abs(a.waste - b.waste) > 1e-6) return a.waste < b.waste;
  const uniqueA = new Set(a.picks.map((p) => p.meal.id)).size;
  const uniqueB = new Set(b.picks.map((p) => p.meal.id)).size;
  if (uniqueA !== uniqueB) return uniqueA > uniqueB;
  const nameA = a.picks.map((p) => p.meal.name).join("|");
  const nameB = b.picks.map((p) => p.meal.name).join("|");
  return nameA.localeCompare(nameB, "fr", { sensitivity: "base" }) < 0;
}

/** Score pour trier le beam (plus grand = meilleur à garder). */
function beamStateRank(s: BeamState): [number, number, number, string] {
  const unique = new Set(s.picks.map((p) => p.meal.id)).size;
  const names = s.picks.map((p) => p.meal.name).join("|");
  return [s.portions, -s.waste, unique, names];
}

/** Compare deux rangs beam (ordre lexicographique). */
function compareBeamRanks(
  a: [number, number, number, string],
  b: [number, number, number, string],
): number {
  if (a[0] !== b[0]) return b[0] - a[0];
  if (a[1] !== b[1]) return b[1] - a[1];
  if (a[2] !== b[2]) return b[2] - a[2];
  return a[3].localeCompare(b[3], "fr", { sensitivity: "base" });
}

/** Convertit un état beam en résultat public. */
function stateToResult(s: BeamState): MaxMealBeamResult {
  return {
    picks: s.picks.map((p) => ({ meal: p.meal, ratio: p.ratio })),
    stock: cloneStockMap(s.stock),
    totalPortions: s.portions,
    waste: s.waste,
  };
}

/**
 * Tentatives d’extension : portion entière (ratio 1) ou partielle [0.5, 1).
 * Ignore Infinity (boucle).
 */
function listFeasibleMoves(
  meal: Meal,
  stock: Map<string, StockInfo>,
): Array<{ ratio: number }> {
  const multiple = getMealMultiple(meal, stock);
  if (multiple !== null && multiple !== Infinity && multiple >= 1) {
    return [{ ratio: 1 }];
  }
  const frac = getMealFractionalRatio(meal, stock);
  if (frac !== null && frac >= 0.5 && frac < 1) {
    return [{ ratio: frac }];
  }
  return [];
}

/**
 * Une profondeur de beam : étend chaque état, garde les `beamWidth` meilleurs.
 */
function expandBeamDepth(
  beam: BeamState[],
  candidates: Meal[],
  beamWidth: number,
): BeamState[] {
  const next: BeamState[] = [];
  for (const state of beam) {
    let expanded = false;
    for (const meal of candidates) {
      const moves = listFeasibleMoves(meal, state.stock);
      for (const { ratio } of moves) {
        const trial = cloneStockMap(state.stock);
        if (!deductMealServingFromVirtualStock(meal, trial, ratio)) continue;
        const usedCounts = new Map(state.usedCounts);
        usedCounts.set(meal.id, (usedCounts.get(meal.id) ?? 0) + 1);
        next.push({
          stock: trial,
          picks: [...state.picks, { meal, ratio }],
          usedCounts,
          waste: measureLeftoverWaste(trial),
          portions: state.portions + 1,
        });
        expanded = true;
      }
    }
    if (!expanded && state.picks.length > 0) {
      next.push(state);
    }
  }
  next.sort((a, b) => compareBeamRanks(beamStateRank(a), beamStateRank(b)));
  const seen = new Set<string>();
  const pruned: BeamState[] = [];
  for (const s of next) {
    const sig = s.picks.map((p) => `${p.meal.id}@${Math.round(p.ratio * 1000)}`).join(">");
    if (seen.has(sig)) continue;
    seen.add(sig);
    pruned.push(s);
    if (pruned.length >= beamWidth) break;
  }
  return pruned;
}

/**
 * Exécute la beam search (synchrone). Utile pour les tests et le premier passage.
 */
export function runMaxMealBeamSearch(
  foodItems: FoodItem[],
  meals: Meal[],
  morningMealFoodItemIds: Set<string> = new Set(),
  options: MaxMealBeamSearchOptions = {},
): MaxMealBeamResult {
  const beamWidth = options.beamWidth ?? 60;
  const maxDepth = options.maxDepth ?? 80;
  const candidates = buildMaxMealCandidatePool(meals, foodItems, morningMealFoodItemIds);
  const initialStock = buildStockMap(foodItems);
  let beam: BeamState[] = [
    {
      stock: cloneStockMap(initialStock),
      picks: [],
      usedCounts: new Map(),
      waste: measureLeftoverWaste(initialStock),
      portions: 0,
    },
  ];
  let best = stateToResult(beam[0]!);

  for (let depth = 0; depth < maxDepth; depth++) {
    if (options.shouldCancel?.()) break;
    const prevMax = Math.max(...beam.map((s) => s.portions), 0);
    const next = expandBeamDepth(beam, candidates, beamWidth);
    if (next.length === 0) break;
    const grew = next.some((s) => s.portions > prevMax);
    beam = next;
    for (const s of beam) {
      const r = stateToResult(s);
      if (isBetterBeamPlan(r, best)) best = r;
    }
    options.onProgress?.(best);
    if (!grew) break;
  }

  return best;
}

/**
 * Beam search avec yields entre profondeurs pour ne pas bloquer l’UI.
 */
export async function runMaxMealBeamSearchAsync(
  foodItems: FoodItem[],
  meals: Meal[],
  morningMealFoodItemIds: Set<string> = new Set(),
  options: MaxMealBeamSearchOptions = {},
): Promise<MaxMealBeamResult> {
  const beamWidth = options.beamWidth ?? 60;
  const maxDepth = options.maxDepth ?? 80;
  const candidates = buildMaxMealCandidatePool(meals, foodItems, morningMealFoodItemIds);
  const initialStock = buildStockMap(foodItems);
  let beam: BeamState[] = [
    {
      stock: cloneStockMap(initialStock),
      picks: [],
      usedCounts: new Map(),
      waste: measureLeftoverWaste(initialStock),
      portions: 0,
    },
  ];
  let best = stateToResult(beam[0]!);

  for (let depth = 0; depth < maxDepth; depth++) {
    if (options.shouldCancel?.()) break;
    const prevMax = Math.max(...beam.map((s) => s.portions), 0);
    const next = expandBeamDepth(beam, candidates, beamWidth);
    if (next.length === 0) break;
    const grew = next.some((s) => s.portions > prevMax);
    beam = next;
    for (const s of beam) {
      const r = stateToResult(s);
      if (isBetterBeamPlan(r, best)) best = r;
    }
    options.onProgress?.(best);
    if (!grew) break;
    if (options.yieldBetweenDepths !== false) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return best;
}

/**
 * Transforme les picks beam en lignes d’affichage (macros / ingrédients scalés).
 */
export function beamPicksToDisplayRows(
  picks: MaxMealBeamPick[],
  stockForScaling: Map<string, StockInfo>,
): Array<{
  name: string;
  calories: number | null;
  protein: number | null;
  ingredients: string;
  ratio: number;
  portionCount: number;
  isStandaloneFood: false;
}> {
  return picks.map((pick) => {
    const scaled =
      pick.ratio !== 1
        ? buildScaledMealForRatio(pick.meal, pick.ratio, stockForScaling)
        : pick.meal;
    const cal = computeIngredientCalories(scaled.ingredients);
    const pro = computeIngredientProtein(scaled.ingredients);
    return {
      name: pick.meal.name,
      calories: cal != null ? Math.round(cal) : null,
      protein: pro != null ? Math.round(pro) : null,
      ingredients: cleanIngredientText(scaled.ingredients || ""),
      ratio: pick.ratio,
      portionCount: 1,
      isStandaloneFood: false as const,
    };
  });
}
