/**
 * AvailableList — Liste "Au choix" des repas réalisables avec le stock actuel.
 *
 * Calcule et affiche les repas faisables selon 4 sources :
 * 1. Recettes complètes (tous ingrédients disponibles, multiple ≥ 1)
 * 2. Recettes partielles (50-100% des ingrédients, ratio fractionnel)
 * 3. Correspondance par nom (repas sans ingrédients ↔ aliment en stock)
 * 4. Aliments is_meal (repas autonomes sans recette)
 *
 * Fonctionnalités avancées :
 * - Filtrage par seuil calorique restant (useRemainingCalories) — filtre séparé
 * - Filtre « 100 % » = complétude stock uniquement (multiple ≥ 1 / partiel ≥ 90 %)
 * - Sélecteur de jour (14 j) en mémoire JS : défaut = aujourd’hui, reset au F5 / déconnexion
 * - Tri par calories, protéines, note, satiété, péremption ou manuel
 * - Recherche dans les noms et ingrédients
 * - Badges de ratio personnalisable (x2, 75%, etc.)
 * - Affichage des aliments inutilisés et des items cross-catégorie périmant bientôt
 * - Aliments indivisibles : ratios discrets (getValidDiscreteRatios)
 *
 * tryFitMeal() : vérifie si un repas rentre dans le budget calorique restant
 * Pipeline unifié : `buildUnifiedAvailableItems` (src/lib/availableListPipeline.ts)
 */
import { useState, Fragment, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DragEvent, ReactNode } from "react";
import { Plus, GripVertical, CheckCircle2, RotateCcw, AlertCircle, ArrowUpDown, CalendarDays, Calendar, Box, Wand2, Flame, Drumstick, Sparkles, PieChart, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowRight, UtensilsCrossed, Infinity as InfinityIcon, Search, Hash, Scale } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealCard } from "@/components/MealCard";
import type { Meal } from "@/hooks/useMeals";
import { applyContainerReorderDrop } from "@/lib/listReorderDnD";
import { colorFromName } from "@/lib/foodColors";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import { autofillIngredientLinesMacros, resolveIngredientLineMacros } from "@/domain/macros/ingredientMacroDatabase";
import { getExtraPortionMacros, parseFoodMacroValue } from "@/lib/extraMacroUtils";
import { usePreferences } from "@/hooks/usePreferences";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import {
  buildStockMap, findStockKey, getMealMultiple, getMealMultipleAtRatio,
  analyzeMealIngredients,
  getMissingIngredients,
  getMissingQuantityForIngredient,
  buildIngredientMealIndex,
  buildFoodItemIndex,
  formatExpirationLabel, compareExpirationWithCounter, buildScaledMealForRatio,
  getIndivisibleConstrainedRatio, getValidDiscreteRatios,
  getDisplayedCalories, getDisplayedProtein, parseMacroDisplay,
  type StockInfo, type FoodItemIndex,
} from "@/lib/stockUtils";
import {
  normalizeForMatch, strictNameMatch, smartFoodContains, parseQty, formatNumeric, getFoodItemTotalGrams, parseIngredientGroups, computeIngredientCalories, computeIngredientProtein, computeCounterDays, normalizeKey, parseIngredientsToLines, serializeIngredients
} from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useCalorieBalance } from "@/hooks/useCalorieBalance";
import { DESSERT_FOOD_PREF_KEY } from "@/lib/foodDessertUtils";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  buildTwoWeekDates,
  resolveDefaultThresholdDayIso,
  resolvePlanningGoalForIso,
} from "@/lib/planningWeekUtils";
import {
  getAvailableThresholdDayIso,
  setAvailableThresholdDayIso,
  subscribeAvailableThresholdDay,
} from "@/lib/availableThresholdDaySession";
import {
  availableFullRemainingPrefKey,
  availableSeuilMaxPrefKey,
  isAvailableSeuilMaxDefaultOn,
  shouldAutoEnableFullRemainingWithSeuilMax,
} from "@/lib/availableSeuilMaxPrefs";
import { getCalorieRangeTotalColorClass } from "@/domain/planning/calorieGoalRange";
import {
  buildUnifiedAvailableItems,
  buildNameMatchItems,
  filterMealsByStockAvailability,
  splitIsMealByExpiration,
  type AvailableFullItem,
  type AvailableNameMatch,
  type AvailablePartialItem,
  type AvailableSortMode,
} from "@/lib/availableListPipeline";
import {
  compareMealsByNutritionNote,
  compareMealsBySatiety,
} from "@/lib/mealListSort";

/**
 * Indique si un aliment est marqué comme option planning (repas, matin ou dessert)
 * et doit donc être exclu de la section « Aliments inutilisés ».
 */
function isFoodPlanningOption(
  fi: FoodItem,
  morningIds: Set<string>,
  dessertIds: Set<string>,
): boolean {
  if (fi.is_meal) return true;
  if (morningIds.has(fi.id)) return true;
  if (dessertIds.has(fi.id)) return true;
  return false;
}

/**
 * Détecte un contexte mobile / tactile sans hover fiable, pour ouvrir le détail des suggestions au tap.
 */
function useUnusedSuggestionTapMode(): boolean {
  const [tapMode, setTapMode] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px), (hover: none) and (pointer: coarse)");
    const sync = () => setTapMode(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return tapMode;
}

/**
 * Calcule les macros affichées (kcal, protéines, fibres) pour une portion d'aliment-repas
 * à partir des valeurs /100g, du grammage unitaire et du référentiel Macro si besoin.
 */
function computeFoodItemPortionMacros(
  fi: FoodItem,
  opts?: { ratio?: number; macroSources?: IngredientMacroAutofillSources },
): { calories: string | null; protein: string | null; fiber: string | null } {
  const ratio = opts?.ratio ?? 1;
  let calRef = parseFoodMacroValue(fi.calories);
  let proRef = parseFoodMacroValue(fi.protein);
  let fiberRef = parseFoodMacroValue(fi.fiber);

  if (calRef <= 0 && proRef <= 0 && fiberRef <= 0 && opts?.macroSources) {
    const resolved = resolveIngredientLineMacros(
      { name: fi.name, qty: fi.grams ?? "", count: fi.quantity ?? undefined },
      opts.macroSources,
    );
    calRef = parseFoodMacroValue(resolved.cal);
    proRef = parseFoodMacroValue(resolved.pro);
    fiberRef = parseFoodMacroValue(resolved.fiber);
  }

  if (calRef <= 0 && proRef <= 0 && fiberRef <= 0 && opts?.macroSources?.macroLibrary?.length) {
    const libraryItem = opts.macroSources.macroLibrary.find((entry) =>
      strictNameMatch(entry.displayName, fi.name),
    );
    if (libraryItem) {
      calRef = parseFoodMacroValue(libraryItem.calories);
      proRef = parseFoodMacroValue(libraryItem.protein);
      fiberRef = parseFoodMacroValue(libraryItem.fiber);
    }
  }

  if (calRef <= 0 && proRef <= 0 && fiberRef <= 0 && opts?.macroSources?.foodItems?.length) {
    const donor = opts.macroSources.foodItems.find(
      (item) =>
        item.id !== fi.id &&
        strictNameMatch(item.name, fi.name) &&
        (parseFoodMacroValue(item.calories) > 0 ||
          parseFoodMacroValue(item.protein) > 0 ||
          parseFoodMacroValue(item.fiber) > 0),
    );
    if (donor) {
      calRef = parseFoodMacroValue(donor.calories);
      proRef = parseFoodMacroValue(donor.protein);
      fiberRef = parseFoodMacroValue(donor.fiber);
    }
  }

  const enriched: FoodItem = {
    ...fi,
    calories: calRef > 0 ? String(calRef) : fi.calories,
    protein: proRef > 0 ? String(proRef) : fi.protein,
    fiber: fiberRef > 0 ? String(fiberRef) : fi.fiber,
  };
  const portion = getExtraPortionMacros(enriched, { perUnit: true });

  return {
    calories: portion.cal > 0 ? String(Math.round(portion.cal * ratio)) : null,
    protein: portion.pro > 0 ? String(Math.round(portion.pro * ratio)) : null,
    fiber: portion.fiber > 0 ? String(Math.round(portion.fiber * ratio)) : null,
  };
}

/**
 * Harmonise quantité/grammage des aliments-repas : pastille xN en coin (comme les recettes),
 * grammage unitaire affiché seulement s'il n'y a qu'une unité en stock.
 */
function getStandaloneFoodStockDisplay(
  fi: FoodItem,
  portionsAvailable?: number | null,
): { portionsLabel: string | null; displayGrams: string | null } {
  if (fi.is_infinite) {
    return { portionsLabel: null, displayGrams: fi.grams ?? "∞" };
  }
  const qty = portionsAvailable ?? fi.quantity ?? 1;
  return {
    portionsLabel: `x${qty}`,
    displayGrams: qty > 1 ? null : fi.grams ?? null,
  };
}

/** Style commun : aliments (quantité + nom) — se détache du texte de liaison. */
const SUGGESTION_STYLE_ALIMENT = "font-semibold tabular-nums not-italic text-emerald-950 dark:text-emerald-300";

/** Style commun : nom de plat / recette entre guillemets. */
const SUGGESTION_STYLE_PLAT = "font-semibold not-italic text-emerald-900 dark:text-emerald-400";

/**
 * Aliments inutilisés (ligne « Pour utiliser … ») : ambre pour les distinguer du vert
 * des quantités à acheter et des noms de plats.
 */
const SUGGESTION_STYLE_ALIMENT_INUTILISE =
  "font-semibold tabular-nums not-italic text-amber-950 dark:text-amber-300";

/**
 * Ligne alternative « Ou ajouter » : verts plus sourds (moins « néon ») que le bloc principal,
 * tout en restant lisibles sur fond sombre.
 */
const SUGGESTION_STYLE_ALIMENT_ALT =
  "font-semibold tabular-nums not-italic text-emerald-900 dark:text-emerald-500";

/** Nom de plat sur la ligne « Ou » : même famille que les aliments alternatifs, légèrement atténué. */
const SUGGESTION_STYLE_PLAT_ALT =
  "font-semibold not-italic text-emerald-900/90 dark:text-emerald-500/90";

/**
 * Conteneur visuel des suggestions « Ou ajouter » : bordure en pointillés, fond grisé et léger
 * voile d'opacité marqué pour une zone très secondaire, tout en restant lisible au besoin.
 */
const UNUSED_ALT_SUGGESTION_SHELL =
  "mt-1.5 rounded-lg border border-dashed border-border/50 bg-muted/35 px-2.5 py-1.5 opacity-[0.72] dark:border-border/40 dark:bg-muted/30";

/**
 * Dans « Pour utiliser … », met en avant les aliments inutilisés (quantité + nom) avec une couleur dédiée.
 */
function renderUnusedFoodLabelsLightAccent(labels: string[]): ReactNode {
  if (labels.length === 0) return null;
  return labels.map((label, i) => (
    <Fragment key={`${label}-${i}`}>
      {i > 0 && (i === labels.length - 1 ? " et " : ", ")}
      <span className={SUGGESTION_STYLE_ALIMENT_INUTILISE}>{label}</span>
    </Fragment>
  ));
}

