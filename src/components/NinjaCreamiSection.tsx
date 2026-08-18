/**
 * Section « Ninja Creami » (onglet Desserts) :
 * Recettes testées (comme Tous) + encadré Tests (Base / Extras → Possible).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Drumstick,
  Flame,
  Hash,
  List,
  Plus,
  Scale,
  Sparkles,
  Star,
  Wheat,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MealList } from "@/components/MealList";
import { MealCard } from "@/components/MealCard";
import { AutoGrowDescriptionTextarea } from "@/components/AutoGrowDescriptionTextarea";
import { NinjaCreamiBaseGroupsEditor } from "@/components/NinjaCreamiBaseGroupsEditor";
import { NinjaCreamiSelectableIngredientList } from "@/components/NinjaCreamiSelectableIngredientList";
import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import {
  buildStockMap,
  buildFoodItemIndex,
  findStockKey,
  getMissingIngredients,
  analyzeMealIngredients,
  formatExpirationLabel,
} from "@/lib/stockUtils";
import { isToday } from "date-fns";
import {
  flattenNinjaCreamiBaseGroups,
  formatNinjaCreamiTotalsForMeal,
  isNinjaCreamiLineSelectable,
  moveNinjaCreamiCatalogLine,
  NINJA_CREAMI_EXTRAS_GROUP_ID,
  serializeSelectedNinjaCreamiIngredients,
  sumSelectedNinjaCreamiMacros,
  type NinjaCreamiBaseGroup,
  type NinjaCreamiCatalogLine,
  type NinjaCreamiLineDragPayload,
} from "@/domain/ninjaCreami/ninjaCreami";
import { normalizeForMatch } from "@/lib/ingredientUtils";
import {
  sortMealsByMasterMode,
  type MasterSortMode,
} from "@/lib/mealListSort";

/** Clé de préférence pour le tri « Recettes testées » (même cycle que Tous). */
export { NINJA_CREAMI_TESTED_SORT_KEY } from "@/domain/ninjaCreami/ninjaCreami";

/**
 * Champ description éditable dans l’aperçu Recettes testées.
 * Sauvegarde au blur pour garder le curseur fluide pendant la frappe.
 */
function TestedOverviewDescriptionField({
  mealId,
  savedValue,
  onSave,
}: {
  mealId: string;
  savedValue: string;
  onSave: (id: string, description: string | null) => void;
}) {
  const [draft, setDraft] = useState(savedValue);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(savedValue);
  }, [savedValue]);

  /** Persiste la description si elle a vraiment changé. */
  const commit = () => {
    const next = draft.trim() ? draft : null;
    const prev = savedValue.trim() ? savedValue : null;
    if (next === prev) return;
    onSave(mealId, next);
  };

  return (
    <AutoGrowDescriptionTextarea
      value={draft}
      onChange={setDraft}
      autoFocus={false}
      minHeightPx={24}
      maxViewportRatio={0.28}
      rows={1}
      placeholder="Cliquer pour écrire une description…"
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      className="block min-h-0 max-h-[30vh] resize-none border-transparent bg-transparent px-0 py-0.5 text-sm leading-normal focus-visible:ring-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    />
  );
}

