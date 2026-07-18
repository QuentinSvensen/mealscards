import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import {
  buildFoodDessertExtras,
  findSnapshotFoodItemForDessertExtra,
  parseFoodDessertExtraId,
  resolveFoodDessertPortionMacros,
  supplementFoodDessertExtrasFromSnapshots,
} from "@/lib/foodDessertUtils";
import { getExtraPortionMacros } from "@/lib/extraMacroUtils";

/** Décode un extra personnalisé encodé dans un id `custom::…`. */
export function parsePlanningCustomExtraId(id: string): { name: string; cal: number; prot: number } | null {
  if (!id.startsWith("custom::")) return null;
  const parts = id.slice(8).split("::");
  return {
    name: parts[0] || "Personnalisé",
    cal: parseFloat((parts[1] || "0").replace(",", ".")) || 0,
    prot: parseFloat((parts[2] || "0").replace(",", ".")) || 0,
  };
}

/**
 * Lit une valeur de préférence indexée par ISO ou par clé jour (lundi…dimanche).
 */
export function pickPlanningDayValue<T>(
  record: Record<string, T>,
  iso: string | undefined,
  dayKey: string,
): T | undefined {
  if (iso && Object.prototype.hasOwnProperty.call(record, iso)) return record[iso];
  if (Object.prototype.hasOwnProperty.call(record, dayKey)) return record[dayKey];
  return undefined;
}

/** Collecte tous les ids d'extras présents dans les sélections et les assignations de créneaux. */
export function collectPlanningExtraIds(
  extraSelections: Record<string, string[]>,
  extraSlotAssignments: Record<string, string[]>,
): string[] {
  const ids = new Set<string>();
  for (const list of Object.values(extraSelections)) {
    for (const id of list ?? []) ids.add(id);
  }
  for (const list of Object.values(extraSlotAssignments)) {
    for (const id of list ?? []) ids.add(id);
  }
  return [...ids];
}

/**
 * Construit le catalogue desserts (id → macros) pour les totaux journaliers,
 * y compris les fiches supprimées du stock mais encore sélectionnées.
 */
export function buildPlanningDessertCatalogById(
  foodItems: FoodItem[],
  dessertFoodItemIds: string[],
  macroLibrary: IngredientMacroLibraryItem[],
  extraSelections: Record<string, string[]>,
  extraSlotAssignments: Record<string, string[]>,
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>,
): Map<string, { cal: number; prot: number; fiber?: number }> {
  const selectedFoodDessertIds = collectPlanningExtraIds(extraSelections, extraSlotAssignments).filter(
    (id): id is string => !!parseFoodDessertExtraId(id),
  );
  const supplemented = supplementFoodDessertExtrasFromSnapshots(
    buildFoodDessertExtras(foodItems, dessertFoodItemIds, macroLibrary),
    dessertExtraStockSnapshots,
    macroLibrary,
    selectedFoodDessertIds,
  );
  return new Map(
    supplemented.map((entry) => [entry.id, { cal: entry.cal, prot: entry.prot, fiber: entry.fiber }]),
  );
}

/**
 * Lit une valeur de préférence indexée par créneau (`ISO-midi` ou `jeudi-midi`).
 */
export function pickPlanningSlotValue<T>(
  record: Record<string, T>,
  iso: string | undefined,
  dayKey: string,
  slot: string,
): T | undefined {
  if (iso) {
    const isoKey = `${iso}-${slot}`;
    if (Object.prototype.hasOwnProperty.call(record, isoKey)) return record[isoKey];
  }
  const daySlotKey = `${dayKey}-${slot}`;
  if (Object.prototype.hasOwnProperty.call(record, daySlotKey)) return record[daySlotKey];
  return undefined;
}

/** Liste les ids d'extras déjà assignés à un créneau pour une journée. */
export function getAssignedExtraIdsForDay(
  extraSlotAssignments: Record<string, string[]>,
  iso: string,
  key: string,
): string[] {
  const slots: Array<"matin" | "midi" | "gouter" | "soir"> = ["matin", "midi", "gouter", "soir"];
  const out = new Set<string>();
  for (const slot of slots) {
    for (const id of extraSlotAssignments[`${iso}-${slot}`] ?? []) out.add(id);
    for (const id of extraSlotAssignments[`${key}-${slot}`] ?? []) out.add(id);
  }
  return [...out];
}

/**
 * Fusionne les sélections extras du jour avec les extras déjà posés dans un créneau.
 */
export function mergeExtraDaySelectionIds(
  selectedIds: string[],
  extraSlotAssignments: Record<string, string[]>,
  iso: string,
  key: string,
): string[] {
  const merged = [...selectedIds];
  const assigned = getAssignedExtraIdsForDay(extraSlotAssignments, iso, key);
  for (const id of new Set(assigned)) {
    const assignedCount = assigned.filter((entry) => entry === id).length;
    const selectedCount = merged.filter((entry) => entry === id).length;
    for (let i = selectedCount; i < assignedCount; i++) merged.push(id);
  }
  return merged;
}

/**
 * Somme kcal / prot / fibres des extras sélectionnés
 * (stock, desserts `food-dessert::…`, catalogue et snapshots).
 */
export function aggregateExtraSelectionMacros(
  ids: string[] | undefined,
  foodItems: FoodItem[],
  macroLibrary: IngredientMacroLibraryItem[] = [],
  dessertCatalogById: Map<string, { cal: number; prot: number; fiber?: number }> = new Map(),
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>> = {},
): { cal: number; pro: number; fiber: number } {
  let cal = 0;
  let pro = 0;
  let fiber = 0;
  for (const id of ids ?? []) {
    const custom = parsePlanningCustomExtraId(id);
    if (custom) {
      cal += custom.cal;
      pro += custom.prot;
      continue;
    }
    const foodDessertItemId = parseFoodDessertExtraId(id);
    if (foodDessertItemId) {
      const dessertFi = foodItems.find((f) => f.id === foodDessertItemId);
      if (dessertFi) {
        const macros = resolveFoodDessertPortionMacros(dessertFi, macroLibrary);
        cal += macros.cal;
        pro += macros.pro;
        fiber += macros.fiber;
      } else {
        const catalogDessert = dessertCatalogById.get(id);
        if (catalogDessert) {
          cal += catalogDessert.cal;
          pro += catalogDessert.prot;
          fiber += catalogDessert.fiber ?? 0;
        } else {
          const snapshotFi = findSnapshotFoodItemForDessertExtra(dessertExtraStockSnapshots, id);
          if (snapshotFi) {
            const macros = resolveFoodDessertPortionMacros(snapshotFi, macroLibrary);
            cal += macros.cal;
            pro += macros.pro;
            fiber += macros.fiber;
          }
        }
      }
      continue;
    }
    const fi = foodItems.find((f) => f.id === id);
    if (fi) {
      const macros = getExtraPortionMacros(fi);
      cal += macros.cal;
      pro += macros.pro;
      fiber += macros.fiber;
    }
  }
  return { cal, pro, fiber };
}

/**
 * Multiplie les macros d'une portion par un nombre d'occurrences
 * pour l'affichage des lignes d'extras dans le planning.
 */
export function scaleExtraDisplayMacrosByCount(
  macros: { cal: number; pro: number; fiber: number },
  count: number,
): { cal: number; pro: number; fiber: number } {
  const q = Math.max(1, Math.round(count));
  if (q <= 1) return macros;
  return {
    cal: Math.round(macros.cal * q),
    pro: Math.round(macros.pro * q),
    fiber: Math.round(macros.fiber * q),
  };
}
