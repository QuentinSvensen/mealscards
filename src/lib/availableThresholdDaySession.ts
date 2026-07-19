/**
 * Mémoire de session JS pour le jour du seuil « Au choix ».
 * Survît aux remounts / navigation in-app, pas au F5 ni à la déconnexion.
 * Volontairement hors localStorage / sessionStorage.
 */

/** Jour ISO choisi pour le seuil calories restantes (null = pas encore choisi cette session). */
let sessionThresholdDayIso: string | null = null;

/**
 * Lit le jour de seuil mémorisé en session JS.
 * Sert à restaurer le choix après un remount sans recharger la page.
 */
export function getAvailableThresholdDayIso(): string | null {
  return sessionThresholdDayIso;
}

/**
 * Mémorise le jour de seuil pour la session JS courante.
 * Permet de conserver le jour choisi pendant la navigation dans l’app.
 */
export function setAvailableThresholdDayIso(iso: string): void {
  sessionThresholdDayIso = iso;
}

/**
 * Vide le jour de seuil mémorisé.
 * À appeler à la déconnexion pour repartir sur aujourd’hui à la prochaine session.
 */
export function clearAvailableThresholdDayIso(): void {
  sessionThresholdDayIso = null;
}
