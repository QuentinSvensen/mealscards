/**
 * Miroir local + auto-réparation du trait extras après un incident Supabase
 * (préférence perdue / trait remonté alors que le catalogue local était plus large).
 */
import { useEffect, useRef } from "react";
import {
  FOOD_EXTRAS_DIVIDER_PREF_KEY,
  recoverExtrasDividerAfterId,
  syncLocalExtrasDividerBackup,
} from "@/lib/extrasDividerUtils";

type SetPreferenceMutate = {
  mutate: (args: { key: string; value: unknown }) => void;
};

/**
 * Maintient le miroir localStorage du trait et réécrit la préférence Supabase
 * si une réparation est nécessaire (extras redevenus visibles au Planning).
 */
export function useExtrasDividerRecovery(
  sortedExtras: { id: string }[],
  storedDividerAfterId: string | null | undefined,
  prefsReady: boolean,
  setPreference: SetPreferenceMutate,
): void {
  const healedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!prefsReady || sortedExtras.length === 0) return;

    const recoveryId = recoverExtrasDividerAfterId(sortedExtras, storedDividerAfterId);
    const effectiveId = recoveryId ?? storedDividerAfterId ?? null;

    syncLocalExtrasDividerBackup(sortedExtras, effectiveId);

    if (!recoveryId) {
      healedKeyRef.current = null;
      return;
    }

    const healKey = `${recoveryId}:${sortedExtras.map((i) => i.id).join(",")}`;
    if (healedKeyRef.current === healKey) return;
    healedKeyRef.current = healKey;

    setPreference.mutate({
      key: FOOD_EXTRAS_DIVIDER_PREF_KEY,
      value: recoveryId,
    });
  }, [prefsReady, setPreference, sortedExtras, storedDividerAfterId]);
}
