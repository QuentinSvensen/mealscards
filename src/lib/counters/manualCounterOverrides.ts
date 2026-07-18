/**
 * Surcharges manuelles start/stop du compteur (session courante).
 *
 * Le reconcile auto (force-start / clear scellé) et le résolveur d'affichage
 * inventent sinon un compteur sur lot entamé, ou effacent un démarrage manuel
 * sur paquet encore scellé — ce module permet au clic Compteur / Stop de gagner.
 */

const manuallyStoppedIds = new Set<string>();
const manuallyStartedIds = new Set<string>();

/** Mémorise un arrêt manuel : empêche force-start + inventaire d'affichage. */
export function markFoodCounterManuallyStopped(id: string): void {
  if (!id) return;
  manuallyStoppedIds.add(id);
  manuallyStartedIds.delete(id);
}

/** Mémorise un démarrage manuel : empêche le clear « fantôme scellé » du reconcile. */
export function markFoodCounterManuallyStarted(id: string): void {
  if (!id) return;
  manuallyStartedIds.add(id);
  manuallyStoppedIds.delete(id);
}

/** Indique si l'utilisateur a stoppé le compteur (session) sans le relancer. */
export function isFoodCounterManuallyStopped(id: string): boolean {
  return !!id && manuallyStoppedIds.has(id);
}

/** Indique si l'utilisateur a démarré le compteur manuellement (session). */
export function isFoodCounterManuallyStarted(id: string): boolean {
  return !!id && manuallyStartedIds.has(id);
}

/** Efface la surchage manuelle (ex. compteur reposé par une déduction stock). */
export function clearFoodCounterManualOverride(id: string): void {
  if (!id) return;
  manuallyStoppedIds.delete(id);
  manuallyStartedIds.delete(id);
}
