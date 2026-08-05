import { getTargetDate } from "@/lib/ingredientUtils";

type PossiblePlanningSortable = {
  day_of_week: string | null;
  meal_time: string | null;
  counter_start_date?: string | null;
  sort_order: number;
  meals?: { name?: string | null } | null;
};

/** Ordre logique d'une journée : matin → midi → goûter → soir. */
const MEAL_TIME_SORT_RANK: Record<string, number> = {
  matin: 0,
  midi: 1,
  gouter: 2,
  soir: 3,
};

/**
 * Indique si le nom contient un numéro de pot (ex. « Pot #3 »), pas un « #? ».
 */
export function hasNumberedPotLabel(name: string | null | undefined): boolean {
  return /#\s*\d+/.test((name || "").trim());
}

/**
 * Indique un pot sans numéro (ex. « Pot #? » ou « Pot # ») — à distinguer des pots numérotés.
 */
export function isUnnumberedPotLabel(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!/^pot\s*#/i.test(n)) return false;
  return !hasNumberedPotLabel(n);
}

/**
 * Parmi les cartes non planifiées, place les pots numérotés (#3) au-dessus des #? / sans chiffre.
 * Les cartes planifiées gardent leur place ; l’ordre relatif dans chaque groupe est préservé.
 */
export function prioritizeNumberedPotsAmongUnplanned<T extends PossiblePlanningSortable>(
  items: readonly T[],
): T[] {
  const result = [...items];
  const unplannedIndices: number[] = [];
  for (let i = 0; i < result.length; i++) {
    if (!result[i].day_of_week?.trim()) unplannedIndices.push(i);
  }
  if (unplannedIndices.length < 2) return result;

  const unplannedItems = unplannedIndices.map((i) => result[i]);
  unplannedItems.sort((a, b) => {
    const aNum = hasNumberedPotLabel(a.meals?.name) ? 0 : 1;
    const bNum = hasNumberedPotLabel(b.meals?.name) ? 0 : 1;
    return aNum - bNum;
  });
  unplannedIndices.forEach((idx, j) => {
    result[idx] = unplannedItems[j];
  });
  return result;
}

/** Classe un créneau dans l'ordre d'une journée, en plaçant les cartes sans timing après les créneaux choisis. */
function getMealTimeSortRank(mealTime: string | null | undefined): number {
  const key = (mealTime || "").trim().toLowerCase();
  return MEAL_TIME_SORT_RANK[key] ?? 99;
}

/** Retourne la date calendaire de tri d'une carte planifiée, indépendamment de son timing. */
function getPlanningDaySortTime(pm: PossiblePlanningSortable, fixedNow: Date): number {
  return getTargetDate(pm.day_of_week, fixedNow, null, null).getTime();
}

/** Compare deux cartes possibles pour le tri Planning : jour, créneau, puis ordre manuel stable. */
export function comparePossiblePlanningOrder(
  a: PossiblePlanningSortable,
  b: PossiblePlanningSortable,
  fixedNow: Date = new Date(),
): number {
  const aHasPlan = !!a.day_of_week;
  const bHasPlan = !!b.day_of_week;

  if (aHasPlan || bHasPlan) {
    if (aHasPlan && bHasPlan) {
      const dateA = getPlanningDaySortTime(a, fixedNow);
      const dateB = getPlanningDaySortTime(b, fixedNow);
      if (dateA !== dateB) return dateA - dateB;

      const timeRankA = getMealTimeSortRank(a.meal_time);
      const timeRankB = getMealTimeSortRank(b.meal_time);
      if (timeRankA !== timeRankB) return timeRankA - timeRankB;
    } else if (aHasPlan) {
      return -1;
    } else if (bHasPlan) {
      return 1;
    }
  } else {
    const aNum = hasNumberedPotLabel(a.meals?.name) ? 0 : 1;
    const bNum = hasNumberedPotLabel(b.meals?.name) ? 0 : 1;
    if (aNum !== bNum) return aNum - bNum;

    const dateA = getTargetDate(null, fixedNow, null, a.meal_time);
    const dateB = getTargetDate(null, fixedNow, null, b.meal_time);
    if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
  }

  return (a.sort_order - b.sort_order) || (a.meals?.name ?? "").localeCompare(b.meals?.name ?? "");
}
