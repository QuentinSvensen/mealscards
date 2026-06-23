interface NutritionScoreBadgeProps {
  score: number | null | undefined;
}

/**
 * Affiche la note nutritionnelle (/100) à droite du nom d'une recette.
 */
export function NutritionScoreBadge({ score }: NutritionScoreBadgeProps) {
  if (score == null) return null;

  const tone =
    score >= 80
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
