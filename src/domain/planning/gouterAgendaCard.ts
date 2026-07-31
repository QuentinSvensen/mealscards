/**
 * Modes d’affichage du créneau Goûter dans la vue Google Agenda :
 * extras seuls → carte « Goûter » ; repas seuls → cartes classiques ;
 * repas + extras → une carte « Goûter » avec titres repas en pastilles.
 */

export type GouterAgendaMode = "none" | "extras-only" | "meals-only" | "combined";

/**
 * Détermine le mode d’affichage agenda du goûter
 * selon le nombre de cartes repas et d’extras du créneau.
 */
export function resolveGouterAgendaMode(
  mealCount: number,
  extraCount: number,
): GouterAgendaMode {
  const meals = Math.max(0, mealCount);
  const extras = Math.max(0, extraCount);
  if (meals === 0 && extras === 0) return "none";
  if (meals === 0 && extras > 0) return "extras-only";
  if (meals > 0 && extras === 0) return "meals-only";
  return "combined";
}