interface AvailableListProps {
  category: { value: string; label: string; emoji: string };
  meals: Meal[];
  foodItems: FoodItem[];
  allMeals: Meal[];
  stockMap: Map<string, StockInfo>;
  sortMode: AvailableSortMode;
  sortAsc: boolean;
  onToggleSort: () => void;
  onToggleSortDirection: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onMoveToPossible: (id: string) => void;
  onMovePartialToPossible: (meal: Meal, ratio: number) => void;
  onMoveFoodItemToPossible: (fi: FoodItem) => void;
  onDeleteFoodItem: (id: string) => void;
  onMoveNameMatchToPossible: (meal: Meal, fi: FoodItem, ratio?: number) => void;
  onRename: (id: string, name: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateOvenTemp: (id: string, t: string | null) => void;
  onUpdateOvenMinutes: (id: string, m: string | null) => void;
  onUpdateDescription: (id: string, description: string | null) => void;
  onAfterMoveToPossible?: () => void;
  ingredientMacroAutofillSources?: IngredientMacroAutofillSources;
}

export function AvailableList({ category, meals, foodItems, allMeals, stockMap, sortMode, sortAsc, onToggleSort, onToggleSortDirection, collapsed, onToggleCollapse, onMoveToPossible, onMovePartialToPossible, onMoveFoodItemToPossible, onDeleteFoodItem, onMoveNameMatchToPossible, onRename, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onUpdateDescription, onAfterMoveToPossible, ingredientMacroAutofillSources }: AvailableListProps) {
  const isPlat = category.value === "plat";
  const showMealItemsInAvailable = category.value === "plat" || category.value === "petit_dejeuner";
  const { getPreference: getAvailPref, setPreference: setAvailPref } = usePreferences();
  const hideCalorieDisplay = getAvailPref<boolean>(PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, false);
  const morningMealFoodItemIds = getAvailPref<string[]>('morning_meal_food_item_ids', []);
  const morningMealFoodItemIdSet = new Set(morningMealFoodItemIds);
  const dessertFoodItemIds = getAvailPref<string[]>(DESSERT_FOOD_PREF_KEY, []);
  const dessertFoodItemIdSet = new Set(dessertFoodItemIds);
  const storedOrder = getAvailPref<string[]>(`available_order_${category.value}`, []);
  const useRemainingCalories = getAvailPref<boolean>(
    availableSeuilMaxPrefKey(category.value),
    isAvailableSeuilMaxDefaultOn(category.value),
  );
  const showOnlyFullRemainingRecipes = getAvailPref<boolean>(
    availableFullRemainingPrefKey(category.value),
    false,
  );
  const [avDragIndex, setAvDragIndex] = useState<number | null>(null);
  const [customRatios, setCustomRatios] = useState<Record<string, number>>({});
  const [editingRatioId, setEditingRatioId] = useState<string | null>(null);
  const [ratioInput, setRatioInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const ingredientSuggestions = useMemo(
    () => foodItems.map((item) => item.name).filter(Boolean),
    [foodItems],
  );
  const tapModeForUnusedSuggestions = useUnusedSuggestionTapMode();
  const [mobileUnusedSuggestionKey, setMobileUnusedSuggestionKey] = useState<string | null>(null);
  useEffect(() => {
    if (!tapModeForUnusedSuggestions) setMobileUnusedSuggestionKey(null);
  }, [tapModeForUnusedSuggestions]);
  const isAvailableCb = useMemo(() => {
    return (name: string) => {
      const key = findStockKey(stockMap, name);
      if (!key) return false;
      const stock = stockMap.get(key);
      if (!stock) return false;
      return stock.infinite || stock.grams > 0 || stock.count > 0;
    };
  }, [stockMap]);
  const { getTargetCalorieThreshold, getRemainingProtein, getDayCalories, DAILY_GOAL, DAILY_GOAL_LOW } = useCalorieBalance(isAvailableCb);
  const todayIso = format(new Date(), "yyyy-MM-dd");
  // Fenêtre de 14 jours (semaine actuelle + suivante) pour le sélecteur de seuil.
  const thresholdDayWindow = useMemo(() => buildTwoWeekDates(new Date()), [todayIso]);
  const defaultThresholdDayIso = resolveDefaultThresholdDayIso(thresholdDayWindow, todayIso);
  // Mémoire JS (module) via useSyncExternalStore : survît aux remounts, pas au F5 ni à la déconnexion.
  const sessionThresholdDayIso = useSyncExternalStore(
    subscribeAvailableThresholdDay,
    getAvailableThresholdDayIso,
    () => null,
  );
  const selectedThresholdDayIso =
    sessionThresholdDayIso && thresholdDayWindow.some((d) => d.iso === sessionThresholdDayIso)
      ? sessionThresholdDayIso
      : defaultThresholdDayIso;
  const selectedThresholdDay = thresholdDayWindow.find((d) => d.iso === selectedThresholdDayIso)
    ?? thresholdDayWindow[0];
  // Seuil max affiché / filtre : si min Planning renseigné → pile max − conso du jour choisi.
  const baseCalorieThreshold = getTargetCalorieThreshold(selectedThresholdDayIso);
  const remainingProtein = getRemainingProtein(selectedThresholdDayIso);
  const [tempCalorieOverride, setTempCalorieOverride] = useState<number | null>(null);
  const calorieThreshold = tempCalorieOverride ?? baseCalorieThreshold;

  const nextDailyGoal = getAvailPref<number>("next_week_daily_goal", DAILY_GOAL);
  const nextDailyGoalLow = getAvailPref<number>("next_week_daily_goal_low", DAILY_GOAL_LOW);
  const thresholdDayCalories = getDayCalories(selectedThresholdDay.key, selectedThresholdDay.iso);
  const thresholdDayGoalHigh = resolvePlanningGoalForIso(selectedThresholdDayIso, DAILY_GOAL, nextDailyGoal);
  const thresholdDayGoalLow = resolvePlanningGoalForIso(selectedThresholdDayIso, DAILY_GOAL_LOW, nextDailyGoalLow);
  const seuilCalorieWordClass =
    getCalorieRangeTotalColorClass(thresholdDayCalories, thresholdDayGoalLow, thresholdDayGoalHigh) ?? "text-white";

  /**
   * Change le jour du seuil en mémoire de session JS et réinitialise l’override temporaire.
   * Conservé à la navigation ; remis à aujourd’hui seulement après F5 ou déconnexion.
   */
  const handleThresholdDayChange = (iso: string) => {
    setAvailableThresholdDayIso(iso);
    setTempCalorieOverride(null);
  };

  // Aligne la session JS sur le jour effectivement affiché (défaut inclus), pour la pop-up optionnels.
  useEffect(() => {
    setAvailableThresholdDayIso(selectedThresholdDayIso);
  }, [selectedThresholdDayIso]);

  const parseRatioInput = (input: string, maxRatio: number): number | null => {
    const trimmed = input.trim().toLowerCase();
    if (trimmed.startsWith("x")) {
      const mult = parseFloat(trimmed.slice(1));
      if (isNaN(mult) || mult < 0.5) return null;
      return Math.min(mult, maxRatio);
    }
    const pct = parseFloat(trimmed.replace("%", ""));
    if (isNaN(pct) || pct < 50) return null;
    return Math.min(pct / 100, maxRatio);
  };

  const formatRatioBadge = (ratio: number): string => {
    if (ratio >= 1 && Number.isInteger(ratio)) return `x${ratio}`;
    return `${Math.round(ratio * 100)}%`;
  };

  const commitRatio = (idKey: string, maxRatio: number) => {
    const parsed = parseRatioInput(ratioInput, maxRatio);
    if (parsed !== null && parsed >= 0.5) {
      if (parsed === 1 && !idKey.startsWith("partial-")) {
        setCustomRatios(prev => { const next = { ...prev }; delete next[idKey]; return next; });
      } else {
        setCustomRatios(prev => ({ ...prev, [idKey]: parsed }));
      }
    }
    setEditingRatioId(null);
  };

  // Utiliser les aides partagées de stockUtils au lieu de doublons locaux

  const parseMacroValue = (value: string | null | undefined): number => {
    return parseMacroDisplay(value) ?? 0;
  };

  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);

  // Prépare un repas pour le tri : ratio, autofill Macro et mêmes règles de stock que l'affichage carte.
  const resolveMealForAvailableSort = (meal: Meal, ratio = 1): Meal => {
    let resolved = ratio !== 1 ? buildScaledMealForRatio(meal, ratio, stockMap) : meal;
    if (!ingredientMacroAutofillSources || !resolved.ingredients?.trim()) return resolved;
    const filled = autofillIngredientLinesMacros(parseIngredientsToLines(resolved.ingredients), ingredientMacroAutofillSources);
    const ingredients = serializeIngredients(filled);
    if (!ingredients || ingredients === resolved.ingredients) return resolved;
    return { ...resolved, ingredients };
  };

  // Retourne la valeur calorique ou protéique utilisée pour trier (alignée sur les badges affichés).
  const getAvailableSortMacroValue = (meal: Meal, field: "calories" | "protein", ratio = 1): number => {
    const resolved = resolveMealForAvailableSort(meal, ratio);
    if (field === "calories") {
      return getDisplayedCalories(resolved, undefined, undefined, isAvailableCb, foodItems, foodItemIndex) ?? 0;
    }
    return getDisplayedProtein(resolved, undefined, undefined, isAvailableCb, foodItems, foodItemIndex) ?? 0;
  };

  // 1 / 1b. Recettes complètes + partielles (filtre stock partagé / testable)
  const { available, partial: partialAvailable } = filterMealsByStockAvailability(meals, stockMap);
  const availableMealIds = new Set(available.map(a => a.meal.id));
  const partialMealIds = new Set(partialAvailable.map(p => p.meal.id));

  // 2. Correspondance par nom
  type NameMatch = AvailableNameMatch;

  /** Construit un repas factice avec les macros de la portion unitaire pour un aliment-repas. */
  const buildIsMealCalorieMeal = (fi: FoodItem): Meal => {
    const macros = computeFoodItemPortionMacros(fi, { macroSources: ingredientMacroAutofillSources });
    return { ...fi as unknown as Meal, ...macros, ingredients: null };
  };

  /** Construit un repas factice avec les calories visibles pour une correspondance nom ↔ aliment. */
  const buildNameMatchCalorieMeal = (nm: NameMatch): Meal => {
    let baseCal = nm.meal.calories && nm.meal.calories !== "0" ? parseFloat(nm.meal.calories.replace(",", ".")) : 0;
    if (!baseCal && nm.fi.calories) {
      const fiCal = parseFloat(nm.fi.calories.replace(",", "."));
      if (Number.isFinite(fiCal) && fiCal > 0) {
        if (nm.fi.grams) {
          const totalG = getFoodItemTotalGrams(nm.fi);
          if (totalG > 0) baseCal = (fiCal * totalG) / 100;
        } else {
          baseCal = fiCal * (nm.fi.quantity ?? 1);
        }
      }
    }
    return { ...nm.meal, calories: baseCal > 0 ? String(Math.round(baseCal)) : nm.meal.calories, ingredients: null };
  };

  const tryFitMeal = (meal: Meal, overrideRatio: number | null, isScalable: boolean = true): { show: boolean; newRatio: number | null } => {
    if (!useRemainingCalories) return { show: true, newRatio: overrideRatio };

    const baseRaw = getAvailableSortMacroValue(meal, "calories");
    if (baseRaw === null || baseRaw === 0) return { show: true, newRatio: overrideRatio }; // No cal info, keep it

    const startingRatio = overrideRatio ?? 1;
    let currentCal = getAvailableSortMacroValue(meal, "calories", startingRatio);

    if (currentCal !== null && currentCal <= calorieThreshold) {
      return { show: true, newRatio: startingRatio };
    }

    if (!isScalable) return { show: false, newRatio: null };

    let targetRatio = calorieThreshold / baseRaw;
    if (targetRatio < 0.5) return { show: false, newRatio: null };

    const validRatios = getValidDiscreteRatios(meal, stockMap);

    if (!validRatios) {
       // Continuous: direct calculation instead of while loop (O(1) vs O(50))
       // Round down to nearest 0.01 to ensure we don't exceed threshold
       const directRatio = Math.floor(targetRatio * 100) / 100;
       if (directRatio < 0.5) return { show: false, newRatio: null };
       const checkCal = getAvailableSortMacroValue(meal, "calories", directRatio);
       if (checkCal !== null && checkCal <= calorieThreshold) return { show: true, newRatio: directRatio };
       // Edge case: rounding artifacts — try one step down
       const fallback = directRatio - 0.01;
       if (fallback >= 0.5) {
         const fbCal = getAvailableSortMacroValue(meal, "calories", fallback);
         if (fbCal !== null && fbCal <= calorieThreshold) return { show: true, newRatio: fallback };
       }
       return { show: false, newRatio: null };
    } else {
       // Discrete
       const EPSILON = 0.001;
       let bestValid = -1;
       for (const r of validRatios) {
         if (r <= targetRatio + EPSILON && r > bestValid) {
           bestValid = r;
         }
       }
       
       if (bestValid < 0.5) return { show: false, newRatio: null };
       
       currentCal = getAvailableSortMacroValue(meal, "calories", bestValid);
       if (currentCal !== null && currentCal <= calorieThreshold) {
         return { show: true, newRatio: bestValid };
       }
       
       // Fallback: search descending if rounding pushed it over
       const sortedRatios = [...validRatios].sort((a,b) => b-a);
       for (const r of sortedRatios) {
         if (r <= targetRatio + EPSILON && r >= 0.5) {
            currentCal = getAvailableSortMacroValue(meal, "calories", r);
            if (currentCal !== null && currentCal <= calorieThreshold) return { show: true, newRatio: r };
         }
       }
       return { show: false, newRatio: null };
    }
  };

  const { nameMatches, nameMatchedFiIds } = buildNameMatchItems(
    meals,
    foodItems,
    availableMealIds,
    partialMealIds,
  );

  // 3. Articles alimentaires de type 'is_meal'
  const isMealItems = showMealItemsInAvailable ? foodItems.filter((fi) => {
    if (!fi.is_meal) return false;
    const isMorningMeal = morningMealFoodItemIdSet.has(fi.id);
    if (category.value === "petit_dejeuner" && !isMorningMeal) return false;
    if (category.value === "plat" && isMorningMeal) return false;
    if (nameMatchedFiIds.has(fi.id)) return false;
    const hasRecipeMatch = meals.some(m => strictNameMatch(m.name, fi.name));
    if (hasRecipeMatch) return false;
    return true;
  }) : [];

  // 4. Articles alimentaires inutilisés
  const unusedFoodItems = (() => {
    const nonToujoursItems = foodItems.filter(fi => fi.storage_type !== 'toujours' && fi.storage_type !== 'extras' && fi.storage_type !== 'test');
    const globalAvailableMeals: Meal[] = allMeals.filter(meal => {
      if (!meal.ingredients?.trim()) return false;
      const m = getMealMultiple(meal, stockMap);
      return m !== null && m > 0;
    });
    const nameMatchMealNames = new Set<string>();
    for (const meal of allMeals) {
      if (meal.ingredients?.trim()) continue;
      if (!meal.is_available) continue;
      for (const fi of foodItems) {
        if (strictNameMatch(meal.name, fi.name)) {
          nameMatchMealNames.add(normalizeForMatch(fi.name));
          break;
        }
      }
    }
    const usedIngredientKeys = new Set<string>();
    for (const meal of globalAvailableMeals) {
      const groups = parseIngredientGroups(meal.ingredients!);
      for (const group of groups) {
        for (const alt of group) {
          for (const item of alt) {
            const key = findStockKey(stockMap, item.name);
            if (key !== null) {
              const stock = stockMap.get(key)!;
              if (stock.infinite || stock.grams > 0 || stock.count > 0) {
                usedIngredientKeys.add(key);
              }
            }
          }
        }
      }
    }
    for (const nmKey of nameMatchMealNames) usedIngredientKeys.add(nmKey);

    return nonToujoursItems.filter(fi => {
      if (isFoodPlanningOption(fi, morningMealFoodItemIdSet, dessertFoodItemIdSet)) return false;
      const fiKey = normalizeForMatch(fi.name);
      for (const usedKey of usedIngredientKeys) {
        if (strictNameMatch(fiKey, usedKey)) return false;
      }
      return true;
    });
  })();

  // Articles expirant dans d'autres catégories : articles utilisés dans d'AUTRES catégories qui expirent sous 3 jours
  const crossCategoryExpiringItems = (() => {
    const todayMs = new Date(new Date().toDateString()).getTime();
    const threeDaysMs = 3 * 86400000;
    const currentCat = category.value;

    // Find food items that expire within 3 days
    const expiringItems = foodItems.filter(fi => {
      if (fi.storage_type === 'toujours' || fi.is_meal) return false;
      if (!fi.expiration_date) return false;
      const expMs = new Date(fi.expiration_date).getTime();
      const daysUntil = expMs - todayMs;
      return daysUntil <= threeDaysMs; // includes already expired
    });

    // For each expiring item, check which categories use it
    const result: FoodItem[] = [];
    for (const fi of expiringItems) {
      if (isFoodPlanningOption(fi, morningMealFoodItemIdSet, dessertFoodItemIdSet)) continue;
      const fiKey = normalizeForMatch(fi.name);
      // Find which categories this item belongs to (via meal ingredients or name match)
      const belongsToCategories = new Set<string>();
      for (const meal of allMeals) {
        if (meal.ingredients?.trim()) {
          const groups = parseIngredientGroups(meal.ingredients);
          for (const group of groups) {
            for (const alt of group) {
              for (const item of alt) {
                const altKey = findStockKey(stockMap, item.name);
                if (altKey && strictNameMatch(fiKey, altKey)) {
                  belongsToCategories.add(meal.category);
                }
              }
            }
          }
        } else if (strictNameMatch(meal.name, fi.name)) {
          belongsToCategories.add(meal.category);
        }
      }
      // Show in this category only if item does NOT belong to this category
      if (belongsToCategories.size > 0 && !belongsToCategories.has(currentCat)) {
        // Check it's not already in the unused list
        if (!unusedFoodItems.some(u => u.id === fi.id)) {
          result.push(fi);
        }
      }
    }
    return result;
  })();

  // Tri des listes sources (avant fusion unifiée)
  let sortedAvailable: AvailableFullItem[] = [...available];
  let sortedNameMatches = [...nameMatches];
  let sortedIsMealItems = [...isMealItems];

  if (sortMode === "calories" || sortMode === "protein") {
    const dir = sortAsc ? 1 : -1;

    if (sortMode === "calories") {
      sortedAvailable.sort((a, b) => dir * (getAvailableSortMacroValue(a.meal, "calories") - getAvailableSortMacroValue(b.meal, "calories")));
      sortedNameMatches.sort((a, b) => dir * (getAvailableSortMacroValue(buildNameMatchCalorieMeal(a), "calories") - getAvailableSortMacroValue(buildNameMatchCalorieMeal(b), "calories")));
      sortedIsMealItems.sort((a, b) => dir * (getAvailableSortMacroValue(buildIsMealCalorieMeal(a), "calories") - getAvailableSortMacroValue(buildIsMealCalorieMeal(b), "calories")));
    } else {
      sortedAvailable.sort((a, b) => dir * (getAvailableSortMacroValue(a.meal, "protein") - getAvailableSortMacroValue(b.meal, "protein")));
      sortedNameMatches.sort((a, b) => dir * (getAvailableSortMacroValue(buildNameMatchCalorieMeal(a), "protein") - getAvailableSortMacroValue(buildNameMatchCalorieMeal(b), "protein")));
      sortedIsMealItems.sort((a, b) => dir * (getAvailableSortMacroValue(buildIsMealCalorieMeal(a), "protein") - getAvailableSortMacroValue(buildIsMealCalorieMeal(b), "protein")));
    }
  } else if (sortMode === "note" || sortMode === "satiety") {
    /** Compare deux repas selon note ou satiété pour le pré-tri des listes sources. */
    const compareScore = (a: Meal, b: Meal) =>
      sortMode === "note"
        ? compareMealsByNutritionNote(a, b, sortAsc, isAvailableCb)
        : compareMealsBySatiety(a, b, sortAsc, ingredientMacroAutofillSources);

    sortedAvailable.sort((a, b) => compareScore(a.meal, b.meal));
    sortedNameMatches.sort((a, b) => compareScore(buildNameMatchCalorieMeal(a), buildNameMatchCalorieMeal(b)));
    sortedIsMealItems.sort((a, b) => compareScore(buildIsMealCalorieMeal(a), buildIsMealCalorieMeal(b)));
  } else if (sortMode === "expiration") {
    sortedAvailable.sort((a, b) => {
      const aAn = analyzeMealIngredients(a.meal, foodItems, foodItemIndex);
      const bAn = analyzeMealIngredients(b.meal, foodItems, foodItemIndex);
      const res = compareExpirationWithCounter(aAn.earliestExpiration, bAn.earliestExpiration, aAn.maxIngredientCounter, bAn.maxIngredientCounter);
      if (res !== 0) return res;
      // Tie-breaker: favorites first
      if (a.meal.is_favorite && !b.meal.is_favorite) return -1;
      if (!a.meal.is_favorite && b.meal.is_favorite) return 1;
      return 0;
    });
    sortedNameMatches.sort((a, b) => {
      const ac = computeCounterDays(a.fi.counter_start_date);
      const bc = computeCounterDays(b.fi.counter_start_date);
      const res = compareExpirationWithCounter(a.fi.expiration_date, b.fi.expiration_date, ac, bc);
      if (res !== 0) return res;
      // Tie-breaker: favorites first
      if (a.meal.is_favorite && !b.meal.is_favorite) return -1;
      if (!a.meal.is_favorite && b.meal.is_favorite) return 1;
      return 0;
    });
    sortedIsMealItems.sort((a, b) => {
      const ac = computeCounterDays(a.counter_start_date);
      const bc = computeCounterDays(b.counter_start_date);
      return compareExpirationWithCounter(a.expiration_date, b.expiration_date, ac, bc);
    });
  }

  const isMealBuckets = splitIsMealByExpiration(sortedIsMealItems);

  const unifiedItems = useMemo(
    () =>
      buildUnifiedAvailableItems({
        sortedAvailable,
        sortedNameMatches,
        isMealBuckets,
        partialAvailable,
        searchQuery,
        useRemainingCalories,
        showOnlyFullRemainingRecipes,
        customRatios,
        sortMode,
        sortAsc,
        storedOrder,
        foodItems,
        foodItemIndex,
        helpers: {
          getAvailableSortMacroValue,
          buildIsMealCalorieMeal,
          buildNameMatchCalorieMeal,
          tryFitMeal,
          isIngredientAvailable: isAvailableCb,
          ingredientMacroSources: ingredientMacroAutofillSources,
        },
      }),
    // Les helpers ferment sur stockMap / seuils / macros — deps données ci-dessous suffisent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      sortedAvailable,
      sortedNameMatches,
      isMealBuckets,
      partialAvailable,
      searchQuery,
      useRemainingCalories,
      showOnlyFullRemainingRecipes,
      customRatios,
      sortMode,
      sortAsc,
      storedOrder,
      foodItems,
      foodItemIndex,
      calorieThreshold,
      stockMap,
      ingredientMacroAutofillSources,
    ],
  );

