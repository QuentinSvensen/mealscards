import type { Meal, PossibleMeal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import { getCardDisplayCalories, getCardDisplayProtein } from "@/hooks/useCalorieBalance";
import type { FoodItemMacroIndex } from "@/lib/ingredientUtils";
import { getExtraPortionMacros } from "@/lib/extraMacroUtils";
import type { PossibleMealBackupCard } from "./types";

/** Une ligne du détail petit-déjeuner affiché dans le popover. */
export interface BreakfastBreakdownItem {
  id: string;
  name: string;
  cal: number;
  pro: number;
}

/** Indique si une carte Possible petit-déj est déjà comptée via le créneau matin ce jour-là. */
export function isBackupBreakfastPmAlreadyInMatinSlot(
  pm: PossibleMealBackupCard | undefined,
  iso: string,
  key: string,
  matinCards: PossibleMealBackupCard[],
): boolean {
  if (!pm) return false;
  const matinIds = new Set(matinCards.map((c) => c.id));
  if (matinIds.has(pm.id)) return true;
  return (pm.day_of_week === iso || pm.day_of_week === key) && pm.meal_time === "matin";
}

/** Lit les kcal depuis une chaîne affichée sur une fiche repas. */
function parseMealCalories(cal: string | null | undefined): number {
  if (!cal) return 0;
  const n = parseFloat(cal.replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

/** Lit les protéines depuis une chaîne affichée sur une fiche repas. */
function parseMealProtein(prot: string | null | undefined): number {
  if (!prot) return 0;
  const n = parseFloat(prot.replace(",", ".").replace(/[^0-9.]/g, ""));
  return Number.isNaN(n) ? 0 : n;
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

/** Ajoute les extras assignés au matin dans la liste de détail. */
function appendMatinExtrasToBreakdown(
  items: BreakfastBreakdownItem[],
  assignedIds: string[],
  foodItems: FoodItem[],
): void {
  const counts = new Map<string, number>();
  for (const id of assignedIds) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) {
    const custom = parseCustomExtraId(id);
    if (custom) {
      items.push({
        id: `extra-${id}`,
        name: count > 1 ? `${custom.name} ×${count}` : custom.name,
        cal: custom.cal * count,
        pro: custom.prot * count,
      });
      continue;
    }
    const fi = foodItems.find((f) => f.id === id);
    if (fi) {
      const macros = getExtraPortionMacros(fi);
      items.push({
        id: `extra-${id}`,
        name: count > 1 ? `${fi.name} ×${count}` : fi.name,
        cal: macros.cal * count,
        pro: macros.pro * count,
      });
    }
  }
}

/**
 * Construit la liste des petits déjeuners du planning courant pour un jour donné
 * (créneau matin + sélection menu + extras + saisie manuelle).
 */
export function buildLiveBreakfastBreakdownItems(params: {
  key: string;
  iso: string;
  matinMeals: PossibleMeal[];
  breakfast: Meal | null;
  breakfastSelections: Record<string, string>;
  possibleMeals: PossibleMeal[];
  calOverrides: Record<string, string>;
  proOverrides: Record<string, string>;
  breakfastManualCalories: Record<string, number>;
  breakfastManualProteins: Record<string, number>;
  breakfastAssignedIds: string[];
  foodItems: FoodItem[];
  isAvailable?: (name: string) => boolean;
  foodMacroIndex?: FoodItemMacroIndex;
  getMealCal: (meal: Meal) => number;
  getMealPro: (meal: Meal) => number;
}): BreakfastBreakdownItem[] {
  const {
    key,
    iso,
    matinMeals,
    breakfast,
    breakfastSelections,
    possibleMeals,
    calOverrides,
    proOverrides,
    breakfastManualCalories,
    breakfastManualProteins,
    breakfastAssignedIds,
    foodItems,
    isAvailable,
    foodMacroIndex,
    getMealCal,
    getMealPro,
  } = params;

  const items: BreakfastBreakdownItem[] = [];
  const matinIds = new Set(matinMeals.map((pm) => pm.id));

  for (const pm of matinMeals) {
    items.push({
      id: `matin-${pm.id}`,
      name: pm.meals?.name || "Repas",
      cal: getCardDisplayCalories(pm, calOverrides[pm.id], isAvailable),
      pro: getCardDisplayProtein(pm, proOverrides[pm.id], isAvailable, foodItems, foodMacroIndex),
    });
  }

  const selId = iso ? breakfastSelections[iso] : undefined;
  if (breakfast && selId) {
    if (selId.startsWith("pm:")) {
      const pmId = selId.slice(3);
      if (!matinIds.has(pmId)) {
        const possiblePdj = possibleMeals.find((pm) => pm.id === pmId);
        items.push({
          id: `sel-${pmId}`,
          name: possiblePdj?.meals?.name || breakfast.name,
          cal: possiblePdj
            ? getCardDisplayCalories(possiblePdj, calOverrides[possiblePdj.id], isAvailable)
            : parseMealCalories(breakfast.calories),
          pro: possiblePdj
            ? getCardDisplayProtein(possiblePdj, proOverrides[possiblePdj.id], isAvailable, foodItems, foodMacroIndex)
            : parseMealProtein(breakfast.protein),
        });
      }
    } else {
      items.push({
        id: `sel-${selId}`,
        name: breakfast.name,
        cal: getMealCal(breakfast),
        pro: getMealPro(breakfast),
      });
    }
  } else if (!breakfast && matinMeals.length === 0) {
    const manualCal = (iso && breakfastManualCalories[iso]) || 0;
    const manualPro = (iso && breakfastManualProteins[iso]) || 0;
    if (manualCal > 0 || manualPro > 0) {
      items.push({
        id: "manual",
        name: "Saisie manuelle",
        cal: manualCal,
        pro: manualPro,
      });
    }
  }

  appendMatinExtrasToBreakdown(items, breakfastAssignedIds, foodItems);
  return items;
}

/**
 * Construit la liste des petits déjeuners depuis la sauvegarde (semaine précédente)
 * en évitant de dupliquer une carte déjà présente dans le créneau matin.
 */
export function buildBackupBreakfastBreakdownItems(params: {
  key: string;
  iso: string;
  matinCards: PossibleMealBackupCard[];
  bfSel: string | undefined;
  cards: PossibleMealBackupCard[];
  breakfastManualCalories: Record<string, number>;
  breakfastManualProteins: Record<string, number>;
  calOverrides: Record<string, string>;
  proOverrides: Record<string, string>;
  matinAssignedIds: string[];
  mealsById: Map<string, Meal>;
  foodItems: FoodItem[];
  isAvailable?: (name: string) => boolean;
  foodMacroIndex?: FoodItemMacroIndex;
}): BreakfastBreakdownItem[] {
  const {
    key,
    iso,
    matinCards,
    bfSel,
    cards,
    breakfastManualCalories,
    breakfastManualProteins,
    calOverrides,
    proOverrides,
    matinAssignedIds,
    mealsById,
    foodItems,
    isAvailable,
    foodMacroIndex,
  } = params;

  const items: BreakfastBreakdownItem[] = [];

  for (const c of matinCards) {
    const m = mealsById.get(c.meal_id);
    if (!m) continue;
    const fullPm = { ...c, meals: m };
    items.push({
      id: `matin-${c.id}`,
      name: m.name,
      cal: getCardDisplayCalories(fullPm, calOverrides[c.id], isAvailable),
      pro: getCardDisplayProtein(fullPm, proOverrides[c.id], isAvailable, foodItems, foodMacroIndex),
    });
  }

  if (bfSel?.startsWith("meal:")) {
    const m = mealsById.get(bfSel.slice(5));
    if (m) {
      items.push({
        id: `sel-${bfSel}`,
        name: m.name,
        cal: parseMealCalories(m.calories),
        pro: parseMealProtein(m.protein),
      });
    }
  } else if (bfSel?.startsWith("pm:")) {
    const pm = cards.find((c) => c.id === bfSel.slice(3));
    if (pm && !isBackupBreakfastPmAlreadyInMatinSlot(pm, iso, key, matinCards)) {
      const m = mealsById.get(pm.meal_id);
      if (m) {
        const fullPm = { ...pm, meals: m };
        items.push({
          id: `sel-${pm.id}`,
          name: m.name,
          cal: getCardDisplayCalories(fullPm, calOverrides[pm.id], isAvailable),
          pro: getCardDisplayProtein(fullPm, proOverrides[pm.id], isAvailable, foodItems, foodMacroIndex),
        });
      }
    }
  } else if (!bfSel && matinCards.length === 0) {
    const manualCal = breakfastManualCalories[iso] || breakfastManualCalories[key] || 0;
    const manualPro = breakfastManualProteins[iso] || breakfastManualProteins[key] || 0;
    if (manualCal > 0 || manualPro > 0) {
      items.push({ id: "manual", name: "Saisie manuelle", cal: manualCal, pro: manualPro });
    }
  }

  appendMatinExtrasToBreakdown(items, matinAssignedIds, foodItems);
  return items;
}
