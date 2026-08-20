/**
 * PossibleMealCard — Carte de repas dans la liste "Possibles".
 *
 * Affiche un repas planifié avec toutes ses options :
 * - Dates : péremption, jour de la semaine, créneau (matin/midi/soir/goûter)
 * - Compteur d'ouverture (jours depuis l'ouverture de l'ingrédient)
 * - Macros : calories, protéines et fibres (calculées ou manuelles)
 * - Badges note nutritionnelle + indice de satiété (comme MealCard)
 * - Multiplicateur de ratio (détecté automatiquement depuis les ingrédients)
 * - Édition inline des calories, grammes, quantité, ratio
 * - Édition des ingrédients via IngredientEditor
 *
 * detectScaleRatio() : détecte si les ingrédients ont été mis à l'échelle
 * StructuredIngredientInline : affichage compact des ingrédients avec highlighting
 */
import React, { useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, MoreVertical, Calendar, Timer, Flame, Weight, Hash, List, Undo2, Percent, Thermometer, SplitSquareHorizontal, Pin, FileText, Pencil, Sparkles, Plus } from "lucide-react";
import {
  NinjaCreamiTestsExtrasDialog,
  serializeNinjaCreamiExtrasForPossible,
} from "@/components/NinjaCreamiTestsExtrasDialog";
import type { NinjaCreamiBaseGroup, NinjaCreamiCatalogLine } from "@/domain/ninjaCreami/ninjaCreami";
import { isUnnumberedPotLabel } from "@/domain/planning/possiblePlanningSort";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IngredientEditor } from "@/components/IngredientEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { PossibleMeal } from "@/hooks/useMeals";
import type { Meal } from "@/types/meals";
import { resolveMealDescriptionForDisplay } from "@/lib/mealDescription";
import { DAYS } from "@/hooks/useMeals";
import { format, parseISO } from "date-fns";

