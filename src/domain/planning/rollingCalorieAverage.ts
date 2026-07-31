import { format } from "date-fns";
import type { Meal, PossibleMeal } from "@/types/meals";
import type { FoodItem } from "@/types/food";
import { getCardDisplayCalories } from "@/hooks/useCalorieBalance";
import type { FoodItemMacroIndex } from "@/lib/ingredientUtils";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { buildWeekDates, PLANNING_DAY_KEYS } from "@/lib/planningWeekUtils";
import {
  aggregateExtraSelectionMacros,
  buildPlanningDessertCatalogById,
} from "@/lib/planningExtraMacros";
import type { PossibleMealBackupCard, PossibleMealsFullBackup } from "./types";
import { isBackupBreakfastPmAlreadyInMatinSlot } from "./breakfastBreakdown";
import { isIsoWithinRange } from "./dailyCalorieHistory";
import { mergeBackupCardOverrides } from "./mergeBackupOverrides";
import {
  collectBackupDayKeyVariants,
  filterBackupCardsForDisplayDay,
  pickBackupDayNumber,
  pickBackupDayString,
  pickBackupDayStringArray,
  pickBackupSlotBoolean,
  pickBackupSlotNumber,
  pickBackupSlotStringArray,
  prepareBackupForDisplayWeek,
  resolveArchivedIsoForDisplay,
} from "./backupWeekAlignment";
import {
  mergeRecoveredAndBackupCards,
  recoverPreviousWeekCardsFromLive,
} from "./recoverPreviousWeekCards";

const DRINK_CALORIES = 150;
const DEFAULT_ROLLING_DAYS = 14;

/** Nombre de jours de la fenêtre glissante 7 jours (comparatif court terme). */
export const ROLLING_WINDOW_7_DAYS = 7;

/** Nombre de jours de la fenêtre glissante 14 jours (moyenne longue). */
export const ROLLING_WINDOW_14_DAYS = DEFAULT_ROLLING_DAYS;

/** Contexte de la sauvegarde planning utilisé pour reconstituer les totaux journaliers passés. */
export interface BackupCalorieDayContext {
  cards: PossibleMealBackupCard[];
  manualCalories: Record<string, number>;
  manualProteins: Record<string, number>;
  extraCalories: Record<string, number>;
  extraProteins: Record<string, number>;
  extraSelections: Record<string, string[]>;
  extraSlotAssignments: Record<string, string[]>;
  breakfastManualCalories: Record<string, number>;
  breakfastManualProteins: Record<string, number>;
  breakfastSelections: Record<string, string>;
  drinkChecks: Record<string, boolean>;
  calOverrides: Record<string, string>;
  proOverrides: Record<string, string>;
}

/** Paramètres macros desserts pour recalculer les extras d'une sauvegarde. */
export interface BackupExtraMacroParams {
  dessertFoodItemIds: string[];
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>;
  macroLibrary: IngredientMacroLibraryItem[];
}

/** Retourne la clé jour du planning (lundi…dimanche) pour une date calendaire. */
export function getPlanningDayKeyForDate(date: Date): string {
  const dow = date.getDay();
  if (dow === 0) return "dimanche";
  return PLANNING_DAY_KEYS[dow - 1];
}

/** Lit les kcal depuis une chaîne affichée sur une fiche repas. */
function parseMealCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Somme kcal / prot / fibres des extras sélectionnés dans une sauvegarde
 * (catalogue desserts, snapshots et extras `custom::…`).
 */
function sumBackupExtrasFromSelectionIds(
  ids: string[] | undefined,
  foodItems: FoodItem[],
  dessertCatalogById: Map<string, { cal: number; prot: number; fiber?: number }>,
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>,
  macroLibrary: IngredientMacroLibraryItem[],
): { cal: number; pro: number; fiber: number } {
  return aggregateExtraSelectionMacros(
    ids,
    foodItems,
    macroLibrary,
    dessertCatalogById,
    dessertExtraStockSnapshots,
  );
}

/**
 * Construit le contexte calorie à partir de `possible_meals_backup`
 * en fusionnant les overrides live encore présents.
 */
