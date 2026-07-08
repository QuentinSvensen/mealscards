import { format } from "date-fns";
import type { Meal } from "@/hooks/useMeals";
import { TIMES } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { getCardDisplayCalories, getCardDisplayProtein } from "@/hooks/useCalorieBalance";
import type { FoodItemMacroIndex } from "@/lib/ingredientUtils";
import { getExtraPortionMacros } from "@/lib/extraMacroUtils";
import { parseFoodDessertExtraId } from "@/lib/foodDessertUtils";
import { PLANNING_DAY_KEYS } from "@/lib/planningWeekUtils";
import type { PossibleMealBackupCard } from "./types";
import { isBackupBreakfastPmAlreadyInMatinSlot } from "./breakfastBreakdown";
import { mergeBackupCardOverrides } from "./mergeBackupOverrides";

const DRINK_CALORIES = 150;
const ROLLING_DAYS = 7;

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

/** Retourne la clé jour du planning (lundi…dimanche) pour une date calendaire. */
export function getPlanningDayKeyForDate(date: Date): string {
  const dow = date.getDay();
  if (dow === 0) return "dimanche";
  return PLANNING_DAY_KEYS[dow - 1];
}

/** Décode un extra personnalisé encodé dans un id `custom::…`. */
function parseCustomExtraId(id: string): { name: string; cal: number; prot: number } | null {
  if (!id.startsWith("custom::")) return null;
  const parts = id.slice(8).split("::");
  return {
    name: parts[0] || "Personnalisé",
    cal: parseFloat((parts[1] || "0").replace(",", ".")) || 0,
    prot: parseFloat((parts[2] || "0").replace(",", ".")) || 0,
  };
}

