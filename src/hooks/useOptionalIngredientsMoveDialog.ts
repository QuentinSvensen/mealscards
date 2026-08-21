import { useRef, useState } from "react";
import type { OptionalIngredientGroup, OptionalStockSnapshot } from "@/lib/ingredientUtils";
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
 * Les non optionnels sont pré-cochés ; pour un « ou », seule l’alt. stockée est cochée.
 * Si `ask` est rappelé avant `finish`, la promesse précédente est résolue à `null`.
 */
export function useOptionalIngredientsMoveDialog() {
  const [optionalMoveDialog, setOptionalMoveDialog] = useState<{
    mealName: string;
    mealCategory: string | null;
    groups: OptionalIngredientGroup[];
    ingredients: string | null;
  } | null>(null);
  const [optionalIncludeKeys, setOptionalIncludeKeys] = useState<Set<string>>(() => new Set());
  const [optionalQtyEdits, setOptionalQtyEdits] = useState<Record<string, IngredientQtyEdit>>({});
  const optionalMoveResolveRef = useRef<((selection: OptionalIngredientSelection | null) => void) | null>(null);
  const groupsRef = useRef<OptionalIngredientGroup[]>([]);

  /**
   * Demande quels ingrédients inclure sur la carte Possible (null = annulation).
   * `stockMap` sert à pré-cocher la bonne alternative « ou ».
   * `mealCategory` sert à afficher la note nutritionnelle dans la pop-up.
   */
  const askOptionalIngredientInclusions = (
    mealName: string,
    groups: OptionalIngredientGroup[],
    ingredients: string | null = null,
    stockMap?: Map<string, OptionalStockSnapshot>,
    mealCategory: string | null = null,
  ) =>
    new Promise<OptionalIngredientSelection | null>((resolve) => {
      // Garde re-entrante : annule la demande précédente encore ouverte.
      const previous = optionalMoveResolveRef.current;
      if (previous) {
        optionalMoveResolveRef.current = null;
        previous(null);
      }
      optionalMoveResolveRef.current = resolve;
      groupsRef.current = groups;
      setOptionalIncludeKeys(defaultIncludedIngredientKeys(groups, stockMap));
      setOptionalQtyEdits(defaultIngredientQtyEdits(groups));
      setOptionalMoveDialog({ mealName, mealCategory, groups, ingredients });
    });

  /** Ferme la pop-up et résout la promesse en attente. */
  const finishOptionalMoveDialog = (selection: OptionalIngredientSelection | null) => {
    const resolve = optionalMoveResolveRef.current;
    optionalMoveResolveRef.current = null;
    groupsRef.current = [];
    setOptionalMoveDialog(null);
    setOptionalIncludeKeys(new Set());
    setOptionalQtyEdits({});
    resolve?.(selection);
  };

  /**
   * Alterne l'inclusion d'un ingrédient.
   * Dans un groupe « ou », cocher une ligne sélectionne l'alternative (non optionnels)
   * et décoche les autres alternatives.
   */
  const toggleOptionalIncludeKey = (key: string) => {
    setOptionalIncludeKeys((prev) => {
      const next = new Set(prev);
      const group = groupsRef.current.find((g) =>
        g.alternatives.some((alt) => alt.items.some((item) => item.key === key)),
      );

      if (group && group.alternatives.length > 1) {
        const chosenAlt = group.alternatives.find((alt) => alt.items.some((item) => item.key === key));
        if (!chosenAlt) return next;

        if (next.has(key)) {
          // Décoche toute l'alternative courante
          for (const item of chosenAlt.items) next.delete(item.key);
          return next;
        }

        // Remplace les autres « ou » par cette alternative
        for (const alt of group.alternatives) {
          for (const item of alt.items) next.delete(item.key);
        }
        for (const item of chosenAlt.items) {
          next.add(item.key);
        }
        return next;
      }

      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Met à jour la quantité, le compteur ou le nom d'un ingrédient dans la pop-up. */
  const updateOptionalQtyEdit = (key: string, field: keyof IngredientQtyEdit, value: string) => {
    setOptionalQtyEdits((prev) => ({
      ...prev,
      [key]: {
        qty: prev[key]?.qty ?? "",
        count: prev[key]?.count ?? "",
        name: prev[key]?.name ?? "",
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
