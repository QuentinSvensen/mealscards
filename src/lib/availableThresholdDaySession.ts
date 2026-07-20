/**
 * Mémoire de session JS pour le jour du seuil « Au choix ».
 *
 * Contrat :
 * - Volontairement hors localStorage / sessionStorage (JS only).
 * - Survît aux remounts / navigation in-app.
 * - Remis à null au F5 (rechargement) et via clearAvailableThresholdDayIso à la déconnexion.
 * - Notifie les abonnés React (`useSyncExternalStore`) à chaque changement.
 */

/** Jour ISO choisi pour le seuil calories restantes (null = pas encore choisi cette session). */
let sessionThresholdDayIso: string | null = null;

/** Abonnés à notifier quand le jour de seuil change. */
const thresholdDayListeners = new Set<() => void>();

/** Notifie tous les abonnés React du changement de jour Au choix. */
function emitAvailableThresholdDayChange(): void {
  thresholdDayListeners.forEach((listener) => listener());
}

/**
 * Lit le jour de seuil mémorisé en session JS (snapshot pour useSyncExternalStore).
 * Sert à restaurer le choix après un remount sans recharger la page.
 */
export function getAvailableThresholdDayIso(): string | null {
  return sessionThresholdDayIso;
}

/**
 * Abonne un listener aux changements du jour Au choix (API useSyncExternalStore).
 */
export function subscribeAvailableThresholdDay(onStoreChange: () => void): () => void {
  thresholdDayListeners.add(onStoreChange);
  return () => {
    thresholdDayListeners.delete(onStoreChange);
  };
}

/**
 * Mémorise le jour de seuil pour la session JS courante.
 * Permet de conserver le jour choisi pendant la navigation dans l’app.
 */
export function setAvailableThresholdDayIso(iso: string): void {
  if (sessionThresholdDayIso === iso) return;
  sessionThresholdDayIso = iso;
  emitAvailableThresholdDayChange();
}

/**
 * Vide le jour de seuil mémorisé.
 * À appeler à la déconnexion pour repartir sur aujourd’hui à la prochaine session.
 */
export function clearAvailableThresholdDayIso(): void {
  if (sessionThresholdDayIso === null) return;
  sessionThresholdDayIso = null;
  emitAvailableThresholdDayChange();
}
