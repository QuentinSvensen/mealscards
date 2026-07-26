/**
 * Utilitaires DnD pour réordonner des cartes en droppant dans le vide d’un conteneur
 * (padding, gaps, fond), pas seulement sur une autre carte.
 */

/** Élément minimal pour lire la position verticale (tests + DOM). */
export type ReorderCardRectSource = {
  getBoundingClientRect: () => { top: number; height: number };
};

/**
 * Calcule l’index d’insertion (0..n) selon la position Y du pointeur parmi les cartes.
 * Sert à placer l’élément avant la première carte dont le milieu est sous le curseur.
 */
export function findInsertIndexBefore(
  clientY: number,
  cardElements: ReorderCardRectSource[],
): number {
  for (let i = 0; i < cardElements.length; i++) {
    const rect = cardElements[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return cardElements.length;
}

/**
 * Convertit un index d’insertion (avant retrait) en index cible pour un splice après retrait de fromIndex.
 * Retourne null si le déplacement est un no-op.
 */
export function resolveReorderToIndex(fromIndex: number, insertBefore: number): number | null {
  if (fromIndex < 0 || insertBefore < 0) return null;
  let toIndex = insertBefore;
  if (fromIndex < insertBefore) toIndex = insertBefore - 1;
  if (toIndex < 0 || toIndex === fromIndex) return null;
  return toIndex;
}

/**
 * Calcule l’index de réordonnancement à partir de la position Y du drop parmi les cartes.
 * Retourne null si aucun déplacement n’est nécessaire.
 */
export function resolveReorderDropIndex(
  fromIndex: number,
  clientY: number,
  cardElements: ReorderCardRectSource[],
): number | null {
  if (fromIndex < 0 || cardElements.length === 0) return null;
  const insertBefore = findInsertIndexBefore(clientY, cardElements);
  return resolveReorderToIndex(fromIndex, insertBefore);
}

/**
 * Collecte les cartes marquées pour le réordonnancement dans un conteneur, triées par index.
 */
export function queryReorderCards(
  container: ParentNode | null,
  selector = "[data-reorder-idx]",
): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).sort((a, b) => {
    const ai = Number(a.getAttribute("data-reorder-idx") ?? a.getAttribute("data-food-idx") ?? a.getAttribute("data-upu-idx") ?? 0);
    const bi = Number(b.getAttribute("data-reorder-idx") ?? b.getAttribute("data-food-idx") ?? b.getAttribute("data-upu-idx") ?? 0);
    return ai - bi;
  });
}

/**
 * Applique un drop « zone vide » : calcule la cible et appelle onReorder si pertinent.
 * Retourne true si un drag interne était en cours (même sans déplacement effectif).
 */
export function applyContainerReorderDrop(
  fromIndex: number | null,
  clientY: number,
  container: ParentNode | null,
  onReorder: (fromIndex: number, toIndex: number) => void,
  selector = "[data-reorder-idx]",
): boolean {
  if (fromIndex === null) return false;
  const toIndex = resolveReorderDropIndex(fromIndex, clientY, queryReorderCards(container, selector));
  if (toIndex !== null) onReorder(fromIndex, toIndex);
  return true;
}