export interface NinjaCreamiSectionProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Repli de la sous-liste « Recettes testées ». */
  testedCollapsed?: boolean;
  onToggleTestedCollapse?: () => void;
  /** Repli de l’encadré « Tests ». */
  testsCollapsed?: boolean;
  onToggleTestsCollapse?: () => void;
  testedMeals: Meal[];
  foodItems: FoodItem[];
  baseGroups: NinjaCreamiBaseGroup[];
  extrasLines: NinjaCreamiCatalogLine[];
  onBaseGroupsChange: (groups: NinjaCreamiBaseGroup[]) => void;
  onExtrasLinesChange: (lines: NinjaCreamiCatalogLine[]) => void;
  onIngredientNameCommit: (line: NinjaCreamiCatalogLine) => void;
  ingredientMacroAutofillSources?: IngredientMacroAutofillSources;
  /** Mode de tri (mêmes options que « Tous »). */
  testedSortMode?: MasterSortMode;
  /** Sens du tri numérique (calories / protéines / note / satiété). */
  testedSortAsc?: boolean;
  /** Cycle le mode de tri Recettes testées. */
  onToggleTestedSort?: () => void;
  /** Inverse croissant / décroissant. */
  onToggleTestedSortDirection?: () => void;
  onAddTestedRecipe: () => void;
  onMoveToPossible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onUpdateCalories: (id: string, cal: string | null) => void;
  onUpdateProtein: (id: string, prot: string | null) => void;
  onUpdateFiber: (id: string, fiber: string | null) => void;
  onUpdateGrams: (id: string, g: string | null) => void;
  onUpdateIngredients: (id: string, ing: string | null) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateOvenTemp: (id: string, t: string | null) => void;
  onUpdateOvenMinutes: (id: string, m: string | null) => void;
  onUpdateDescription: (id: string, description: string | null) => void;
  /** Crée une carte Possible depuis la sélection Tests. */
  onCreateFromTests: (payload: {
    name: string;
    ingredients: string;
    calories: string;
    protein: string;
    fiber: string;
  }) => void;
  createBusy?: boolean;
}

/**
 * Bloc collapsible Ninja Creami : recettes testées + Tests sélectionnables.
 */
