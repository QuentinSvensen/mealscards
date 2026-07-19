import { Check, Flame, Plus, Wheat } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { PlanningInput } from "@/components/planning/PlanningInput";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { Meal } from "@/hooks/useMeals";
import type { PlanningSnapshotEntry } from "@/domain/planning/types";
import type { IngredientMacroLibraryItem } from "@/domain/macros/ingredientMacroDatabase";
import { getSortedFoodItems } from "@/lib/foodSortUtils";
import { splitSortedExtrasByDivider } from "@/lib/extrasDividerUtils";
import { EXTRA_DAY_SLOTS } from "@/domain/planning/extraSlotOps";
import { clearExtraSnapshotsForWeekday, clearNextWeekExtraStateForDay } from "@/domain/planning/extraSnapshotUtils";
import { formatPlanningSnapshotTitle } from "@/domain/planning/formatPlanningSnapshotTitle";
import { scaleExtraDisplayMacrosByCount } from "@/lib/planningExtraMacros";
import {
  parseCustomExtraId,
  resolveDessertCatalogId,
  isDessertExtraInSelections,
  extractExtraDisplayQuantity,
  resolvePlanningExtraFoodMacros,
  getUnassignedExtraSelectionIds,
  countDisplayableExtraSelections,
  formatExtraQuantitySubtitle,
  formatExtraRemainingCountLabel,
  resolveExtraFoodRemainingCount,
} from "@/domain/planning/extraDisplay";
import { parseFoodDessertExtraId } from "@/lib/foodDessertUtils";
import { extraFitsRemainingCalories } from "@/domain/planning/calorieGoalRange";
import { toast } from "@/hooks/use-toast";

/** Dessert catalogue (portion) utilisé par la colonne Extra. */
export type PlanningDessertExtra = {
  id: string;
  name: string;
  cal: number;
  prot: number;
  fiber: number;
  mealPayload: Meal;
};

export interface PlanningExtraColumnProps {
  dayKey: string;
  dayIso: string;
  dragOverSlot: string | null;
  setDragOverSlot: React.Dispatch<React.SetStateAction<string | null>>;
  draggedSelectedExtraId: string | null;
  setDraggedSelectedExtraId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraggedSelectedExtraOrigin: React.Dispatch<React.SetStateAction<{ iso: string; key: string } | null>>;
  unassignExtraFromAllDaySlots: (extraId: string, iso: string, key: string) => void;
  extraCalories: Record<string, number>;
  extraProteins: Record<string, number>;
  extraFibers: Record<string, number>;
  extraSelections: Record<string, string[]>;
  extraSlotAssignments: Record<string, string[]>;
  setPreference: { mutate: (args: { key: string; value: unknown }) => void };
  getPreference: <T>(key: string, fallback: T) => T;
  openExtrasDay: string | null;
  setOpenExtrasDay: React.Dispatch<React.SetStateAction<string | null>>;
  isTouchDevice: boolean;
  foodItems: FoodItem[];
  testItemIdSet: Set<string>;
  foodSortModes: Record<string, string>;
  sortDirections: Record<string, boolean>;
  extrasDividerAfterId: string | null;
  allSingleIngredientDessertExtras: PlanningDessertExtra[];
  singleIngredientDessertExtras: PlanningDessertExtra[];
  singleIngredientDessertById: Map<string, PlanningDessertExtra>;
  dessertExtraStockSnapshots: Record<string, Record<string, FoodItem[][]>>;
  canAddDessertById: Map<string, boolean>;
  dessertPossibleCountById: Map<string, number>;
  ingredientMacroLibrary: IngredientMacroLibraryItem[] | null | undefined;
  sumDayExtras: (ids: string[]) => { cal: number; pro: number; fiber: number };
  getAssignedExtraIdsForDayLocal: (iso: string, key: string) => string[];
  removeOneSelectedExtraForDay: (id: string, iso: string, key: string) => Promise<void>;
  applyDessertExtraStockDelta: (
    catalogId: string,
    delta: number,
    iso: string,
    key: string,
    opts?: { persistSnapshot?: boolean },
  ) => Promise<{ ok: boolean; snapshots?: FoodItem[][] }>;
  buildDessertExtraSnapshotStoreAfterPush: (
    catalogId: string,
    iso: string,
    key: string,
    snapshots: FoodItem[][],
  ) => Record<string, Record<string, FoodItem[][]>>;
  persistExtraSelectionAndSnapshot: (
    prefKey: string,
    updated: Record<string, string[]>,
    snapshotStore?: Record<string, Record<string, FoodItem[][]>>,
  ) => Promise<void>;
  savedSnapshots: Record<string, PlanningSnapshotEntry>;
  flashedKeys: Record<string, boolean>;
  setFlashedKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  weekOffset: number;
  nextExtraSelections: Record<string, string[]>;
  nextExtraCalories: Record<string, number>;
  nextExtraProteins: Record<string, number>;
  nextExtraFibers: Record<string, number>;
  nextExtraSlotAssignments: Record<string, string[]>;
  jsDayToKey: Record<number, string>;
  selectedExtrasTopByDay: Record<string, string[]>;
  setSelectedExtrasTopByDay: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  selectedExtrasMiddleByDay: Record<string, string[]>;
  setSelectedExtrasMiddleByDay: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  selectedExtrasDropZone: string | null;
  setSelectedExtrasDropZone: React.Dispatch<React.SetStateAction<string | null>>;
  customExtraName: string;
  setCustomExtraName: React.Dispatch<React.SetStateAction<string>>;
  customExtraCal: string;
  setCustomExtraCal: React.Dispatch<React.SetStateAction<string>>;
  customExtraProt: string;
  setCustomExtraProt: React.Dispatch<React.SetStateAction<string>>;
  /** Pref « Masquer calories » : cache les badges flamme et filtre le catalogue. */
  hideDayCalorieTotals: boolean;
  /** Calories restantes du jour (objectif max − total planifié). */
  remainingDayCalories: number;
}

