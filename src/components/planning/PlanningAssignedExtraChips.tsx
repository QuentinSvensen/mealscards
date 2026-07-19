import type { Meal } from "@/hooks/useMeals";
import type { FoodItem } from "@/hooks/useFoodItems";
import {
  getAssignedExtraLabel,
  groupAssignedExtraIds,
  resolveAssignedExtraForDisplay,
} from "@/domain/planning/extraDisplay";

export interface PlanningAssignedExtraChipsProps {
  assignedIds: string[];
  dayIso: string;
  dayKey: string;
  /** Libellé tooltip du chip (ex. « Extra assigné à Midi »). */
  title: string;
  foodItems: FoodItem[];
  dessertById: Map<string, { mealPayload: Meal; name?: string }>;
  /** Conservé pour compat callers ; le chip affiche la quantité assignée, pas le reste. */
  dessertCatalog?: Array<{ id: string; name: string }>;
  /** Conservé pour compat callers ; non utilisé pour le label sélectionné. */
  dessertPossibleCountById?: Map<string, number>;
  chipClassName?: string;
  /** Conteneur autour des chips (ex. `mt-1` pour le petit-déj, `pt-0.5` pour midi/soir). */
  wrapperClassName?: string;
  keyPrefix: string;
  onDeselect: (extraId: string, iso: string, key: string) => void;
  onDragStartExtra: (extraId: string, iso: string, key: string, e: React.DragEvent) => void;
  onDragEndExtra: () => void;
}

/**
 * Affiche les bulles d’extras assignés à un créneau (drag pour déplacer, × pour retirer du jour).
 * Le label montre la quantité assignée (`#N`), pas le stock restant.
 */
export function PlanningAssignedExtraChips({
  assignedIds,
  dayIso,
  dayKey,
  title,
  foodItems,
  dessertById,
  chipClassName = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/15 text-orange-600 border border-orange-500/25 cursor-grab active:cursor-grabbing",
  wrapperClassName = "flex flex-wrap gap-1 pt-0.5",
  keyPrefix,
  onDeselect,
  onDragStartExtra,
  onDragEndExtra,
}: PlanningAssignedExtraChipsProps) {
  if (assignedIds.length === 0) return null;

  return (
    <div className={wrapperClassName}>
      {groupAssignedExtraIds(assignedIds).map(({ id: extraId, count }, index) => {
        const resolved = resolveAssignedExtraForDisplay(extraId, foodItems, dessertById);
        if (!resolved) return null;
        const { custom, fi } = resolved;
        return (
          <span
            key={`${keyPrefix}-${extraId}-${index}-${count}`}
            draggable
            onDragStart={(e) => onDragStartExtra(extraId, dayIso, dayKey, e)}
            onDragEnd={onDragEndExtra}
            className={chipClassName}
            title={title}
          >
            {getAssignedExtraLabel(extraId, count, custom, fi ?? undefined, foodItems, dessertById)}
            <button
              type="button"
              onClick={() => onDeselect(extraId, dayIso, dayKey)}
              className="opacity-60 hover:opacity-100 font-bold"
              title="Retirer des extras du jour"
            >
              ×
            </button>
          </span>
        );
      })}
    </div>
  );
}