export function parseBackupCalorieContext(
  backupRaw: unknown,
  liveCalOverrides: Record<string, string>,
  liveProOverrides: Record<string, string>,
): BackupCalorieDayContext | null {
  if (!backupRaw || typeof backupRaw !== "object") return null;
  const raw = backupRaw as Record<string, unknown>;
  const isNF = !Array.isArray(raw) && Array.isArray(raw.cards);
  if (!isNF) return null;

  const cards = raw.cards as PossibleMealBackupCard[];
  const cardIds = cards.map((c) => c.id);

  return {
    cards,
    manualCalories: (raw.manualCalories as Record<string, number>) || {},
    manualProteins: (raw.manualProteins as Record<string, number>) || {},
    extraCalories: (raw.extraCalories as Record<string, number>) || {},
    extraProteins: (raw.extraProteins as Record<string, number>) || {},
    extraSelections: (raw.extraSelections as Record<string, string[]>) || {},
    extraSlotAssignments: (raw.extraSlotAssignments as Record<string, string[]>) || {},
    breakfastManualCalories: (raw.breakfastManualCalories as Record<string, number>) || {},
    breakfastManualProteins: (raw.breakfastManualProteins as Record<string, number>) || {},
    breakfastSelections: (raw.breakfastSelections as Record<string, string>) || {},
    drinkChecks: (raw.drinkChecks as Record<string, boolean>) || {},
    calOverrides: mergeBackupCardOverrides(
      raw.calOverrides as Record<string, string | number> | undefined,
      liveCalOverrides,
      cardIds,
    ),
    proOverrides: mergeBackupCardOverrides(
      raw.proOverrides as Record<string, string | number> | undefined,
      liveProOverrides,
      cardIds,
    ),
  };
}

/**
 * Calcule le total calorique d'un jour à partir de la sauvegarde planning
 * (même filtre de cartes / variantes de clés que la vue « semaine précédente »).
 */
export function computeBackupDayTotalCalories(
  ctx: BackupCalorieDayContext,
  iso: string,
  key: string,
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  isAvailable?: (name: string) => boolean,
  _foodMacroIndex?: FoodItemMacroIndex,
  extraMacroParams?: BackupExtraMacroParams,
  archivedIso?: string,
): number {
  const bIso = archivedIso ?? iso;
  const dayVariants = collectBackupDayKeyVariants(iso, key, bIso);

  const dessertCatalogById = extraMacroParams
    ? buildPlanningDessertCatalogById(
      foodItems,
      extraMacroParams.dessertFoodItemIds,
      extraMacroParams.macroLibrary,
      ctx.extraSelections,
      ctx.extraSlotAssignments,
      extraMacroParams.dessertExtraStockSnapshots,
    )
    : new Map<string, { cal: number; prot: number; fiber?: number }>();

  const sumExtras = (ids: string[] | undefined) =>
    sumBackupExtrasFromSelectionIds(
      ids,
      foodItems,
      dessertCatalogById,
      extraMacroParams?.dessertExtraStockSnapshots ?? {},
      extraMacroParams?.macroLibrary ?? [],
    );

  // Même règle que le footer : ISO d’abord, clé jour seulement en repli
  const dayCards = filterBackupCardsForDisplayDay(ctx.cards, iso, key, bIso);
  const midiCards = dayCards.filter((c) => c.meal_time === "midi");
  const soirCards = dayCards.filter((c) => c.meal_time === "soir");
  const matinCards = dayCards.filter((c) => c.meal_time === "matin");
  const gouterCards = dayCards.filter((c) => c.meal_time === "gouter");

  let bfSlotCal = 0;
  let midiSlotCal = 0;
  let soirSlotCal = 0;
  let gouterSlotCal = 0;

  const bfSel = pickBackupDayString(ctx.breakfastSelections, dayVariants);
  if (bfSel?.startsWith("meal:")) {
    const m = mealsById.get(bfSel.slice(5));
    if (m) bfSlotCal += parseMealCalories(m.calories);
  } else if (bfSel?.startsWith("pm:")) {
    const pm = ctx.cards.find((c) => c.id === bfSel.slice(3));
    if (pm && !isBackupBreakfastPmAlreadyInMatinSlot(pm, bIso, key, matinCards)) {
      const m = mealsById.get(pm.meal_id);
      const fullPm = m ? { ...pm, meals: m } : pm;
      bfSlotCal += getCardDisplayCalories(fullPm, ctx.calOverrides[pm.id], isAvailable);
    }
  } else {
    bfSlotCal += pickBackupDayNumber(ctx.breakfastManualCalories, dayVariants);
  }

  const processCards = (slotCards: PossibleMealBackupCard[]) => {
    let cals = 0;
    for (const c of slotCards) {
      const m = mealsById.get(c.meal_id);
      if (!m) continue;
      const fullPm = { ...c, meals: m };
      cals += getCardDisplayCalories(fullPm, ctx.calOverrides[c.id], isAvailable);
    }
    return cals;
  };

  const matinAssignedIds = pickBackupSlotStringArray(ctx.extraSlotAssignments, "matin", dayVariants);
  const midiAssignedIds = pickBackupSlotStringArray(ctx.extraSlotAssignments, "midi", dayVariants);
  const soirAssignedIds = pickBackupSlotStringArray(ctx.extraSlotAssignments, "soir", dayVariants);
  const gouterAssignedIds = pickBackupSlotStringArray(ctx.extraSlotAssignments, "gouter", dayVariants);
  const matinAssigned = sumExtras(matinAssignedIds);
  const midiAssigned = sumExtras(midiAssignedIds);
  const soirAssigned = sumExtras(soirAssignedIds);
  const gouterAssigned = sumExtras(gouterAssignedIds);

  bfSlotCal += processCards(matinCards) + matinAssigned.cal;

  midiSlotCal = processCards(midiCards) + midiAssigned.cal;
  if (midiCards.length === 0) {
    midiSlotCal += pickBackupSlotNumber(ctx.manualCalories, "midi", dayVariants);
  }
  if (pickBackupSlotBoolean(ctx.drinkChecks, "midi", dayVariants)) midiSlotCal += DRINK_CALORIES;

  soirSlotCal = processCards(soirCards) + soirAssigned.cal;
  if (soirCards.length === 0) {
    soirSlotCal += pickBackupSlotNumber(ctx.manualCalories, "soir", dayVariants);
  }
  if (pickBackupSlotBoolean(ctx.drinkChecks, "soir", dayVariants)) soirSlotCal += DRINK_CALORIES;

  gouterSlotCal = processCards(gouterCards) + gouterAssigned.cal;
  if (gouterCards.length === 0) {
    gouterSlotCal += pickBackupSlotNumber(ctx.manualCalories, "gouter", dayVariants);
  }
  if (pickBackupSlotBoolean(ctx.drinkChecks, "gouter", dayVariants)) gouterSlotCal += DRINK_CALORIES;

  let dayTotal = bfSlotCal + midiSlotCal + soirSlotCal + gouterSlotCal;
  dayTotal += pickBackupDayNumber(ctx.extraCalories, dayVariants);

  const daySelectionIds = pickBackupDayStringArray(ctx.extraSelections, dayVariants);
  // Comme le footer backup : extras jour seulement, pas de merge avec les créneaux
  // (les créneaux sont déjà additionnés via matinAssigned / midiAssigned / …).
  const backupExtraSum = sumExtras(daySelectionIds);
  const backupAssignedExtraCal =
    matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
  dayTotal += Math.max(0, backupExtraSum.cal - backupAssignedExtraCal);

  return dayTotal;
}

