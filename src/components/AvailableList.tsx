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
 * - Filtrage par seuil calorique restant (useRemainingCalories)
 * - Tri par calories, protéines, péremption ou manuel
 * - Recherche dans les noms et ingrédients
 * - Badges de ratio personnalisable (x2, 75%, etc.)
 * - Affichage des aliments inutilisés et des items cross-catégorie périmant bientôt
 * - Aliments indivisibles : ratios discrets (getValidDiscreteRatios)
 *
 * tryFitMeal() : vérifie si un repas rentre dans le budget calorique restant
 * buildUnifiedItems() : fusionne toutes les sources en liste unifiée triée
 */
import { useState, Fragment, useEffect } from "react";
import type { ReactNode } from "react";
import { Plus, GripVertical, CheckCircle2, RotateCcw, AlertCircle, ArrowUpDown, CalendarDays, Box, Wand2, Flame, Drumstick, Sparkles, PieChart, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowRight, UtensilsCrossed, Infinity as InfinityIcon, Search } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealCard } from "@/components/MealCard";
import type { Meal } from "@/hooks/useMeals";
import { colorFromName } from "@/lib/foodColors";
import type { FoodItem } from "@/hooks/useFoodItems";
import { usePreferences } from "@/hooks/usePreferences";
import {
  buildStockMap, findStockKey, getMealMultiple, getMealFractionalRatio,
  analyzeMealIngredients,
  getMissingIngredients,
  buildIngredientMealIndex,
  formatExpirationLabel, compareExpirationWithCounter, buildScaledMealForRatio,
  getIndivisibleConstrainedRatio, getValidDiscreteRatios,
  getDisplayedCalories, getDisplayedProtein, parseMacroDisplay,
  type StockInfo, type FoodItemIndex,
} from "@/lib/stockUtils";
import {
  normalizeForMatch, strictNameMatch, smartFoodContains, parseQty, formatNumeric, getFoodItemTotalGrams, parseIngredientGroups, computeIngredientCalories, computeIngredientProtein, computeCounterDays, normalizeKey
} from "@/lib/ingredientUtils";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { useCalorieBalance } from "@/hooks/useCalorieBalance";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type AvailableSortMode = "manual" | "calories" | "protein" | "expiration";

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
  onAfterMoveToPossible?: () => void;
}

