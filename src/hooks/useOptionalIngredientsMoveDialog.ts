import { useRef, useState } from "react";
import type { OptionalIngredientGroup } from "@/components/OptionalIngredientsMoveDialog";

/**
 * Orchestre la pop-up des ingrédients optionnels lors d’un transfert vers Possible.
 * Expose une promesse (`ask`) résolue par Continuer (clés cochées) ou Annuler (`null`).
 */
export function useOptionalIngredientsMoveDialog() {
  const [optionalMoveDialog, setOptionalMoveDialog] = useState<{
    mealName: string;
    groups: OptionalIngredientGroup[];
  } | null>(null);
  const [optionalIncludeKeys, setOptionalIncludeKeys] = useState<Set<string>>(() => new Set());
  const optionalMoveResolveRef = useRef<((keys: Set<string> | null) => void) | null>(null);

  /** Demande à l'utilisateur quels optionnels inclure sur la carte Possible (null = annulation). */
  const askOptionalIngredientInclusions = (mealName: string, groups: OptionalIngredientGroup[]) =>
    new Promise<Set<string> | null>((resolve) => {
      optionalMoveResolveRef.current = resolve;
      setOptionalIncludeKeys(new Set());
      setOptionalMoveDialog({ mealName, groups });
    });

  /** Ferme la pop-up optionnels et résout la promesse en attente. */
  const finishOptionalMoveDialog = (keys: Set<string> | null) => {
    const resolve = optionalMoveResolveRef.current;
    optionalMoveResolveRef.current = null;
    setOptionalMoveDialog(null);
    setOptionalIncludeKeys(new Set());
    resolve?.(keys);
  };

  /** Alterne l'inclusion d'un ingrédient optionnel dans la sélection de la pop-up. */
  const toggleOptionalIncludeKey = (key: string) => {
    setOptionalIncludeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return {
    optionalMoveDialog,
    optionalIncludeKeys,
    askOptionalIngredientInclusions,
    finishOptionalMoveDialog,
    toggleOptionalIncludeKey,
  };
}