/**
 * Précalcule les totaux kcal de la semaine précédente (lun→dim)
 * avec le même alignement archive + récupération live que la vue backup.
 */
export function buildPreviousWeekBackupCalorieMap(
  backupFull: PossibleMealsFullBackup | null | undefined,
  backupCtx: BackupCalorieDayContext | null,
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  isAvailable?: (name: string) => boolean,
  foodMacroIndex?: FoodItemMacroIndex,
  extraMacroParams?: BackupExtraMacroParams,
  refDate: Date = new Date(),
  possibleMeals: PossibleMeal[] = [],
): Map<string, number> {
  const map = new Map<string, number>();
  if (!backupFull || !backupCtx) return map;

  const previousWeekDates = buildWeekDates(-1, refDate);
  const prepared = prepareBackupForDisplayWeek(backupFull, previousWeekDates);
  const recovered = recoverPreviousWeekCardsFromLive(possibleMeals, previousWeekDates);
  const mergedCards = mergeRecoveredAndBackupCards(
    recovered,
    prepared.backup.cards ?? backupCtx.cards,
    previousWeekDates,
  );

  const alignedCtx: BackupCalorieDayContext = {
    ...backupCtx,
    cards: mergedCards,
    manualCalories: prepared.backup.manualCalories ?? backupCtx.manualCalories,
    manualProteins: prepared.backup.manualProteins ?? backupCtx.manualProteins,
    extraCalories: prepared.backup.extraCalories ?? backupCtx.extraCalories,
    extraProteins: prepared.backup.extraProteins ?? backupCtx.extraProteins,
    extraSelections: prepared.backup.extraSelections ?? backupCtx.extraSelections,
    extraSlotAssignments:
      prepared.backup.extraSlotAssignments ?? backupCtx.extraSlotAssignments,
    breakfastManualCalories:
      prepared.backup.breakfastManualCalories ?? backupCtx.breakfastManualCalories,
    breakfastManualProteins:
      prepared.backup.breakfastManualProteins ?? backupCtx.breakfastManualProteins,
    breakfastSelections:
      prepared.backup.breakfastSelections ?? backupCtx.breakfastSelections,
    drinkChecks: prepared.backup.drinkChecks ?? backupCtx.drinkChecks,
  };

  for (const day of previousWeekDates) {
    const archivedIso = resolveArchivedIsoForDisplay(
      day.iso,
      prepared.displayToArchivedIso,
    );
    const cal = computeBackupDayTotalCalories(
      alignedCtx,
      day.iso,
      day.key,
      mealsById,
      foodItems,
      isAvailable,
      foodMacroIndex,
      extraMacroParams,
      archivedIso,
    );
    if (cal > 0) map.set(day.iso, cal);
  }
  return map;
}

