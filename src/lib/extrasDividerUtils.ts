/** Clé de préférence : id du dernier extra au-dessus du trait horizontal. */
export const FOOD_EXTRAS_DIVIDER_PREF_KEY = "food_extras_divider_after_id";

/**
 * Résout l'id après lequel afficher le trait (défaut : premier extra de la liste triée).
 */
export function resolveExtrasDividerAfterId<T extends { id: string }>(
  sortedItems: T[],
  storedId: string | null | undefined,
): string | null {
  if (sortedItems.length === 0) return null;
  if (storedId && sortedItems.some((item) => item.id === storedId)) return storedId;
  return sortedItems[0].id;
}

/**
 * Sépare une liste d'extras selon le trait (items jusqu'à dividerAfterId inclus = au-dessus).
 */
export function splitSortedExtrasByDivider<T extends { id: string }>(
  sortedItems: T[],
  dividerAfterId: string | null | undefined,
): { above: T[]; below: T[] } {
  const effectiveId = resolveExtrasDividerAfterId(sortedItems, dividerAfterId);
  if (!effectiveId) return { above: sortedItems, below: [] };
  const idx = sortedItems.findIndex((item) => item.id === effectiveId);
  if (idx < 0) return { above: sortedItems, below: [] };
  return {
    above: sortedItems.slice(0, idx + 1),
    below: sortedItems.slice(idx + 1),
  };
}

/**
 * Déplace le trait d'une position vers le haut (moins d'extras au-dessus).
 * Retourne null si le trait est déjà tout en haut (aucun extra au-dessus).
 */
export function moveExtrasDividerUp<T extends { id: string }>(
  sortedItems: T[],
  dividerAfterId: string | null | undefined,
): string | null {
  const effectiveId = resolveExtrasDividerAfterId(sortedItems, dividerAfterId);
  if (!effectiveId) return null;
  const idx = sortedItems.findIndex((item) => item.id === effectiveId);
  if (idx <= 0) return null;
  return sortedItems[idx - 1].id;
}

/**
 * Déplace le trait d'une position vers le bas (plus d'extras au-dessus).
 */
export function moveExtrasDividerDown<T extends { id: string }>(
  sortedItems: T[],
  dividerAfterId: string | null | undefined,
): string | null {
  const effectiveId = resolveExtrasDividerAfterId(sortedItems, dividerAfterId);
  if (!effectiveId || sortedItems.length <= 1) return effectiveId;
  const idx = sortedItems.findIndex((item) => item.id === effectiveId);
  if (idx < 0 || idx >= sortedItems.length - 1) return sortedItems[sortedItems.length - 1].id;
  return sortedItems[idx + 1].id;
}

/** Indique si le trait peut encore monter ou descendre dans la liste. */
export function extrasDividerMoveState<T extends { id: string }>(
  sortedItems: T[],
  dividerAfterId: string | null | undefined,
): { canMoveUp: boolean; canMoveDown: boolean } {
  const effectiveId = resolveExtrasDividerAfterId(sortedItems, dividerAfterId);
  if (!effectiveId || sortedItems.length <= 1) {
    return { canMoveUp: false, canMoveDown: false };
  }
  const idx = sortedItems.findIndex((item) => item.id === effectiveId);
  return {
    canMoveUp: idx > 0,
    canMoveDown: idx < sortedItems.length - 1,
  };
}
