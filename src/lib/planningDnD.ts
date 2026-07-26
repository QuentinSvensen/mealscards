/**
 * Utilitaires DnD du Planning : détection des types dataTransfer
 * (les navigateurs exposent les types en ASCII minuscule) et lecture du pmId.
 */

export type PlanningSlotDragRef = {
  pmId: string;
  slotKey: string;
} | null;

/**
 * Indique si le dataTransfer contient un type donné (comparaison insensible à la casse).
 * Nécessaire car `types` est normalisé en minuscules (`pmId` → `pmid`).
 */
export function dataTransferHasType(
  dataTransfer: DataTransfer | null | undefined,
  type: string,
): boolean {
  if (!dataTransfer) return false;
  const wanted = type.toLowerCase();
  return Array.from(dataTransfer.types).some((t) => t.toLowerCase() === wanted);
}

/**
 * Indique si le drag en cours peut être une carte planning (PossibleMeal)
 * et doit donc être accepté par le conteneur d’un créneau (y compris zone vide).
 */
export function isPlanningCardDrag(
  dataTransfer: DataTransfer | null | undefined,
  draggedPlanningPmId?: string | null,
  slotDragRef?: PlanningSlotDragRef,
): boolean {
  if (draggedPlanningPmId || slotDragRef?.pmId) return true;
  return (
    dataTransferHasType(dataTransfer, "pmId") ||
    dataTransferHasType(dataTransfer, "mealId") ||
    dataTransferHasType(dataTransfer, "application/x-planning-pmid")
  );
}

/**
 * Indique si le créneau doit appeler preventDefault sur dragOver
 * (carte planning ou extra sélectionné / text/plain).
 */
export function canAcceptPlanningSlotDrag(
  dataTransfer: DataTransfer | null | undefined,
  draggedSelectedExtraId?: string | null,
  draggedPlanningPmId?: string | null,
  slotDragRef?: PlanningSlotDragRef,
): boolean {
  if (draggedSelectedExtraId) return true;
  if (dataTransferHasType(dataTransfer, "text/plain")) return true;
  return isPlanningCardDrag(dataTransfer, draggedPlanningPmId, slotDragRef);
}

/**
 * Lit l’id de la carte Possible déposée (dataTransfer + repli sur la ref de drag).
 */
export function getPlanningPmIdFromDrop(
  e: { dataTransfer: DataTransfer },
  slotDragRef?: PlanningSlotDragRef,
): string {
  const fromDt =
    e.dataTransfer.getData("pmId") ||
    e.dataTransfer.getData("application/x-planning-pmid") ||
    "";
  if (fromDt) return fromDt;
  return slotDragRef?.pmId || "";
}

/**
 * Enregistre les types dataTransfer au démarrage d’un drag de mini-carte planning.
 */
export function setPlanningCardDragData(dataTransfer: DataTransfer, pmId: string, mealId: string): void {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData("pmId", pmId);
  dataTransfer.setData("application/x-planning-pmid", pmId);
  dataTransfer.setData("mealId", mealId);
  dataTransfer.setData("source", "planning-slot");
}
