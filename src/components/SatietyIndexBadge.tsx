import { formatSatietyIndexTooltip } from "@/lib/satietyIndex";

interface SatietyIndexBadgeProps {
  index: number | null;
  /** kcal / 100 g pour le détail « ≈ XXX g pour 240 kcal » dans le tooltip. */
  caloriesPer100g?: number | null;
  /** Message si l'indice ne peut pas être calculé. */
  missingTitle?: string;
  /** Variante compacte pour les formulaires d'ajout. */
  compact?: boolean;
}

/**
 * Affiche l'indice de satiété Holt (pain blanc = 100 pour 240 kcal) avec code couleur.
 */
export function SatietyIndexBadge({
  index,
  caloriesPer100g,
  missingTitle = "Satiété : renseigne kcal, prot. et fib.",
  compact = false,
}: SatietyIndexBadgeProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg font-semibold tabular-nums ${
        compact ? "h-8 min-w-[2rem] px-1 text-xs" : "h-8 min-w-[2rem] px-1 text-xs"
      } ${
        index == null
          ? "text-muted-foreground"
          : index >= 150
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : index >= 100
              ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
      }`}
      title={index != null ? formatSatietyIndexTooltip(index, caloriesPer100g) : missingTitle}
    >
      {index ?? "—"}
    </span>
  );
}
