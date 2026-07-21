interface NutritionScoreBadgeProps {
  score: number | null | undefined;
  /** Tons lisibles sur fond clair (ex. onglet Macro) ; défaut = fond sombre des cartes repas. */
  onLight?: boolean;
}

/**
 * Affiche la note nutritionnelle (/100) à côté du nom d'une recette ou d'un ingrédient Macro.
 */
export function NutritionScoreBadge({ score, onLight = false }: NutritionScoreBadgeProps) {
  if (score == null) return null;

  const tone = onLight
    ? score >= 80
      ? "bg-emerald-700 text-white border-emerald-500/40"
      : score >= 65
        ? "bg-sky-700 text-white border-sky-500/40"
        : score >= 50
          ? "bg-amber-700 text-white border-amber-500/40"
          : score >= 35
            ? "bg-orange-700 text-white border-orange-500/40"
            : "bg-red-700 text-white border-red-500/40"
    : score >= 80
      ? "bg-emerald-400/35 text-emerald-50 border-emerald-200/30"
      : score >= 65
        ? "bg-sky-400/35 text-sky-50 border-sky-200/30"
        : score >= 50
          ? "bg-amber-400/35 text-amber-50 border-amber-200/30"
          : score >= 35
            ? "bg-orange-400/35 text-orange-50 border-orange-200/30"
            : "bg-red-400/35 text-red-50 border-red-200/30";

  return (
    <span
      className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 tabular-nums border ${tone}`}
      title={`Note nutritionnelle : ${score}/100`}
    >
      {score}
    </span>
  );
}