/** Libellés du sélecteur de créneau (Repas) — alignés sur le Planning (GOÛTER). */
const MEAL_TIME_SELECT_LABELS: Record<string, string> = {
  matin: "Matin",
  midi: "Midi",
  soir: "Soir",
  gouter: "Goûter",
};
import {
  type IngLine, parseIngredientLineDisplay, formatQtyDisplay,
  parseIngredientsToLines, serializeIngredients, computeIngredientCalories,
  computeIngredientProtein, computeIngredientFiber, cleanIngredientText, normalizeKey,
  hasNegativeMetric, getMealColor, getDateForDayKey,
  extractMetrics, parseIngredientLineRaw,
  ingredientsForPossibleCardDisplay, restoreIngredientDisplayNamesFromReference,
  getAdaptedCounterHours, ensureTrailingEmptyIngredientLine,
} from "@/lib/ingredientUtils";
import { StructuredIngredientInline } from "@/components/StructuredIngredientInline";
import { AutoGrowDescriptionTextarea } from "@/components/AutoGrowDescriptionTextarea";
import { scaleIngredientStringExact, findStockKey, getDisplayedPMCalories, getDisplayedPMProtein, getDisplayedPMFiber, buildFoodItemIndex, formatFrozenPossibleCounterTooltip, formatPossibleCounterBadgeLabel, parseMacroDisplay } from "@/lib/stockUtils";
import { NutritionScoreBadge } from "@/components/NutritionScoreBadge";
import { SatietyIndexBadge } from "@/components/SatietyIndexBadge";
import { getPossibleMealNutritionScore } from "@/lib/nutritionScore";
import { getPossibleMealSatietyDetails } from "@/lib/satietyIndex";
import type { StockInfo } from "@/lib/stockUtils";
import type { FoodItem } from "@/hooks/useFoodItems";
import { usePreferenceValue } from "@/hooks/usePreferences";
import { PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY } from "@/lib/planningDisplayPrefs";
import { autofillIngredientLinesMacros, computeHomonymFoodMealMacros, type IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import { fr } from "date-fns/locale";

interface PossibleMealCardProps {
  pm: PossibleMeal;
  onRemove: () => void;
  onReturnWithoutDeduction?: () => void;
  onReturnWithoutDeductionLabel?: string;
  onReturnToMaster?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onUpdateExpiration: (date: string | null) => void;
  onUpdatePlanning: (day: string | null, time: string | null) => void;
  onUpdateCounter: (date: string | null) => void;
  onUpdateCalories: (cal: string | null) => void;
  onUpdateProtein?: (pro: string | null) => void;
  onUpdateFiber?: (fiber: string | null) => void;
  onUpdateGrams: (g: string | null) => void;
  onUpdateQuantity?: (qty: number) => void;
  onSplitQuantity?: (ratio: number, baseIngredients: string | null) => void;
  onUpdateIngredients: (ing: string | null) => void;
  onUpdatePossibleIngredients?: (newIngredients: string | null) => void;
  onUpdateOvenTemp?: (temp: string | null) => void;
  onUpdateOvenMinutes?: (minutes: string | null) => void;
  /** Met à jour les consignes (synchronisées avec les fiches Tous / Au choix du même nom). */
  onUpdateDescription?: (description: string | null) => void;
  /** Renomme le repas (uniquement cartes créées directement dans Possible). */
  onRename?: (name: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isHighlighted?: boolean;
  stockMap?: Map<string, StockInfo>;
  expiredIngredientNames?: Set<string>;
  expiringSoonIngredientNames?: Set<string>;
  onDoubleClick?: () => void;
  realtimeCounterStartDate?: string | null;
  /**
   * Badge compteur figé à l’arrivée en Possible (ou au re-gel planning).
   * `undefined` = pas encore gelé (pas de badge) ; `null` = gelé sans badge ; `number` = jours figés.
   */
  frozenCounterDays?: number | null;
  /** Fiches aliments (garde-manger) : complète les protéines quand les lignes n’ont que des kcal ou pas de [pro]. */
  foodItems?: FoodItem[];
  ingredientMacroSources?: IngredientMacroAutofillSources;
  /** Catalogue Tous / Au choix pour préremplir la description si la copie Possible en est dépourvue. */
  mealsCatalog?: Meal[];
  /** Carte issue de « Tous » : contour jaune pour la distinguer. */
  fromMaster?: boolean;
  /** Libellé du retour sans stock (défaut : « Revenir dans Tous »). */
  onReturnToMasterLabel?: string;
  /** Enregistre la recette dans Ninja Creami → Recettes testées (cartes issues de Tests). */
  onSaveToNinjaTested?: () => void;
  /** Catalogue Base (sous-catégories) de Ninja Creami → Tests pour « Ajouter extras ». */
  ninjaCreamiBaseGroups?: NinjaCreamiBaseGroup[];
  /** Catalogue Extras de Ninja Creami → Tests pour « Ajouter extras ». */
  ninjaCreamiExtrasLines?: NinjaCreamiCatalogLine[];
  /** Ordre des sous-catégories Tests (identique à l’encadré Tests). */
  ninjaCreamiTestsGroupOrder?: string[] | null;
}

const DAY_LABELS: Record<string, string> = {
  lundi: 'Lun', mardi: 'Mar', mercredi: 'Mer', jeudi: 'Jeu',
  vendredi: 'Ven', samedi: 'Sam', dimanche: 'Dim',
};

/**
 * Indique si les kcal affichées sur une carte « possible » relèvent du calcul par lignes (style orange),
 * comme sur MealCard « au choix ». Si l’override post-déduction a perdu les `{cal}`, on regarde la recette maître.
 */
function caloriesLookComputedOnPossibleCard(
  ingredientsOverrideDefined: boolean,
  displayIngredients: string | null | undefined,
  masterIngredients: string | null | undefined,
  scaleR: number,
  isAvailable?: (name: string) => boolean,
): boolean {
  const fromDisplay = computeIngredientCalories(displayIngredients ?? null, isAvailable, scaleR);
  if (fromDisplay !== null) return true;
  if (!ingredientsOverrideDefined || !masterIngredients?.trim()) return false;
  return computeIngredientCalories(masterIngredients, isAvailable, 1) !== null;
}

/**
 * Idem pour les protéines (bleu), y compris complément depuis les fiches aliments sur les lignes.
 */
function proteinLooksComputedOnPossibleCard(
  ingredientsOverrideDefined: boolean,
  displayIngredients: string | null | undefined,
  masterIngredients: string | null | undefined,
  scaleR: number,
  isAvailable: ((name: string) => boolean) | undefined,
  foodItems: FoodItem[] | undefined,
  foodMacroIndex: ReturnType<typeof buildFoodItemIndex> | undefined,
): boolean {
  const fromDisplay = computeIngredientProtein(
    displayIngredients ?? null,
    isAvailable,
    scaleR,
    foodItems,
    foodMacroIndex,
  );
  if (fromDisplay !== null) return true;
  if (!ingredientsOverrideDefined || !masterIngredients?.trim()) return false;
  return computeIngredientProtein(masterIngredients, isAvailable, 1, foodItems, foodMacroIndex) !== null;
}

/** Indique si les fibres affichées sur une carte « possible » relèvent du calcul par lignes ou fiches aliments. */
function fiberLooksComputedOnPossibleCard(
  ingredientsOverrideDefined: boolean,
  displayIngredients: string | null | undefined,
  masterIngredients: string | null | undefined,
  scaleR: number,
  isAvailable: ((name: string) => boolean) | undefined,
  foodItems: FoodItem[] | undefined,
  foodMacroIndex: ReturnType<typeof buildFoodItemIndex> | undefined,
): boolean {
  const fromDisplay = computeIngredientFiber(displayIngredients ?? null, isAvailable, scaleR, foodItems, foodMacroIndex);
  if (fromDisplay !== null) return true;
  if (!ingredientsOverrideDefined || !masterIngredients?.trim()) return false;
  return computeIngredientFiber(masterIngredients, isAvailable, 1, foodItems, foodMacroIndex) !== null;
}

// Utilitaires d'analyse d'ingrédients importés de @/lib/ingredientUtils

/** Indique si une recette contient des marqueurs d'édition structurés : alternative, liaison ou optionnel. */
function hasIngredientStructure(lines: IngLine[]): boolean {
  return lines.some((line) => line.isOr || line.isAnd || line.isOptional);
}

/** Reconstruit l'éditeur Possible avec la structure master, sans écraser les quantités propres à la carte. */
function buildPossibleEditorLines(
  masterIngredients: string | null | undefined,
  overrideIngredients: string | null | undefined,
  ratio: number | null,
  scaleLines: (lines: IngLine[], ratio: number) => IngLine[],
): IngLine[] {
  const hasOverride = overrideIngredients != null && String(overrideIngredients).trim() !== "";
  const source = hasOverride ? overrideIngredients! : masterIngredients;
  if (!source?.trim()) return [];

  const overrideLines = hasOverride ? parseIngredientsToLines(overrideIngredients!) : [];
  const masterLines = masterIngredients?.trim() ? parseIngredientsToLines(masterIngredients) : [];
  const overrideHasStructure = hasOverride && hasIngredientStructure(overrideLines);
  const masterHasStructure = hasIngredientStructure(masterLines);

  if (!hasOverride || overrideHasStructure || !masterHasStructure) {
    return !hasOverride && ratio !== null ? scaleLines(parseIngredientsToLines(source), ratio) : parseIngredientsToLines(source);
  }

  const overrideByName = new Map<string, IngLine[]>();
  for (const line of overrideLines) {
    const key = normalizeKey(line.name);
    if (!key) continue;
    const matches = overrideByName.get(key) ?? [];
    matches.push(line);
    overrideByName.set(key, matches);
  }

  const scaledMasterLines = ratio !== null ? scaleLines(masterLines, ratio) : masterLines;
  return scaledMasterLines.map((line) => {
    const key = normalizeKey(line.name);
    const matching = key ? overrideByName.get(key)?.shift() : undefined;
    if (!matching) return line;
    return {
      ...line,
      qty: matching.qty,
      count: matching.count,
      name: matching.name || line.name,
      cal: matching.cal || line.cal,
      pro: matching.pro || line.pro,
      fiber: matching.fiber || line.fiber,
    };
  });
}

/** Carte d’un repas « possible » : dates, macros, édition, drag & drop (voir en-tête de module). */
export function PossibleMealCard({
  pm, stockMap, onRemove, onReturnWithoutDeduction, onReturnWithoutDeductionLabel,
  onReturnToMaster, onDelete: _onDelete, onDuplicate, onUpdateExpiration, onUpdatePlanning,
  onUpdateCounter, onUpdateCalories, onUpdateProtein, onUpdateFiber, onUpdateGrams, onUpdateQuantity,
  onUpdateIngredients, onUpdatePossibleIngredients, 
  onUpdateOvenTemp, onUpdateOvenMinutes, onUpdateDescription, onRename,
  onDragStart, onDragOver,
  onDrop, isHighlighted, expiredIngredientNames, expiringSoonIngredientNames, onSplitQuantity, onDoubleClick,
  realtimeCounterStartDate, frozenCounterDays, foodItems, ingredientMacroSources, mealsCatalog,
  fromMaster = false,
  onReturnToMasterLabel,
  onSaveToNinjaTested,
  ninjaCreamiBaseGroups,
  ninjaCreamiExtrasLines,
  ninjaCreamiTestsGroupOrder = null,
}: PossibleMealCardProps) {
  const parseIngredientLine = parseIngredientLineDisplay;
  const formatQty = formatQtyDisplay;
  const [editing, setEditing] = useState<"name" | "calories" | "protein" | "fiber" | "grams" | "quantity" | "ratio" | "oven_temp" | "oven_minutes" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [calOpen, setCalOpen] = useState(false);
  const [calMobileOpen, setCalMobileOpen] = useState(false);
  const [editingIngredients, setEditingIngredients] = useState(false);
  const [ingLines, setIngLines] = useState<IngLine[]>([]);
  const [descriptionEditorOpen, setDescriptionEditorOpen] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");
  /** Pop-up de sélection des ingrédients Tests (Base + Extras). */
  const [extrasDialogOpen, setExtrasDialogOpen] = useState(false);
  /** Contrôle du menu ⋮ : fermé avant d’ouvrir le Dialog description (évite le blocage Radix pointer-events). */
  const [menuOpen, setMenuOpen] = useState(false);
  /**
   * Flag synchrone (ref) : l’état React arrive trop tard quand Radix ferme le menu
   * dans le même tick que onSelect → le Dialog ne s’ouvrait jamais.
   */
  const pendingDescriptionOpenRef = useRef(false);
  /** Même pattern pour ouvrir « Ajouter extras » après fermeture du menu ⋮. */
  const pendingExtrasOpenRef = useRef(false);
  /** Ouvre l’éditeur d’ingrédients après fermeture du menu ⋮ (évite le blur → commit immédiat). */
  const pendingIngredientsOpenRef = useRef(false);
  const canAddNinjaExtras =
    Array.isArray(ninjaCreamiBaseGroups) && Array.isArray(ninjaCreamiExtrasLines);
  const hideCalorieDisplay = usePreferenceValue<boolean>(PLANNING_HIDE_DAY_CALORIE_TOTALS_PREF_KEY, false);

  const foodMacroIndex = useMemo(
    () => (foodItems?.length ? buildFoodItemIndex(foodItems) : undefined),
    [foodItems],
  );
  const ingredientSuggestions = useMemo(
    () => foodItems?.map((item) => item.name).filter(Boolean) ?? [],
    [foodItems],
  );

  // ⚠️ Ne PAS faire de `return` conditionnel ici : tous les hooks (useMemo ci-dessous) doivent être
  // appelés à chaque rendu (règle des Hooks React). Le garde `if (!meal) return null` est déplacé
  // après le dernier hook. Les valeurs dérivées utilisent donc `meal?.` par sécurité.
  const meal = pm.meals;

  /**
   * Recalcule une macro depuis l’aliment homonyme + Macro
   * (fiche vide → /100 g × grammes de la portion Possible).
   * Uniquement pour les repas sans lignes d’ingrédients : sinon un aliment
   * portant le même nom (ex. « Confiture ») écraserait les macros de la recette.
   */
  const getFoodMealPortionMacro = (
    field: "calories" | "protein" | "fiber",
    extraRatio: number = 1,
  ): number | null => {
    if (!meal) return null;
    const macros = computeHomonymFoodMealMacros(
      meal,
      foodItems,
      ingredientMacroSources,
      extraRatio,
    );
    if (!macros) return null;
    return parseMacroDisplay(macros[field]);
  };

  // `ingredients_override === ""` : override volontairement vide (ne pas retomber sur la recette maître via ??).
  const displayIngredients =
    pm.ingredients_override != null ? pm.ingredients_override : meal?.ingredients;
  /** True si la carte Possible a une vraie liste d’ingrédients (pas un aliment-repas seul). */
  const hasRecipeIngredientLines = Boolean(displayIngredients?.trim());
  const displayIngredientsWithReferenceNames = useMemo(
    () =>
      pm.ingredients_override != null
        ? restoreIngredientDisplayNamesFromReference(displayIngredients, meal?.ingredients)
        : displayIngredients,
    [displayIngredients, meal?.ingredients, pm.ingredients_override],
  );
  const cardColorIngredients = meal?.ingredients?.trim()
    ? meal.ingredients
    : displayIngredientsWithReferenceNames;
  const cardDisplayIngredients = useMemo(
    () => ingredientsForPossibleCardDisplay(displayIngredientsWithReferenceNames),
    [displayIngredientsWithReferenceNames],
  );

  // Construire le rappel isAvailable à partir de stockMap pour le calcul des macros
  const isAvailableCb = stockMap ? (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  } : undefined;

  // Détecter le ratio de mise à l'échelle à partir de l'override vs les ingrédients originaux.
  // Ignore les optionnels (sinon un 2e « Chocolat » non inclus fausse le ratio, ex. 60/22).
  // Découpe aussi les bundles « + ».
  const detectScaleRatio = (): number | null => {
    if (!pm.ingredients_override || !meal) return null;
    const baseIngStr = meal.ingredients
      ? meal.ingredients
      : (() => {
        const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
        return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
      })();

    /** Parse une recette en map nom → qté, en ignorant les optionnels si demandé. */
    const parseToMap = (str: string, skipOptionals: boolean) => {
      const map = new Map<string, { qty: number; count: number }>();
      str.split(/(?:\n|,(?!\d))/).map(s => s.trim()).filter(Boolean).forEach(group => {
        const alt = group.split(/\|/)[0].trim();
        alt.split(/\+/).map(s => s.trim()).filter(Boolean).forEach(rawItem => {
          const isOptional = rawItem.startsWith("?");
          if (skipOptionals && isOptional) return;
          const cleanAlt = isOptional ? rawItem.slice(1).trim() : rawItem;
          const { text: withoutMetrics } = extractMetrics(cleanAlt);
          const parsed = parseIngredientLineRaw(withoutMetrics);
          if (!parsed.name) return;
          const key = normalizeKey(parsed.name);
          if (!map.has(key)) {
            map.set(key, { qty: parsed.qty, count: parsed.count });
          }
        });
      });
      return map;
    };

    // Base : seulement les obligatoires. Override : tout (les inclus n'ont plus de « ? »).
    const baseMap = parseToMap(baseIngStr, true);
    const overMap = parseToMap(pm.ingredients_override, false);

    if (baseMap.size === 0 || overMap.size === 0) return null;

    const detectedRatios: number[] = [];
    let commonCount = 0;

    for (const [key, baseVal] of baseMap.entries()) {
      const overVal = overMap.get(key);
      if (!overVal) continue;

      commonCount++;
      if (baseVal.qty > 0 && overVal.qty > 0) {
        detectedRatios.push(overVal.qty / baseVal.qty);
      } else if (baseVal.count > 0 && overVal.count > 0) {
        detectedRatios.push(overVal.count / baseVal.count);
      } else {
        detectedRatios.push(1);
      }
    }

    if (detectedRatios.length === 0) return null;
    const firstRatio = detectedRatios[0];
    if (Math.abs(firstRatio - 1) <= 0.01) return null;

    const allSame = detectedRatios.every(r => Math.abs(r - firstRatio) / (firstRatio || 1) < 0.05);
    if (!allSame) return null;
    if (commonCount < Math.min(baseMap.size, overMap.size) * 0.5) return null;

    return firstRatio;
  };
  const detectedRatio = detectScaleRatio();

  /**
   * Résout une macro carte Possible : lignes d’ingrédients d’abord (sans filtre stock),
   * puis avec stock, puis aliment homonyme seulement si la recette n’a pas d’ingrédients.
   */
  const resolvePossibleCardMacro = (
    field: "calories" | "protein" | "fiber",
    scaleR: number,
  ): number | null => {
    const ratio = detectedRatio ?? undefined;
    if (hasRecipeIngredientLines) {
      if (field === "calories") {
        return (
          getDisplayedPMCalories(pm, ratio, undefined) ??
          getDisplayedPMCalories(pm, ratio, isAvailableCb)
        );
      }
      if (field === "protein") {
        return (
          getDisplayedPMProtein(pm, ratio, undefined, foodItems, foodMacroIndex) ??
          getDisplayedPMProtein(pm, ratio, isAvailableCb, foodItems, foodMacroIndex)
        );
      }
      return (
        getDisplayedPMFiber(pm, ratio, undefined, foodItems, foodMacroIndex) ??
        getDisplayedPMFiber(pm, ratio, isAvailableCb, foodItems, foodMacroIndex)
      );
    }
    return getFoodMealPortionMacro(field, scaleR);
  };

  /** Macros actuelles de la carte Possible (pour le total de la pop-up « Ajouter extras »). */
  const recipeMacrosForExtras = useMemo(() => {
    const scaleR = detectedRatio ?? 1;
    const cal = resolvePossibleCardMacro("calories", scaleR) ?? 0;
    const pro = resolvePossibleCardMacro("protein", scaleR) ?? 0;
    const fib = resolvePossibleCardMacro("fiber", scaleR) ?? 0;
    return {
      calories: Math.round(cal * 10) / 10,
      protein: Math.round(pro * 10) / 10,
      fiber: Math.round(fib * 10) / 10,
    };
  }, [pm, detectedRatio, isAvailableCb, foodItems, foodMacroIndex, meal?.grams, meal?.name, hasRecipeIngredientLines, displayIngredients]);

  // Facteur affiché : quantité # de la carte Possible, ou ratio détecté sur les ingrédients.
  const displayMultiplier = (() => {
    const qtyMul = pm.quantity >= 2 ? pm.quantity : null;
    const ratioMul =
      detectedRatio !== null &&
      (detectedRatio < 1 || Math.abs(detectedRatio - 1) > 0.01)
        ? detectedRatio
        : detectedRatio !== null && detectedRatio >= 2 && Number.isInteger(detectedRatio)
          ? detectedRatio
          : null;
    if (qtyMul != null && ratioMul != null) {
      return Math.max(qtyMul, Math.round(ratioMul));
    }
    return qtyMul ?? ratioMul;
  })();
  const splitFactor =
    displayMultiplier !== null && displayMultiplier >= 2 && Number.isInteger(displayMultiplier)
      ? displayMultiplier
      : pm.quantity >= 2
        ? pm.quantity
        : null;
  const nutritionScore = getPossibleMealNutritionScore(
    pm,
    detectedRatio ?? undefined,
    isAvailableCb,
    foodItems,
    foodMacroIndex,
  );
  // Satiété : override Possible si présent, sinon fiche maître (pas de filtre stock, comme MealCard).
  const mealSatietyDetails = getPossibleMealSatietyDetails(pm, ingredientMacroSources);

  const isExpired = pm.expiration_date && new Date(pm.expiration_date) < new Date();
  const todayISO = format(new Date(), 'yyyy-MM-dd');

  // Badge compteur = valeur figée (prefs) uniquement — plus de calcul live Aliments.
  // Garde placé APRÈS tous les hooks : une carte sans repas source n'est pas rendue.
  if (!meal) return null;

  const counterDays = frozenCounterDays !== undefined ? frozenCounterDays : null;
  const counterStartForHours = realtimeCounterStartDate ?? pm.counter_start_date;
  const counterHoursUntilSlot =
    counterDays === 0
      ? getAdaptedCounterHours(counterStartForHours, pm.day_of_week, pm.meal_time)
      : null;
  const counterBadgeLabel = formatPossibleCounterBadgeLabel(counterDays, counterHoursUntilSlot);
  const counterBadgeTitle = formatFrozenPossibleCounterTooltip(
    frozenCounterDays,
    counterStartForHours,
    counterHoursUntilSlot,
  );

  // Arrêter le clignotement si le jour du repas est passé !
  let isPast = false;
  if (pm.day_of_week) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = getDateForDayKey(pm.day_of_week, new Date());
    isPast = target.getTime() < today.getTime();
  }

  const counterUrgent = counterDays !== null && counterDays >= 3;
  const animateUrgent = counterUrgent && !isPast;

  const handleSaveEdit = () => {
    const val = editValue.trim() || null;
    if (editing === "name" && onRename) {
      const trimmed = editValue.trim();
      if (trimmed && trimmed !== meal.name) onRename(trimmed);
    }
    if (editing === "calories") onUpdateCalories(val);
    if (editing === "protein" && onUpdateProtein) onUpdateProtein(val);
    if (editing === "fiber" && onUpdateFiber) onUpdateFiber(val);
    if (editing === "grams") onUpdateGrams(val);
    if (editing === "oven_temp" && onUpdateOvenTemp) onUpdateOvenTemp(val);
    if (editing === "oven_minutes" && onUpdateOvenMinutes) onUpdateOvenMinutes(val);
    if (editing === "quantity" && onUpdateQuantity) {
      const qty = parseInt(editValue.trim());
      if (!isNaN(qty) && qty >= 1) onUpdateQuantity(qty);
    }
    if (editing === "ratio") {
      const trimmed = editValue.trim().toLowerCase();
      let ratio: number | null = null;
      if (trimmed.startsWith("x")) {
        const mult = parseFloat(trimmed.slice(1));
        if (!isNaN(mult) && mult >= 0.1) ratio = mult;
      } else {
        const pct = parseFloat(trimmed.replace("%", ""));
        if (!isNaN(pct) && pct >= 10) ratio = pct / 100;
      }
      if (ratio !== null && onUpdatePossibleIngredients) {
        // Toujours appliquer le ratio depuis la base ORIGINALE du repas maître (meal.ingredients),
        // pas depuis ingredients_override qui est déjà mis à l'échelle (ex: après une division).
        // Ainsi "x2" signifie toujours "2x la recette originale", quelle que soit l'état courant.
        const baseIng = meal.ingredients
          ? meal.ingredients
          : (() => {
            const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
            return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
          })();

        const scaledIngredients = scaleIngredientStringExact(baseIng, ratio, undefined, true);
        onUpdatePossibleIngredients(scaledIngredients);
      }
      // NOTE : Ne PAS appeler onUpdateGrams ou onUpdateCalories ici — ceux-ci modifient le repas MAÎTRE.
      // Les valeurs mises à l'échelle sont dérivées de ingredients_override (pour les calories basées sur les ingrédients)
      // et visibles via le badge detectedRatio pour l'affichage des grammes.
    }
    setEditing(null);
  };

  // Applique le ratio de la carte aux champs numériques de l'éditeur (grammes et quantités).
  const scaleEditorLines = (lines: IngLine[], ratio: number): IngLine[] => {
    const scaleValue = (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return value;
      const parsed = parseFloat(trimmed.replace(",", "."));
      if (Number.isNaN(parsed)) return value;
      const scaled = Math.round(parsed * ratio * 10) / 10;
      return Number.isInteger(scaled) ? String(Math.trunc(scaled)) : String(scaled);
    };

    return lines.map((line) => ({
      ...line,
      qty: scaleValue(line.qty),
      count: scaleValue(line.count),
    }));
  };

  // Prépare les lignes puis ouvre l'éditeur (marqueurs ou/? master si override réduit).
  const openIngredients = () => {
    let lines = buildPossibleEditorLines(
      meal.ingredients,
      pm.ingredients_override,
      detectedRatio,
      scaleEditorLines,
    );
    if (lines.length === 0) {
      const fallbackSource = pm.ingredients_override ?? meal.ingredients;
      lines = parseIngredientsToLines(fallbackSource?.trim() ? fallbackSource : null);
    }
    const filled = ingredientMacroSources
      ? autofillIngredientLinesMacros(lines, ingredientMacroSources)
      : lines;
    setIngLines(ensureTrailingEmptyIngredientLine(filled));
    setEditingIngredients(true);
  };

  /** Ouvre l’éditeur d’ingrédients après fermeture du menu ⋮. */
  const launchIngredientsEditor = () => {
    if (!pendingIngredientsOpenRef.current) return;
    pendingIngredientsOpenRef.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.style.removeProperty("pointer-events");
    openIngredients();
  };

  /** Prépare l’ouverture depuis le menu ⋮ (ferme d’abord le dropdown). */
  const openIngredientsFromMenu = () => {
    pendingIngredientsOpenRef.current = true;
    setMenuOpen(false);
    window.setTimeout(launchIngredientsEditor, 0);
  };

  /** Ouvre le Dialog description après fermeture du menu ⋮ (blur + nettoyage pointer-events). */
  const launchDescriptionEditor = () => {
    if (!pendingDescriptionOpenRef.current) return;
    pendingDescriptionOpenRef.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.style.removeProperty("pointer-events");
    setDescriptionEditorOpen(true);
  };

  /** Ouvre la pop-up « Ajouter extras » après fermeture du menu ⋮. */
  const launchExtrasDialog = () => {
    if (!pendingExtrasOpenRef.current) return;
    pendingExtrasOpenRef.current = false;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    document.body.style.removeProperty("pointer-events");
    setExtrasDialogOpen(true);
  };

  /**
   * Prépare l’ouverture de l’éditeur de consignes : ferme d’abord le menu ⋮.
   * Le Dialog s’ouvre via onMenuOpenChange ou le timeout de secours.
   */
  const openDescriptionEditor = () => {
    setDescriptionDraft(resolveMealDescriptionForDisplay(meal, mealsCatalog) || "");
    pendingDescriptionOpenRef.current = true;
    setMenuOpen(false);
    // Secours si onOpenChange ne voit pas le pending (fermeture Radix déjà en cours).
    window.setTimeout(launchDescriptionEditor, 0);
  };

  /** Prépare l’ouverture de la pop-up extras Tests (ferme d’abord le menu ⋮). */
  const openExtrasDialog = () => {
    pendingExtrasOpenRef.current = true;
    setMenuOpen(false);
    window.setTimeout(launchExtrasDialog, 0);
  };

  /**
   * Gère l’ouverture/fermeture du menu ⋮ ; ouvre Dialog / éditeurs
   * uniquement une fois le menu réellement fermé.
   */
  const onMenuOpenChange = (open: boolean) => {
    setMenuOpen(open);
    if (open) {
      // Débloque un body coincé après un Dialog précédent (pointer-events: none).
      document.body.style.removeProperty("pointer-events");
      return;
    }
    window.requestAnimationFrame(() => {
      launchDescriptionEditor();
      launchExtrasDialog();
      launchIngredientsEditor();
    });
  };

  /**
   * Ajoute les lignes Tests sélectionnées aux ingrédients de la carte Possible.
   */
  const handleConfirmNinjaExtras = (lines: NinjaCreamiCatalogLine[]) => {
    const extrasText = serializeNinjaCreamiExtrasForPossible(lines);
    if (!extrasText || !onUpdatePossibleIngredients) return;
    const current =
      (pm.ingredients_override ?? meal?.ingredients ?? "").trim();
    const merged = current ? `${current}, ${extrasText}` : extrasText;
    onUpdatePossibleIngredients(merged);
  };

  /** Enregistre les consignes sur le repas lié à la carte Possible puis ferme l'éditeur. */
  const saveDescription = () => {
    const val = descriptionDraft.trim();
    onUpdateDescription?.(val || null);
    closeDescriptionEditor();
  };

  /** Ferme l’éditeur de description et nettoie un éventuel pointer-events résiduel sur le body. */
  const closeDescriptionEditor = () => {
    setDescriptionEditorOpen(false);
    pendingDescriptionOpenRef.current = false;
    document.body.style.removeProperty("pointer-events");
  };

  // Persiste les ingrédients validés depuis l'éditeur (lignes passées = état le plus récent).
  const commitIngredients = (committedLines: IngLine[]) => {
    const serialized = serializeIngredients(committedLines);
    if (onUpdatePossibleIngredients) {
      onUpdatePossibleIngredients(serialized === null ? "" : serialized);
    }
    setEditingIngredients(false);
  };

  const selectedDate = pm.expiration_date ? parseISO(pm.expiration_date) : undefined;
  const expIsToday = pm.expiration_date === todayISO;

  const renderDatesSection = (isMobile: boolean) => {
    const isOpen = isMobile ? calMobileOpen : calOpen;
    const setIsOpen = isMobile ? setCalMobileOpen : setCalOpen;

    return (
      <div className={`flex items-center flex-wrap shrink-0 ${isMobile ? "gap-0.5" : "gap-1"}`}>
        <Calendar className="h-2.5 w-2.5 text-white/50 shrink-0" />
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className={`h-5 ${isMobile ? "min-w-[86px] px-1.5" : "min-w-[88px] px-1.5"} border bg-white/10 text-white text-[10px] rounded-md flex items-center hover:bg-white/20 transition-colors ${expIsToday ? 'border-red-500 ring-1 ring-red-500 text-red-200' : isExpired ? 'border-white/20 text-red-200' : 'border-white/20'
                }`}
            >
              {pm.expiration_date
                ? format(parseISO(pm.expiration_date), 'd MMM yy', { locale: fr })
                : <span className="text-white/40">Date péremption</span>
              }
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <CalendarPicker
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onUpdateExpiration(date ? format(date, 'yyyy-MM-dd') : null);
                setIsOpen(false);
              }}
              initialFocus
            />
            {pm.expiration_date && (
              <div className="p-2 border-t">
                <button
                  onClick={() => { onUpdateExpiration(null); setIsOpen(false); }}
                  className="text-xs text-muted-foreground hover:text-destructive w-full text-center"
                >
                  Effacer la date
                </button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {(() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const monday = new Date(today);
          const dayOf = monday.getDay();
          const diff = monday.getDate() - dayOf + (dayOf === 0 ? -6 : 1);
          monday.setDate(diff);

          const planningDays = Array.from({ length: 14 }).map((_, i) => {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            return {
              iso: format(d, 'yyyy-MM-dd'),
              label: format(d, 'EEEE d', { locale: fr }).replace(/^\w/, c => c.toUpperCase())
            };
          });

          return (
            <Select
              value={pm.day_of_week && /^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week) ? pm.day_of_week : "none"}
              onValueChange={(val) => onUpdatePlanning(val === "none" ? null : val, pm.meal_time)}
            >
              <SelectTrigger
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className={`h-5 ${isMobile ? "min-w-[62px] px-1.5 gap-0.5" : "min-w-[58px] px-1.5 gap-1"} w-auto justify-start p-0 border border-white/20 bg-white/10 text-white text-[10px] flex items-center hover:bg-white/20 transition-colors [&>svg:last-child]:hidden focus:ring-0 focus:ring-offset-0`}
              >
                <Calendar className="h-2.5 w-2.5 opacity-50 shrink-0" />
                {pm.day_of_week ? (
                  /^\d{4}-\d{2}-\d{2}$/.test(pm.day_of_week)
                    ? format(parseISO(pm.day_of_week), 'eee d', { locale: fr })
                    : DAY_LABELS[pm.day_of_week] || pm.day_of_week
                ) : (
                  <span className="opacity-40">Jour</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nul —</SelectItem>
                {planningDays.map(d => (
                  <SelectItem
                    key={d.iso}
                    value={d.iso}
                    className={d.iso === todayISO ? 'bg-primary/15 focus:bg-primary/25 font-bold' : ''}
                  >
                    <div className="flex items-center gap-2">
                      <span>{d.iso === todayISO ? `📅 ${d.label}` : d.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })()}

        <Select value={pm.meal_time || "none"} onValueChange={(val) => onUpdatePlanning(pm.day_of_week, val === "none" ? null : val)}>
          <SelectTrigger
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className={`h-5 ${isMobile ? "min-w-[52px] w-auto px-1" : "min-w-[50px] w-auto px-1"} border-white/20 bg-white/10 text-white text-[10px]`}
          >
            <SelectValue placeholder="Quand" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {/* Matin : petit-déj + desserts possibles (ex. yaourt au petit déj) */}
            {(meal.category === "petit_dejeuner" || meal.category === "dessert") && (
              <SelectItem value="matin">{MEAL_TIME_SELECT_LABELS.matin}</SelectItem>
            )}
            <SelectItem value="midi">{MEAL_TIME_SELECT_LABELS.midi}</SelectItem>
            {/* Même clé meal_time que la section GOÛTER du Planning — entre Midi et Soir */}
            <SelectItem value="gouter">{MEAL_TIME_SELECT_LABELS.gouter}</SelectItem>
            <SelectItem value="soir">{MEAL_TIME_SELECT_LABELS.soir}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <>
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        onDoubleClick?.();
      }}
      className={`group relative flex flex-col rounded-2xl px-3 py-2.5 shadow-md cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02] hover:shadow-lg ${isHighlighted ? 'ring-4 ring-yellow-400 scale-105' : fromMaster ? 'ring-2 ring-yellow-400' : expIsToday ? 'ring-2 ring-red-500' : isExpired ? 'ring-2 ring-red-500' : ''}`}
      style={{
        backgroundColor: isUnnumberedPotLabel(meal.name)
          ? "hsl(220, 6%, 22%)"
          : getMealColor(cardColorIngredients, meal.name),
      }}
      title={fromMaster ? "Issu de Tous" : undefined}
    >
      {/* Badge multiplicateur — épinglé en haut à droite absolu */}
      {displayMultiplier !== null && !editing && !editingIngredients && (
        <div className="absolute top-0 right-0 z-10">
          <button onClick={() => { setEditValue(displayMultiplier >= 1 ? `x${Math.round(displayMultiplier * 10) / 10}` : `${Math.round(displayMultiplier * 100)}%`); setEditing("ratio"); }} className="bg-orange-500/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded-tr-2xl rounded-bl-2xl hover:bg-orange-500/90 transition-colors shadow-sm">
            {displayMultiplier >= 1 && Number.isInteger(displayMultiplier) ? `x${displayMultiplier}` : `${Math.round(displayMultiplier * 100)}%`}
          </button>
        </div>
      )}

      {/* Ligne 1 : nom + actions + planification à droite (ou dessous si manque de place) */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] max-[820px]:grid-cols-1 items-start gap-1.5 min-w-0">
        <div className="flex items-start gap-1.5 min-w-0">
          <Button size="icon" variant="ghost" onClick={onRemove} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20 mt-0.5" data-testid="pm-return-btn">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {onRename ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditValue(meal.name);
                  setEditing("name");
                }}
                className="block flex-1 font-semibold text-white text-sm min-w-0 break-normal whitespace-normal pt-[2px] text-left rounded-sm hover:bg-white/10 transition-colors"
                title="Cliquer pour renommer"
              >
                {meal.name}
              </button>
            ) : (
              <span className="block flex-1 font-semibold text-white text-sm min-w-0 break-normal whitespace-normal pt-[2px]">
                {meal.name}
              </span>
            )}
            <NutritionScoreBadge score={nutritionScore} />
            <SatietyIndexBadge
              index={mealSatietyDetails?.index ?? null}
              totalGrams={mealSatietyDetails?.totalGrams}
              hideWhenMissing
              onMealCard
              recipeTotal
            />
            {counterDays !== null ? (
              <button
                onClick={() => onUpdateCounter(null)}
                className={`min-[431px]:hidden max-[430px]:flex text-xs font-bold px-1.5 py-0.5 rounded-full items-center gap-0.5 transition-all shrink-0 ${counterUrgent
                  ? animateUrgent
                    ? 'bg-red-500/80 text-white animate-pulse shadow-lg shadow-red-500/30'
                    : 'bg-red-500/80 text-white shadow-lg shadow-red-500/30'
                  : 'bg-white/25 text-white'
                  }`}
                title={counterBadgeTitle}
              >
                <Timer className="h-3 w-3" /> {counterBadgeLabel}
              </button>
            ) : null}
          </div>
        </div>

        {/* Dates bureau uniquement (en haut à droite) */}
        <div className="hidden lg:flex items-center shrink-0 mt-0.5">
          {renderDatesSection(false)}
        </div>

        {/* Planification mobile/tablette : à droite du titre, ou ligne dessous à droite si manque de place */}
        <div className="lg:hidden flex items-center shrink-0 justify-self-end max-[820px]:w-full max-[820px]:justify-end">
          {renderDatesSection(true)}
        </div>
      </div>

      {/* Superposition d'édition */}
      {editing ? (
        <Input autoFocus placeholder={
          editing === "name" ? "Nom du repas" :
          editing === "ratio" ? "75% ou x2" :
            editing === "calories" ? "Ex: 350 kcal" :
              editing === "protein" ? "Ex: 28 g" :
                editing === "fiber" ? "Ex: 8 g" :
                editing === "oven_temp" ? "Ex: 180" :
                  editing === "oven_minutes" ? "Ex: 25" :
                    "Ex: 150g"
        } value={editValue}
          onChange={(e) => setEditValue(e.target.value)} onBlur={handleSaveEdit}
          onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
          inputMode={editing === "oven_temp" || editing === "oven_minutes" ? "numeric" : undefined}
          className="mt-1.5 h-6 border-white/30 bg-white/20 text-white placeholder:text-white/60 text-xs" />
      ) : editingIngredients ? (
        <div className="mt-1.5">
          <IngredientEditor
            lines={ingLines}
            onUpdate={setIngLines}
            onCommit={commitIngredients}
            ingredientSuggestions={ingredientSuggestions}
            ingredientMacroSources={ingredientMacroSources}
          />
        </div>
      ) : null}

      {/* Ligne 2 : Options (alignées à droite) */}
      <div className="flex flex-wrap items-center justify-end gap-y-1.5 gap-x-1 md:gap-x-2 w-full mt-1.5 mt-auto">

        {/* Options */}
        <div className="ml-auto w-full flex flex-wrap items-center justify-end gap-1 md:gap-1.5">
          {counterDays !== null ? (
            <button
              onClick={() => onUpdateCounter(null)}
              className={`hidden min-[431px]:inline-flex text-xs font-bold px-1.5 py-0.5 rounded-full items-center gap-0.5 transition-all shrink-0 ${counterUrgent
                ? animateUrgent
                  ? 'bg-red-500/80 text-white animate-pulse shadow-lg shadow-red-500/30'
                  : 'bg-red-500/80 text-white shadow-lg shadow-red-500/30' // Figé passé l'urgence
                : 'bg-white/25 text-white'
                }`}
              title={counterBadgeTitle}
            >
              <Timer className="h-3 w-3" /> {counterBadgeLabel}
            </button>
          ) : null}

          {(pm.quantity > 1 || onUpdateQuantity) && (
            <button
              onClick={() => { if (onUpdateQuantity) { setEditValue(String(pm.quantity)); setEditing("quantity"); } }}
              className={`text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 ${onUpdateQuantity ? 'hover:bg-black/40 cursor-pointer' : ''}`}
            >
              <Hash className="h-2.5 w-2.5" />{pm.quantity}
            </button>
          )}
          {(() => {
            const explicitEmptyOverride =
              pm.ingredients_override != null && String(pm.ingredients_override).trim() === "";
            const baseG = parseFloat((meal.grams || "").replace(/[^0-9.]/g, "")) || 0;
            if (explicitEmptyOverride || baseG <= 0) return null;
            const displayG =
              detectedRatio !== null && baseG > 0 ? String(Math.round(baseG * detectedRatio)) : meal.grams;
            return (
              <button onClick={() => { setEditValue(meal.grams || ""); setEditing("grams"); }} className="text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 hover:bg-black/40 shrink-0">
                <Weight className="h-2.5 w-2.5" />{displayG}
              </button>
            );
          })()}
          {(meal.oven_temp || meal.oven_minutes) && (
            <span className="text-[10px] text-white/90 bg-black/30 px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0">
              <Thermometer className="h-2.5 w-2.5" /> {meal.oven_temp && `${meal.oven_temp}°C`}{meal.oven_temp && meal.oven_minutes && ' · '}{meal.oven_minutes && `${meal.oven_minutes}min`}
            </span>
          )}
          {/* le badge de ratio a été déplacé en haut à droite absolu */}
          {(() => {
            if (hideCalorieDisplay) return null;
            const scaleR = detectedRatio ?? 1;
            const rawDisplayCal = resolvePossibleCardMacro("calories", scaleR);
            const displayCal = rawDisplayCal ? Math.round(rawDisplayCal) : null;
            const isComputed = caloriesLookComputedOnPossibleCard(
              pm.ingredients_override != null,
              displayIngredients,
              meal.ingredients,
              scaleR,
              undefined,
            );

            return displayCal ? (
              <button
                onClick={() => { setEditValue(meal.calories || ""); setEditing("calories"); }}
                className={`text-[10px] px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 ${isComputed
                  ? 'bg-orange-500/50 text-white font-bold hover:bg-orange-500/60'
                  : 'bg-black/30 text-white/90 hover:bg-black/40'
                  }`}
              >
                <Flame className="h-2.5 w-2.5" />{displayCal}
              </button>
            ) : null;
          })()}
          {(() => {
            const scaleR = detectedRatio ?? 1;
            const rawDisplayPro = resolvePossibleCardMacro("protein", scaleR);
            const displayPro = rawDisplayPro != null ? Math.round(rawDisplayPro) : null;
            const isComputedPro = proteinLooksComputedOnPossibleCard(
              pm.ingredients_override != null,
              displayIngredients,
              meal.ingredients,
              scaleR,
              undefined,
              foodItems,
              foodMacroIndex,
            );
            return displayPro != null && displayPro > 0 ? (
              <button
                onClick={() => { setEditValue(meal.protein || ""); setEditing("protein"); }}
                className={`text-[10px] px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${isComputedPro
                  ? 'bg-blue-600/60 text-white hover:bg-blue-600/80'
                  : 'bg-black/30 text-white/90 hover:bg-black/40'
                  }`}
              >
                🍗 {displayPro}
              </button>
            ) : null;
          })()}
          {(() => {
            const scaleR = detectedRatio ?? 1;
            const fromLines = resolvePossibleCardMacro("fiber", scaleR);
            const baseFiber = parseMacroDisplay(meal.fiber);
            const scaledMealFiber =
              baseFiber != null && detectedRatio != null && !pm.ingredients_override
                ? baseFiber * detectedRatio
                : baseFiber;
            const rawDisplayFiber = fromLines ?? scaledMealFiber;
            const displayFiber = rawDisplayFiber != null ? Math.round(rawDisplayFiber) : null;
            const isComputedFiber = fiberLooksComputedOnPossibleCard(
              pm.ingredients_override != null,
              displayIngredients,
              meal.ingredients,
              scaleR,
              undefined,
              foodItems,
              foodMacroIndex,
            );
            return displayFiber != null && displayFiber > 0 ? (
              <button
                onClick={() => { setEditValue(meal.fiber || ""); setEditing("fiber"); }}
                className={`text-[10px] px-1 py-0.5 rounded-full flex items-center gap-0.5 shrink-0 font-semibold ${isComputedFiber
                  ? 'bg-emerald-600/60 text-white hover:bg-emerald-600/80'
                  : 'bg-black/30 text-white/90 hover:bg-black/40'
                  }`}
              >
                🌾 {displayFiber}
              </button>
            ) : null;
          })()}

          <Button size="icon" variant="ghost" onClick={onDuplicate} className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20" title="Dupliquer">
            <Copy className="h-3 w-3" />
          </Button>

          <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange} modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-white/80 hover:text-white hover:bg-white/20">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onReturnToMaster && (
                <DropdownMenuItem onClick={onReturnToMaster}>
                  <Undo2 className="mr-2 h-4 w-4" /> {onReturnToMasterLabel || "Revenir dans Tous"}
                </DropdownMenuItem>
              )}
              {onSaveToNinjaTested && (
                <DropdownMenuItem onClick={onSaveToNinjaTested}>
                  <Sparkles className="mr-2 h-4 w-4" /> Enregistrer dans Recettes testées
                </DropdownMenuItem>
              )}
              {canAddNinjaExtras && (
                <DropdownMenuItem onSelect={() => openExtrasDialog()}>
                  <Plus className="mr-2 h-4 w-4" /> Ajouter extras
                </DropdownMenuItem>
              )}
              {onReturnWithoutDeduction && (
                <DropdownMenuItem onClick={onReturnWithoutDeduction}>
                  <Undo2 className="mr-2 h-4 w-4" /> {onReturnWithoutDeductionLabel || 'Remettre au choix (sans déduire)'}
                </DropdownMenuItem>
              )}
              {onRename && (
                <DropdownMenuItem onClick={() => { setEditValue(meal.name); setEditing("name"); }}>
                  <Pencil className="mr-2 h-4 w-4" /> Renommer
                </DropdownMenuItem>
              )}
              {onSplitQuantity && splitFactor !== null && (
                <DropdownMenuItem onClick={() => {
                  const baseIng = pm.ingredients_override ? pm.ingredients_override : meal.ingredients ? meal.ingredients : (() => {
                    const baseGrams = parseFloat((meal.grams || "0").replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
                    return baseGrams > 0 ? `${baseGrams}g ${meal.name}` : `1 ${meal.name}`;
                  })();
                  const baseIngredients = scaleIngredientStringExact(baseIng, 1 / splitFactor, undefined, true);
                  onSplitQuantity(splitFactor, baseIngredients);
                }}>
                  <SplitSquareHorizontal className="mr-2 h-4 w-4" /> Diviser les quantités
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => { setEditValue(""); setEditing("ratio"); }}>
                <Percent className="mr-2 h-4 w-4" /> Pourcentage / Multiple
              </DropdownMenuItem>
              {(onUpdateOvenTemp || onUpdateOvenMinutes) && (
                <div className="flex items-stretch gap-0.5 px-1 py-0.5" role="group" aria-label="Cuisson">
                  {onUpdateOvenTemp && (
                    <DropdownMenuItem
                      className="flex-1 min-w-0 justify-center px-1.5"
                      onClick={() => { setEditValue(meal.oven_temp || ""); setEditing("oven_temp"); }}
                    >
                      <Thermometer className="mr-1 h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Temp. (°C)</span>
                    </DropdownMenuItem>
                  )}
                  {onUpdateOvenMinutes && (
                    <DropdownMenuItem
                      className="flex-1 min-w-0 justify-center px-1.5"
                      onClick={() => { setEditValue(meal.oven_minutes || ""); setEditing("oven_minutes"); }}
                    >
                      <Timer className="mr-1 h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Durée (min)</span>
                    </DropdownMenuItem>
                  )}
                </div>
              )}
              {onUpdateDescription && (
                <DropdownMenuItem onSelect={() => openDescriptionEditor()}>
                  <FileText className="mr-2 h-4 w-4" /> Description
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => openIngredientsFromMenu()}>
                <List className="mr-2 h-4 w-4" /> Ingrédients
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Ligne 3 : ingrédients (cliquer pour éditer) — masquée si la carte n'en a pas encore */}
      {!editing && !editingIngredients && cardDisplayIngredients && (
        <button onClick={openIngredients} className="mt-1 text-[10px] text-white/60 flex flex-wrap gap-x-1 text-left hover:text-white/80 transition-colors">
          <StructuredIngredientInline
            ingredients={cardDisplayIngredients}
            expiredIngredientNames={expiredIngredientNames}
            expiringSoonIngredientNames={expiringSoonIngredientNames}
            stockMap={stockMap}
            softUnavailableStyle
            forcePlainWhite
            removeQuantityPrefixX
          />
        </button>
      )}
    </div>

    {/* Éditeur des consignes — met à jour le repas lié à la carte Possible */}
    <Dialog
      open={descriptionEditorOpen}
      onOpenChange={(open) => {
        if (open) setDescriptionEditorOpen(true);
        else closeDescriptionEditor();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Description — {meal.name}</DialogTitle>
        </DialogHeader>
        <AutoGrowDescriptionTextarea
          value={descriptionDraft}
          onChange={setDescriptionDraft}
        />
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={closeDescriptionEditor}>Annuler</Button>
          <Button type="button" onClick={saveDescription}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {canAddNinjaExtras && (
      <NinjaCreamiTestsExtrasDialog
        open={extrasDialogOpen}
        onOpenChange={setExtrasDialogOpen}
        baseGroups={ninjaCreamiBaseGroups!}
        extrasLines={ninjaCreamiExtrasLines!}
        testsGroupOrder={ninjaCreamiTestsGroupOrder}
        recipeMacros={recipeMacrosForExtras}
        onConfirm={handleConfirmNinjaExtras}
      />
    )}
    </>
  );
}
