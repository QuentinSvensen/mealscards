/**
 * Gate module-scoped pour suspendre brièvement l’invalidation realtime du stock.
 * Évite qu’un refetch stale écrase un patch optimiste local juste après une mutation.
 */

/** Horodatage (ms) jusqu’auquel les invalidations food_items realtime sont ignorées. */
let suppressUntilMs = 0;

/**
 * Suspend les invalidations realtime stock pendant `ms` millisecondes (défaut 6000).
 * À appeler juste après un update optimiste sur food_items.
 */
export function suppressStockRealtime(ms = 6000): void {
  suppressUntilMs = Date.now() + ms;
}

/**
 * Indique si l’invalidation realtime food_items doit être ignorée pour le moment.
 */
export function shouldSuppressStockRealtime(): boolean {
  return Date.now() < suppressUntilMs;
}