/** Jour calendaire résolu pour la moyenne glissante. */
export interface RollingCalorieDayBreakdown {
  /** Décalage par rapport à aujourd'hui (0 = aujourd'hui, 7 = J-7). */
  offset: number;
  iso: string;
  key: string;
  calories: number;
  source: "live" | "history" | "backup" | "none";
}

/** Moyenne sur une fenêtre glissante de N jours (7 → 14). */
export interface RollingCalorieWindowAverage {
  windowDays: number;
  average: number;
  daysCounted: number;
  /** Décalage du jour le plus ancien inclus (ex. 6 pour 7j, 7 pour 8j). */
  oldestOffset: number;
  /** Variation vs la fenêtre précédente (undefined pour 7j). */
  deltaFromPrevious?: number;
}

type RollingCalorieResolveParams = Omit<
  Parameters<typeof computeRollingDayCalorieAverage>[0],
  "rollingDays" | "refDate"
> & { refDate?: Date };

/**
 * Résout les kcal journalières sur `maxDays` (aujourd'hui → J-(maxDays-1)).
 * Priorité : live → backup semaine précédente alignée → backup plage ISO
 * → historique (hors valeurs clairement gonflées).
 */
export function resolveRollingDayCalories(
  params: RollingCalorieResolveParams,
  maxDays = ROLLING_WINDOW_14_DAYS,
): RollingCalorieDayBreakdown[] {
  const {
    getLiveDayCalories,
    currentWeekIsos,
    dailyCalorieHistory,
    backupCtx,
    backupFull,
    backupWeekRange,
    mealsById,
    foodItems,
    isAvailable,
    foodMacroIndex,
    extraMacroParams,
    refDate = new Date(),
  } = params;

  const today = new Date(refDate);
  today.setHours(0, 0, 0, 0);
  const daily: RollingCalorieDayBreakdown[] = [];

  const previousWeekCalByIso = buildPreviousWeekBackupCalorieMap(
    backupFull,
    backupCtx,
    mealsById,
    foodItems,
    isAvailable,
    foodMacroIndex,
    extraMacroParams,
    today,
    params.possibleMeals ?? [],
  );

  const previousWeekDates = buildWeekDates(-1, today);
  const previousWeekIsoSet = new Set(previousWeekDates.map((d) => d.iso));

  const reliableRefValues = [
    ...previousWeekCalByIso.values(),
  ];
  // Référence anti-gonflement : moyenne semaine précédente, sinon jours live déjà résolus plus bas
  let inflatedCeiling =
    reliableRefValues.length > 0
      ? (reliableRefValues.reduce((a, b) => a + b, 0) / reliableRefValues.length) * 1.6
      : 0;

  for (let i = 0; i < maxDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = format(d, "yyyy-MM-dd");
    const key = getPlanningDayKeyForDate(d);
    let calories = 0;
    let source: RollingCalorieDayBreakdown["source"] = "none";

    if (currentWeekIsos.has(iso)) {
      calories = getLiveDayCalories(key, iso);
      source = calories > 0 ? "live" : "none";
      if (calories > 0 && inflatedCeiling <= 0) {
        reliableRefValues.push(calories);
      }
    } else if (previousWeekCalByIso.has(iso)) {
      calories = previousWeekCalByIso.get(iso) ?? 0;
      source = calories > 0 ? "backup" : "none";
    } else if (previousWeekIsoSet.has(iso) && backupCtx) {
      calories = computeBackupDayTotalCalories(
        backupCtx,
        iso,
        key,
        mealsById,
        foodItems,
        isAvailable,
        foodMacroIndex,
        extraMacroParams,
        iso,
      );
      source = calories > 0 ? "backup" : "none";
    } else if (
      backupCtx
      && backupWeekRange
      && isIsoWithinRange(iso, backupWeekRange.startISO, backupWeekRange.endISO)
    ) {
      calories = computeBackupDayTotalCalories(
        backupCtx,
        iso,
        key,
        mealsById,
        foodItems,
        isAvailable,
        foodMacroIndex,
        extraMacroParams,
      );
      source = calories > 0 ? "backup" : "none";
    }

    // Repli historique si live/backup n'ont rien donné pour ce jour
    if (
      calories <= 0
      && dailyCalorieHistory[iso] != null
      && dailyCalorieHistory[iso] > 0
    ) {
      const historyCal = dailyCalorieHistory[iso];
      if (inflatedCeiling <= 0 && reliableRefValues.length > 0) {
        inflatedCeiling =
          (reliableRefValues.reduce((a, b) => a + b, 0) / reliableRefValues.length) * 1.6;
      }
      if (inflatedCeiling > 0 && historyCal > inflatedCeiling) {
        // Historique gonflé : on garde 0
      } else {
        calories = historyCal;
        source = "history";
      }
    }

    daily.push({ offset: i, iso, key, calories, source });
  }

  return daily;
}