export function AvailableList({ category, meals, foodItems, allMeals, stockMap, sortMode, sortAsc, onToggleSort, onToggleSortDirection, collapsed, onToggleCollapse, onMoveToPossible, onMovePartialToPossible, onMoveFoodItemToPossible, onDeleteFoodItem, onMoveNameMatchToPossible, onRename, onUpdateCalories, onUpdateGrams, onUpdateIngredients, onToggleFavorite, onUpdateOvenTemp, onUpdateOvenMinutes, onAfterMoveToPossible }: AvailableListProps) {
  const isPlat = category.value === "plat";
  const { getPreference: getAvailPref, setPreference: setAvailPref } = usePreferences();
  const storedOrder = getAvailPref<string[]>(`available_order_${category.value}`, []);
  const useRemainingCalories = getAvailPref<boolean>(`available_use_remaining_calories_${category.value}`, category.value !== "petit_dejeuner");
  const [avDragIndex, setAvDragIndex] = useState<number | null>(null);
  const [customRatios, setCustomRatios] = useState<Record<string, number>>({});
  const [editingRatioId, setEditingRatioId] = useState<string | null>(null);
  const [ratioInput, setRatioInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const tapModeForUnusedSuggestions = useUnusedSuggestionTapMode();
  const [mobileUnusedSuggestionKey, setMobileUnusedSuggestionKey] = useState<string | null>(null);
  useEffect(() => {
    if (!tapModeForUnusedSuggestions) setMobileUnusedSuggestionKey(null);
  }, [tapModeForUnusedSuggestions]);
  const isAvailableCb = (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  };
  const { getTargetCalorieThreshold, getDayProtein, DAILY_PROTEIN_GOAL } = useCalorieBalance(isAvailableCb);
  const baseCalorieThreshold = getTargetCalorieThreshold();
  const JS_DAY_TO_KEY: Record<number, string> = { 1:"lundi",2:"mardi",3:"mercredi",4:"jeudi",5:"vendredi",6:"samedi",0:"dimanche" };
  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const todayProtein = getDayProtein(JS_DAY_TO_KEY[new Date().getDay()], todayIso);
  const remainingProtein = Math.max(0, DAILY_PROTEIN_GOAL - todayProtein);
  const [tempCalorieOverride, setTempCalorieOverride] = useState<number | null>(null);
  const calorieThreshold = tempCalorieOverride ?? baseCalorieThreshold;

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

  const getUnifiedItemName = (u: {
    type: 'isMeal' | 'nm' | 'av' | 'partial';
    fi?: FoodItem;
    nm?: NameMatch;
    item?: { meal: Meal };
  }): string => {
    if (u.type === 'isMeal') return u.fi?.name ?? '';
    if (u.type === 'nm') return u.nm?.meal.name ?? '';
    return u.item?.meal.name ?? '';
  };

  const getUnifiedItemIngredients = (u: {
    type: 'isMeal' | 'nm' | 'av' | 'partial';
    fi?: FoodItem;
    nm?: NameMatch;
    item?: { meal: Meal };
  }): string => {
    if (u.type === 'av' || u.type === 'partial') return u.item?.meal.ingredients ?? '';
    return '';
  };

  const matchesSearch = (u: any): boolean => {
    if (!searchQuery.trim()) return true;
    const q = normalizeForMatch(searchQuery);
    const name = normalizeForMatch(getUnifiedItemName(u));
    if (name.includes(q)) return true;
    const ing = normalizeForMatch(getUnifiedItemIngredients(u));
    if (ing.includes(q)) return true;
    return false;
  };

  // 1. Repas réalisables via correspondance d'ingrédients
  const available: { meal: Meal; multiple: number | null }[] = meals
    .filter(meal => meal.ingredients?.trim())
    .map((meal) => {
      const rawMultiple = getMealMultiple(meal, stockMap);
      if (rawMultiple === null) return { meal, multiple: null };
      return { meal, multiple: rawMultiple };
    })
    .filter(({ multiple }) => multiple !== null && (multiple === Infinity || (multiple as number) > 0));
  const availableMealIds = new Set(available.map(a => a.meal.id));

  // 1b. Recettes partielles (50-100%)
  const partialAvailable: { meal: Meal; ratio: number }[] = meals
    .filter(meal => meal.ingredients?.trim() && !availableMealIds.has(meal.id))
    .map(meal => {
      const ratio = getMealFractionalRatio(meal, stockMap);
      if (ratio === null) return null;
      return { meal, ratio };
    })
    .filter(Boolean) as { meal: Meal; ratio: number }[];
  const partialMealIds = new Set(partialAvailable.map(p => p.meal.id));

  // 2. Correspondance par nom
  type NameMatch = { meal: Meal; fi: FoodItem; portionsAvailable: number | null };
  const nameMatches: NameMatch[] = [];
  const nameMatchedFiIds = new Set<string>();

  for (const meal of meals) {
    if (availableMealIds.has(meal.id) || partialMealIds.has(meal.id)) continue;
    if (meal.ingredients?.trim()) continue;
    for (const fi of foodItems) {
      if (strictNameMatch(meal.name, fi.name)) {
        const mealGrams = parseQty(meal.grams);
        const stockGrams = fi.is_infinite ? Infinity : getFoodItemTotalGrams(fi);
        if (!fi.is_infinite && stockGrams <= 0) continue;
        let portions: number | null = null;
        if (!fi.is_infinite && mealGrams > 0) {
          portions = Math.floor(stockGrams / mealGrams);
          if (portions < 1) continue;
        } else if (!fi.is_infinite) {
          portions = fi.quantity ?? 1;
          if (portions < 1) continue;
        }
        nameMatches.push({ meal, fi, portionsAvailable: fi.is_infinite ? null : portions });
        nameMatchedFiIds.add(fi.id);
        break;
      }
    }
  }

  // 3. Articles alimentaires de type 'is_meal'
  const isMealItems = foodItems.filter((fi) => {
    if (!fi.is_meal) return false;
    if (nameMatchedFiIds.has(fi.id)) return false;
    const hasRecipeMatch = meals.some(m => strictNameMatch(m.name, fi.name));
    if (hasRecipeMatch) return false;
    return true;
  });

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
      if (fi.is_meal) return false;
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

  // Tri
  let sortedAvailable = [...available];
  let sortedNameMatches = [...nameMatches];
  let sortedIsMealItems = [...isMealItems];

  if (sortMode === "calories" || sortMode === "protein") {
    const dir = sortAsc ? 1 : -1;

    if (sortMode === "calories") {
      sortedAvailable.sort((a, b) => dir * ((getDisplayedCalories(a.meal) ?? 0) - (getDisplayedCalories(b.meal) ?? 0)));
      sortedNameMatches.sort((a, b) => dir * ((getDisplayedCalories(a.meal) ?? 0) - (getDisplayedCalories(b.meal) ?? 0)));
      sortedIsMealItems.sort((a, b) => dir * (parseMacroValue(a.calories) - parseMacroValue(b.calories)));
    } else {
      sortedAvailable.sort((a, b) => dir * ((getDisplayedProtein(a.meal) ?? 0) - (getDisplayedProtein(b.meal) ?? 0)));
      sortedNameMatches.sort((a, b) => dir * ((getDisplayedProtein(a.meal) ?? 0) - (getDisplayedProtein(b.meal) ?? 0)));
      sortedIsMealItems.sort((a, b) => dir * (parseMacroValue(a.protein) - parseMacroValue(b.protein)));
    }
  } else if (sortMode === "expiration") {
    sortedAvailable.sort((a, b) => {
      const aAn = analyzeMealIngredients(a.meal, foodItems);
      const bAn = analyzeMealIngredients(b.meal, foodItems);
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
    const isMealNoDate = sortedIsMealItems.filter(fi => !fi.expiration_date);
    const isMealWithDate = sortedIsMealItems.filter(fi => !!fi.expiration_date);
    sortedIsMealItems = isMealNoDate;
    (sortedIsMealItems as any).__withDate = isMealWithDate;
  }

  type UnifiedAvail =
    | { type: 'isMeal'; key: string; fi: FoodItem }
    | { type: 'nm'; key: string; nm: NameMatch; nmIdx: number }
    | { type: 'av'; key: string; item: typeof available[0] }
    | { type: 'partial'; key: string; item: typeof partialAvailable[0] };

  const buildUnifiedItems = (): UnifiedAvail[] => {
    let items: UnifiedAvail[] = [
      ...sortedIsMealItems.map(fi => ({ type: 'isMeal' as const, key: `fi-${fi.id}`, fi })),
      ...sortedNameMatches.map((nm, i) => ({ type: 'nm' as const, key: `nm-${nm.meal.id}-${nm.fi.id}`, nm, nmIdx: i })),
      ...sortedAvailable.map(item => ({ type: 'av' as const, key: item.meal.id, item })),
      ...partialAvailable.map(item => ({ type: 'partial' as const, key: `partial-${item.meal.id}`, item }))
    ];

    // Apply search filter
    if (searchQuery.trim()) {
      items = items.filter(matchesSearch);
    }

    // Au lieu de polluer le state global React customRatios lors du JS de rendu,
    // on gère une copie locale pour cette passe de calcul :
    const localCalculatedRatios: Record<string, number> = {};

    if (useRemainingCalories) {
      items = items.filter(u => {
        if (u.type === 'isMeal') {
          let displayCal = u.fi.calories;
          if (u.fi.grams) {
            const unitG = parseQty(u.fi.grams);
            if (unitG > 0 && displayCal) displayCal = String(Math.round(parseFloat(displayCal.replace(',', '.')) * unitG / 100));
          }
          const fakeMeal: Meal = { ...u.fi as unknown as Meal, calories: displayCal, ingredients: null };
          return tryFitMeal(fakeMeal, 1, false).show;
        }
        if (u.type === 'nm') {
          let baseCal = u.nm.meal.calories && u.nm.meal.calories !== "0" ? parseFloat(u.nm.meal.calories.replace(",", ".")) : 0;
          if (!baseCal && u.nm.fi.calories) {
            const fiCal = parseFloat(u.nm.fi.calories.replace(",", "."));
            if (u.nm.fi.grams) {
              const unitG = parseQty(u.nm.fi.grams);
              if (unitG > 0) baseCal = (fiCal * unitG) / 100;
            } else {
              baseCal = fiCal;
            }
          }
          const fakeMeal: Meal = { ...u.nm.meal, calories: baseCal > 0 ? String(Math.round(baseCal)) : u.nm.meal.calories };
          return tryFitMeal(fakeMeal, 1, false).show;
        }
        if (u.type === 'av') {
          const ratioToTry = customRatios[u.item.meal.id] ?? 1;
          const fitResult = tryFitMeal(u.item.meal, ratioToTry);
          if (fitResult.show && fitResult.newRatio !== null && fitResult.newRatio !== ratioToTry) {
            localCalculatedRatios[u.item.meal.id] = fitResult.newRatio;
          }
          return fitResult.show;
        }
        if (u.type === 'partial') {
          const ratioToTry = customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
          const fitResult = tryFitMeal(u.item.meal, ratioToTry);
          if (fitResult.show && fitResult.newRatio !== null && fitResult.newRatio !== ratioToTry) {
            localCalculatedRatios[`partial-${u.item.meal.id}`] = fitResult.newRatio;
          }
          return fitResult.show;
        }
        return true;
      });

      // Patch en place des `items` avec les ratios locaux (pour qu'ils soient récupérés correctement pendant le sort et le rendu final)
      items = items.map(u => {
        if (u.type === 'av' && localCalculatedRatios[u.item.meal.id] !== undefined) {
           u.item = { ...u.item, calculatedRatio: localCalculatedRatios[u.item.meal.id] } as any; // trick type local
        }
        if (u.type === 'partial' && localCalculatedRatios[`partial-${u.item.meal.id}`] !== undefined) {
           u.item = { ...u.item, calculatedRatio: localCalculatedRatios[`partial-${u.item.meal.id}`] } as any;
        }
        return u;
      });
    }

    if (sortMode === "manual" && storedOrder.length > 0) {
      const orderMap = new Map(storedOrder.map((k: string, i: number) => [k, i]));
      items.sort((a, b) => (orderMap.get(a.key) ?? Infinity) - (orderMap.get(b.key) ?? Infinity));
    }
    if (sortMode === "calories" || sortMode === "protein") {
      const dir = sortAsc ? 1 : -1;
      const getVal = (u: UnifiedAvail): number => {
        if (sortMode === "calories") {
          if (u.type === 'isMeal') {
            // Pour le tri numérique, classer sur UNE seule portion (et non le total xN disponible).
            let displayCal = u.fi.calories;
            if (u.fi.grams) {
              const unitG = parseQty(u.fi.grams);
              if (unitG > 0 && displayCal) displayCal = String(Math.round(parseFloat(displayCal.replace(',', '.')) * unitG / 100));
            }
            const fakeMeal: Meal = { ...u.fi as unknown as Meal, calories: displayCal, ingredients: null };
            return getDisplayedCalories(fakeMeal) ?? 0;
          }
          if (u.type === 'nm') return getDisplayedCalories(u.nm.meal) ?? 0;
          if (u.type === 'av') {
            const dynRatio = (u.item as any).calculatedRatio;
            const ratio = dynRatio ?? customRatios[u.item.meal.id] ?? 1;
            const displayMeal = ratio !== 1 ? buildScaledMealForRatio(u.item.meal, ratio, stockMap) : u.item.meal;
            return getDisplayedCalories(displayMeal) ?? 0;
          }
          if (u.type === 'partial') {
            const dynRatio = (u.item as any).calculatedRatio;
            const ratio = dynRatio ?? customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
            const displayMeal = buildScaledMealForRatio(u.item.meal, ratio, stockMap);
            return getDisplayedCalories(displayMeal) ?? 0;
          }
          return 0;
        }

        if (u.type === 'isMeal') {
            // Même règle côté protéines : tri basé sur la portion unitaire.
            let displayPro = u.fi.protein;
            if (u.fi.grams) {
              const unitG = parseQty(u.fi.grams);
              if (unitG > 0 && displayPro) displayPro = String(Math.round(parseFloat(displayPro.replace(',', '.')) * unitG / 100));
            }
            return parseMacroValue(displayPro);
        }
        if (u.type === 'nm') return getDisplayedProtein(u.nm.meal) ?? 0;
        if (u.type === 'av') {
          const dynRatio = (u.item as any).calculatedRatio;
          const ratio = dynRatio ?? customRatios[u.item.meal.id] ?? 1;
          const displayMeal = ratio !== 1 ? buildScaledMealForRatio(u.item.meal, ratio, stockMap) : u.item.meal;
          return getDisplayedProtein(displayMeal) ?? 0;
        }
        if (u.type === 'partial') {
          const dynRatio = (u.item as any).calculatedRatio;
          const ratio = dynRatio ?? customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
          const displayMeal = buildScaledMealForRatio(u.item.meal, ratio, stockMap);
          return getDisplayedProtein(displayMeal) ?? 0;
        }
        return 0;
      };
      items.sort((a, b) => {
        // Les articles is_meal sont toujours en bas (sauf pour Plat)
        if (!isPlat) {
          const aIsMeal = a.type === 'isMeal' ? 1 : 0;
          const bIsMeal = b.type === 'isMeal' ? 1 : 0;
          if (aIsMeal !== bIsMeal) return aIsMeal - bIsMeal;
        }
        return dir * (getVal(a) - getVal(b));
      });
    } else if (sortMode === "manual") {
      // For manual sort, also push is_meal to bottom when no stored order (except for Plat)
      if (storedOrder.length === 0 && !isPlat) {
        items.sort((a, b) => {
          const aIsMeal = a.type === 'isMeal' ? 1 : 0;
          const bIsMeal = b.type === 'isMeal' ? 1 : 0;
          return aIsMeal - bIsMeal;
        });
      }
    }
    return items;
  };

  const tryFitMeal = (meal: Meal, overrideRatio: number | null, isScalable: boolean = true): { show: boolean; newRatio: number | null } => {
    if (!useRemainingCalories) return { show: true, newRatio: overrideRatio };

    const baseRaw = getDisplayedCalories(meal);
    if (baseRaw === null || baseRaw === 0) return { show: true, newRatio: overrideRatio }; // No cal info, keep it

    const startingRatio = overrideRatio ?? 1;
    let scaledMeal = buildScaledMealForRatio(meal, startingRatio, stockMap);
    let currentCal = getDisplayedCalories(scaledMeal);

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
       const checkCal = getDisplayedCalories(buildScaledMealForRatio(meal, directRatio, stockMap));
       if (checkCal !== null && checkCal <= calorieThreshold) return { show: true, newRatio: directRatio };
       // Edge case: rounding artifacts — try one step down
       const fallback = directRatio - 0.01;
       if (fallback >= 0.5) {
         const fbCal = getDisplayedCalories(buildScaledMealForRatio(meal, fallback, stockMap));
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
       
       currentCal = getDisplayedCalories(buildScaledMealForRatio(meal, bestValid, stockMap));
       if (currentCal !== null && currentCal <= calorieThreshold) {
         return { show: true, newRatio: bestValid };
       }
       
       // Fallback: search descending if rounding pushed it over
       const sortedRatios = [...validRatios].sort((a,b) => b-a);
       for (const r of sortedRatios) {
         if (r <= targetRatio + EPSILON && r >= 0.5) {
            currentCal = getDisplayedCalories(buildScaledMealForRatio(meal, r, stockMap));
            if (currentCal !== null && currentCal <= calorieThreshold) return { show: true, newRatio: r };
         }
       }
       return { show: false, newRatio: null };
    }
  };
  const unifiedItems = buildUnifiedItems();

  const totalIsMealCount = unifiedItems.filter(u => u.type === 'isMeal').length;
  const totalCount = unifiedItems.length;

  const isNumericSort = sortMode === "calories" || sortMode === "protein";
  const SortIcon = sortMode === "calories" ? Flame : sortMode === "protein" ? Drumstick : sortMode === "expiration" ? CalendarDays : ArrowUpDown;
  const sortLabel = sortMode === "calories" ? "Calories" : sortMode === "protein" ? "Protéines" : sortMode === "expiration" ? "Péremption" : "Manuel";

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
    const displayGrams = fi.quantity && fi.quantity > 1 && fi.grams
      ? `${parseQty(fi.grams) * fi.quantity}g`
      : (fi.is_infinite ? "∞" : fi.grams ?? null);
    
    let displayCal = fi.calories;
    let displayPro = fi.protein ?? null;
    if (fi.grams) {
      const totalG = getFoodItemTotalGrams(fi);
      if (totalG > 0) {
        if (displayCal) displayCal = String(Math.round(parseFloat(displayCal.replace(',', '.')) * totalG / 100));
        if (displayPro) displayPro = String(Math.round(parseFloat(displayPro.replace(',', '.')) * totalG / 100));
      }
    }

    const counterDays = computeCounterDays(fi.counter_start_date);
    const fakeMeal: Meal = {
      id: `fi-${fi.id}`, name: fi.name, category: "plat", calories: displayCal,
      protein: displayPro,
      grams: displayGrams, ingredients: null,
      sort_order: 0, created_at: fi.created_at, is_available: true, is_favorite: false,
      oven_temp: null, oven_minutes: null,
    };
    return (
      <div key={fi.id} className="relative">
        <MealCard meal={fakeMeal} stockMap={stockMap}
          onMoveToPossible={() => { onMoveFoodItemToPossible(fi); onAfterMoveToPossible?.(); }}
          onRename={() => {}} onDelete={() => onDeleteFoodItem(fi.id)} onUpdateCalories={() => {}} onUpdateGrams={() => {}} onUpdateIngredients={() => {}}
          onDragStart={(e) => { e.dataTransfer.setData("mealId", fi.id); e.dataTransfer.setData("source", "available"); if (unifiedIdx !== undefined) setAvDragIndex(unifiedIdx); }}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (sortMode === "manual" && avDragIndex !== null && unifiedIdx !== undefined && avDragIndex !== unifiedIdx) handleAvReorder(avDragIndex, unifiedIdx); setAvDragIndex(null); }}
          expirationLabel={expLabel} expirationDate={fi.expiration_date} expirationIsToday={expIsTodayFi} 
          maxIngredientCounter={counterDays} earliestCounterDate={fi.counter_start_date} />
        {fi.quantity && fi.quantity > 1 && (
          <div className="absolute top-1 right-2 z-10 bg-black/60 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow flex items-center gap-0.5">
            x{fi.quantity}
          </div>
        )}
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
    const baseGrams = fi.quantity && fi.quantity > 1 && fi.grams
      ? `${parseQty(fi.grams) * fi.quantity}g`
      : (meal.grams ?? (fi.is_infinite ? "∞" : fi.grams ?? null));
    const baseG = parseQty(baseGrams);
    const hasCal = meal.calories && meal.calories !== "0";
    const hasPro = meal.protein && meal.protein !== "0" && meal.protein !== "0%";
    
    let baseCal = hasCal ? parseFloat(meal.calories!.replace(",", ".")) : 0;
    let basePro = hasPro ? parseFloat(meal.protein!.replace(",", ".")) : 0;

    // Si le repas maître n'a pas de macros, on prend celles de l'aliment
    if (!hasCal || !hasPro) {
      if (!hasCal && fi.calories) {
        const fiCal = parseFloat(fi.calories.replace(",", "."));
        if (fi.grams) {
          const totalG = getFoodItemTotalGrams(fi);
          baseCal = (fiCal * totalG) / 100;
        } else {
          baseCal = fiCal * (fi.quantity ?? 1);
        }
      }
      if (!hasPro && fi.protein) {
        const fiPro = parseFloat(fi.protein.replace(",", "."));
        if (fi.grams) {
          const totalG = getFoodItemTotalGrams(fi);
          basePro = (fiPro * totalG) / 100;
        } else {
          basePro = fiPro * (fi.quantity ?? 1);
        }
      }
    }

    // Mise à l'échelle des grammes et macros si le ratio != 1
    let displayGrams = baseGrams;
    let displayMeal = meal;

    if (effectiveRatio !== 1) {
      const scaledG = baseG > 0 ? Math.round(baseG * effectiveRatio) : 0;
      const scaledCal = baseCal > 0 ? Math.round(baseCal * effectiveRatio) : 0;
      const scaledPro = basePro > 0 ? Math.round(basePro * effectiveRatio) : 0;
      displayGrams = scaledG > 0 ? `${scaledG}g` : baseGrams;
      displayMeal = { 
        ...meal, 
        grams: displayGrams,
        // On passe les ingrédients pour que getDisplayedCalories calcule tout seul depuis le stock
        ingredients: meal.ingredients || (scaledG > 0 ? `${scaledG}g ${meal.name}` : null),
        calories: scaledCal > 0 ? String(scaledCal) : (baseCal > 0 ? String(Math.round(baseCal)) : meal.calories), 
        protein: scaledPro > 0 ? String(scaledPro) : (basePro > 0 ? String(Math.round(basePro)) : meal.protein) 
      };
    } else if (!hasCal || !hasPro) {
      // Même sans changement de ratio, on assure l'affichage des macros calculées
      displayMeal = {
        ...meal,
        ingredients: meal.ingredients || (baseG > 0 ? `${baseG}g ${meal.name}` : null),
        calories: baseCal > 0 ? String(Math.round(baseCal)) : meal.calories,
        protein: basePro > 0 ? String(Math.round(basePro)) : meal.protein
      };
    }

    const expIsTodayNm = isToday(fi.expiration_date);
    const fakeMeal: Meal = { ...displayMeal, id: nmKey, grams: displayGrams };
    return (
      <div key={`nm-${idx}`} className="relative">
        <MealCard meal={fakeMeal} stockMap={stockMap}
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
    const dynCalculatedRatio = (item as any).calculatedRatio;
    const customRatio = dynCalculatedRatio ?? customRatios[meal.id];
    const isCalorieRestrictedRatio = dynCalculatedRatio !== undefined && dynCalculatedRatio < 1;

    const effectiveRatio = customRatio ?? 1;
    const displayMeal = effectiveRatio !== 1 ? buildScaledMealForRatio(meal, effectiveRatio, stockMap) : meal;
    // Calcule le nombre de portions réellement faisables pour la portion affichée (ex: 57%).
    const displayMultiple = effectiveRatio !== 1 ? getMealMultiple(displayMeal, stockMap) : multiple;
    const badgeMultiple = displayMultiple ?? multiple;
    // L'analyse en une seule passe remplace 6+ appels de fonctions séparés
    const analysis = analyzeMealIngredients(meal, foodItems);
    const expLabel = formatExpirationLabel(analysis.earliestExpiration);
    const expIsTodayAv = isToday(analysis.earliestExpiration);
    const expiringIng = analysis.expiringIngredientName;
    return (
      <div key={meal.id} className="relative">
        <MealCard meal={displayMeal} stockMap={stockMap}
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
    const dynCalculatedRatio = (item as any).calculatedRatio;
    const customRatio = dynCalculatedRatio ?? customRatios[`partial-${meal.id}`];

    const effectiveRatio = customRatio ?? defaultRatio;
    const pct = Math.round(effectiveRatio * 100);
    const analysis = analyzeMealIngredients(meal, foodItems);
    const expLabel = formatExpirationLabel(analysis.earliestExpiration);
    const expIsTodayPa = isToday(analysis.earliestExpiration);
    const partialMeal = buildScaledMealForRatio(meal, effectiveRatio, stockMap);
    const partialKey = `partial-${meal.id}`;
    return (
      <div key={partialKey} className="relative">
        <MealCard meal={partialMeal} stockMap={stockMap}
          onMoveToPossible={async () => {
            setCustomRatios(prev => { const next = { ...prev }; delete next[partialKey]; return next; });
            await onMovePartialToPossible(meal, effectiveRatio);
            onAfterMoveToPossible?.();
          }}
          onRename={(name) => onRename(meal.id, name)} onDelete={() => {}} onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)} onUpdateGrams={(g) => onUpdateGrams(meal.id, g)} onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
          onToggleFavorite={() => onToggleFavorite(meal.id)}
          onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)} onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
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
    const items = buildUnifiedItems();
    const reordered = [...items];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    setAvailPref.mutate({ key: `available_order_${category.value}`, value: reordered.map(u => u.key) });
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

    // On ne traite que les items inutilisés AVEC une date de péremption pour suggérer des compléments.
    const candidatesToProcessByFi = items.filter(fi => !!fi.expiration_date);

    const unusedStockKeys = new Set(
      candidatesToProcessByFi.map((fi) => findStockKey(stockMap, fi.name) ?? normalizeKey(fi.name))
    );
    const unusedCanonicalNames = new Set(candidatesToProcessByFi.map((fi) => canonicalize(fi.name)));
    const allUnusedCanonicalNames = new Set(items.map((fi) => canonicalize(fi.name)));

    const isActuallyMissing = (missingKey: string): boolean => {
      const missingCanonical = canonicalize(missingKey);
      if (!missingCanonical) return true;
      if (allUnusedCanonicalNames.has(missingCanonical)) return false;
      const missingWords = missingCanonical.split(/\s+/).filter(Boolean);
      if (missingWords.length === 0) return true;
      for (const unusedCan of allUnusedCanonicalNames) {
        const unusedWords = unusedCan.split(/\s+/).filter(Boolean);
        if (unusedWords.length === 0) continue;
        const shorter = missingWords.length <= unusedWords.length ? missingWords : unusedWords;
        const longer = missingWords.length <= unusedWords.length ? unusedWords : missingWords;
        if (shorter.every((w) => longer.includes(w))) return false;
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

    for (const fi of candidatesToProcessByFi) {
      const unusedKey = normalizeKey(fi.name);
      const fiCanonical = canonicalize(fi.name);
      const mealIds = new Set<string>(index.get(unusedKey) ?? []);
      for (const [idxKey, ids] of index.entries()) {
        const isCanonicalMatch = canonicalize(idxKey) === fiCanonical;
        const isSmartMatch = smartFoodContains(idxKey, fi.name);
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
          const altGroups = parseIngredientGroups(alternativeCandidate.meal.ingredients!);
          const labels: string[] = [];
          for (const altMissingKey of alternativeCandidate.missingKeys) {
            let qty = 0, count = 0, displayName = altMissingKey;
            for (const group of altGroups) {
              const first = group[0]?.[0];
              if (first && normalizeKey(first.name) === altMissingKey) {
                qty = first.qty; count = first.count;
                displayName = first.rawName || first.name;
                break;
              }
            }
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
              if (!strictNameMatch(item.name, fi.name) && !sameByCanonical) continue;
              if (item.qty > 0) unusedQtyInRecipe = Math.max(unusedQtyInRecipe, item.qty);
              if (item.count > 0) unusedCountInRecipe = Math.max(unusedCountInRecipe, item.count);
            }
          }
        }
        const unusedRecipeAmountLabel =
          unusedQtyInRecipe > 0
            ? `${formatNumeric(unusedQtyInRecipe)}g`
            : (unusedCountInRecipe > 0 ? `x${unusedCountInRecipe}` : "quantité inconnue");

        for (const missingKey of missing) {
          let qty = 0, count = 0, displayName = missingKey;
          for (const group of groups) {
            const first = group[0]?.[0];
            if (first && normalizeKey(first.name) === missingKey) {
              qty = first.qty;
              count = first.count;
              displayName = first.rawName || first.name;
              break;
            }
          }
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

  const renderUnusedItems = (items: FoodItem[], crossCatItems: FoodItem[] = []) => {
    const allItems = [...items, ...crossCatItems];
    const crossCatIds = new Set(crossCatItems.map(fi => fi.id));
    const suggestions = computeUnusedSuggestions(allItems);
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
          </div>
        </>
        
      )}
    </div>
    );
  };

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-sm p-4">
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
          <Checkbox
            id={`filter-calories-${category.value}`}
            checked={useRemainingCalories}
            onCheckedChange={(checked) => {
              setAvailPref.mutate({ key: `available_use_remaining_calories_${category.value}`, value: !!checked });
              if (!checked) {
                setCustomRatios({});
                setTempCalorieOverride(null);
              }
            }}
          />
          <div className="flex flex-col">
            <label htmlFor={`filter-calories-${category.value}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-foreground">
              Carte en fonction des calories restantes
            </label>
            {useRemainingCalories && (
              <div className="flex items-center gap-1.5 mt-0.5">
                 <span className="text-[10px] text-muted-foreground">
                   Seuil max :
                 </span>
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
                <span className="text-[10px] text-muted-foreground mx-1">·</span>
                <span className="text-sm font-bold text-blue-400">{Math.round(remainingProtein)}</span>
                <span className="text-[10px] text-muted-foreground">g prot</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!collapsed &&
        <div className="flex flex-col gap-2 mt-3">
          {isPlat && (unusedFoodItems.length > 0 || crossCategoryExpiringItems.length > 0) && renderUnusedItems(unusedFoodItems, crossCategoryExpiringItems)}

          {(() => {
            const isMealWithDate: FoodItem[] = (sortedIsMealItems as any).__withDate || [];

            if (sortMode === "expiration") {
              type UnifiedItem =
                | { type: 'isMeal'; fi: FoodItem; sortDate: string | null; sortCounter: number | null; sortCalories: number | null }
                | { type: 'nm'; nm: NameMatch; nmIdx: number; sortDate: string | null; sortCounter: number | null; sortCalories: number | null }
                | { type: 'av'; item: typeof available[0]; sortDate: string | null; sortCounter: number | null; sortCalories: number | null }
                | { type: 'partial'; item: typeof partialAvailable[0]; sortDate: string | null; sortCounter: number | null; sortCalories: number | null };

              const unified: UnifiedItem[] = [];
              for (const fi of [...sortedIsMealItems, ...isMealWithDate]) {
                const counter = computeCounterDays(fi.counter_start_date);
                const fakeMeal: Meal = { ...fi as unknown as Meal, calories: fi.calories, ingredients: null };
                unified.push({ type: 'isMeal', fi, sortDate: fi.expiration_date, sortCounter: counter, sortCalories: getDisplayedCalories(fakeMeal) });
              }
              for (let i = 0; i < sortedNameMatches.length; i++) {
                const nm = sortedNameMatches[i];
                const counter = computeCounterDays(nm.fi.counter_start_date);
                unified.push({ type: 'nm', nm, nmIdx: i, sortDate: nm.fi.expiration_date, sortCounter: counter, sortCalories: getDisplayedCalories(nm.meal) });
              }
              for (const item of sortedAvailable) {
                const an = analyzeMealIngredients(item.meal, foodItems);
                const ratio = customRatios[item.meal.id] ?? 1;
                const displayMeal = ratio !== 1 ? buildScaledMealForRatio(item.meal, ratio, stockMap) : item.meal;
                unified.push({ type: 'av', item, sortDate: an.earliestExpiration, sortCounter: an.maxIngredientCounter, sortCalories: getDisplayedCalories(displayMeal) });
              }
              for (const item of partialAvailable) {
                const an = analyzeMealIngredients(item.meal, foodItems);
                const ratio = customRatios[`partial-${item.meal.id}`] ?? item.ratio;
                const displayMeal = buildScaledMealForRatio(item.meal, ratio, stockMap);
                unified.push({ type: 'partial', item, sortDate: an.earliestExpiration, sortCounter: an.maxIngredientCounter, sortCalories: getDisplayedCalories(displayMeal) });
              }
              
              // Apply search filter
              let filteredUnified = searchQuery.trim() ? unified.filter(u => {
                const name = normalizeForMatch(u.type === 'isMeal' ? (u.fi?.name ?? '') : u.type === 'nm' ? (u.nm?.meal.name ?? '') : (u.item?.meal.name ?? ''));
                const q = normalizeForMatch(searchQuery);
                if (name.includes(q)) return true;
                if (u.type === 'av' || u.type === 'partial') {
                  const ing = normalizeForMatch(u.item?.meal.ingredients ?? '');
                  if (ing.includes(q)) return true;
                }
                return false;
              }) : unified;
              if (useRemainingCalories) {
                filteredUnified = filteredUnified.filter(u => {
                  if (u.type === 'isMeal') {
                    const fakeMeal: Meal = { ...u.fi as unknown as Meal, calories: u.fi.calories, ingredients: null };
                    return tryFitMeal(fakeMeal, 1, false).show;
                  }
                  if (u.type === 'nm') {
                    return tryFitMeal(u.nm.meal, 1, false).show;
                  }
                  if (u.type === 'av') {
                    const ratioToTry = customRatios[u.item.meal.id] ?? 1;
                    const fitResult = tryFitMeal(u.item.meal, ratioToTry);
                    if (fitResult.show && fitResult.newRatio !== null && fitResult.newRatio !== ratioToTry) {
                       u.item = { ...u.item, calculatedRatio: fitResult.newRatio } as any;
                    }
                    return fitResult.show;
                  }
                  if (u.type === 'partial') {
                    const ratioToTry = customRatios[`partial-${u.item.meal.id}`] ?? u.item.ratio;
                    const fitResult = tryFitMeal(u.item.meal, ratioToTry);
                    if (fitResult.show && fitResult.newRatio !== null && fitResult.newRatio !== ratioToTry) {
                       u.item = { ...u.item, calculatedRatio: fitResult.newRatio } as any;
                    }
                    return fitResult.show;
                  }
                  return true;
                });
              }

              filteredUnified.sort((a, b) => {
                // is_meal items always at bottom (except for Plat)
                if (!isPlat) {
                  const aIsMeal = a.type === 'isMeal' ? 1 : 0;
                  const bIsMeal = b.type === 'isMeal' ? 1 : 0;
                  if (aIsMeal !== bIsMeal) return aIsMeal - bIsMeal;
                }

                const baseCmp = compareExpirationWithCounter(a.sortDate, b.sortDate, a.sortCounter, b.sortCounter);
                if (baseCmp !== 0) return baseCmp;

                // Same group + same date => calories ascending as tiebreaker
                if (a.sortCalories !== null && b.sortCalories !== null && a.sortCalories !== b.sortCalories) return a.sortCalories - b.sortCalories;
                if (a.sortCalories !== null && b.sortCalories === null) return -1;
                if (a.sortCalories === null && b.sortCalories !== null) return 1;

                return getUnifiedItemName(a).localeCompare(getUnifiedItemName(b));
              });

              // Find where past/today ends and future begins
              const todayStr = new Date().toISOString().slice(0, 10);
              let dateSeparatorInserted = false;
              const firstIsMealIdx = !isPlat ? filteredUnified.findIndex(u => u.type === 'isMeal') : -1;

              return filteredUnified.map((u, idx) => {
                const elements: React.ReactNode[] = [];

                // Date separator: between past/today and future items (only for group 2 = has date, no counter)
                if (!dateSeparatorInserted && u.sortDate && u.sortDate > todayStr && (u.sortCounter === null || u.sortCounter <= 0)) {
                  // Check that at least one previous item had a date ≤ today
                  const hasPastBefore = filteredUnified.slice(0, idx).some(prev => prev.sortDate && prev.sortDate <= todayStr && (prev.sortCounter === null || prev.sortCounter <= 0));
                  if (hasPastBefore) {
                    dateSeparatorInserted = true;
                    elements.push(
                      <div key="sep-date-future" className="my-1.5">
                        <Separator className="opacity-30" />
                      </div>
                    );
                  }
                }

                const sep = (idx === firstIsMealIdx && firstIsMealIdx > 0) ? (
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
            }

            // manual or calories: use unified items
            const unifiedItems = buildUnifiedItems();
            const firstIsMealIdx = !isPlat ? unifiedItems.findIndex(u => u.type === 'isMeal') : -1;
            return unifiedItems.map((u, idx) => {
              const sep = (idx === firstIsMealIdx && firstIsMealIdx > 0) ? (
                <div key={`sep-ismeal-m`} className="flex items-center gap-2 my-2">
                  <Separator className="flex-1" />
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1"><UtensilsCrossed className="h-3 w-3" />Repas seuls</span>
                  <Separator className="flex-1" />
                </div>
              ) : null;
              const card = u.type === 'isMeal' ? renderIsMealCard(u.fi, idx)
                : u.type === 'nm' ? renderNameMatchCard(u.nm, u.nmIdx, idx)
                : u.type === 'partial' ? renderPartialCard(u.item, idx)
                : renderAvailableCard(u.item, idx);
              return sep ? <Fragment key={`wrapper-m-${idx}`}>{sep}{card}</Fragment> : card;
            });
          })()}

          {totalCount === 0 &&
            <p className="text-muted-foreground text-sm text-center py-4 italic">
              {useRemainingCalories ? "Aucun repas ne correspond à vos calories restantes." : "Aucun repas réalisable avec les aliments disponibles"}
            </p>
          }

          {!isPlat && (unusedFoodItems.length > 0 || crossCategoryExpiringItems.length > 0) && renderUnusedItems(unusedFoodItems, crossCategoryExpiringItems)}
        </div>
      }
    </div>
  );
}