export function NinjaCreamiSection({
  collapsed,
  onToggleCollapse,
  testedCollapsed = false,
  onToggleTestedCollapse,
  testsCollapsed = false,
  onToggleTestsCollapse,
  testedMeals,
  foodItems,
  baseGroups,
  extrasLines,
  onBaseGroupsChange,
  onExtrasLinesChange,
  onIngredientNameCommit,
  ingredientMacroAutofillSources,
  testedSortMode = "manual",
  testedSortAsc = true,
  onToggleTestedSort,
  onToggleTestedSortDirection,
  onAddTestedRecipe,
  onMoveToPossible,
  onRename,
  onDelete,
  onUpdateCalories,
  onUpdateProtein,
  onUpdateFiber,
  onUpdateGrams,
  onUpdateIngredients,
  onToggleFavorite,
  onUpdateOvenTemp,
  onUpdateOvenMinutes,
  onUpdateDescription,
  onCreateFromTests,
  createBusy = false,
}: NinjaCreamiSectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  /** Aperçu tableau cartes + descriptions (double-clic sur Recettes testées). */
  const [testedOverviewOpen, setTestedOverviewOpen] = useState(false);
  /** Champ nom à la création : curseur placé après « Pot # ». */
  const createNameInputRef = useRef<HTMLInputElement>(null);

  const stockMap = useMemo(() => buildStockMap(foodItems), [foodItems]);
  const foodItemIndex = useMemo(() => buildFoodItemIndex(foodItems), [foodItems]);
  /** Suggestions autocomplete : aliments + Macro ingrédients. */
  const ingredientSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (name: string | undefined | null) => {
      const t = (name ?? "").trim();
      if (!t) return;
      const key = normalizeForMatch(t);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    for (const item of foodItems) add(item.name);
    for (const entry of ingredientMacroAutofillSources?.macroLibrary ?? []) {
      add(entry.displayName);
    }
    return out;
  }, [foodItems, ingredientMacroAutofillSources]);

  /**
   * Indique si un ingrédient a encore du stock (pour le tri par note).
   */
  const isIngredientAvailable = (name: string) => {
    const key = findStockKey(stockMap, name);
    if (!key) return false;
    const stock = stockMap.get(key);
    if (!stock) return false;
    return stock.infinite || stock.grams > 0 || stock.count > 0;
  };

  /** Recettes testées triées comme « Tous ». */
  const sortedTestedMeals = useMemo(
    () =>
      sortMealsByMasterMode(testedMeals, testedSortMode, {
        ascending: testedSortAsc,
        isIngredientAvailable,
        satietySources: ingredientMacroAutofillSources,
      }),
    // isIngredientAvailable dépend de stockMap ; on reclasse quand stock / mode changent.
    [testedMeals, testedSortMode, testedSortAsc, stockMap, ingredientMacroAutofillSources],
  );

  const SortIcon =
    testedSortMode === "calories"
      ? Flame
      : testedSortMode === "protein"
        ? Drumstick
        : testedSortMode === "note"
          ? Hash
          : testedSortMode === "satiety"
            ? Scale
            : testedSortMode === "favorites"
              ? Star
              : testedSortMode === "ingredients"
                ? List
                : ArrowUpDown;
  const sortLabel =
    testedSortMode === "calories"
      ? "Calories"
      : testedSortMode === "protein"
        ? "Protéines"
        : testedSortMode === "note"
          ? "Note"
          : testedSortMode === "satiety"
            ? "Satiété"
            : testedSortMode === "favorites"
              ? "Favoris"
              : testedSortMode === "ingredients"
                ? "Ingrédients"
                : "Manuel";
  const isNumericSort =
    testedSortMode === "calories" ||
    testedSortMode === "protein" ||
    testedSortMode === "note" ||
    testedSortMode === "satiety";

  const baseLines = useMemo(() => flattenNinjaCreamiBaseGroups(baseGroups), [baseGroups]);

  /** Totaux à partir des macros saisies / autofill exact au blur (pas de fuzzy). */
  const selectedTotals = useMemo(
    () => sumSelectedNinjaCreamiMacros([...baseLines, ...extrasLines], selectedIds),
    [baseLines, extrasLines, selectedIds],
  );

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const line of [...baseLines, ...extrasLines]) {
      if (selectedIds.has(line.id) && isNinjaCreamiLineSelectable(line)) n += 1;
    }
    return n;
  }, [baseLines, extrasLines, selectedIds]);

  /**
   * Déplace une ligne Tests entre sous-catégories Base et/ou Extras.
   */
  const handleMoveCatalogLine = (
    toGroupId: string,
    payload: NinjaCreamiLineDragPayload,
    targetIdx: number,
  ) => {
    const result = moveNinjaCreamiCatalogLine(
      baseGroups,
      extrasLines,
      payload.fromGroupId,
      payload.line.id,
      toGroupId,
      targetIdx,
    );
    onBaseGroupsChange(result.baseGroups);
    onExtrasLinesChange(result.extrasLines);
  };

  /** Ouvre le dialog de nom pour Créer. */
  const openCreateDialog = () => {
    if (selectedCount === 0) return;
    setCreateName("Pot #");
    setCreateOpen(true);
    // Place le curseur après « Pot # » pour taper directement le chiffre.
    window.setTimeout(() => {
      const el = createNameInputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }, 0);
  };

  /** Valide Créer → Possible. */
  const confirmCreate = () => {
    const name = createName.trim() || "Pot #";
    const ingredients = serializeSelectedNinjaCreamiIngredients(baseLines, extrasLines, selectedIds);
    if (!ingredients) return;
    const macros = formatNinjaCreamiTotalsForMeal(selectedTotals);
    onCreateFromTests({
      name,
      ingredients,
      calories: macros.calories,
      protein: macros.protein,
      fiber: macros.fiber,
    });
    setCreateOpen(false);
    setSelectedIds(new Set());
  };

  /** Ouvre l’aperçu tableau Recettes testées (cartes à gauche, descriptions à droite). */
  const openTestedOverview = () => {
    setTestedOverviewOpen(true);
  };

  /**
   * Rend une carte Recettes testées, identique à la liste.
   * En aperçu, le glisser-déposer est désactivé pour rester dans la pop-up.
   */
  const renderTestedMealCard = (meal: Meal, preview = false) => {
    const missingIngs = getMissingIngredients(meal, stockMap);
    const analysis = analyzeMealIngredients(meal, foodItems, foodItemIndex);
    const expLabel = formatExpirationLabel(analysis.earliestExpiration);
    const expIsTodayM = isToday(analysis.earliestExpiration);
    return (
      <MealCard
        meal={meal}
        stockMap={stockMap}
        foodItems={foodItems}
        foodItemIndex={foodItemIndex}
        ingredientSuggestions={ingredientSuggestions}
        ingredientMacroSources={ingredientMacroAutofillSources}
        onMoveToPossible={() => onMoveToPossible(meal.id)}
        onRename={(name) => onRename(meal.id, name)}
        onDelete={() => onDelete(meal.id)}
        onUpdateCalories={(cal) => onUpdateCalories(meal.id, cal)}
        onUpdateProtein={(prot) => onUpdateProtein(meal.id, prot)}
        onUpdateFiber={(fiber) => onUpdateFiber(meal.id, fiber)}
        onUpdateGrams={(g) => onUpdateGrams(meal.id, g)}
        onUpdateIngredients={(ing) => onUpdateIngredients(meal.id, ing)}
        onToggleFavorite={() => onToggleFavorite(meal.id)}
        onUpdateOvenTemp={(t) => onUpdateOvenTemp(meal.id, t)}
        onUpdateOvenMinutes={(m) => onUpdateOvenMinutes(meal.id, m)}
        onUpdateDescription={(d) => onUpdateDescription(meal.id, d)}
        missingIngredientNames={missingIngs.size > 0 ? missingIngs : undefined}
        expirationLabel={expLabel}
        expirationDate={analysis.earliestExpiration}
        expirationIsToday={expIsTodayM}
        expiredIngredientNames={analysis.expiredIngredientNames}
        expiringSoonIngredientNames={analysis.expiringSoonIngredientNames}
        maxIngredientCounter={analysis.maxIngredientCounter}
        counterIngredientNames={analysis.counterIngredientNames}
        earliestCounterDate={analysis.earliestCounterDate}
        onDragStart={(e) => {
          if (preview) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData("mealId", meal.id);
          e.dataTransfer.setData("source", "master");
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        hideCounter
      />
    );
  };

  return (
    <div className="flex flex-col rounded-3xl bg-card/80 backdrop-blur-sm p-5 min-h-[80px] gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggleCollapse} className="text-muted-foreground shrink-0">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-cyan-400" />
          Ninja Creami
        </h2>
      </div>

      {!collapsed && (
        <>
          <MealList
            title="Recettes testées"
            emoji="🧪"
            count={testedMeals.length}
            collapsed={testedCollapsed}
            onToggleCollapse={onToggleTestedCollapse}
            onHeaderDoubleClick={openTestedOverview}
            headerDoubleClickTitle="Double-clic : aperçu cartes et descriptions"
            className="py-3 px-2"
            headerActions={
              <>
                {onToggleTestedSort && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onToggleTestedSort}
                    className="text-[10px] gap-0.5 h-6 px-1.5"
                    title="Trier les recettes testées"
                  >
                    <SortIcon
                      className={`h-3 w-3 ${
                        testedSortMode === "favorites" ? "text-yellow-400 fill-yellow-400" : ""
                      }`}
                    />
                    <span className="hidden sm:inline">{sortLabel}</span>
                  </Button>
                )}
                {isNumericSort && onToggleTestedSortDirection && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onToggleTestedSortDirection}
                    className="h-6 w-6 p-0"
                    title={testedSortAsc ? "Croissant" : "Décroissant"}
                  >
                    {testedSortAsc ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  title="Nouvelle recette testée"
                  onClick={onAddTestedRecipe}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </>
            }
          >
            {sortedTestedMeals.length === 0 && (
              <p className="text-muted-foreground text-sm text-center py-4 italic">
                Aucune recette testée
              </p>
            )}
            {sortedTestedMeals.map((meal) => (
              <div key={meal.id}>{renderTestedMealCard(meal)}</div>
            ))}
          </MealList>

          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-3 space-y-3">
            <button
              type="button"
              onClick={() => onToggleTestsCollapse?.()}
              className="text-sm font-bold text-foreground flex items-center gap-2 w-full text-left hover:text-foreground/90"
              title={testsCollapsed ? "Afficher Tests" : "Masquer Tests"}
              disabled={!onToggleTestsCollapse}
            >
              {testsCollapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="text-base">🧬</span> Tests
            </button>

            {!testsCollapsed && (
              <>
                <NinjaCreamiBaseGroupsEditor
                  groups={baseGroups}
                  onGroupsChange={onBaseGroupsChange}
                  selectedIds={selectedIds}
                  onSelectedIdsChange={setSelectedIds}
                  onIngredientNameCommit={onIngredientNameCommit}
                  ingredientMacroSources={ingredientMacroAutofillSources}
                  ingredientSuggestions={ingredientSuggestions}
                  onMoveLineToGroup={handleMoveCatalogLine}
                />
                <NinjaCreamiSelectableIngredientList
                  title="Extras"
                  groupId={NINJA_CREAMI_EXTRAS_GROUP_ID}
                  lines={extrasLines}
                  selectedIds={selectedIds}
                  onLinesChange={onExtrasLinesChange}
                  onSelectedIdsChange={setSelectedIds}
                  onIngredientNameCommit={onIngredientNameCommit}
                  ingredientMacroSources={ingredientMacroAutofillSources}
                  ingredientSuggestions={ingredientSuggestions}
                  onExternalLineDrop={(payload, targetIdx) =>
                    handleMoveCatalogLine(NINJA_CREAMI_EXTRAS_GROUP_ID, payload, targetIdx)
                  }
                  frameTone="violet"
                />

                <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground px-0.5">
                  <span>Total</span>
                  <span className="inline-flex items-center gap-0.5 text-orange-400">
                    <Flame className="h-3 w-3" />
                    {selectedTotals.calories || "—"}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-blue-400">
                    <span className="text-[10px]">🍗</span>
                    {selectedTotals.protein || "—"}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-emerald-400">
                    <Wheat className="h-3 w-3" />
                    {selectedTotals.fiber || "—"}
                  </span>
                  <span className="text-muted-foreground/70">
                    ({selectedCount} sélectionné{selectedCount > 1 ? "s" : ""})
                  </span>
                </div>

                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl gap-1"
                  disabled={selectedCount === 0 || createBusy}
                  onClick={openCreateDialog}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Créer
                </Button>
              </>
            )}
          </div>
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nom de la carte Possible</DialogTitle>
          </DialogHeader>
          <Input
            ref={createNameInputRef}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Pot #"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmCreate();
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="button" onClick={confirmCreate} disabled={createBusy}>
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testedOverviewOpen} onOpenChange={setTestedOverviewOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-6xl w-[min(96vw,72rem)] max-h-[90vh] overflow-hidden flex flex-col gap-3 p-4 sm:p-6"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-2xl">🧪</span>
              Recettes testées
              <span className="text-sm font-normal text-muted-foreground">{sortedTestedMeals.length}</span>
            </DialogTitle>
          </DialogHeader>
          {sortedTestedMeals.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8 italic">Aucune recette testée</p>
          ) : (
            <div className="overflow-y-auto min-h-0 flex-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-3 px-1 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <span>Carte</span>
                <span>Description</span>
              </div>
              <div className="flex flex-col divide-y divide-border/40">
                {sortedTestedMeals.map((meal) => (
                    <div
                      key={meal.id}
                      className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-3 py-1 first:pt-0 items-start"
                    >
                      <div className="min-w-0">{renderTestedMealCard(meal, true)}</div>
                      <div className="self-start h-fit rounded-2xl border border-border/40 bg-muted/30 px-3 py-1">
                        <TestedOverviewDescriptionField
                          mealId={meal.id}
                          savedValue={meal.description ?? ""}
                          onSave={onUpdateDescription}
                        />
                      </div>
                    </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
