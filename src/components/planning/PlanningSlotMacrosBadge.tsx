import { Flame, Wheat } from "lucide-react";
import { SLOT_MEAL_TOTAL_CLASS, SLOT_MEAL_TOTAL_SEP_CLASS } from "@/components/planning/planningSlotStyles";

export interface PlanningSlotMacrosBadgeProps {
  calories: number;
  proteins: number;
  fibers: number;
  /** Masque entièrement le badge (préférence « Masquer calories »). */
  hidden?: boolean;
  className?: string;
  /** Utilise l’icône Wheat pour les fibres (petit-déj / goûter) au lieu de l’emoji. */
  fiberAsWheatIcon?: boolean;
  /** `header` = icônes un peu plus grandes (bandeau petit-déj). */
  size?: "slot" | "header";
}

/**
 * Badge compact kcal / protéines / fibres d’un créneau ou d’une bande (petit-déj, midi, soir, goûter).
 */
export function PlanningSlotMacrosBadge({
  calories,
  proteins,
  fibers,
  hidden = false,
  className,
  fiberAsWheatIcon = false,
  size = "slot",
}: PlanningSlotMacrosBadgeProps) {
  if (hidden || (calories <= 0 && proteins <= 0 && fibers <= 0)) return null;

  const iconClass = size === "header" ? "w-2 h-2 sm:w-2.5 sm:h-2.5" : "w-1.5 h-1.5 sm:w-2 sm:h-2";
  const proteinEmojiClass = size === "header" ? "text-[8px] sm:text-[10px] opacity-60" : "text-[8px] sm:text-[9px] opacity-60";

  const fiberIcon = fiberAsWheatIcon ? (
    <Wheat className={`${iconClass} text-emerald-500/70`} />
  ) : (
    <span className="text-[8px] sm:text-[9px] opacity-60">🌾</span>
  );

  return (
    <div className={className ? `${SLOT_MEAL_TOTAL_CLASS} ${className}` : SLOT_MEAL_TOTAL_CLASS}>
      {calories > 0 && (
        <span className="flex items-center gap-0.5">
          <Flame className={`${iconClass} text-orange-500/60`} />
          {Math.round(calories)}
        </span>
      )}
      {calories > 0 && (proteins > 0 || fibers > 0) && <span className={SLOT_MEAL_TOTAL_SEP_CLASS}>•</span>}
      {proteins > 0 && (
        <span className="flex items-center gap-0.5">
          <span className={proteinEmojiClass}>🍗</span>
          {Math.round(proteins)}
        </span>
      )}
      {proteins > 0 && fibers > 0 && <span className={SLOT_MEAL_TOTAL_SEP_CLASS}>•</span>}
      {fibers > 0 && (
        <span className="flex items-center gap-0.5">
          {fiberIcon}
          {Math.round(fibers)}
        </span>
      )}
    </div>
  );
}
