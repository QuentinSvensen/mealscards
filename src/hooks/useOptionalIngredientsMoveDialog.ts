import { useRef, useState } from "react";
import type { OptionalIngredientGroup } from "@/components/OptionalIngredientsMoveDialog";
import {
  defaultIncludedIngredientKeys,
  defaultIngredientQtyEdits,
  type IngredientQtyEdit,
} from "@/lib/ingredientUtils";

/** Résultat de la pop-up : cases cochées + quantités éventuellement modifiées. */
export type OptionalIngredientSelection = {
  includeKeys: Set<string>;
  qtyEdits: Record<string, IngredientQtyEdit>;
};

/**
 * Orchestre la pop-up des ingrédients lors d’un transfert vers Possible.
 * Expose une promesse (`ask`) résolue par Continuer (sélection) ou Annuler (`null`).
 * Les non optionnels sont pré-cochés ; les quantités sont éditables.
 */
export function useOptionalIngredientsMoveDialog() {
  const [optionalMoveDialog, setOptionalMoveDialog] = useState<{
    mealName: string;
    groups: OptionalIngredientGroup[];
    ingredients: string | null;
  } | null>(null);
  const [optionalIncludeKeys, setOptionalIncludeKeys] = useState<Set<string>>(() => new Set());
  const [optionalQtyEdits, setOptionalQtyEdits] = useState<Record<string, IngredientQtyEdit>>({});
  const optionalMoveResolveRef = useRef<((selection: OptionalIngredientSelection | null) => void) | null>(null);

  /**
   * Demande quels ingrédients inclure sur la carte Possible (null = annulation).
   * `ingredients` sert au recalcul live des macros cochées.
   */
  const askOptionalIngredientInclusions = (
    mealName: string,
    groups: OptionalIngredientGroup[],
    ingredients: string | null = null,
  ) =>
    new Promise<OptionalIngredientSelection | null>((resolve) => {
      optionalMoveResolveRef.current = resolve;
      setOptionalIncludeKeys(defaultIncludedIngredientKeys(groups));
      setOptionalQtyEdits(defaultIngredientQtyEdits(groups));
      setOptionalMoveDialog({ mealName, groups, ingredients });
    });

  /** Ferme la pop-up et résout la promesse en attente. */
  const finishOptionalMoveDialog = (selection: OptionalIngredientSelection | null) => {
    const resolve = optionalMoveResolveRef.current;
    optionalMoveResolveRef.current = null;
    setOptionalMoveDialog(null);
    setOptionalIncludeKeys(new Set());
    setOptionalQtyEdits({});
    resolve?.(selection);
  };

  /** Alterne l'inclusion d'un ingrédient dans la sélection de la pop-up. */
  const toggleOptionalIncludeKey = (key: string) => {
    setOptionalIncludeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Met à jour la quantité (grammes) ou le compteur d'un ingrédient dans la pop-up. */
  const updateOptionalQtyEdit = (key: string, field: keyof IngredientQtyEdit, value: string) => {
    setOptionalQtyEdits((prev) => ({
      ...prev,
      [key]: {
        qty: prev[key]?.qty ?? "",
        count: prev[key]?.count ?? "",
        [field]: value,
      },
    }));
  };

  return {
    optionalMoveDialog,
    optionalIncludeKeys,
    optionalQtyEdits,
    askOptionalIngredientInclusions,
    finishOptionalMoveDialog,
    toggleOptionalIncludeKey,
    updateOptionalQtyEdit,
  };
}