  const totalIsMealCount = unifiedItems.filter(u => u.type === 'isMeal').length;
  const totalCount = unifiedItems.length;

  const isNumericSort =
    sortMode === "calories" || sortMode === "protein" || sortMode === "note" || sortMode === "satiety";
  const SortIcon =
    sortMode === "calories" ? Flame
      : sortMode === "protein" ? Drumstick
        : sortMode === "note" ? Hash
          : sortMode === "satiety" ? Scale
            : sortMode === "expiration" ? CalendarDays
              : ArrowUpDown;
  const sortLabel =
    sortMode === "calories" ? "Calories"
      : sortMode === "protein" ? "Protéines"
        : sortMode === "note" ? "Note"
          : sortMode === "satiety" ? "Satiété"
            : sortMode === "expiration" ? "Péremption"
              : "Manuel";

  const isToday = (dateStr: string | null) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const today = new Date();
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  };

  // Aides au rendu
  const renderIsMealCard = (fi: FoodItem, unifiedIdx?: number) => {
    const expLabel = formatExpirationLabel(fi.expiration_date);
    const isExpiredFi = fi.expiration_date && new Date(new Date(fi.expiration_date).toDateString()) < new Date(new Date().toDateString());
    const expIsTodayFi = isToday(fi.expiration_date);
    const { portionsLabel, displayGrams } = getStandaloneFoodStockDisplay(fi);
    const macros = computeFoodItemPortionMacros(fi, { macroSources: ingredientMacroAutofillSources });

    const counterDays = computeCounterDays(fi.counter_start_date);
    const fakeMeal: Meal = {
      id: `fi-${fi.id}`, name: fi.name, category: category.value,
      calories: macros.calories,
      protein: macros.protein,
      fiber: macros.fiber,
      grams: displayGrams, ingredients: null,
      sort_order: 0, created_at: fi.created_at, is_available: true, is_favorite: false,
      oven_temp: null, oven_minutes: null,
    };
    return (
      <div key={fi.id} className="relative" data-reorder-idx={unifiedIdx}>
        <MealCard meal={fakeMeal} stockMap={stockMap} foodItems={foodItems} foodItemIndex={foodItemIndex}
          ingredientSuggestions={ingredientSuggestions}
          ingredientMacroSources={ingredientMacroAutofillSources}
          onMoveToPossible={() => { onMoveFoodItemToPossible(fi); onAfterMoveToPossible?.(); }}
          onRename={() => {}} onDelete={() => onDeleteFoodItem(fi.id)} onUpdateCalories={() => {}} onUpdateGrams={() => {}} onUpdateIngredients={() => {}}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", fi.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          expirationLabel={expLabel} expirationDate={fi.expiration_date} expirationIsToday={expIsTodayFi} 
          maxIngredientCounter={counterDays} earliestCounterDate={fi.counter_start_date} />
        {portionsLabel ? (
          <span className="absolute top-1 right-2 z-10 text-white text-[10px] font-black px-1.5 py-0.5 bg-black/60 rounded-full shadow pointer-events-none">
            {portionsLabel}
          </span>
        ) : null}
      </div>
    );
  };

  const renderNameMatchCard = (nm: NameMatch, idx: number, unifiedIdx?: number) => {
    const { meal, fi, portionsAvailable } = nm;
    const nmKey = `nm-${meal.id}-${fi.id}`;
    const expLabel = formatExpirationLabel(fi.expiration_date);
    const counterDays = computeCounterDays(fi.counter_start_date);
    const customRatio = customRatios[nmKey];
    const effectiveRatio = customRatio ?? 1;
    const stockDisplay = getStandaloneFoodStockDisplay(fi, portionsAvailable);
    const unitG = parseQty(meal.grams ?? fi.grams ?? "0");
    const fiMacros = computeFoodItemPortionMacros(fi, {
      ratio: effectiveRatio,
      macroSources: ingredientMacroAutofillSources,
    });

    const mealCal = parseMacroDisplay(meal.calories);
    const mealPro = parseMacroDisplay(meal.protein);
    const mealFiber = parseMacroDisplay(meal.fiber);

    let displayGrams = stockDisplay.displayGrams ?? meal.grams ?? null;
    if (effectiveRatio !== 1 && unitG > 0) {
      displayGrams = `${Math.round(unitG * effectiveRatio)}g`;
    }

    const scaledMealMacro = (val: number | null): string | null => {
      if (val == null || val <= 0) return null;
      return String(Math.round(val * effectiveRatio));
    };

    const displayMeal: Meal = {
      ...meal,
      grams: displayGrams,
      ingredients: null,
      calories: mealCal != null && mealCal > 0 ? scaledMealMacro(mealCal) : fiMacros.calories,
      protein: mealPro != null && mealPro > 0 ? scaledMealMacro(mealPro) : fiMacros.protein,
      fiber: mealFiber != null && mealFiber > 0 ? scaledMealMacro(mealFiber) : fiMacros.fiber,
    };

    const expIsTodayNm = isToday(fi.expiration_date);
    const fakeMeal: Meal = { ...displayMeal, id: nmKey };
    return (
      <div key={`nm-${idx}`} className="relative" data-reorder-idx={unifiedIdx}>
        <MealCard meal={fakeMeal} stockMap={stockMap} foodItems={foodItems} foodItemIndex={foodItemIndex}
          ingredientSuggestions={ingredientSuggestions}
          ingredientMacroSources={ingredientMacroAutofillSources}
          onMoveToPossible={async () => {
            const cr = customRatios[nmKey];
            // On réinitialise AVANT pour un effet immédiat
            setCustomRatios(prev => {
              const next = { ...prev };
              delete next[nmKey];
              return next;
            });
            await onMoveNameMatchToPossible(meal, fi, cr && cr !== 1 ? cr : undefined);
            onAfterMoveToPossible?.();
          }}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
          onUpdateDescription={(d) => onUpdateDescription(meal.id, d)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          hideDelete expirationLabel={expLabel} expirationDate={fi.expiration_date} expirationIsToday={expIsTodayNm} 
          maxIngredientCounter={counterDays} earliestCounterDate={fi.counter_start_date} />
        {editingRatioId === nmKey ? (
          <div className="absolute top-1 right-2 z-20">
            <Input autoFocus value={ratioInput}
              onChange={(e) => setRatioInput(e.target.value)}
              onBlur={() => commitRatio(nmKey, 99)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRatio(nmKey, 99); if (e.key === "Escape") setEditingRatioId(null); }}
              placeholder="x2, x3..."
              className="w-20 h-6 text-[10px] bg-black/80 text-white border-white/30 placeholder:text-white/40 px-1.5 rounded-full shadow-lg focus-visible:ring-1 focus-visible:ring-white/50"
            />
          </div>
        ) : (
          <div className={`absolute top-1 right-2 z-10 flex items-center shadow flex-row-reverse`}>
            {fi.is_infinite ? (
              <button
                onClick={() => { setEditingRatioId(nmKey); setRatioInput(customRatio ? formatRatioBadge(customRatio) : ""); }}
                className={`text-white text-[10px] font-black px-1.5 py-0.5 transition-colors ${!customRatio ? 'bg-black/60 hover:bg-black/80 rounded-full' : 'bg-black/60 hover:bg-black/80 rounded-r-full pl-1'}`}
              >
                <InfinityIcon className="inline h-[13px] w-[13px]" />
              </button>
            ) : (
              <button
                onClick={() => { setEditingRatioId(nmKey); setRatioInput(customRatio ? formatRatioBadge(customRatio) : ""); }}
                className={`text-white text-[10px] font-black px-1.5 py-0.5 transition-colors bg-black/60 hover:bg-black/80 flex items-center gap-0.5 ${!customRatio ? 'rounded-full px-2' : 'rounded-r-full pl-1 pr-2'}`}
              >
                {portionsAvailable !== null ? `x${portionsAvailable}` : `x${fi.quantity ?? 1}`}
              </button>
            )}
            {customRatio && (
              <button
                onClick={() => { setEditingRatioId(nmKey); setRatioInput(formatRatioBadge(customRatio)); }}
                className="bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 hover:bg-orange-500/90 transition-colors rounded-l-full pr-1"
              >
                {formatRatioBadge(customRatio)}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderAvailableCard = (item: typeof available[0], unifiedIdx?: number) => {
    const { meal, multiple } = item;
    const maxRatio = multiple === Infinity ? 99 : (multiple ?? 1);

    // Apply local calculated ratio if any (from filter), otherwise user's custom ratio, otherwise 1
    const dynCalculatedRatio = item.calculatedRatio;
    const customRatio = dynCalculatedRatio ?? customRatios[meal.id];
    const isCalorieRestrictedRatio = dynCalculatedRatio !== undefined && dynCalculatedRatio < 1;

    const effectiveRatio = customRatio ?? 1;
    const displayMeal = effectiveRatio !== 1 ? buildScaledMealForRatio(meal, effectiveRatio, stockMap) : meal;
    // Calcule le nombre de portions réellement faisables pour la portion affichée (ex: 57%).
    const displayMultiple = effectiveRatio !== 1 ? getMealMultipleAtRatio(meal, stockMap, effectiveRatio) : multiple;
    const badgeMultiple = displayMultiple ?? multiple;
    // L'analyse en une seule passe remplace 6+ appels de fonctions séparés
    const analysis = analyzeMealIngredients(meal, foodItems, foodItemIndex);
    const expLabel = formatExpirationLabel(analysis.earliestExpiration);
    const expIsTodayAv = isToday(analysis.earliestExpiration);
    const expiringIng = analysis.expiringIngredientName;
    return (
      <div key={meal.id} className="relative" data-reorder-idx={unifiedIdx}>
        <MealCard meal={displayMeal} stockMap={stockMap} foodItems={foodItems} foodItemIndex={foodItemIndex}
          ingredientSuggestions={ingredientSuggestions}
          ingredientMacroSources={ingredientMacroAutofillSources}
          onMoveToPossible={async () => {
            const cr = customRatios[meal.id];
            setCustomRatios(prev => { const next = { ...prev }; delete next[meal.id]; return next; });
            if (cr && cr !== 1) {
              await onMovePartialToPossible(meal, cr);
              onAfterMoveToPossible?.();
            } else {
              await onMoveToPossible(meal.id);
              onAfterMoveToPossible?.();
            }
          }}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
          onUpdateDescription={(d) => onUpdateDescription(meal.id, d)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          hideDelete expirationLabel={expLabel} expirationDate={analysis.earliestExpiration} expirationIsToday={expIsTodayAv}
          expiringIngredientName={expiringIng} expiredIngredientNames={analysis.expiredIngredientNames} expiringSoonIngredientNames={analysis.expiringSoonIngredientNames}
          counterIngredientNames={analysis.counterIngredientNames} maxIngredientCounter={analysis.maxIngredientCounter} 
          earliestCounterDate={analysis.earliestCounterDate} />
        {multiple !== null && (
          editingRatioId === meal.id ? (
            <div className="absolute top-1 right-2 z-20">
              <Input autoFocus value={ratioInput}
                onChange={(e) => setRatioInput(e.target.value)}
                onBlur={() => commitRatio(meal.id, maxRatio)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRatio(meal.id, maxRatio); if (e.key === "Escape") setEditingRatioId(null); }}
                placeholder="75% ou x2"
                className="w-20 h-6 text-[10px] bg-black/80 text-white border-white/30 placeholder:text-white/40 px-1.5 rounded-full shadow-lg focus-visible:ring-1 focus-visible:ring-white/50"
              />
            </div>
          ) : (
            <div className="absolute top-1 right-2 z-10 flex items-center shadow flex-row-reverse">
              {/* Quantité max disponible en stock (affiché en premier en flex-row-reverse = le plus à droite) */}
              {(!customRatio || (badgeMultiple !== null && badgeMultiple > 1)) && (
                <button
                  onClick={() => { setEditingRatioId(meal.id); setRatioInput(customRatio ? formatRatioBadge(customRatio) : ""); }}
                  className={`text-white text-[10px] font-black px-1.5 py-0.5 transition-colors ${!customRatio ? 'bg-black/60 hover:bg-black/80 rounded-full' : 'bg-black/60 hover:bg-black/80 rounded-r-full pl-1'}`}
                  title={customRatio ? `Stock permet jusqu'à x${badgeMultiple}` : "Modifier la portion"}
                >
                  <span className={customRatio ? "opacity-70" : ""}>
                    x{badgeMultiple === Infinity ? <InfinityIcon className="inline h-[13px] w-[13px]" /> : badgeMultiple}
                  </span>
                </button>
              )}
              {/* Force du ratio appliqué par le filtre calorie ou manuel (affiché à gauche de la quantité) */}
              {customRatio && (
                 <button
                   onClick={() => { setEditingRatioId(meal.id); setRatioInput(formatRatioBadge(customRatio)); }}
                  className={`bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 hover:bg-orange-500/90 transition-colors ${(badgeMultiple !== null && badgeMultiple > 1) || isCalorieRestrictedRatio ? 'rounded-l-full pr-1' : 'rounded-full'}`}
                   title="Modifier la portion"
                 >
                   {formatRatioBadge(customRatio)}
                 </button>
              )}
              {isCalorieRestrictedRatio && (
                <button
                  onClick={async () => {
                    setCustomRatios(prev => { const next = { ...prev }; delete next[meal.id]; return next; });
                    await onMoveToPossible(meal.id);
                    onAfterMoveToPossible?.();
                  }}
                  className="bg-orange-500/80 text-white text-[10px] font-black px-1 py-0.5 hover:bg-orange-500/90 transition-colors rounded-l-full border-l border-orange-300/40"
                  title="Ajouter directement à 100%"
                >
                  <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        )}
      </div>
    );
  };

  const renderPartialCard = (item: typeof partialAvailable[0], unifiedIdx?: number) => {
    const { meal, ratio: defaultRatio } = item;
    const dynCalculatedRatio = item.calculatedRatio;
    const customRatio = dynCalculatedRatio ?? customRatios[`partial-${meal.id}`];

    const effectiveRatio = customRatio ?? defaultRatio;
    const pct = Math.round(effectiveRatio * 100);
    const analysis = analyzeMealIngredients(meal, foodItems, foodItemIndex);
    const expLabel = formatExpirationLabel(analysis.earliestExpiration);
    const expIsTodayPa = isToday(analysis.earliestExpiration);
    const partialMeal = buildScaledMealForRatio(meal, effectiveRatio, stockMap);
    const partialKey = `partial-${meal.id}`;
    return (
      <div key={partialKey} className="relative" data-reorder-idx={unifiedIdx}>
        <MealCard meal={partialMeal} stockMap={stockMap} foodItems={foodItems} foodItemIndex={foodItemIndex}
          ingredientSuggestions={ingredientSuggestions}
          ingredientMacroSources={ingredientMacroAutofillSources}
          onMoveToPossible={async () => {
            setCustomRatios(prev => { const next = { ...prev }; delete next[partialKey]; return next; });
            await onMovePartialToPossible(meal, effectiveRatio);
            onAfterMoveToPossible?.();
          }}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
          onUpdateDescription={(d) => onUpdateDescription(meal.id, d)}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", meal.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          hideDelete expirationLabel={expLabel} expirationDate={analysis.earliestExpiration} expirationIsToday={expIsTodayPa} 
          expiredIngredientNames={analysis.expiredIngredientNames} expiringSoonIngredientNames={analysis.expiringSoonIngredientNames} 
          counterIngredientNames={analysis.counterIngredientNames} maxIngredientCounter={analysis.maxIngredientCounter} 
          earliestCounterDate={analysis.earliestCounterDate} />
        {editingRatioId === partialKey ? (
          <div className="absolute top-1 right-2 z-20">
            <Input autoFocus value={ratioInput}
              onChange={(e) => setRatioInput(e.target.value)}
              onBlur={() => commitRatio(partialKey, defaultRatio)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRatio(partialKey, defaultRatio); if (e.key === "Escape") setEditingRatioId(null); }}
              placeholder="50-100%"
              className="w-20 h-6 text-[10px] bg-black/80 text-white border-white/30 placeholder:text-white/40 px-1.5 rounded-full shadow-lg focus-visible:ring-1 focus-visible:ring-white/50"
            />
          </div>
        ) : (
          <div className="absolute top-1 right-2 z-10 flex items-center shadow">
            <button
              onClick={() => { setEditingRatioId(partialKey); setRatioInput(`${pct}%`); }}
              className={`bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full hover:bg-orange-500/90 transition-colors`}
            >
              {pct}%
            </button>
          </div>
        )}
      </div>
    );
  };

  const handleAvReorder = (fromIdx: number, toIdx: number) => {
    const reordered = [...unifiedItems];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setAvailPref.mutate({ key: `available_order_${category.value}`, value: reordered.map(u => u.key) });
  };

  /**
   * Drop dans le vide de l’encadré « Au choix » : réordonne selon la position Y (tri manuel uniquement).
   */
  const handleAvailableContainerDrop = (e: DragEvent) => {
    e.preventDefault();
    if (sortMode !== "manual") {
      setAvDragIndex(null);
      return;
    }
    applyContainerReorderDrop(avDragIndex, e.clientY, e.currentTarget, handleAvReorder);
    setAvDragIndex(null);
  };

  // Pour chaque aliment inutilisé, cherche la meilleure recette qui l'utilise (priorité :
  // max d'aliments inutilisés, puis min d'ingrédients manquants, puis calories),
  // puis renvoie la liste
  // dédupliquée des ingrédients manquants de ces recettes. Sert de suggestions d'achats.
  const computeUnusedSuggestions = (items: FoodItem[]) => {
    // Proposer des compléments pour tous les aliments inutilisés (qu'ils aient une date ou non).
    if (!items.length || !allMeals.length) return [];
    const index = buildIngredientMealIndex(allMeals);
    // Normalise un nom ingrédient en version canonique pour rapprocher singulier/pluriel mot à mot.
    const canonicalize = (name: string) =>
      normalizeForMatch(name)
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.replace(/s$/i, ""))
        .join(" ");
    const genericSingleWordIngredients = new Set(["sauce"]);

    /** Vérifie qu'un ingrédient de recette correspond vraiment à l'aliment stocké sans confondre un terme trop générique. */
    const ingredientMatchesFoodItem = (ingredientName: string, fi: FoodItem): boolean => {
      if (strictNameMatch(ingredientName, fi.name)) return true;
      const ingredientCanonical = canonicalize(ingredientName);
      const foodCanonical = canonicalize(fi.name);
      if (ingredientCanonical === foodCanonical) return true;
      if (genericSingleWordIngredients.has(ingredientCanonical)) return false;
      return smartFoodContains(ingredientName, fi.name);
    };

    // On ne traite que les items inutilisés AVEC une date de péremption pour suggérer des compléments.
    const candidatesToProcessByFi = items.filter(fi => !!fi.expiration_date);

    const unusedStockKeys = new Set(
      candidatesToProcessByFi.map((fi) => findStockKey(stockMap, fi.name) ?? normalizeKey(fi.name))
    );
    const unusedCanonicalNames = new Set(candidatesToProcessByFi.map((fi) => canonicalize(fi.name)));
    const allUnusedCanonicalNames = new Set(items.map((fi) => canonicalize(fi.name)));

    // Vérifie qu'un ingrédient manquant n'est pas déjà parmi les aliments inutilisés.
    // Comparaison stricte (nom canonique exact) pour éviter les faux positifs entre
    // produits différents partageant un mot (ex: "poulet" ≠ "aiguillettes poulet").
    const isActuallyMissing = (missingKey: string): boolean => {
      const missingCanonical = canonicalize(missingKey);
      if (!missingCanonical) return true;
      if (allUnusedCanonicalNames.has(missingCanonical)) return false;
      for (const fi of items) {
        if (strictNameMatch(missingKey, fi.name)) return false;
      }
      return true;
    };

    type Source = {
      unusedName: string;
      recipeName: string;
      recipeId: string;
      unusedRecipeAmountLabel: string;
      missingAmountLabel: string;
      altMissingLabel?: string;
      altRecipeName?: string;
      debug: { unusedUsed: number; usedWithUnused: number; missingCount: number; cal: number };
    };
    const byMissing = new Map<string, { missingName: string; qty: number; count: number; sources: Source[]; countedRecipeIds: Set<string> }>();

    /** Formate la quantité d'un aliment inutilisé, avec repli sur le stock réel si la recette ne précise rien. */
    const formatUnusedRecipeAmountLabel = (fi: FoodItem, recipeQty: number, recipeCount: number): string => {
      if (recipeQty > 0) return `${formatNumeric(recipeQty)}g`;
      if (recipeCount > 0) return `x${formatNumeric(recipeCount)}`;

      const totalGrams = getFoodItemTotalGrams(fi);
      if (totalGrams > 0) return `${formatNumeric(totalGrams)}g`;
      const quantity = fi.quantity ?? null;
      if (quantity && quantity > 0) return `x${formatNumeric(quantity)}`;
      return "";
    };

    for (const fi of candidatesToProcessByFi) {
      const unusedKey = normalizeKey(fi.name);
      const fiCanonical = canonicalize(fi.name);
      const mealIds = new Set<string>(index.get(unusedKey) ?? []);
      for (const [idxKey, ids] of index.entries()) {
        const isCanonicalMatch = canonicalize(idxKey) === fiCanonical;
        const isSmartMatch = ingredientMatchesFoodItem(idxKey, fi);
        if (!strictNameMatch(idxKey, fi.name) && !isCanonicalMatch && !isSmartMatch) continue;
        for (const id of ids) mealIds.add(id);
      }
      if (mealIds.size === 0) continue;

      const rankedCandidates: Array<{
        meal: Meal;
        score: { unusedUsed: number; usedWithUnused: number; missingCount: number; cal: number };
        missingKeys: string[];
      }> = [];

      for (const mealId of mealIds) {
        const meal = allMeals.find(m => m.id === mealId);
        if (!meal?.ingredients?.trim()) continue;
        const groups = parseIngredientGroups(meal.ingredients);
        const usedUnusedKeys = new Set<string>();
        const usedWithUnusedKeys = new Set<string>();
        for (const group of groups) {
          for (const alt of group) {
            for (const item of alt) {
              const ingredientStockKey = findStockKey(stockMap, item.name) ?? normalizeKey(item.name);
              const ingredientCanonical = canonicalize(item.name);
              if (unusedStockKeys.has(ingredientStockKey) || unusedCanonicalNames.has(ingredientCanonical)) {
                usedUnusedKeys.add(`${ingredientStockKey}::${ingredientCanonical}`);
              } else {
                const inStockKey = findStockKey(stockMap, item.name);
                if (inStockKey) {
                  const stock = stockMap.get(inStockKey);
                  if (stock && (stock.infinite || stock.grams > 0 || stock.count > 0)) {
                    usedWithUnusedKeys.add(`${inStockKey}::${ingredientCanonical}`);
                  }
                }
              }
            }
          }
        }
        const missing = getMissingIngredients(meal, stockMap);
        const missingCount = Array.from(missing).filter(isActuallyMissing).length;
        const cal = parseMacroDisplay(meal.calories) ?? Number.POSITIVE_INFINITY;
        const score = { unusedUsed: usedUnusedKeys.size, usedWithUnused: usedWithUnusedKeys.size, missingCount, cal };
        rankedCandidates.push({
          meal,
          score,
          missingKeys: Array.from(missing).filter(isActuallyMissing),
        });
      }

      const sortedCandidates = [...rankedCandidates].sort((a, b) => {
        if (a.score.unusedUsed !== b.score.unusedUsed) return b.score.unusedUsed - a.score.unusedUsed;
        if (a.score.missingCount !== b.score.missingCount) return a.score.missingCount - b.score.missingCount;
        if (a.score.cal !== b.score.cal) return a.score.cal - b.score.cal;
        return a.meal.name.localeCompare(b.meal.name);
      });

      // On cherche la meilleure recette qui nécessite des achats (compléments).
      // On autorise jusqu'à 4 ingrédients manquants pour les recettes complexes.
      const bestWithMissing = sortedCandidates.find(c => c.score.missingCount > 0 && c.score.missingCount <= 4);
      
      if (bestWithMissing) {
        // Détermine une alternative "autre recette possible" pour enrichir le tooltip.
        const alternativeCandidate = sortedCandidates.find((c) => c.meal.id !== bestWithMissing.meal.id && c.missingKeys.length > 0);
        let alternativeMissingLabel: string | undefined;
        let alternativeRecipeName: string | undefined;
        if (alternativeCandidate) {
          const labels: string[] = [];
          for (const altMissingKey of alternativeCandidate.missingKeys) {
            const { qty, count, displayName } = getMissingQuantityForIngredient(
              alternativeCandidate.meal.ingredients,
              altMissingKey,
              stockMap,
            );
            labels.push(qty > 0 ? `${formatNumeric(qty)}g ${displayName}` : (count > 0 ? `x${count} ${displayName}` : displayName));
          }
          if (labels.length > 0) alternativeMissingLabel = labels.join(" + ");
          alternativeRecipeName = alternativeCandidate.meal.name;
        }

        const meal = bestWithMissing.meal;
        const score = bestWithMissing.score;
        const missing = new Set(Array.from(getMissingIngredients(meal, stockMap)).filter(isActuallyMissing));
        const groups = parseIngredientGroups(meal.ingredients!);
        let unusedQtyInRecipe = 0;
        let unusedCountInRecipe = 0;
        for (const group of groups) {
          for (const alt of group) {
            for (const item of alt) {
              const sameByCanonical = canonicalize(item.name) === fiCanonical;
              if (!ingredientMatchesFoodItem(item.name, fi) && !sameByCanonical) continue;
              if (item.qty > 0) unusedQtyInRecipe = Math.max(unusedQtyInRecipe, item.qty);
              if (item.count > 0) unusedCountInRecipe = Math.max(unusedCountInRecipe, item.count);
            }
          }
        }
        const unusedRecipeAmountLabel =
          formatUnusedRecipeAmountLabel(fi, unusedQtyInRecipe, unusedCountInRecipe);

        for (const missingKey of missing) {
          // Quantité à proposer = manque (besoin − stock), pas le besoin total de la recette.
          const { qty, count, displayName } = getMissingQuantityForIngredient(
            meal.ingredients,
            missingKey,
            stockMap,
          );
          const entry = byMissing.get(missingKey) || { missingName: displayName, qty: 0, count: 0, sources: [], countedRecipeIds: new Set<string>() };
          if (!entry.countedRecipeIds.has(meal.id)) {
            entry.qty += qty;
            entry.count += count;
            entry.countedRecipeIds.add(meal.id);
          }
          entry.sources.push({
            unusedName: fi.name,
            recipeName: meal.name,
            recipeId: meal.id,
            unusedRecipeAmountLabel,
            missingAmountLabel: qty > 0 ? `${formatNumeric(qty)}g` : (count > 0 ? `x${count}` : "quantité inconnue"),
            altMissingLabel: alternativeMissingLabel,
            altRecipeName: alternativeRecipeName,
            debug: score,
          });
          byMissing.set(missingKey, entry);
        }
      }
    }
    // Filtre final de sécurité : applique la même règle qu'à la sélection
    // (les aliments inutilisés ne doivent jamais être reproposés).
    return Array.from(byMissing.values())
      .map(({ countedRecipeIds: _ignored, ...rest }) => rest)
      .filter((entry) => isActuallyMissing(entry.missingName));
  };

  /**
   * Recettes auxquelles il ne manque qu'UN SEUL ingrédient.
   * Allocation gloutonne par calories croissantes : si deux recettes consomment le même
   * stock fini (ex. 200g de lardons), seule la moins calorique est retenue.
   */
  const computeOneMissingSuggestions = (): { missingName: string; qty: number; count: number; recipes: { name: string; id: string }[] }[] => {
    if (!allMeals.length) return [];

    type Candidate = {
      meal: Meal;
      missingKey: string;
      missingDisplayName: string;
      missingQty: number;
      missingCount: number;
      finiteStockKeys: Set<string>;
      cal: number;
    };
    const candidates: Candidate[] = [];

    for (const meal of allMeals) {
      if (!meal.ingredients?.trim()) continue;
      const groups = parseIngredientGroups(meal.ingredients);
      if (groups.length <= 1) continue;
      const missing = getMissingIngredients(meal, stockMap);
      if (missing.size !== 1) continue;
      const missingKey = Array.from(missing)[0];

      // Collecter les clés de stock fini que cette recette consommerait
      const finiteStockKeys = new Set<string>();
      for (const group of groups) {
        for (const alt of group) {
          for (const item of alt) {
            if (normalizeKey(item.name) === missingKey) continue;
            const sk = findStockKey(stockMap, item.name);
            if (!sk) continue;
            const stock = stockMap.get(sk);
            if (stock && !stock.infinite) finiteStockKeys.add(sk);
          }
        }
      }
      if (finiteStockKeys.size === 0) continue;

      // Manque affiché = besoin recette − stock (ex. 3 − 2 → ×1), pas le besoin total.
      const { qty: mQty, count: mCount, displayName } = getMissingQuantityForIngredient(
        meal.ingredients,
        missingKey,
        stockMap,
      );
      candidates.push({
        meal,
        missingKey,
        missingDisplayName: displayName,
        missingQty: mQty,
        missingCount: mCount,
        finiteStockKeys,
        cal: parseMacroDisplay(meal.calories) ?? Infinity,
      });
    }

    // Tri par calories croissantes pour privilégier les recettes légères
    candidates.sort((a, b) => a.cal - b.cal);

    // Allocation gloutonne : réserver le stock fini au fur et à mesure
    const reservedStock = new Set<string>();
    const byMissing = new Map<string, { missingName: string; qty: number; count: number; recipes: { name: string; id: string }[] }>();

    for (const c of candidates) {
      // Vérifier qu'au moins un ingrédient fini n'est pas déjà réservé
      let hasAvailableFinite = false;
      for (const sk of c.finiteStockKeys) {
        if (!reservedStock.has(sk)) { hasAvailableFinite = true; break; }
      }
      if (!hasAvailableFinite) continue;

      // Réserver tout le stock fini de cette recette
      for (const sk of c.finiteStockKeys) reservedStock.add(sk);

      // Multi-recettes : max des manques (assez pour compléter la pire / n'importe laquelle).
      const entry = byMissing.get(c.missingKey) ?? { missingName: c.missingDisplayName, qty: 0, count: 0, recipes: [] };
      if (!entry.recipes.some(r => r.id === c.meal.id)) {
        entry.qty = Math.max(entry.qty, c.missingQty);
        entry.count = Math.max(entry.count, c.missingCount);
        entry.recipes.push({ name: c.meal.name, id: c.meal.id });
      }
      byMissing.set(c.missingKey, entry);
    }
    return Array.from(byMissing.values());
  };

  const renderUnusedItems = (items: FoodItem[], crossCatItems: FoodItem[] = []) => {
    const allItems = [...items, ...crossCatItems];
    const crossCatIds = new Set(crossCatItems.map(fi => fi.id));
    const suggestions = computeUnusedSuggestions(allItems);
    const oneMissing = computeOneMissingSuggestions();
    const existingSuggestionNames = new Set(suggestions.map(s => normalizeKey(s.missingName)));
    const filteredOneMissing = oneMissing.filter(s => !existingSuggestionNames.has(normalizeKey(s.missingName)));
    return (
    <div className={`${isPlat ? 'mb-2' : 'mt-4'} rounded-2xl bg-muted/30 border border-border/20 p-3`}>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">🧊 Aliments inutilisés ({allItems.length})</p>
      <div className="flex flex-wrap gap-1.5">
        {[...allItems].sort((a, b) => {
          const today = new Date(new Date().toDateString());
          const aCounter = computeCounterDays(a.counter_start_date);
          const bCounter = computeCounterDays(b.counter_start_date);
          if (aCounter !== null && bCounter === null) return -1;
          if (aCounter === null && bCounter !== null) return 1;
          if (aCounter !== null && bCounter !== null && aCounter !== bCounter) return bCounter - aCounter;
          const aExpired = a.expiration_date ? new Date(a.expiration_date) < today : false;
          const bExpired = b.expiration_date ? new Date(b.expiration_date) < today : false;
          if (aExpired && !bExpired) return -1;
          if (!aExpired && bExpired) return 1;
          if (a.expiration_date && b.expiration_date) return a.expiration_date.localeCompare(b.expiration_date);
          if (a.expiration_date && !b.expiration_date) return -1;
          if (!a.expiration_date && b.expiration_date) return 1;
          return 0;
        }).map(fi => {
          const totalG = getFoodItemTotalGrams(fi);
          const qty = fi.quantity && fi.quantity > 1 ? fi.quantity : null;
          const todayStr = new Date().toDateString();
          const isExpired = fi.expiration_date ? new Date(fi.expiration_date) < new Date(todayStr) : false;
          const daysUntilExp = fi.expiration_date ? Math.ceil((new Date(fi.expiration_date).getTime() - new Date(todayStr).getTime()) / 86400000) : null;
          const isSoonExpiring = daysUntilExp !== null && daysUntilExp >= 0 && daysUntilExp <= 7;
          const expLabel = fi.expiration_date ? format(parseISO(fi.expiration_date), 'd MMM', { locale: fr }) : null;
          const counterDays = computeCounterDays(fi.counter_start_date);
          const counterUrgent = counterDays !== null && counterDays >= 3;
          const isCrossCat = crossCatIds.has(fi.id);
          return (
            <span key={fi.id} className={`text-[11px] px-2.5 py-1.5 rounded-full font-medium transition-colors inline-flex items-center gap-1 ${
              isCrossCat
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 border border-dashed border-amber-500/30'
                : isExpired ? 'bg-red-500/20 text-red-300 ring-1 ring-red-500/40'
                : (isSoonExpiring ? 'bg-muted/80 text-muted-foreground ring-2 ring-red-500/60' : 'bg-muted/80 text-muted-foreground hover:bg-muted')
            }`}>
              {fi.name}
              {counterDays !== null && (
                <span className={`text-[9px] font-black px-1 py-0 rounded-full flex items-center gap-0.5 ${counterUrgent ? 'bg-red-500/60 text-white' : 'opacity-70'}`}>
                  ⏱{counterDays}j
                </span>
              )}
              {totalG > 0 && <span className="opacity-60">{formatNumeric(totalG)}g</span>}
              {qty && <span className="opacity-60">×{qty}</span>}
              {fi.is_infinite && <span className="opacity-60">∞</span>}
              {expLabel && <span className={`text-[9px] ${isExpired ? 'text-red-300' : 'opacity-50'}`}>📅{expLabel}</span>}
              {!isCrossCat && <button onClick={() => onDeleteFoodItem(fi.id)} className="ml-0.5 opacity-40 hover:opacity-100 hover:text-destructive transition-opacity" title="Supprimer cet aliment">✕</button>}
            </span>
          );
        })}
      </div>
      <div className="h-px w-full bg-border/50 mt-2" />
      {suggestions.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2 mb-1.5">🧩 Aliments pour compléter</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s, i) => {
              const groupedByRecipe = new Map<string, { recipeName: string; missingAmountLabel: string; unusedLabels: string[] }>();
              for (const src of s.sources) {
                const key = `${src.recipeId}::${src.missingAmountLabel}`;
                const current = groupedByRecipe.get(key) ?? {
                  recipeName: src.recipeName,
                  missingAmountLabel: src.missingAmountLabel,
                  unusedLabels: [],
                };
                const unusedLabel = `${src.unusedRecipeAmountLabel} ${src.unusedName}`;
                if (!current.unusedLabels.includes(unusedLabel)) current.unusedLabels.push(unusedLabel);
                groupedByRecipe.set(key, current);
              }
              const groups = Array.from(groupedByRecipe.values());
              // Suggestions d’autres recettes (dédoublonnées) pour la ligne en italique sous le tooltip.
              const dedupedAltSuggestions = Array.from(
                new Map(
                  s.sources
                    .filter((src): src is (typeof src & { altMissingLabel: string; altRecipeName: string }) =>
                      Boolean(src.altMissingLabel && src.altRecipeName),
                    )
                    .map((src) => [
                      `${src.altRecipeName}\u0000${src.altMissingLabel}`,
                      { missingLabel: src.altMissingLabel, recipeName: src.altRecipeName },
                    ] as const)
                ).values(),
              );
              const chipKey = `unused-suggestion-${i}-${s.missingName}-${s.qty}-${s.count}`;
              const chipClassName =
                "text-[11px] px-2.5 py-1.5 rounded-full font-medium inline-flex items-center gap-1 bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 touch-manipulation";
              const panelShellClass =
                "relative z-[80] max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-0 text-[11px] leading-relaxed text-foreground shadow-md shadow-black/15 ring-1 ring-border/50 dark:shadow-black/30";
              const panelShellPopoverClass = `${panelShellClass} w-[min(100vw-2rem,24rem)] sm:w-auto sm:max-w-sm`;
              const panelBody = (
                <>
                  <div className="relative space-y-2 px-3.5 py-3">
                    {groups.map((group, idx) => (
                      <Fragment key={`${group.recipeName}-${idx}`}>
                        {idx > 0 && <div className="border-t border-border pt-2" />}
                        <div className="space-y-1.5">
                          <p className="text-[11px] leading-snug">
                            <span className="font-normal text-muted-foreground">Pour utiliser </span>
                            {renderUnusedFoodLabelsLightAccent(group.unusedLabels)}
                            <span className="font-normal text-muted-foreground"> il faut ajouter :</span>
                          </p>
                          <p className="text-[11px] leading-snug">
                            <span className="font-normal text-muted-foreground">- </span>
                            <span className={SUGGESTION_STYLE_ALIMENT}>
                              {group.missingAmountLabel} {s.missingName}
                            </span>
                            <span className="font-normal text-muted-foreground"> pour la recette : </span>
                            <span className={SUGGESTION_STYLE_PLAT}>&quot;{group.recipeName}&quot;</span>
                          </p>
                          {group.unusedLabels.length > 0 &&
                            dedupedAltSuggestions.map((alt) => (
                              <div
                                key={`${alt.recipeName}-${alt.missingLabel}`}
                                className={UNUSED_ALT_SUGGESTION_SHELL}
                              >
                                <p className="text-[10px] leading-relaxed">
                                  <span
                                    className="mr-0.5 inline-block translate-y-px font-normal text-muted-foreground/90 select-none"
                                    aria-hidden
                                  >
                                    ↳
                                  </span>
                                  <span className="font-normal text-muted-foreground">Ou ajouter </span>
                                  <span className={SUGGESTION_STYLE_ALIMENT_ALT}>{alt.missingLabel}</span>
                                  <span className="font-normal text-muted-foreground"> pour la recette </span>
                                  <span className={SUGGESTION_STYLE_PLAT_ALT}>&quot;{alt.recipeName}&quot;</span>
                                </p>
                              </div>
                            ))}
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </>
              );
              if (tapModeForUnusedSuggestions) {
                const isOpen = mobileUnusedSuggestionKey === chipKey;
                return (
                  <Popover
                    key={chipKey}
                    open={isOpen}
                    onOpenChange={(open) => {
                      if (open) setMobileUnusedSuggestionKey(chipKey);
                      else setMobileUnusedSuggestionKey((k) => (k === chipKey ? null : k));
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={`${chipClassName} cursor-pointer`}
                        aria-expanded={isOpen}
                        aria-controls={`unused-suggestion-panel-${i}`}
                      >
                        {s.missingName}
                        {s.qty > 0 && <span className="opacity-60">{formatNumeric(s.qty)}g</span>}
                        {s.count > 0 && <span className="opacity-60">×{s.count}</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      id={`unused-suggestion-panel-${i}`}
                      side="bottom"
                      align="center"
                      sideOffset={12}
                      className={panelShellPopoverClass}
                      onOpenAutoFocus={(e) => e.preventDefault()}
                    >
                      {panelBody}
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <Tooltip key={chipKey} delayDuration={250}>
                  <TooltipTrigger asChild>
                    <span className={`${chipClassName} cursor-default`}>
                      {s.missingName}
                      {s.qty > 0 && <span className="opacity-60">{formatNumeric(s.qty)}g</span>}
                      {s.count > 0 && <span className="opacity-60">×{s.count}</span>}
                    </span>
                  </TooltipTrigger>
                  {/* Panneau d’aide : sous la pastille « aliment à ajouter », centré sur celle-ci. */}
                  <TooltipContent
                    side="bottom"
                    align="center"
                    sideOffset={12}
                    className={panelShellClass}
                  >
                    {panelBody}
                  </TooltipContent>
                </Tooltip>
              );
            })}
            {/* Aliments à acheter : il ne manque qu'un seul ingrédient pour compléter la recette (fond rose) */}
            {filteredOneMissing.map((s, i) => {
              const chipKey = `one-missing-${i}-${s.missingName}`;
              const chipClassName =
                "text-[11px] px-2.5 py-1.5 rounded-full font-medium inline-flex items-center gap-1 bg-pink-500/20 text-pink-300 ring-1 ring-pink-500/40 touch-manipulation";
              const tooltipContent = (
                <div className="text-[11px] leading-relaxed max-w-xs px-3 py-2 space-y-1">
                  <p className="font-semibold text-foreground">Il ne manque que cet aliment pour :</p>
                  {s.recipes.map((r) => (
                    <p key={r.id} className="text-muted-foreground">• <span className="font-semibold text-foreground">{r.name}</span></p>
                  ))}
                </div>
              );
              if (tapModeForUnusedSuggestions) {
                const isOpen = mobileUnusedSuggestionKey === chipKey;
                return (
                  <Popover key={chipKey} open={isOpen} onOpenChange={(open) => {
                    if (open) setMobileUnusedSuggestionKey(chipKey);
                    else setMobileUnusedSuggestionKey((k) => (k === chipKey ? null : k));
                  }}>
                    <PopoverTrigger asChild>
                      <button type="button" className={`${chipClassName} cursor-pointer`}>
                        {s.missingName}
                        {s.qty > 0 && <span className="opacity-60">{formatNumeric(s.qty)}g</span>}
                        {s.count > 0 && <span className="opacity-60">×{s.count}</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="center" sideOffset={12}
                      className="relative z-[80] max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-0 text-[11px] leading-relaxed text-foreground shadow-md w-[min(100vw-2rem,24rem)]"
                      onOpenAutoFocus={(e) => e.preventDefault()}>
                      {tooltipContent}
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <Tooltip key={chipKey} delayDuration={250}>
                  <TooltipTrigger asChild>
                    <span className={`${chipClassName} cursor-default`}>
                      {s.missingName}
                      {s.qty > 0 && <span className="opacity-60">{formatNumeric(s.qty)}g</span>}
                      {s.count > 0 && <span className="opacity-60">×{s.count}</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center" sideOffset={12}
                    className="relative z-[80] max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-0 text-[11px] leading-relaxed text-foreground shadow-md">
                    {tooltipContent}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </>
        
      )}
      {suggestions.length === 0 && filteredOneMissing.length > 0 && (
        <>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-2 mb-1.5">🧩 Aliments pour compléter</p>
          <div className="flex flex-wrap gap-1.5">
            {filteredOneMissing.map((s, i) => {
              const chipKey = `one-missing-only-${i}-${s.missingName}`;
              const chipClassName =
                "text-[11px] px-2.5 py-1.5 rounded-full font-medium inline-flex items-center gap-1 bg-pink-500/20 text-pink-300 ring-1 ring-pink-500/40 touch-manipulation";
              const tooltipContent = (
                <div className="text-[11px] leading-relaxed max-w-xs px-3 py-2 space-y-1">
                  <p className="font-semibold text-foreground">Il ne manque que cet aliment pour :</p>
                  {s.recipes.map((r) => (
                    <p key={r.id} className="text-muted-foreground">• <span className="font-semibold text-foreground">{r.name}</span></p>
                  ))}
                </div>
              );
              if (tapModeForUnusedSuggestions) {
                const isOpen = mobileUnusedSuggestionKey === chipKey;
                return (
                  <Popover key={chipKey} open={isOpen} onOpenChange={(open) => {
                    if (open) setMobileUnusedSuggestionKey(chipKey);
                    else setMobileUnusedSuggestionKey((k) => (k === chipKey ? null : k));
                  }}>
                    <PopoverTrigger asChild>
                      <button type="button" className={`${chipClassName} cursor-pointer`}>
                        {s.missingName}
                        {s.qty > 0 && <span className="opacity-60">{formatNumeric(s.qty)}g</span>}
                        {s.count > 0 && <span className="opacity-60">×{s.count}</span>}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="bottom" align="center" sideOffset={12}
                      className="relative z-[80] max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-0 text-[11px] leading-relaxed text-foreground shadow-md w-[min(100vw-2rem,24rem)]"
                      onOpenAutoFocus={(e) => e.preventDefault()}>
                      {tooltipContent}
                    </PopoverContent>
                  </Popover>
                );
              }
              return (
                <Tooltip key={chipKey} delayDuration={250}>
                  <TooltipTrigger asChild>
                    <span className={`${chipClassName} cursor-default`}>
                      {s.missingName}
                      {s.qty > 0 && <span className="opacity-60">{formatNumeric(s.qty)}g</span>}
                      {s.count > 0 && <span className="opacity-60">×{s.count}</span>}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="center" sideOffset={12}
                    className="relative z-[80] max-w-sm overflow-hidden rounded-2xl border border-border bg-card p-0 text-[11px] leading-relaxed text-foreground shadow-md">
                    {tooltipContent}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </>
      )}
    </div>
    );
  };

  return (
    <div
      className="rounded-3xl bg-card/80 backdrop-blur-sm p-4"
      onDragOver={(e) => { if (sortMode === "manual") e.preventDefault(); }}
      onDrop={handleAvailableContainerDrop}
    >
      <div className="flex items-center gap-2 w-full">
        <button onClick={onToggleCollapse} className="flex items-center gap-2 flex-1 text-left">
          {!collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-yellow-500" />
            {category.label} au choix
          </h2>
          <span className="text-sm font-normal text-muted-foreground">{totalCount}</span>
        </button>
      {!collapsed && (
        <div className="relative ml-auto">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/40 pointer-events-none" />
          <Input
            type="text"
            placeholder="Rechercher…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 w-24 sm:w-28 text-[10px] rounded-xl bg-muted/40 border-border/30 placeholder:text-muted-foreground/40 pl-6"
          />
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={onToggleSort} className="text-[10px] gap-0.5 h-6 px-1.5">
          <SortIcon className="h-3 w-3" />
          <span className="hidden sm:inline">{sortLabel}</span>
        </Button>
        {isNumericSort && (
          <Button size="sm" variant="ghost" onClick={onToggleSortDirection} className="h-6 w-6 p-0">
            {sortAsc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="flex items-center gap-3 mt-3 px-3 py-1.5 bg-muted/40 rounded-2xl border border-muted/50">
          <div className="flex items-center gap-3 min-w-0">
            <Checkbox
              id={`filter-calories-${category.value}`}
              checked={useRemainingCalories}
              onCheckedChange={(checked) => {
                const on = !!checked;
                setAvailPref.mutate({ key: availableSeuilMaxPrefKey(category.value), value: on });
                // Plat au choix : activer « 100 % » dès que le seuil max s’allume ; sinon désactiver.
                setAvailPref.mutate({
                  key: availableFullRemainingPrefKey(category.value),
                  value: on && shouldAutoEnableFullRemainingWithSeuilMax(category.value),
                });
                if (!on) {
                  setCustomRatios({});
                  setTempCalorieOverride(null);
                }
              }}
            />
            <div className="flex flex-col min-w-0">
              <label htmlFor={`filter-calories-${category.value}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-foreground">
                Carte en fonction des calories restantes
              </label>
              {useRemainingCalories && (
                <div className="flex items-center gap-1.5 mt-0.5">
                   {/* Valeur = baseCalorieThreshold (max − conso si min Planning renseigné). */}
                   <span className="text-[10px] text-muted-foreground">
                     Seuil max :
                   </span>
                   {hideCalorieDisplay ? (
                     <span className={`text-sm font-bold ${seuilCalorieWordClass}`}>Calorie</span>
                   ) : (
                     <>
                   <input
                     type="number"
                     inputMode="numeric"
                     defaultValue={Math.round(tempCalorieOverride ?? baseCalorieThreshold)}
                     key={`temp-cal-${tempCalorieOverride ?? 'base'}-${Math.round(baseCalorieThreshold)}`}
                     onBlur={(e) => {
                       const val = parseInt(e.target.value);
                       if (val && val > 0 && val !== Math.round(baseCalorieThreshold)) {
                         setTempCalorieOverride(val);
                       } else {
                         setTempCalorieOverride(null);
                       }
                     }}
                     onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                     className="w-16 h-5 text-sm font-bold bg-transparent border-none rounded px-1 text-foreground focus:outline-none focus:ring-1 focus:ring-orange-400/30 text-center hover:text-orange-500 transition-colors"
                   />
                  <span className="text-[10px] text-muted-foreground">kcal</span>
                  {tempCalorieOverride !== null && (
                    <button
                      onClick={() => setTempCalorieOverride(null)}
                      className="text-[9px] text-muted-foreground/60 hover:text-muted-foreground"
                      title="Réinitialiser au seuil calculé"
                    >✕</button>
                  )}
                     </>
                   )}
                  <span className="text-[10px] text-muted-foreground mx-1">·</span>
                  <span className="text-sm font-bold text-blue-400">{Math.round(remainingProtein)}</span>
                  <span className="text-[10px] text-muted-foreground">g prot</span>
                </div>
              )}
            </div>
          </div>
          {useRemainingCalories && (
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {/* Sélecteur de date : style badge calendrier des cartes Possible */}
              <Select value={selectedThresholdDayIso} onValueChange={handleThresholdDayChange}>
                <SelectTrigger
                  className="h-5 min-w-[58px] w-auto justify-start gap-1 px-1.5 py-0 border border-border/50 bg-background/60 text-foreground text-[10px] rounded-md hover:bg-background/80 transition-colors [&>svg:last-child]:hidden focus:ring-0 focus:ring-offset-0"
                  title="Jour utilisé pour le seuil max (calories / protéines restantes)"
                >
                  <Calendar className="h-2.5 w-2.5 opacity-50 shrink-0" />
                  <span className="whitespace-nowrap">
                    {selectedThresholdDay
                      ? format(parseISO(selectedThresholdDay.iso), "eee d", { locale: fr })
                      : "Jour"}
                  </span>
                </SelectTrigger>
                <SelectContent align="end">
                  {thresholdDayWindow.map((d) => (
                    <SelectItem
                      key={d.iso}
                      value={d.iso}
                      className={d.iso === todayIso ? "bg-primary/15 focus:bg-primary/25 font-bold" : ""}
                    >
                      {d.iso === todayIso
                        ? `📅 ${format(parseISO(d.iso), "EEEE d", { locale: fr }).replace(/^\w/, (c) => c.toUpperCase())}`
                        : format(parseISO(d.iso), "EEEE d", { locale: fr }).replace(/^\w/, (c) => c.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label
                htmlFor={`filter-full-recipes-${category.value}`}
                className="flex items-center gap-2 rounded-xl bg-background/40 px-2 py-1 text-[10px] font-bold text-muted-foreground cursor-pointer hover:text-foreground transition-colors"
                title="Afficher uniquement les recettes entièrement faisables en stock (multiple ≥ 1 ou partiel ≥ 90 %). Le seuil calories reste le filtre séparé."
              >
                <Checkbox
                  id={`filter-full-recipes-${category.value}`}
                  checked={showOnlyFullRemainingRecipes}
                  onCheckedChange={(checked) => {
                    setAvailPref.mutate({ key: availableFullRemainingPrefKey(category.value), value: !!checked });
                    if (checked) setCustomRatios({});
                  }}
                />
                <span className="whitespace-nowrap">100%</span>
              </label>
            </div>
          )}
        </div>
      )}

      {!collapsed &&
        <div className="flex flex-col gap-2 mt-3">
          {isPlat && (unusedFoodItems.length > 0 || crossCategoryExpiringItems.length > 0) && renderUnusedItems(unusedFoodItems, crossCategoryExpiringItems)}

          {(() => {
            const firstIsMealNoDateIdx = showMealItemsInAvailable
              ? unifiedItems.findIndex((u) => u.type === 'isMeal' && !u.fi.expiration_date)
              : -1;
            // En manuel : séparateur avant le premier repas seul (tous regroupés).
            // En calories/protéines/note/satiété/péremption : séparateur seulement avant ceux sans date.
            const firstPinnedIsMealIdx =
              sortMode === "manual"
                ? (showMealItemsInAvailable ? unifiedItems.findIndex((u) => u.type === 'isMeal') : -1)
                : firstIsMealNoDateIdx;

            const todayStr = new Date().toISOString().slice(0, 10);
            let dateSeparatorInserted = false;

            return unifiedItems.map((u, idx) => {
              const elements: React.ReactNode[] = [];

              if (sortMode === "expiration" && !dateSeparatorInserted && u.sortDate && u.sortDate > todayStr && (u.sortCounter === null || u.sortCounter <= 0)) {
                const hasPastBefore = unifiedItems.slice(0, idx).some(prev => prev.sortDate && prev.sortDate <= todayStr && (prev.sortCounter === null || prev.sortCounter <= 0));
                if (hasPastBefore) {
                  dateSeparatorInserted = true;
                  elements.push(
                    <div key="sep-date-future" className="my-1.5">
                      <Separator className="opacity-30" />
                    </div>
                  );
                }
              }

              const sep = (idx === firstPinnedIsMealIdx && firstPinnedIsMealIdx > 0) ? (
                <div key={`sep-ismeal`} className="flex items-center gap-2 my-2">
                  <Separator className="flex-1" />
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1"><UtensilsCrossed className="h-3 w-3" />Repas seuls</span>
                  <Separator className="flex-1" />
                </div>
              ) : null;
              const card = u.type === 'isMeal' ? renderIsMealCard(u.fi, idx)
                : u.type === 'nm' ? renderNameMatchCard(u.nm, u.nmIdx, idx)
                : u.type === 'partial' ? renderPartialCard(u.item, idx)
                : renderAvailableCard(u.item, idx);
              if (elements.length > 0 || sep) {
                return <Fragment key={`wrapper-${idx}`}>{...elements}{sep}{card}</Fragment>;
              }
              return card;
            });
          })()}

          {totalCount === 0 &&
            <p className="text-muted-foreground text-sm text-center py-4 italic">
              {useRemainingCalories ? "Aucun repas ne correspond à vos calories restantes." : "Aucun repas réalisable avec les aliments disponibles"}
            </p>
          }

          {!isPlat && category.value !== "petit_dejeuner" && (unusedFoodItems.length > 0 || crossCategoryExpiringItems.length > 0) && renderUnusedItems(unusedFoodItems, crossCategoryExpiringItems)}
        </div>
      }
    </div>
  );
}
