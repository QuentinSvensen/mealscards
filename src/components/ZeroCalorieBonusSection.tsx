/**
 * Section « Tous · 0 calorie » (onglet Bonus) :
 * sous-catégories d’ingrédients sélectionnables + création Possible.
 */
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ZeroCalorieGroupsEditor } from "@/components/ZeroCalorieGroupsEditor";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import {
  flattenBonusZeroCalorieGroups,
  type BonusZeroCalorieGroup,
} from "@/domain/bonusZeroCalorie/bonusZeroCalorie";
import {
  formatNinjaCreamiTotalsForMeal,
  isNinjaCreamiLineSelectable,
  serializeSelectedNinjaCreamiIngredients,
  sumSelectedNinjaCreamiMacros,
  type NinjaCreamiCatalogLine,
} from "@/domain/ninjaCreami/ninjaCreami";

export type ZeroCalorieCreatePayload = {
  name: string;
  ingredients: string;
  calories: string | null;
  protein: string | null;
  fiber: string | null;
};

type ZeroCalorieBonusSectionProps = {
  /** Sous-catégories du catalogue (préférence partagée). */
  groups: BonusZeroCalorieGroup[];
  /** Persiste les sous-catégories après édition. */
  onGroupsChange: (groups: BonusZeroCalorieGroup[]) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  ingredientMacroAutofillSources?: IngredientMacroAutofillSources;
  ingredientSuggestions?: string[];
  /** Sync Macro ingrédients au blur du nom. */
  onIngredientNameCommit?: (line: NinjaCreamiCatalogLine) => void;
  /** Crée une carte Possible (catégorie bonus) depuis la sélection. */
  onCreateFromSelection?: (payload: ZeroCalorieCreatePayload) => void;
};

/**
 * Encadré collapsible avec sous-catégories + création Possible.
 */
export function ZeroCalorieBonusSection({
  groups,
  onGroupsChange,
  collapsed,
  onToggleCollapse,
  ingredientMacroAutofillSources,
  ingredientSuggestions = [],
  onIngredientNameCommit,
  onCreateFromSelection,
}: ZeroCalorieBonusSectionProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const createNameInputRef = useRef<HTMLInputElement | null>(null);

  const allLines = useMemo(() => flattenBonusZeroCalorieGroups(groups), [groups]);

  const selectedTotals = useMemo(
    () => sumSelectedNinjaCreamiMacros(allLines, selectedIds),
    [allLines, selectedIds],
  );

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const line of allLines) {
      if (selectedIds.has(line.id) && isNinjaCreamiLineSelectable(line)) n += 1;
    }
    return n;
  }, [allLines, selectedIds]);

  const selectableCount = useMemo(
    () => allLines.filter(isNinjaCreamiLineSelectable).length,
    [allLines],
  );

  /** Ouvre le dialog de nom pour Créer, prérempli avec le(s) nom(s) sélectionné(s). */
  const openCreateDialog = () => {
    if (selectedCount === 0 || !onCreateFromSelection) return;
    const selectedNames = allLines
      .filter((line) => selectedIds.has(line.id) && isNinjaCreamiLineSelectable(line))
      .map((line) => line.name.trim())
      .filter(Boolean);
    setCreateName(selectedNames.join(" + "));
    setCreateOpen(true);
    window.setTimeout(() => {
      const el = createNameInputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 50);
  };

  /** Valide Créer → Possible (catégorie bonus). */
  const confirmCreate = () => {
    if (!onCreateFromSelection || createBusy) return;
    const name = createName.trim();
    if (!name) return;
    const ingredients = serializeSelectedNinjaCreamiIngredients(allLines, [], selectedIds);
    if (!ingredients?.trim()) return;
    const formatted = formatNinjaCreamiTotalsForMeal(selectedTotals);
    setCreateBusy(true);
    try {
      onCreateFromSelection({
        name,
        ingredients,
        calories: formatted.calories,
        protein: formatted.protein,
        fiber: formatted.fiber,
      });
      setSelectedIds(new Set());
      setCreateOpen(false);
      setCreateName("");
    } finally {
      setCreateBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-3">
      <button
        type="button"
        onClick={onToggleCollapse}
        className="text-sm font-bold text-foreground flex items-center gap-2 w-full text-left hover:text-foreground/90"
        title={collapsed ? "Afficher Tous · 0 calorie" : "Masquer Tous · 0 calorie"}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-base">🍃</span> Tous · 0 calorie
        <span className="text-[11px] font-semibold text-muted-foreground">
          ({selectableCount})
        </span>
      </button>

      {!collapsed && (
        <>
          <ZeroCalorieGroupsEditor
            groups={groups}
            onGroupsChange={onGroupsChange}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            onIngredientNameCommit={onIngredientNameCommit}
            ingredientMacroSources={ingredientMacroAutofillSources}
            ingredientSuggestions={ingredientSuggestions}
          />

          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-muted-foreground px-0.5">
            <span>
              {selectedCount} sélectionné{selectedCount > 1 ? "s" : ""}
            </span>
          </div>

          {onCreateFromSelection && (
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
          )}
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
            placeholder="Ex. Confiture light"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                confirmCreate();
              }
            }}
            autoFocus
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              disabled={!createName.trim() || createBusy}
              onClick={confirmCreate}
            >
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
