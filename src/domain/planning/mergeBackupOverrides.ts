/**
 * Fusionne les overrides kcal/prot de la sauvegarde avec ceux encore présents
 * dans les préférences live (même id de carte). Les valeurs live priment.
 */
export function mergeBackupCardOverrides(
  backupOverrides: Record<string, string | number> | undefined,
  liveOverrides: Record<string, string>,
  cardIds: Iterable<string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const id of cardIds) {
    const fromBackup = backupOverrides?.[id];
    if (fromBackup != null && String(fromBackup).trim()) {
      merged[id] = String(fromBackup);
    }
    const fromLive = liveOverrides[id];
    if (fromLive?.trim()) merged[id] = fromLive;
  }
  return merged;
}
