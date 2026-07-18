import type { PlanningSnapshotEntry } from "./types";

/**
 * Construit le libellé tooltip du bouton 💾 (snapshot planning) :
 * valeurs sauvegardées, ou invitation à sauvegarder / oublier au double-clic.
 */
export function formatPlanningSnapshotTitle(
  snap: PlanningSnapshotEntry | undefined,
  options: { itemCount?: number; nameFallback?: boolean } = {},
): string {
  if (!snap) return "Sauvegarder les valeurs pour le reset (Double-clic pour oublier)";
  if (options.nameFallback && snap.name) return `Sauvegardé: ${snap.name} (Double-clic pour oublier)`;
  const itemPart = options.itemCount !== undefined ? `, ${options.itemCount} items` : "";
  return `Sauvegardé: ${snap.cal || 0} kcal / ${snap.prot || 0} prot / ${snap.fiber || 0} fib${itemPart} (Double-clic pour oublier)`;
}
