/**
 * Debounce les invalidations React Query pour éviter une rafale de select(*)
 * après chaque événement Realtime / focus.
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Planifie une invalidation unique par clé, en regroupant les événements pendant `ms`.
 */
export function debounceInvalidateQueries(
  qc: QueryClient,
  queryKey: QueryKey,
  ms = 5000,
): void {
  const key = JSON.stringify(queryKey);
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      qc.invalidateQueries({ queryKey });
    }, ms),
  );
}
