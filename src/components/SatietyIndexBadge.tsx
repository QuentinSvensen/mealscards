import {
  formatMealSatietyIndexTooltip,
  formatSatietyIndexTooltip,
} from "@/lib/satietyIndex";

/** Fond des indices de satiété : teal translucide (bordure mint), comme sur les cartes repas. */
const SATIETY_INDEX_SURFACE =
  "bg-emerald-400/35 text-emerald-50 border-emerald-200/40";

interface SatietyIndexBadgeProps {
  index: number | null;
  /** kcal / 100 g (optionnel, réservé au tooltip Macro). */
  caloriesPer100g?: number | null;
  /** Volume total (g) retenu pour la densite recette — tooltip carte. */
  totalGrams?: number | null;
  /** Message si l'indice ne peut pas être calculé. */
  missingTitle?: string;
  /** Variante compacte pour les formulaires d'ajout. */
  compact?: boolean;
  /**
   * Masque le badge quand l'indice est absent (cartes repas) ;
   * sinon affiche « — » (onglet Macro).
   */
  hideWhenMissing?: boolean;
  /**
   * Format compact type carte repas (même taille que la note nutritionnelle).
   */
  onMealCard?: boolean;
  /** Tooltip dédié au total recette (densite 0–100 + volume). */
  recipeTotal?: boolean;
}

/**
 * Affiche l'indice de satiété Meals Cards (base pour 100 g, ou densite recette 0–100).
 * Fond teal uniforme partout (distinct du gris des notes nutritionnelles).
 */
export function SatietyIndexBadge({
  index,
  caloriesPer100g,
  totalGrams,
  missingTitle = "Satiété : renseigne kcal, prot. et fib.",
  compact: _compact = false,
  hideWhenMissing = false,
  onMealCard = false,
  recipeTotal = false,
}: SatietyIndexBadgeProps) {
  if (hideWhenMissing && index == null) return null;

  const sizeClass = onMealCard
    ? "text-[10px] font-black px-1.5 py-0.5"
    : "h-8 min-w-[2rem] px-1.5 text-xs font-semibold";

  const toneClass =
    index == null
      ? onMealCard
        ? "bg-white/20 text-white/70 border-white/20"
        : "border-transparent text-muted-foreground"
      : SATIETY_INDEX_SURFACE;

  const title =
    index != null
      ? recipeTotal
        ? formatMealSatietyIndexTooltip(index, totalGrams)
        : formatSatietyIndexTooltip(index, caloriesPer100g)
      : missingTitle;

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 tabular-nums rounded-full border ${sizeClass} ${toneClass}`}
      title={title}
    >
      {index ?? "—"}
    </span>
  );
}