/** Lit les kcal depuis une chaîne affichée sur une fiche repas. */
function parseMealCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Somme kcal / prot des extras (stock, dessert aliment ou `custom::…`). */
function sumExtrasFromSelectionIds(
  ids: string[] | undefined,
  foodItems: FoodItem[],
): { cal: number; pro: number } {
  let cal = 0;
  let pro = 0;
  for (const id of ids ?? []) {
    const custom = parseCustomExtraId(id);
    if (custom) {
      cal += custom.cal;
      pro += custom.prot;
      continue;
    }
    const foodDessertItemId = parseFoodDessertExtraId(id);
    if (foodDessertItemId) {
      const dessertFi = foodItems.find((f) => f.id === foodDessertItemId);
      if (dessertFi) {
        const macros = getExtraPortionMacros(dessertFi, { perUnit: true });
        cal += macros.cal;
        pro += macros.pro;
      }
      continue;
    }
    const fi = foodItems.find((f) => f.id === id);
    if (fi) {
      const macros = getExtraPortionMacros(fi);
      cal += macros.cal;
      pro += macros.pro;
    }
  }
  return { cal, pro };
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
 * (même logique que la vue « semaine précédente »).
 */
export function computeBackupDayTotalCalories(
  ctx: BackupCalorieDayContext,
  iso: string,
  key: string,
  mealsById: Map<string, Meal>,
  foodItems: FoodItem[],
  isAvailable?: (name: string) => boolean,
  foodMacroIndex?: FoodItemMacroIndex,
): number {
  const dayCards = ctx.cards.filter((c) => c.day_of_week === iso || c.day_of_week === key);
  const midiCards = dayCards.filter((c) => c.meal_time === "midi");
  const soirCards = dayCards.filter((c) => c.meal_time === "soir");
  const matinCards = dayCards.filter((c) => c.meal_time === "matin");
  const gouterCards = dayCards.filter((c) => c.meal_time === "gouter");

  let bfSlotCal = 0;
  let midiSlotCal = 0;
  let soirSlotCal = 0;
  let gouterSlotCal = 0;

  const bfSel = ctx.breakfastSelections[iso] || ctx.breakfastSelections[key];
  if (bfSel?.startsWith("meal:")) {
    const m = mealsById.get(bfSel.slice(5));
    if (m) bfSlotCal += parseMealCalories(m.calories);
  } else if (bfSel?.startsWith("pm:")) {
    const pm = ctx.cards.find((c) => c.id === bfSel.slice(3));
    if (pm && !isBackupBreakfastPmAlreadyInMatinSlot(pm, iso, key, matinCards)) {
      const m = mealsById.get(pm.meal_id);
      const fullPm = m ? { ...pm, meals: m } : pm;
      bfSlotCal += getCardDisplayCalories(fullPm, ctx.calOverrides[pm.id], isAvailable);
    }
  } else {
    bfSlotCal += ctx.breakfastManualCalories[iso] || ctx.breakfastManualCalories[key] || 0;
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

  const matinAssignedIds = ctx.extraSlotAssignments[`${iso}-matin`] ?? ctx.extraSlotAssignments[`${key}-matin`] ?? [];
  const midiAssignedIds = ctx.extraSlotAssignments[`${iso}-midi`] ?? ctx.extraSlotAssignments[`${key}-midi`] ?? [];
  const soirAssignedIds = ctx.extraSlotAssignments[`${iso}-soir`] ?? ctx.extraSlotAssignments[`${key}-soir`] ?? [];
  const gouterAssignedIds = ctx.extraSlotAssignments[`${iso}-gouter`] ?? ctx.extraSlotAssignments[`${key}-gouter`] ?? [];
  const matinAssigned = sumExtrasFromSelectionIds(matinAssignedIds, foodItems);
  const midiAssigned = sumExtrasFromSelectionIds(midiAssignedIds, foodItems);
  const soirAssigned = sumExtrasFromSelectionIds(soirAssignedIds, foodItems);
  const gouterAssigned = sumExtrasFromSelectionIds(gouterAssignedIds, foodItems);

  bfSlotCal += processCards(matinCards) + matinAssigned.cal;

  midiSlotCal = processCards(midiCards) + midiAssigned.cal;
  if (midiCards.length === 0) {
    midiSlotCal += ctx.manualCalories[`${iso}-midi`] || ctx.manualCalories[`${key}-midi`] || 0;
  }
  if (ctx.drinkChecks[`${iso}-midi`] || ctx.drinkChecks[`${key}-midi`]) midiSlotCal += DRINK_CALORIES;

  soirSlotCal = processCards(soirCards) + soirAssigned.cal;
  if (soirCards.length === 0) {
    soirSlotCal += ctx.manualCalories[`${iso}-soir`] || ctx.manualCalories[`${key}-soir`] || 0;
  }
  if (ctx.drinkChecks[`${iso}-soir`] || ctx.drinkChecks[`${key}-soir`]) soirSlotCal += DRINK_CALORIES;

  gouterSlotCal = processCards(gouterCards) + gouterAssigned.cal;
  if (gouterCards.length === 0) {
    gouterSlotCal += ctx.manualCalories[`${iso}-gouter`] || ctx.manualCalories[`${key}-gouter`] || 0;
  }
  if (ctx.drinkChecks[`${iso}-gouter`] || ctx.drinkChecks[`${key}-gouter`]) gouterSlotCal += DRINK_CALORIES;

  let dayTotal = bfSlotCal + midiSlotCal + soirSlotCal + gouterSlotCal;
  dayTotal += ctx.extraCalories[iso] || ctx.extraCalories[key] || 0;

  const backupExtraSum = sumExtrasFromSelectionIds(ctx.extraSelections[iso] || ctx.extraSelections[key], foodItems);
  const backupAssignedExtraCal =
    matinAssigned.cal + midiAssigned.cal + soirAssigned.cal + gouterAssigned.cal;
  dayTotal += Math.max(0, backupExtraSum.cal - backupAssignedExtraCal);

  for (const time of TIMES) {
    if (ctx.drinkChecks[`${iso}-${time}`] || ctx.drinkChecks[`${key}-${time}`]) {
      // Déjà compté par créneau ci-dessus pour midi/soir ; conservé pour cohérence avec l’ancien total backup.
    }
  }

  return dayTotal;
}

/**
 * Moyenne calorique sur les 7 derniers jours calendaires (aujourd'hui → J-6).
 * Les jours de la semaine courante utilisent le planning live ; les jours plus anciens
 * utilisent la sauvegarde `possible_meals_backup` lorsqu'elle est disponible.
 */
export function computeRolling7DayCalorieAverage(params: {
  getLiveDayCalories: (dayKey: string, isoDate?: string) => number;
  currentWeekIsos: Set<string>;
  backupCtx: BackupCalorieDayContext | null;
  mealsById: Map<string, Meal>;
  foodItems: FoodItem[];
  isAvailable?: (name: string) => boolean;
  foodMacroIndex?: FoodItemMacroIndex;
  refDate?: Date;
}): number {
  const {
    getLiveDayCalories,
    currentWeekIsos,
    backupCtx,
    mealsById,
    foodItems,
    isAvailable,
    foodMacroIndex,
    refDate = new Date(),
  } = params;

  const today = new Date(refDate);
  today.setHours(0, 0, 0, 0);
  let total = 0;

  for (let i = 0; i < ROLLING_DAYS; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = format(d, "yyyy-MM-dd");
    const key = getPlanningDayKeyForDate(d);
    const liveCal = getLiveDayCalories(key, iso);

    if (currentWeekIsos.has(iso)) {
      total += liveCal;
      continue;
    }

    if (backupCtx) {
      const backupCal = computeBackupDayTotalCalories(
        backupCtx,
        iso,
        key,
        mealsById,
        foodItems,
        isAvailable,
        foodMacroIndex,
      );
      total += backupCal > 0 ? backupCal : liveCal;
    } else {
      total += liveCal;
    }
  }

  return Math.round(total / ROLLING_DAYS);
}
