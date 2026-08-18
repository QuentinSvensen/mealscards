/**
 * Catalogue Base Ninja Creami : sous-catégories renommables,
 * ajout / suppression, déplacement d’ingrédients entre sous-cats,
 * et réordonnancement manuel des sous-catégories (y compris Extras).
 */
import { useMemo, useRef, useState } from "react";
import { GripVertical, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NinjaCreamiSelectableIngredientList } from "@/components/NinjaCreamiSelectableIngredientList";
import type { IngredientMacroAutofillSources } from "@/domain/macros/ingredientMacroDatabase";
import {
  addNinjaCreamiBaseGroup,
  NINJA_CREAMI_EXTRAS_GROUP_ID,
  NINJA_CREAMI_GROUP_DND_MIME,
  NINJA_CREAMI_LINE_DND_MIME,
  normalizeNinjaCreamiTestsGroupOrder,
  removeNinjaCreamiBaseGroup,
  renameNinjaCreamiBaseGroup,
  reorderNinjaCreamiTestsSections,
  updateNinjaCreamiBaseGroupLines,
  type NinjaCreamiBaseGroup,
  type NinjaCreamiCatalogLine,
  type NinjaCreamiLineDragPayload,
} from "@/domain/ninjaCreami/ninjaCreami";

export interface NinjaCreamiBaseGroupsEditorProps {
  groups: NinjaCreamiBaseGroup[];
  onGroupsChange: (groups: NinjaCreamiBaseGroup[]) => void;
  extrasLines: NinjaCreamiCatalogLine[];
  onExtrasLinesChange: (lines: NinjaCreamiCatalogLine[]) => void;
  /** Ordre sauvegardé Base + Extras (null = Extras à la fin). */
  testsGroupOrder?: readonly string[] | null;
  onTestsGroupOrderChange: (order: string[]) => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: Set<string>) => void;
  onIngredientNameCommit?: (line: NinjaCreamiCatalogLine) => void;
  ingredientMacroSources?: IngredientMacroAutofillSources;
  /** Noms pour l’autocomplete des lignes Base. */
  ingredientSuggestions?: string[];
  /**
   * Déplacement d’une ligne vers une sous-catégorie (depuis une autre sous-cat ou Extras).
   */
  onMoveLineToGroup: (
    toGroupId: string,
    payload: NinjaCreamiLineDragPayload,
    targetIdx: number,
  ) => void;
}

/**
 * Bloc « Base » avec sous-catégories éditables et DnD inter-groupes.
 */
