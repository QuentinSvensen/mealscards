/**
 * Catalogue Base Ninja Creami : sous-catégories renommables,
 * ajout / suppression, déplacement d’ingrédients entre sous-cats,
 * et réordonnancement manuel des sous-catégories.
 */
import { useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NinjaCreamiSelectableIngredientList } from "@/components/NinjaCreamiSelectableIngredientList";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import {
  addNinjaCreamiBaseGroup,
  moveLineBetweenNinjaCreamiBaseGroups,
  NINJA_CREAMI_GROUP_DND_MIME,
  NINJA_CREAMI_LINE_DND_MIME,
  removeNinjaCreamiBaseGroup,
  renameNinjaCreamiBaseGroup,
  reorderNinjaCreamiBaseGroups,
  updateNinjaCreamiBaseGroupLines,
  type NinjaCreamiBaseGroup,
  type NinjaCreamiCatalogLine,
  type NinjaCreamiLineDragPayload,
} from "@/domain/ninjaCreami/ninjaCreami";

export interface NinjaCreamiBaseGroupsEditorProps {
  groups: NinjaCreamiBaseGroup[];
  onGroupsChange: (groups: NinjaCreamiBaseGroup[]) => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onIngredientNameCommit?: (line: NinjaCreamiCatalogLine) => void;
  ingredientMacroSources?: IngredientMacroAutofillSources;
  /** Noms pour l’autocomplete des lignes Base. */
  ingredientSuggestions?: string[];
}

/**
 * Bloc « Base » avec sous-catégories éditables et DnD inter-groupes.
 */
export function NinjaCreamiBaseGroupsEditor({
  groups,
  onGroupsChange,
  selectedIds,
  onSelectedIdsChange,
  onIngredientNameCommit,
  ingredientMacroSources,
  ingredientSuggestions,
}: NinjaCreamiBaseGroupsEditorProps) {
  const [dragGroupIdx, setDragGroupIdx] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);
  const dragGroupIdxRef = useRef<number | null>(null);

  /** Ajoute une sous-catégorie vide. */
  const handleAddGroup = () => {
    onGroupsChange(addNinjaCreamiBaseGroup(groups));
  };

  /** Reçoit une ligne déposée depuis une autre sous-catégorie. */
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

  /**
   * Démarre le drag d’une sous-catégorie depuis sa poignée uniquement
   * (évite d’annuler le drag des ingrédients imbriqués).
   */
  const handleGroupDragStart = (e: React.DragEvent, idx: number) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(NINJA_CREAMI_GROUP_DND_MIME, String(idx));
    e.dataTransfer.setData("text/plain", `group:${idx}`);
    dragGroupIdxRef.current = idx;
    setDragGroupIdx(idx);
  };

  /** Survole une sous-catégorie cible (réordonnancement des groupes). */
  const handleGroupDragOver = (e: React.DragEvent, idx: number) => {
    const types = Array.from(e.dataTransfer.types);
    // Laisser le DnD d’ingrédients à la liste interne.
    if (types.includes(NINJA_CREAMI_LINE_DND_MIME) && !types.includes(NINJA_CREAMI_GROUP_DND_MIME)) {
      return;
    }
    if (!types.includes(NINJA_CREAMI_GROUP_DND_MIME) && dragGroupIdxRef.current === null) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupIdx(idx);
  };

  /** Dépose une sous-catégorie pour changer son ordre. */
  const handleGroupDrop = (e: React.DragEvent, toIndex: number) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(NINJA_CREAMI_LINE_DND_MIME) && !types.includes(NINJA_CREAMI_GROUP_DND_MIME)) {
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <div className="text-[11px] font-bold text-foreground/90">Base</div>
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
          className={`transition-opacity ${
            dragGroupIdx === idx ? "opacity-40" : ""
          } ${
            dragOverGroupIdx === idx && dragGroupIdx !== idx
              ? "border-t-2 border-amber-300/80 pt-0.5"
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
            groupReorderHandle={
              <div
                draggable
                onDragStart={(e) => handleGroupDragStart(e, idx)}
                onDragEnd={handleGroupDragEnd}
                className="shrink-0 h-7 w-5 flex items-center justify-center cursor-grab active:cursor-grabbing text-white/35 hover:text-white/70"
                title="Glisser pour réordonner la sous-catégorie"
              >
                <GripVertical className="h-4 w-4" />
              </div>
            }
          />
        </div>
      ))}
    </div>
  );
}