/**
 * Compare les moyennes 7j → 14j et détaille chaque jour pour repérer
 * celui qui fait chuter la moyenne après J-7.
 */
export function computeRollingCalorieDiagnostics(
  params: RollingCalorieResolveParams,
): {
  daily: RollingCalorieDayBreakdown[];
  windows: RollingCalorieWindowAverage[];
} {
  const daily = resolveRollingDayCalories(params, ROLLING_WINDOW_14_DAYS);
  const windows: RollingCalorieWindowAverage[] = [];

  for (let windowDays = ROLLING_WINDOW_7_DAYS; windowDays <= ROLLING_WINDOW_14_DAYS; windowDays++) {
    const slice = daily.slice(0, windowDays);
    const total = slice.reduce((sum, entry) => sum + entry.calories, 0);
    const daysCounted = slice.filter((entry) => entry.calories > 0).length;
    const average = windowDays > 0 ? Math.round(total / windowDays) : 0;
    const prev = windows[windows.length - 1];
    windows.push({
      windowDays,
      average,
      daysCounted,
      oldestOffset: windowDays - 1,
      deltaFromPrevious: prev != null ? average - prev.average : undefined,
    });
  }

  return { daily, windows };
}

/**
 * Moyenne calorique sur une fenêtre glissante (aujourd'hui → J-(N-1)).
 * Divise toujours par N (taille de la fenêtre), pas seulement par les jours
 * renseignés — ainsi « 14j » est bien la moyenne des 14 derniers jours.
 */
export function computeRollingDayCalorieAverage(params: {
  getLiveDayCalories: (dayKey: string, isoDate?: string) => number;
  currentWeekIsos: Set<string>;
  dailyCalorieHistory: Record<string, number>;
  backupCtx: BackupCalorieDayContext | null;
  /** Sauvegarde complète pour aligner la semaine précédente comme le footer. */
  backupFull?: PossibleMealsFullBackup | null;
  backupWeekRange: { startISO: string; endISO: string } | null;
  mealsById: Map<string, Meal>;
  foodItems: FoodItem[];
  isAvailable?: (name: string) => boolean;
  foodMacroIndex?: FoodItemMacroIndex;
  extraMacroParams?: BackupExtraMacroParams;
  /** Cartes live pour dédupliquer la backup comme la vue semaine précédente. */
  possibleMeals?: PossibleMeal[];
  refDate?: Date;
  rollingDays?: number;
}): { average: number; daysCounted: number } {
  const rollingDays = params.rollingDays ?? DEFAULT_ROLLING_DAYS;
  const daily = resolveRollingDayCalories(params, rollingDays);
  const total = daily.reduce((sum, entry) => sum + entry.calories, 0);
  const daysCounted = daily.filter((entry) => entry.calories > 0).length;

  return {
    average: rollingDays > 0 ? Math.round(total / rollingDays) : 0,
    daysCounted,
  };
}

/** Alias rétrocompatible : moyenne glissante sur 14 jours. */
export function computeRolling7DayCalorieAverage(
  params: Omit<Parameters<typeof computeRollingDayCalorieAverage>[0], "rollingDays">,
): { average: number; daysCounted: number } {
  return computeRollingDayCalorieAverage({ ...params, rollingDays: ROLLING_WINDOW_14_DAYS });
}