/**
 * Colonne Extra d'un jour (semaine courante) : macros manuelles, popover catalogue, sync 💾.
 */
export function PlanningExtraColumn({
  dayKey: key,
  dayIso: iso,
  dragOverSlot,
  setDragOverSlot,
  draggedSelectedExtraId,
  setDraggedSelectedExtraId,
  setDraggedSelectedExtraOrigin,
  unassignExtraFromAllDaySlots,
  extraCalories,
  extraProteins,
  extraFibers,
  extraSelections,
  extraSlotAssignments,
  setPreference,
  getPreference,
  openExtrasDay,
  setOpenExtrasDay,
  isTouchDevice,
  foodItems,
  testItemIdSet,
  foodSortModes,
  sortDirections,
  extrasDividerAfterId,
  allSingleIngredientDessertExtras,
  singleIngredientDessertExtras,
  singleIngredientDessertById,
  dessertExtraStockSnapshots,
  canAddDessertById,
  dessertPossibleCountById,
  ingredientMacroLibrary,
  sumDayExtras,
  getAssignedExtraIdsForDayLocal,
  removeOneSelectedExtraForDay,
  applyDessertExtraStockDelta,
  buildDessertExtraSnapshotStoreAfterPush,
  persistExtraSelectionAndSnapshot,
  savedSnapshots,
  flashedKeys,
  setFlashedKeys,
  weekOffset,
  nextExtraSelections,
  nextExtraCalories,
  nextExtraProteins,
  nextExtraFibers,
  nextExtraSlotAssignments,
  jsDayToKey: JS_DAY_TO_KEY,
  selectedExtrasTopByDay,
  setSelectedExtrasTopByDay,
  selectedExtrasMiddleByDay,
  setSelectedExtrasMiddleByDay,
  selectedExtrasDropZone,
  setSelectedExtrasDropZone,
  customExtraName,
  setCustomExtraName,
  customExtraCal,
  setCustomExtraCal,
  customExtraProt,
  setCustomExtraProt,
  hideDayCalorieTotals,
  remainingDayCalories,
}: PlanningExtraColumnProps) {
const extraDropKey = `extra-${iso}`;
                  const isExtraDragOver = dragOverSlot === extraDropKey;
                  const unassignedExtraIds = getUnassignedExtraSelectionIds(extraSelections, extraSlotAssignments, iso, key);
                  const unassignedExtraMacros = sumDayExtras(unassignedExtraIds);
                  const hasDisplayableExtraSelections = countDisplayableExtraSelections(
                    extraSelections[iso] || extraSelections[key] || [],
                    foodItems,
                    allSingleIngredientDessertExtras,
                    singleIngredientDessertById,
                    dessertExtraStockSnapshots,
                  ) > 0;
                  return (
                <div
                  className={`min-h-[44px] sm:min-h-[52px] rounded-xl border border-dashed p-1 sm:p-1.5 w-12 sm:w-20 flex flex-col items-center transition-colors ${isExtraDragOver ? "border-orange-400/65 bg-orange-500/8 ring-1 ring-orange-400/25" : "border-orange-300/45 bg-orange-500/3"}`}
                  onDragOver={(e) => {
                    const canAccept = !!(draggedSelectedExtraId || e.dataTransfer.types.includes('text/plain'));
                    if (!canAccept) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverSlot(extraDropKey);
                  }}
                  onDragLeave={() => setDragOverSlot((cur) => (cur === extraDropKey ? null : cur))}
                  onDrop={(e) => {
                    const extraId = draggedSelectedExtraId || e.dataTransfer.getData('text/plain');
                    if (!extraId) return;
                    e.preventDefault();
                    unassignExtraFromAllDaySlots(extraId, iso, key);
                    setDraggedSelectedExtraId(null);
                    setDraggedSelectedExtraOrigin(null);
                    setDragOverSlot(null);
                  }}
                  title="Déposer ici pour remettre l'extra dans la catégorie Extras"
                >
                  <span className="text-[8px] sm:text-[9px] font-semibold text-orange-400/80 uppercase tracking-wide">Extra</span>
                  <div className="flex flex-col items-center gap-0.5 mt-1 w-full">
                    <PlanningInput
                      storageKey={`extra-${iso}`}
                      currentValue={(extraCalories[iso] || 0) + unassignedExtraMacros.cal}
                      onSave={(val) => {
                        const manual = Math.max(0, val - unassignedExtraMacros.cal);
                        const updated = { ...extraCalories };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_calories', value: updated });
                      }}
                      placeholder="kcal"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-orange-300/20 rounded px-1 text-orange-400 placeholder:text-orange-300/20 focus:outline-none focus:border-orange-400/40 text-center"
                    />
                    <PlanningInput
                      storageKey={`extra-prot-${iso}`}
                      currentValue={(extraProteins[iso] || 0) + unassignedExtraMacros.pro}
                      onSave={(val) => {
                        const manual = Math.max(0, val - unassignedExtraMacros.pro);
                        const updated = { ...extraProteins };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_proteins', value: updated });
                      }}
                      placeholder="prot"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-blue-400/20 rounded px-1 text-blue-400 placeholder:text-blue-400/30 focus:outline-none focus:border-blue-400/40 text-center"
                    />
                    <PlanningInput
                      storageKey={`extra-fib-${iso}`}
                      currentValue={(extraFibers[iso] || 0) + unassignedExtraMacros.fiber}
                      onSave={(val) => {
                        const manual = Math.max(0, val - unassignedExtraMacros.fiber);
                        const updated = { ...extraFibers };
                        if (manual > 0) updated[iso] = manual;
                        else { delete updated[iso]; delete updated[key]; }
                        setPreference.mutate({ key: 'planning_extra_fibers', value: updated });
                      }}
                      placeholder="fib"
                      className="w-full h-5 text-[11px] bg-transparent border border-dashed border-emerald-400/20 rounded px-1 text-emerald-400 placeholder:text-emerald-400/30 focus:outline-none focus:border-emerald-400/40 text-center"
                    />
                    <div className="flex items-center gap-1 mt-1">
                      <Popover open={openExtrasDay === (iso || key)} onOpenChange={(open) => {
                        setOpenExtrasDay(open ? (iso || key) : null);
                        if (open) { setCustomExtraName(''); setCustomExtraCal(''); setCustomExtraProt(''); }
                      }}>
                        <PopoverTrigger asChild>
                          <button
                            className={`h-5 w-5 flex items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${hasDisplayableExtraSelections ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'}`}
                            title="Ajouter un Extra"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[min(28rem,calc(100vw-1.5rem))] p-3 bg-card/95 backdrop-blur-md border-orange-200/20 shadow-2xl rounded-2xl max-h-[56vh]"
                          align="center"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                        >
                          {/* Formulaire d'ajout en une ligne — STYLE MODERNISÉ */}
                          <div className="flex items-center gap-1.5 mb-3 pb-3 border-b border-white/5">
                            <input
                              type="text"
                              value={customExtraName}
                              onChange={(e) => setCustomExtraName(e.target.value)}
                              readOnly={isTouchDevice}
                              onFocus={(e) => {
                                if (isTouchDevice) e.currentTarget.readOnly = false;
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && customExtraName.trim() && customExtraCal.trim()) {
                                  const name = customExtraName.trim();
                                  const cal = customExtraCal.trim();
                                  const prot = customExtraProt.trim() || '0';
                                  const customId = `custom::${name}::${cal}::${prot}`;
                                  const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                                  const updated = { ...extraSels };
                                  const current = updated[iso] || [];
                                  if (iso) updated[iso] = [...current, customId]; else updated[key] = [...current, customId];
                                  setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                  setCustomExtraName(''); setCustomExtraCal(''); setCustomExtraProt('');
                                }
                              }}
                              placeholder="Nom"
                              className="flex-1 min-w-0 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-3 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-orange-500/20 transition-all shadow-sm"
                            />
                            <div className="relative group/cal shrink-0">
                              <input
                                type="number"
                                inputMode="decimal"
                                value={customExtraCal}
                                onChange={(e) => setCustomExtraCal(e.target.value)}
                                readOnly={isTouchDevice}
                                onFocus={(e) => {
                                  if (isTouchDevice) e.currentTarget.readOnly = false;
                                }}
                                placeholder="kcal"
                                className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-orange-500 placeholder:text-orange-300/30 focus:outline-none focus:ring-2 focus:ring-orange-500/20 text-center transition-all shadow-sm"
                              />
                            </div>
                            <div className="relative group/prot shrink-0">
                              <input
                                type="number"
                                inputMode="decimal"
                                value={customExtraProt}
                                onChange={(e) => setCustomExtraProt(e.target.value)}
                                readOnly={isTouchDevice}
                                onFocus={(e) => {
                                  if (isTouchDevice) e.currentTarget.readOnly = false;
                                }}
                                placeholder="prot"
                                className="w-14 h-8 text-[11px] bg-muted/40 border border-white/5 rounded-full px-1 text-blue-400 placeholder:text-blue-400/20 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-center transition-all shadow-sm"
                              />
                            </div>
                            <button
                              onClick={() => {
                                const name = customExtraName.trim();
                                const cal = customExtraCal.trim();
                                if (!name || !cal) return;
                                const prot = customExtraProt.trim() || '0';
                                const customId = `custom::${name}::${cal}::${prot}`;
                                const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                                const updated = { ...extraSels };
                                const current = updated[iso] || [];
                                if (iso) updated[iso] = [...current, customId]; else updated[key] = [...current, customId];
                                setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                setCustomExtraName(''); setCustomExtraCal(''); setCustomExtraProt('');
                              }}
                              disabled={!customExtraName.trim() || !customExtraCal.trim()}
                              className="h-8 w-8 shrink-0 flex items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-orange-600 hover:from-orange-500 hover:to-orange-700 disabled:opacity-30 text-white shadow-lg shadow-orange-500/20 transition-all hover:scale-110 active:scale-95"
                              title="Valider"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                          </div>

                          <div className="space-y-1.5 max-h-[46vh] overflow-y-auto pr-1 custom-scrollbar">
                            {/* Aliments extras normaux — au-dessus du trait : rentrent dans les kcal restantes du jour */}
                            {(() => {
                              const sectionItems = foodItems.filter(fi => fi.storage_type === 'extras' && !testItemIdSet.has(fi.id));
                              const sortedExtras = getSortedFoodItems(
                                sectionItems,
                                foodSortModes['extras'] || "manual",
                                sortDirections['food-extras'] !== false
                              );
                              if (sortedExtras.length === 0) return (
                                <div className="text-center py-3 bg-muted/20 rounded-xl">
                                  <p className="text-[10px] text-muted-foreground italic">Aucun aliment "Extra"</p>
                                  <p className="text-[9px] text-muted-foreground/60 mt-1">Ajoutez-les dans l'onglet Aliments</p>
                                </div>
                              );
                              const extraSels = getPreference<Record<string, string[]>>('planning_extra_selections', {});
                              const currentIds = extraSels[iso] || [];
                              const assignedIds = new Set(getAssignedExtraIdsForDayLocal(iso, key));
                              const daySlotKey = iso || key;
                              const unselectedDessertExtras = singleIngredientDessertExtras.filter((d) =>
                                !isDessertExtraInSelections(currentIds, d, allSingleIngredientDessertExtras, singleIngredientDessertById),
                              );
                              // Sous « Masquer calories » : n'afficher que les extras ≤ calories restantes du jour.
                              const catalogDessertExtras = hideDayCalorieTotals
                                ? unselectedDessertExtras.filter((d) =>
                                    extraFitsRemainingCalories(d.cal, remainingDayCalories),
                                  )
                                : unselectedDessertExtras;

                              // Réordonne les extras sélectionnés (standards + custom) en conservant les quantités.
                              const reorderSelectedExtras = (sourceId: string, targetId: string) => {
                                if (!sourceId || !targetId || sourceId === targetId) return;
                                const idsForDay = [...currentIds];
                                const order = Array.from(new Set(idsForDay.filter((id) => !assignedIds.has(id))));
                                const from = order.indexOf(sourceId);
                                const to = order.indexOf(targetId);
                                if (from < 0 || to < 0) return;
                                const nextOrder = [...order];
                                const [moved] = nextOrder.splice(from, 1);
                                nextOrder.splice(to, 0, moved);

                                const counts = new Map<string, number>();
                                for (const id of idsForDay) counts.set(id, (counts.get(id) ?? 0) + 1);
                                const hiddenAssignedIds = idsForDay.filter((id) => assignedIds.has(id));
                                const rebuilt: string[] = [];
                                for (const id of nextOrder) {
                                  const count = counts.get(id) ?? 0;
                                  for (let i = 0; i < count; i++) rebuilt.push(id);
                                }
                                rebuilt.push(...hiddenAssignedIds);

                                const updated = { ...extraSels };
                                if (iso) updated[iso] = rebuilt;
                                else updated[key] = rebuilt;
                                setPreference.mutate({ key: "planning_extra_selections", value: updated });
                              };

                              // Bascule un extra sélectionné dans le compartiment du dessus (au-dessus du trait).
                              const moveSelectedExtraToTopSection = (id: string) => {
                                setSelectedExtrasTopByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: [...cur, id] };
                                });
                                setSelectedExtrasMiddleByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                              };

                              // Place un extra dans le compartiment du milieu (entre les deux traits).
                              const moveSelectedExtraToMiddleSection = (id: string) => {
                                setSelectedExtrasMiddleByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: [...cur, id] };
                                });
                                setSelectedExtrasTopByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                              };

                              // Retire un extra des compartiments supérieurs pour le remettre dessous.
                              const moveSelectedExtraToBottomSection = (id: string) => {
                                setSelectedExtrasTopByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                                setSelectedExtrasMiddleByDay((prev) => {
                                  const cur = prev[daySlotKey] || [];
                                  if (!cur.includes(id)) return prev;
                                  return { ...prev, [daySlotKey]: cur.filter((x) => x !== id) };
                                });
                              };

                              const extrasById = new Map(sortedExtras.map((fi) => [fi.id, fi]));
                              const selectedOrderedIds = Array.from(
                                new Set(currentIds.filter((id) => !assignedIds.has(id)))
                              );
                              const topIds = selectedExtrasTopByDay[daySlotKey] || [];
                              const middleIds = selectedExtrasMiddleByDay[daySlotKey] || [];
                              const selectedTopIds = selectedOrderedIds.filter((id) => topIds.includes(id));
                              const selectedMiddleIds = selectedOrderedIds.filter((id) => !topIds.includes(id) && middleIds.includes(id));
                              const selectedBottomIds = selectedOrderedIds.filter((id) => !topIds.includes(id) && !middleIds.includes(id));
                              const others = sortedExtras.filter(fi => !currentIds.includes(fi.id) && !assignedIds.has(fi.id));
                              const { above: catalogAbove } = splitSortedExtrasByDivider(
                                sortedExtras,
                                extrasDividerAfterId,
                              );
                              const aboveIds = new Set(catalogAbove.map((fi) => fi.id));
                              const othersAboveRaw = others.filter((fi) => aboveIds.has(fi.id));
                              const othersAbove = hideDayCalorieTotals
                                ? othersAboveRaw.filter((fi) =>
                                    extraFitsRemainingCalories(
                                      resolvePlanningExtraFoodMacros(fi, ingredientMacroLibrary).cal,
                                      remainingDayCalories,
                                    ),
                                  )
                                : othersAboveRaw;
                              const catalogHasUnfilteredItems =
                                othersAboveRaw.length > 0 || unselectedDessertExtras.length > 0;
                              const catalogFilteredEmpty =
                                hideDayCalorieTotals &&
                                catalogHasUnfilteredItems &&
                                othersAbove.length === 0 &&
                                catalogDessertExtras.length === 0;
                              // Rend un extra sélectionné (normal ou custom) avec drag & drop, compte et macros.
                              /** Rend une ligne d'extra sélectionné avec une clé stable par section pour accepter les doublons. */
                              const renderSelectedRowById = (id: string, selectedSection: "top" | "middle" | "bottom", occurrenceIndex: number) => {
                                const c = parseCustomExtraId(id);
                                const catalogId = resolveDessertCatalogId(
                                  id,
                                  allSingleIngredientDessertExtras,
                                  singleIngredientDessertById,
                                  dessertExtraStockSnapshots,
                                ) ?? id;
                                const dessertExtra = singleIngredientDessertById.get(catalogId);
                                const fi = c ? null : (extrasById.get(id) ?? (dessertExtra ? foodItems.find((f) => f.id === parseFoodDessertExtraId(id)) : undefined));
                                if (!c && !fi && !dessertExtra) return null;
                                const isDessertExtra = !!dessertExtra;
                                const canAddDessert = !isDessertExtra || canAddDessertById.get(catalogId) === true;
                                // Quantité assignée (= chiffre du stepper − / N / +).
                                const assignedCount = currentIds.filter((cid) => cid === id).length;
                                const label = c ? c.name : (dessertExtra?.name ?? fi?.name ?? id);
                                const portionMacros = dessertExtra
                                  ? { cal: dessertExtra.cal, pro: dessertExtra.prot, fiber: dessertExtra.fiber }
                                  : (fi ? resolvePlanningExtraFoodMacros(fi, ingredientMacroLibrary) : { cal: 0, pro: 0, fiber: 0 });
                                const prot = c ? c.prot : portionMacros.pro;
                                const cal = c ? c.cal : portionMacros.cal;
                                const fiber = c ? (dessertExtra?.fiber ?? 0) : portionMacros.fiber;
                                const dessertDisplayQty = dessertExtra
                                  ? extractExtraDisplayQuantity(dessertExtra.mealPayload, foodItems)
                                  : null;
                                // Sous-titre sélection : grammes unitaires + quantité assignée (#N = stepper).
                                const selectedQtySubtitle = c
                                  ? ""
                                  : formatExtraQuantitySubtitle(
                                      isDessertExtra ? dessertDisplayQty?.grams : fi?.grams,
                                      assignedCount,
                                    );
                                return (
                                  <div
                                    key={`${selectedSection}-${id}-${occurrenceIndex}`}
                                    draggable
                                    onDragStart={(e) => {
                                      setDraggedSelectedExtraId(id);
                                      setDraggedSelectedExtraOrigin({ iso, key });
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", id);
                                    }}
                                    onDragOver={(e) => {
                                      if (!draggedSelectedExtraId || draggedSelectedExtraId === id) return;
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                      reorderSelectedExtras(sourceId, id);
                                      if (selectedSection === "top") moveSelectedExtraToTopSection(sourceId);
                                      else if (selectedSection === "middle") moveSelectedExtraToMiddleSection(sourceId);
                                      else moveSelectedExtraToBottomSection(sourceId);
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                      setSelectedExtrasDropZone(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                      setSelectedExtrasDropZone(null);
                                    }}
                                    className="w-full my-1 p-2.5 rounded-2xl border transition-all group flex items-start gap-3 bg-orange-500/10 border-orange-500/20 shadow-sm backdrop-blur-sm cursor-grab active:cursor-grabbing hover:bg-orange-500/20"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[11px] font-black transition-colors break-words leading-snug text-orange-600">{label}</p>
                                      {selectedQtySubtitle && (
                                        <p className="text-[9px] text-muted-foreground/50 font-medium mt-0.5">{selectedQtySubtitle}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        onClick={async () => {
                                          try {
                                            await removeOneSelectedExtraForDay(id, iso, key);
                                          } catch (e) {
                                            toast({
                                              title: "Stock non modifié",
                                              description: "Impossible de retirer cette occurrence.",
                                              variant: "destructive",
                                            });
                                          }
                                        }}
                                        className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold"
                                        title="Désélectionner cet extra"
                                      >−</button>
                                      <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{assignedCount}</span>
                                      {canAddDessert && (
                                        <button
                                          onClick={async () => {
                                            if (isDessertExtra) {
                                              try {
                                                let snapshotStore: Record<string, Record<string, FoodItem[][]>> | undefined;
                                                const { ok, snapshots } = await applyDessertExtraStockDelta(catalogId, 1, iso, key, { persistSnapshot: false });
                                                if (!ok) {
                                                  toast({
                                                    title: "Stock insuffisant",
                                                    description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                    variant: "destructive",
                                                  });
                                                  return;
                                                }
                                                if (snapshots?.length) {
                                                  snapshotStore = buildDessertExtraSnapshotStoreAfterPush(catalogId, iso, key, snapshots);
                                                }
                                                const updated = { ...extraSels };
                                                const current = updated[iso] || [];
                                                if (iso) updated[iso] = [...current, id]; else updated[key] = [...current, id];
                                                await persistExtraSelectionAndSnapshot('planning_extra_selections', updated, snapshotStore);
                                                return;
                                              } catch (e) {
                                                toast({
                                                  title: "Stock insuffisant",
                                                  description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                  variant: "destructive",
                                                });
                                                return;
                                              }
                                            }
                                            const updated = { ...extraSels };
                                            const current = updated[iso] || [];
                                            if (iso) updated[iso] = [...current, id]; else updated[key] = [...current, id];
                                            setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                          }}
                                          className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 text-xs font-bold"
                                          title="Ajouter un"
                                        >+</button>
                                      )}
                                      {prot > 0 && (
                                        <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-blue-500 border border-blue-500/20">
                                          🍗 {prot}
                                        </div>
                                      )}
                                      {fiber > 0 && (
                                        <div className="flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-emerald-500 border border-emerald-500/20">
                                          <Wheat className="w-2.5 h-2.5" />{Math.round(fiber)}
                                        </div>
                                      )}
                                      {!hideDayCalorieTotals && (
                                        <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-orange-500 border border-orange-500/20">
                                          <Flame className="w-2.5 h-2.5" />{cal}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              };
                              const renderRow = (fi: FoodItem, selectedSection: "top" | "bottom" | null = null) => {
                                const assignedCount = currentIds.filter(id => id === fi.id).length;
                                const perOccurrence = resolvePlanningExtraFoodMacros(fi, ingredientMacroLibrary);
                                const macros = scaleExtraDisplayMacrosByCount(perOccurrence, assignedCount > 0 ? assignedCount : 1);
                                // Catalogue : #N / ∞ = reste dispo ; si déjà pris, #N = quantité assignée.
                                const qtySubtitle = formatExtraQuantitySubtitle(
                                  fi.grams,
                                  assignedCount > 0
                                    ? assignedCount
                                    : resolveExtraFoodRemainingCount(fi),
                                );
                                return (
                                  <div
                                    key={fi.id}
                                    draggable={selectedSection !== null}
                                    onDragStart={(e) => {
                                      if (!selectedSection) return;
                                      setDraggedSelectedExtraId(fi.id);
                                      setDraggedSelectedExtraOrigin({ iso, key });
                                      e.dataTransfer.effectAllowed = "move";
                                      e.dataTransfer.setData("text/plain", fi.id);
                                    }}
                                    onDragOver={(e) => {
                                      if (!selectedSection || !draggedSelectedExtraId || draggedSelectedExtraId === fi.id) return;
                                      e.preventDefault();
                                      e.dataTransfer.dropEffect = "move";
                                    }}
                                    onDrop={(e) => {
                                      if (!selectedSection) return;
                                      e.preventDefault();
                                      const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                      reorderSelectedExtras(sourceId, fi.id);
                                      if (selectedSection === "top") moveSelectedExtraToTopSection(sourceId);
                                      else moveSelectedExtraToBottomSection(sourceId);
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                    }}
                                    onDragEnd={() => {
                                      setDraggedSelectedExtraId(null);
                                      setDraggedSelectedExtraOrigin(null);
                                    }}
                                    className={`w-full my-0.5 p-2.5 rounded-2xl border transition-all group flex items-start gap-3 ${assignedCount > 0 ? 'bg-orange-500/10 border-orange-500/20 shadow-sm backdrop-blur-sm' : 'bg-muted/20 hover:bg-orange-500/5 border-transparent'} ${selectedSection ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-[11px] font-black transition-colors break-words leading-snug ${assignedCount > 0 ? 'text-orange-600' : 'text-foreground group-hover:text-orange-600'}`}>{fi.name}</p>
                                      {qtySubtitle && (
                                        <p className="text-[9px] text-muted-foreground/50 font-medium">{qtySubtitle}</p>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {assignedCount > 0 && (
                                        <>
                                          <button
                                            onClick={async () => {
                                              try {
                                                await removeOneSelectedExtraForDay(fi.id, iso, key);
                                              } catch (e) {
                                                toast({
                                                  title: "Stock non modifié",
                                                  description: "Impossible de retirer cette occurrence.",
                                                  variant: "destructive",
                                                });
                                              }
                                            }}
                                            className="h-5 w-5 flex items-center justify-center rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 text-xs font-bold"
                                            title="Désélectionner cet extra"
                                          >−</button>
                                          <span className="text-[10px] font-black text-orange-500 min-w-[14px] text-center">{assignedCount}</span>
                                        </>
                                      )}
                                      <button
                                        onClick={() => {
                                          const updated = { ...extraSels };
                                          const current = updated[iso] || [];
                                          if (iso) updated[iso] = [...current, fi.id]; else updated[key] = [...current, fi.id];
                                          setPreference.mutate({ key: 'planning_extra_selections', value: updated });
                                        }}
                                        className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 text-xs font-bold"
                                        title="Ajouter un"
                                      >+</button>
                                      {macros.pro > 0 && (
                                        <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-blue-500 border border-blue-500/20">
                                          🍗 {macros.pro}
                                        </div>
                                      )}
                                      {macros.fiber > 0 && (
                                        <div className="flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-emerald-500 border border-emerald-500/20">
                                          <Wheat className="w-2.5 h-2.5" />{macros.fiber}
                                        </div>
                                      )}
                                      {!hideDayCalorieTotals && macros.cal > 0 && (
                                        <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-orange-500 border border-orange-500/20">
                                          <Flame className="w-2.5 h-2.5" />{macros.cal}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              };
                              return (
                                <>
                                  {selectedOrderedIds.length > 0 && (
                                    <>
                                      <p className="text-[9px] font-semibold text-orange-500 px-1 pb-1">Extras sélectionnés</p>
                                      {selectedTopIds.map((id, index) => renderSelectedRowById(id, "top", index))}
                                      <div
                                        onDragOver={(e) => {
                                          if (!draggedSelectedExtraId) return;
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setSelectedExtrasDropZone(`${daySlotKey}:top`);
                                        }}
                                        onDragLeave={() => setSelectedExtrasDropZone((cur) => (cur === `${daySlotKey}:top` ? null : cur))}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                          if (sourceId) moveSelectedExtraToTopSection(sourceId);
                                          setDraggedSelectedExtraId(null);
                                          setDraggedSelectedExtraOrigin(null);
                                          setSelectedExtrasDropZone(null);
                                        }}
                                        className="relative my-0.5 h-1"
                                        title="Dépose ici pour placer l'extra au-dessus du trait"
                                      >
                                        <Separator className={`absolute top-1/2 -translate-y-1/2 ${selectedExtrasDropZone === `${daySlotKey}:top` ? 'opacity-90 bg-orange-400' : 'opacity-35'}`} />
                                      </div>
                                      <div
                                        onDragOver={(e) => {
                                          if (!draggedSelectedExtraId) return;
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setSelectedExtrasDropZone(`${daySlotKey}:middle`);
                                        }}
                                        onDragLeave={() => setSelectedExtrasDropZone((cur) => (cur === `${daySlotKey}:middle` ? null : cur))}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                          if (sourceId) moveSelectedExtraToMiddleSection(sourceId);
                                          setDraggedSelectedExtraId(null);
                                          setDraggedSelectedExtraOrigin(null);
                                          setSelectedExtrasDropZone(null);
                                        }}
                                        className={`rounded-sm transition-all ${draggedSelectedExtraId ? 'my-0.5 min-h-6' : 'my-0 min-h-0'} ${selectedExtrasDropZone === `${daySlotKey}:middle` ? 'bg-orange-500/10 ring-1 ring-orange-400/35' : ''}`}
                                        title="Dépose ici pour placer l'extra entre les deux traits"
                                      >
                                        {selectedMiddleIds.map((id, index) => renderSelectedRowById(id, "middle", index))}
                                      </div>
                                      <Separator
                                        className={`${draggedSelectedExtraId && selectedExtrasDropZone === `${daySlotKey}:bottom` ? 'my-0.5 bg-orange-400 opacity-90' : draggedSelectedExtraId ? 'my-0.5' : 'my-px opacity-60'}`}
                                        onDragOver={(e) => {
                                          if (!draggedSelectedExtraId) return;
                                          e.preventDefault();
                                          e.dataTransfer.dropEffect = "move";
                                          setSelectedExtrasDropZone(`${daySlotKey}:bottom`);
                                        }}
                                        onDragLeave={() => setSelectedExtrasDropZone((cur) => (cur === `${daySlotKey}:bottom` ? null : cur))}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          const sourceId = draggedSelectedExtraId || e.dataTransfer.getData("text/plain");
                                          if (sourceId) moveSelectedExtraToBottomSection(sourceId);
                                          setDraggedSelectedExtraId(null);
                                          setDraggedSelectedExtraOrigin(null);
                                          setSelectedExtrasDropZone(null);
                                        }}
                                      />
                                      {selectedBottomIds.map((id, index) => renderSelectedRowById(id, "bottom", index))}
                                    </>
                                  )}
                                  {((!hideDayCalorieTotals && (allSingleIngredientDessertExtras.some((d) => currentIds.includes(d.id)) || singleIngredientDessertExtras.length > 0))
                                    || catalogDessertExtras.length > 0) && (
                                    <>
                                      <Separator className="my-2 opacity-50" />
                                      <p className="text-[9px] font-semibold text-orange-500 px-1 pb-1">Desserts & Shakers</p>
                                      {catalogDessertExtras.map((d, index) => {
                                        // Catalogue : #N = reste disponible après ce qui est déjà pris ailleurs.
                                        const remainingCount = dessertPossibleCountById.get(d.id) ?? 0;
                                        return (
                                        <div key={`unselected-dessert-${d.id}-${index}`} className="w-full my-0.5 p-2.5 rounded-2xl border transition-all group flex items-start gap-3 bg-muted/20 hover:bg-orange-500/5 border-transparent">
                                          <div className="flex-1 min-w-0">
                                            <p className="text-[11px] font-black transition-colors break-words leading-snug text-foreground group-hover:text-orange-600">{d.name}</p>
                                            <p className="text-[9px] text-muted-foreground/50 font-medium">
                                              {formatExtraRemainingCountLabel(remainingCount)}
                                            </p>
                                          </div>
                                          <div className="flex items-center gap-1.5 shrink-0">
                                            <button onClick={async () => {
                                              try {
                                                let snapshotStore: Record<string, Record<string, FoodItem[][]>> | undefined;
                                                const { ok, snapshots } = await applyDessertExtraStockDelta(d.id, 1, iso, key, { persistSnapshot: false });
                                                if (!ok) {
                                                  toast({
                                                    title: "Stock insuffisant",
                                                    description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                    variant: "destructive",
                                                  });
                                                  return;
                                                }
                                                if (snapshots?.length) {
                                                  snapshotStore = buildDessertExtraSnapshotStoreAfterPush(d.id, iso, key, snapshots);
                                                }
                                                const updated = { ...extraSels };
                                                const current = updated[iso] || [];
                                                if (iso) updated[iso] = [...current, d.id]; else updated[key] = [...current, d.id];
                                                await persistExtraSelectionAndSnapshot('planning_extra_selections', updated, snapshotStore);
                                              } catch (e) {
                                                toast({
                                                  title: "Stock insuffisant",
                                                  description: "Le dessert n'a pas pu être ajouté car l'aliment n'est plus disponible.",
                                                  variant: "destructive",
                                                });
                                              }
                                            }} className="h-5 w-5 flex items-center justify-center rounded-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-500 text-xs font-bold" title="Ajouter un">+</button>
                                            {d.prot > 0 && <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-blue-500 border border-blue-500/20">🍗 {Math.round(d.prot)}</div>}
                                            {d.fiber > 0 && <div className="flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-emerald-500 border border-emerald-500/20"><Wheat className="w-2.5 h-2.5" />{Math.round(d.fiber)}</div>}
                                            {!hideDayCalorieTotals && (
                                              <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-0.5 rounded-full text-[9px] font-black text-orange-500 border border-orange-500/20"><Flame className="w-2.5 h-2.5" />{Math.round(d.cal)}</div>
                                            )}
                                          </div>
                                        </div>
                                        );
                                      })}
                                      <Separator className="my-2 opacity-50" />
                                    </>
                                  )}
                                  {othersAbove.map((fi) => renderRow(fi))}
                                  {catalogFilteredEmpty && (
                                    <p className="text-[10px] text-muted-foreground/70 italic text-center py-2">
                                      Aucun extra dans le budget restant
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <button
                        onClick={() => {
                          const snapKey = `extra-${iso}`;
                          // Utiliser l'état React courant (source de vérité instantanée) pour éviter
                          // de relire une préférence potentiellement en retard juste après un clic +/−.
                          const currentIds = extraSelections[iso] || [];
                          const cal = (iso && extraCalories[iso]) || 0;
                          const prot = (iso && extraProteins[iso]) || 0;
                          const fiber = (iso && extraFibers[iso]) || 0;
                          const itemIds = currentIds;
                          const updated = { ...savedSnapshots, [snapKey]: { cal, prot, fiber, savedAt: Date.now(), itemIds } };
                          setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                          // Synchronisation unidirectionnelle vers la semaine prochaine (Actuelle -> Suivante)
                          // Propager via la clé "jour" (lundi/mardi/...) pour que la semaine suivante,
                          // qui a une autre date ISO, récupère bien le visuel des saves.
                          if (weekOffset === 0) {
                            const nxtSel = { ...nextExtraSelections };
                            nxtSel[key] = [...itemIds];
                            setPreference.mutate({ key: 'next_week_extra_selections', value: nxtSel });

                            const nxtCal = { ...nextExtraCalories };
                            if (cal > 0) {
                              nxtCal[key] = cal;
                            } else {
                              delete nxtCal[key];
                            }
                            setPreference.mutate({ key: 'next_week_extra_calories', value: nxtCal });

                            const nxtPro = { ...nextExtraProteins };
                            if (prot > 0) {
                              nxtPro[key] = prot;
                            } else {
                              delete nxtPro[key];
                            }
                            setPreference.mutate({ key: 'next_week_extra_proteins', value: nxtPro });

                            const nxtFiber = { ...nextExtraFibers };
                            if (fiber > 0) {
                              nxtFiber[key] = fiber;
                            } else {
                              delete nxtFiber[key];
                            }
                            setPreference.mutate({ key: 'next_week_extra_fibers', value: nxtFiber });
                          }

                          setFlashedKeys(prev => ({ ...prev, [snapKey]: true }));
                          setTimeout(() => setFlashedKeys(prev => ({ ...prev, [snapKey]: false })), 1200);
                        }}
                        onDoubleClick={() => {
                          const snapKey = `extra-${iso}`;
                          const updated = clearExtraSnapshotsForWeekday(savedSnapshots, iso, key, JS_DAY_TO_KEY);
                          setPreference.mutate({ key: 'planning_saved_snapshots', value: updated });

                          // Semaine suivante : état vide explicite (évite le repli sur d’anciens snapshots extra-YYYY-MM-DD).
                          if (weekOffset === 0) {
                            const cleared = clearNextWeekExtraStateForDay(
                              nextExtraSelections,
                              nextExtraCalories,
                              nextExtraProteins,
                              nextExtraFibers,
                              iso,
                              key,
                            );
                            setPreference.mutate({ key: 'next_week_extra_selections', value: cleared.selections });
                            setPreference.mutate({ key: 'next_week_extra_calories', value: cleared.calories });
                            setPreference.mutate({ key: 'next_week_extra_proteins', value: cleared.proteins });
                            setPreference.mutate({ key: 'next_week_extra_fibers', value: cleared.fibers });
                            const clearedAssignments = { ...nextExtraSlotAssignments };
                            for (const s of EXTRA_DAY_SLOTS) {
                              delete clearedAssignments[`${iso}-${s}`];
                              delete clearedAssignments[`${key}-${s}`];
                            }
                            setPreference.mutate({ key: 'next_week_extra_slot_assignments', value: clearedAssignments });
                          }
                        }}
                        className={`h-5 w-5 text-[9px] rounded font-semibold shrink-0 transition-colors flex items-center justify-center ${flashedKeys[`extra-${iso}`]
                          ? 'bg-green-500/30 text-green-400 border border-green-400/50'
                          : savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`]
                            ? 'bg-primary/20 text-primary border border-primary/40'
                            : 'bg-muted/40 text-muted-foreground/40 hover:text-muted-foreground/60 border border-transparent'
                          }`}
                        title={(() => {
                          const snap = savedSnapshots[`extra-${iso}`] || savedSnapshots[`extra-${key}`];
                          return formatPlanningSnapshotTitle(snap, { itemCount: snap?.itemIds?.length || 0 });
                        })()}
                      >💾</button>
                    </div>
                  </div>
                </div>
                  );
}