export function NinjaCreamiBaseGroupsEditor({
  groups,
  onGroupsChange,
  extrasLines,
  onExtrasLinesChange,
  testsGroupOrder = null,
  onTestsGroupOrderChange,
  selectedIds,
  onSelectedIdsChange,
  onIngredientNameCommit,
  ingredientMacroSources,
  ingredientSuggestions,
  onMoveLineToGroup,
}: NinjaCreamiBaseGroupsEditorProps) {
  const [dragGroupIdx, setDragGroupIdx] = useState<number | null>(null);
  const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);
  const dragGroupIdxRef = useRef<number | null>(null);

  /** Ordre visuel : sous-catégories Base + Extras. */
  const displayOrder = useMemo(
    () => normalizeNinjaCreamiTestsGroupOrder(groups.map((group) => group.id), testsGroupOrder),
    [groups, testsGroupOrder],
  );

  /** Persiste l’ordre Tests sans réécrire les sous-catégories Base (évite d’en perdre une). */
  const persistDisplayOrder = (nextOrder: string[]) => {
    onTestsGroupOrderChange(nextOrder);
  };

  /** Ajoute une sous-catégorie vide (placée juste avant Extras). */
  const handleAddGroup = () => {
    const nextGroups = addNinjaCreamiBaseGroup(groups);
    onGroupsChange(nextGroups);
    onTestsGroupOrderChange(
      normalizeNinjaCreamiTestsGroupOrder(
        nextGroups.map((group) => group.id),
        testsGroupOrder,
      ),
    );
  };

  /** Reçoit une ligne déposée depuis une autre sous-catégorie ou Extras. */
  const handleExternalDrop = (
    toGroupId: string,
    payload: NinjaCreamiLineDragPayload,
    targetIdx: number,
  ) => {
    onMoveLineToGroup(toGroupId, payload, targetIdx);
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
    const types = Array.from(e.dataTransfer.types).map((t) => String(t).toLowerCase());
    // Laisser le DnD d’ingrédients à la liste interne.
    if (
      types.includes(NINJA_CREAMI_LINE_DND_MIME.toLowerCase()) &&
      !types.includes(NINJA_CREAMI_GROUP_DND_MIME.toLowerCase())
    ) {
      return;
    }
    if (!types.includes(NINJA_CREAMI_GROUP_DND_MIME.toLowerCase()) && dragGroupIdxRef.current === null) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupIdx(idx);
  };

  /** Dépose une sous-catégorie pour changer son ordre (Base ou Extras). */
  const handleGroupDrop = (e: React.DragEvent, toIndex: number) => {
    const types = Array.from(e.dataTransfer.types).map((t) => String(t).toLowerCase());
    if (
      types.includes(NINJA_CREAMI_LINE_DND_MIME.toLowerCase()) &&
      !types.includes(NINJA_CREAMI_GROUP_DND_MIME.toLowerCase())
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
    persistDisplayOrder(reorderNinjaCreamiTestsSections(displayOrder, from, toIndex));
  };

  /** Nettoie l’état drag des sous-catégories. */
  const handleGroupDragEnd = () => {
    dragGroupIdxRef.current = null;
    setDragGroupIdx(null);
    setDragOverGroupIdx(null);
  };

  /** Poignée commune pour glisser une sous-catégorie (Base ou Extras). */
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

      {displayOrder.map((sectionId, idx) => {
        const rowClassName = `transition-opacity ${
          idx > 0 ? "pt-1 mt-0.5" : ""
        } ${
          dragGroupIdx === idx ? "opacity-40" : ""
        } ${
          dragOverGroupIdx === idx && dragGroupIdx !== idx
            ? "border-t-2 border-amber-300/80 pt-0.5"
            : ""
        }`;

        if (sectionId === NINJA_CREAMI_EXTRAS_GROUP_ID) {
          return (
            <div
              key={sectionId}
              onDragOver={(e) => handleGroupDragOver(e, idx)}
              onDrop={(e) => handleGroupDrop(e, idx)}
              className={rowClassName}
            >
              <NinjaCreamiSelectableIngredientList
                title="Extras"
                groupId={NINJA_CREAMI_EXTRAS_GROUP_ID}
                lines={extrasLines}
                selectedIds={selectedIds}
                onLinesChange={onExtrasLinesChange}
                onSelectedIdsChange={onSelectedIdsChange}
                onIngredientNameCommit={onIngredientNameCommit}
                ingredientMacroSources={ingredientMacroSources}
                ingredientSuggestions={ingredientSuggestions}
                onExternalLineDrop={(payload, targetIdx) =>
                  handleExternalDrop(NINJA_CREAMI_EXTRAS_GROUP_ID, payload, targetIdx)
                }
                frameTone="violet"
                groupReorderHandle={renderGroupHandle(idx)}
              />
            </div>
          );
        }

        const group = groups.find((item) => item.id === sectionId);
        if (!group) return null;
        return (
          <div
            key={sectionId}
            onDragOver={(e) => handleGroupDragOver(e, idx)}
            onDrop={(e) => handleGroupDrop(e, idx)}
            className={rowClassName}
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
                  ? () => {
                      const nextGroups = removeNinjaCreamiBaseGroup(groups, group.id);
                      onGroupsChange(nextGroups);
                      onTestsGroupOrderChange(
                        normalizeNinjaCreamiTestsGroupOrder(
                          nextGroups.map((item) => item.id),
                          testsGroupOrder,
                        ),
                      );
                    }
                  : undefined
              }
              onExternalLineDrop={(payload, targetIdx) =>
                handleExternalDrop(group.id, payload, targetIdx)
              }
              groupReorderHandle={renderGroupHandle(idx)}
            />
          </div>
        );
      })}
    </div>
  );
}
