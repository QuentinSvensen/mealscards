/**
 * Sous-catégories du catalogue Tous · 0 calorie :
 * ajout / renommage / suppression, DnD entre groupes, sans Extras ni macros.
 */
import { useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NinjaCreamiSelectableIngredientList } from "@/components/NinjaCreamiSelectableIngredientList";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import type { BonusZeroCalorieGroup } from "@/domain/bonusZeroCalorie/bonusZeroCalorie";
import {
  addNinjaCreamiBaseGroup,
  moveLineBetweenNinjaCreamiBaseGroups,
  NINJA_CREAMI_GROUP_DND_MIME,
  NINJA_CREAMI_LINE_DND_MIME,
  removeNinjaCreamiBaseGroup,
  renameNinjaCreamiBaseGroup,
  reorderNinjaCreamiBaseGroups,
  updateNinjaCreamiBaseGroupLines,
  type NinjaCreamiCatalogLine,
  type NinjaCreamiLineDragPayload,
} from "@/domain/ninjaCreami/ninjaCreami";

type ZeroCalorieGroupsEditorProps = {
  groups: BonusZeroCalorieGroup[];
  onGroupsChange: (groups: BonusZeroCalorieGroup[]) => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onIngredientNameCommit?: (line: NinjaCreamiCatalogLine) => void;
  ingredientMacroSources?: IngredientMacroAutofillSources;
  ingredientSuggestions?: string[];
};

/**
 * Indique si le dataTransfer expose un type MIME (insensible à la casse).
 */
function dataTransferHasType(dt: DataTransfer, mime: string): boolean {
  const target = mime.toLowerCase();
  return Array.from(dt.types).some((t) => String(t).toLowerCase() === target);
}

/**
 * Éditeur de sous-catégories pour Tous · 0 calorie.
 */
export function ZeroCalorieGroupsEditor({
  groups,
  onGroupsChange,
  selectedIds,
  onSelectedIdsChange,
  onIngredientNameCommit,
  ingredientMacroSources,
  ingredientSuggestions,
}: ZeroCalorieGroupsEditorProps) {
  const [dragGroupIdx, setDragGroupIdx] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);
  const dragGroupIdxRef = useRef<number | null>(null);

  /** Ajoute une sous-catégorie vide. */
  const handleAddGroup = () => {
    onGroupsChange(addNinjaCreamiBaseGroup(groups));
  };

  /** Déplace une ligne vers une autre sous-catégorie. */
  const handleExternalDrop = (
    toGroupId: string,
    payload: NinjaCreamiLineDragPayload,
    targetIdx: number,
  ) => {
    onGroupsChange(
      moveLineBetweenNinjaCreamiBaseGroups(
        groups,
        payload.fromGroupId,
        payload.line.id,
        toGroupId,
        targetIdx,
      ),
    );
  };

  /** Démarre le drag d’une sous-catégorie (poignée uniquement). */
  const handleGroupDragStart = (e: React.DragEvent, idx: number) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(NINJA_CREAMI_GROUP_DND_MIME, String(idx));
    e.dataTransfer.setData("text/plain", `group:${idx}`);
    dragGroupIdxRef.current = idx;
    setDragGroupIdx(idx);
  };

  /** Survole une sous-catégorie cible pour réordonnancement. */
  const handleGroupDragOver = (e: React.DragEvent, idx: number) => {
    if (
      dataTransferHasType(e.dataTransfer, NINJA_CREAMI_LINE_DND_MIME) &&
      !dataTransferHasType(e.dataTransfer, NINJA_CREAMI_GROUP_DND_MIME)
    ) {
      return;
    }
    if (
      !dataTransferHasType(e.dataTransfer, NINJA_CREAMI_GROUP_DND_MIME) &&
      dragGroupIdxRef.current === null
    ) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupIdx(idx);
  };

  /** Dépose une sous-catégorie pour changer son ordre. */
  const handleGroupDrop = (e: React.DragEvent, toIndex: number) => {
    if (
      dataTransferHasType(e.dataTransfer, NINJA_CREAMI_LINE_DND_MIME) &&
      !dataTransferHasType(e.dataTransfer, NINJA_CREAMI_GROUP_DND_MIME)
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const from =
      dragGroupIdxRef.current ??
      Number.parseInt(e.dataTransfer.getData(NINJA_CREAMI_GROUP_DND_MIME) || "", 10);
    dragGroupIdxRef.current = null;
    setDragGroupIdx(null);
    setDragOverGroupIdx(null);
    if (!Number.isFinite(from) || from === toIndex) return;
    onGroupsChange(reorderNinjaCreamiBaseGroups(groups, from, toIndex));
  };

  /** Nettoie l’état drag des sous-catégories. */
  const handleGroupDragEnd = () => {
    dragGroupIdxRef.current = null;
    setDragGroupIdx(null);
    setDragOverGroupIdx(null);
  };

  /** Poignée pour glisser une sous-catégorie. */
  const renderGroupHandle = (idx: number) => (
    <div
      draggable
      onDragStart={(e) => handleGroupDragStart(e, idx)}
      onDragEnd={handleGroupDragEnd}
      className="shrink-0 h-7 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-white/35 hover:text-white/70"
      title="Glisser pour réordonner la sous-catégorie"
    >
      <GripVertical className="h-4 w-4" />
    </div>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px] gap-0.5 text-muted-foreground hover:text-foreground"
          onClick={handleAddGroup}
          title="Ajouter une sous-catégorie"
        >
          <Plus className="h-3 w-3" />
          Sous-catégorie
        </Button>
      </div>

      {groups.map((group, idx) => (
        <div
          key={group.id}
          onDragOver={(e) => handleGroupDragOver(e, idx)}
          onDrop={(e) => handleGroupDrop(e, idx)}
          className={`transition-opacity ${idx > 0 ? "pt-1 mt-0.5" : ""} ${
            dragGroupIdx === idx ? "opacity-40" : ""
          } ${
            dragOverGroupIdx === idx && dragGroupIdx !== idx
              ? "border-t-2 border-emerald-300/80 pt-0.5"
              : ""
          }`}
        >
          <NinjaCreamiSelectableIngredientList
            title={group.name}
            titleEditable
            groupId={group.id}
            lines={group.lines}
            selectedIds={selectedIds}
            onLinesChange={(lines) =>
              onGroupsChange(updateNinjaCreamiBaseGroupLines(groups, group.id, lines))
            }
            onSelectedIdsChange={onSelectedIdsChange}
            onIngredientNameCommit={onIngredientNameCommit}
            ingredientMacroSources={ingredientMacroSources}
            ingredientSuggestions={ingredientSuggestions}
            onTitleChange={(name) =>
              onGroupsChange(renameNinjaCreamiBaseGroup(groups, group.id, name))
            }
            onDeleteGroup={
              groups.length > 1
                ? () => onGroupsChange(removeNinjaCreamiBaseGroup(groups, group.id))
                : undefined
            }
            onExternalLineDrop={(payload, targetIdx) =>
              handleExternalDrop(group.id, payload, targetIdx)
            }
            groupReorderHandle={renderGroupHandle(idx)}
            hideMacros
          />
        </div>
      ))}
    </div>
  );
}
