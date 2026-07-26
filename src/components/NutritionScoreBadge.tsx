interface NutritionScoreBadgeProps {
  score: number | null | undefined;
  /**
   * Score brut non plafonné (ex. 110). Si > 100, affiché au survol ;
   * le badge continue d’afficher `score` plafonné (100).
   */
  rawScore?: number | null;
}

/**
 * Construit le texte du tooltip de la note nutritionnelle.
 * Affiche toujours « Note nutritionnelle : X/100 » (X = score brut si > 100, sinon score affiché).
 */
export function formatNutritionScoreTooltip(
  score: number,
  rawScore?: number | null,
): string {
  const displayed = rawScore != null && rawScore > 100 ? rawScore : score;
  return `Note nutritionnelle : ${displayed}/100`;
}

/**
 * Affiche la note nutritionnelle (/100) à côté du nom d'une recette ou d'un ingrédient Macro.
 * Fond gris uniforme (distinct de l’indice de satiété).
 */
export function NutritionScoreBadge({
  score,
  rawScore = null,
}: NutritionScoreBadgeProps) {
  if (score == null) return null;

  return (
    <span
      className="text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 tabular-nums border bg-zinc-800/90 text-zinc-100 border-zinc-600/50"
      title={formatNutritionScoreTooltip(score, rawScore)}
    >
      {score}
    </span>
  );
}
