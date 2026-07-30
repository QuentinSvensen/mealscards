/** Clé de préférence : id du dernier extra au-dessus du trait horizontal. */
export const FOOD_EXTRAS_DIVIDER_PREF_KEY = "food_extras_divider_after_id";

/** Miroir localStorage du trait (survit à un rollback / perte de préférence Supabase). */
export const FOOD_EXTRAS_DIVIDER_LOCAL_BACKUP_KEY = "mealcards-food_extras_divider_backup";

/** Durée max pendant laquelle le miroir local peut réparer un trait trop haut. */
const LOCAL_BACKUP_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Snapshot local de la position du trait extras. */
export type ExtrasDividerLocalBackup = {
  afterId: string | null;
  aboveCount: number;
  updatedAt: number;
};

/**
 * Lit le miroir local du trait extras (null si absent / illisible).
 */
export function readLocalExtrasDividerBackup(): ExtrasDividerLocalBackup | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(FOOD_EXTRAS_DIVIDER_LOCAL_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExtrasDividerLocalBackup>;
    if (typeof parsed.updatedAt !== "number" || !Number.isFinite(parsed.updatedAt)) return null;
    const aboveCount =
      typeof parsed.aboveCount === "number" && Number.isFinite(parsed.aboveCount)
        ? Math.max(0, Math.floor(parsed.aboveCount))
        : 0;
    const afterId = typeof parsed.afterId === "string" ? parsed.afterId : null;
    return { afterId, aboveCount, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

/**
 * Écrit le miroir local du trait (id + nombre d’extras au-dessus).
 */
export function writeLocalExtrasDividerBackup(
  afterId: string | null,
  aboveCount: number,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: ExtrasDividerLocalBackup = {
      afterId,
      aboveCount: Math.max(0, Math.floor(aboveCount)),
      updatedAt: Date.now(),
    };
    localStorage.setItem(FOOD_EXTRAS_DIVIDER_LOCAL_BACKUP_KEY, JSON.stringify(payload));
  } catch {
    // Quota / mode privé : ignore.
  }
}

/**
 * Indique si le miroir local est encore assez récent pour une réparation.
 */
export function isLocalExtrasDividerBackupFresh(
  backup: ExtrasDividerLocalBackup | null,
  nowMs: number = Date.now(),
): boolean {
  if (!backup) return false;
  return nowMs - backup.updatedAt <= LOCAL_BACKUP_MAX_AGE_MS;
}

/**
 * Choisit un id de trait depuis le miroir local (id exact, sinon index aboveCount).
 */
export function pickExtrasDividerIdFromLocalBackup<T extends { id: string }>(
  sortedItems: T[],
  backup: ExtrasDividerLocalBackup | null,
): string | null {
  if (!backup || sortedItems.length === 0) return null;
  if (backup.afterId && sortedItems.some((item) => item.id === backup.afterId)) {
    return backup.afterId;
  }
  if (backup.aboveCount > 0) {
    const idx = Math.min(backup.aboveCount, sortedItems.length) - 1;
    return sortedItems[Math.max(0, idx)]?.id ?? null;
  }
  return null;
}

/**
 * Met à jour le miroir local à partir d’une liste triée et d’un id de trait.
 */
export function syncLocalExtrasDividerBackup<T extends { id: string }>(
  sortedItems: T[],
  dividerAfterId: string | null | undefined,
): void {
  const effectiveId = resolveExtrasDividerAfterId(sortedItems, dividerAfterId, {
    useLocalBackup: false,
  });
  if (!effectiveId) {
    writeLocalExtrasDividerBackup(null, 0);
    return;
  }
  const idx = sortedItems.findIndex((item) => item.id === effectiveId);
  writeLocalExtrasDividerBackup(effectiveId, idx >= 0 ? idx + 1 : sortedItems.length);
}

/**
 * Résout l'id après lequel afficher le trait.
 * Défaut sûr (préférence absente / id orphelin) : dernier extra = tout le catalogue Planning.
 * Si la préférence est valide mais le miroir local a un catalogue plus large (trait remonté
 * après incident), on préfère le miroir pour que le Planning retrouve les extras tout de suite.
 */
export function resolveExtrasDividerAfterId<T extends { id: string }>(
  sortedItems: T[],
  storedId: string | null | undefined,
  options?: { useLocalBackup?: boolean; recoverRicherLocal?: boolean },
): string | null {
  if (sortedItems.length === 0) return null;

  if (storedId && sortedItems.some((item) => item.id === storedId)) {
    if (options?.recoverRicherLocal !== false && options?.useLocalBackup !== false) {
      const local = readLocalExtrasDividerBackup();
      const localId = pickExtrasDividerIdFromLocalBackup(sortedItems, local);
      if (localId && localId !== storedId && isLocalExtrasDividerBackupFresh(local)) {
        const storedAbove = sortedItems.findIndex((item) => item.id === storedId) + 1;
        const localAbove = sortedItems.findIndex((item) => item.id === localId) + 1;
        if (localAbove > storedAbove) return localId;
      }
    }
    return storedId;
  }

  if (options?.useLocalBackup !== false) {
    const localId = pickExtrasDividerIdFromLocalBackup(
      sortedItems,
      readLocalExtrasDividerBackup(),
    );
    if (localId) return localId;
  }

  // Défaut : trait en bas → tous les extras restent dans le dropdown Planning
  return sortedItems[sortedItems.length - 1].id;
}

/**
 * Après un incident Supabase, propose un id à réécrire si le trait est trop haut
 * alors que le miroir local avait un catalogue plus large.
 * Retourne null si aucune réparation n’est nécessaire.
 */
export function recoverExtrasDividerAfterId<T extends { id: string }>(
  sortedItems: T[],
  storedId: string | null | undefined,
): string | null {
  if (sortedItems.length === 0) return null;

  const resolved = resolveExtrasDividerAfterId(sortedItems, storedId);
  if (!resolved) return null;
  if (resolved === storedId) return null;
  return resolved;
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

/**
 * Place un nouvel extra juste au-dessus du trait (fin de la zone « au-dessus »)
 * et renvoie le nouvel ordre + l’id du trait à persister.
 */
export function placeNewExtraAboveDivider<T extends { id: string }>(
  sortedItemsWithoutNew: T[],
  newItem: T,
  dividerAfterId: string | null | undefined,
): { ordered: T[]; nextDividerAfterId: string } {
  const withoutDup = sortedItemsWithoutNew.filter((item) => item.id !== newItem.id);
  const { above, below } = splitSortedExtrasByDivider(withoutDup, dividerAfterId);
  return {
    ordered: [...above, newItem, ...below],
    nextDividerAfterId: newItem.id,
  };
}
