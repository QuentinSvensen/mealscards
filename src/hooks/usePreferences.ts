/**
 * usePreferences — Hook de gestion des préférences utilisateur.
 *
 * Lit et écrit les préférences dans la table user_preferences (clé/valeur JSON).
 * Utilisé pour persister les modes de tri, les états de collapse,
 * les paramètres du chronomètre, les menus générés, etc.
 *
 * getPreference(key, default) : lit une préférence avec valeur par défaut
 * setPreference.mutate({ key, value }) : écrit ou met à jour une préférence
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

type PreferenceRow = { id: string; key: string; value: any };
type PreferenceEntry = { key: string; value: any };

/** Horodatage du dernier toast d'erreur préférences pour éviter le spam. */
let lastPreferenceErrorToastAt = 0;

/**
 * Indique si une erreur de préférence peut être ignorée (requête annulée volontairement).
 */
function isBenignPreferenceError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: string }).name) : "";
  const message = "message" in error ? String((error as { message?: string }).message) : "";
  return name === "AbortError" || message.includes("AbortError") || message.includes("signal is aborted");
}

/**
 * Extrait un message lisible depuis une erreur Supabase ou JavaScript.
 */
function getPreferenceErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message?: string }).message ?? "");
    if (message) return message;
  }
  return "Erreur inconnue";
}

/**
 * Affiche un toast d'erreur pour les écritures de préférences, sauf annulations bénignes.
 */
function reportPreferenceError(error: unknown) {
  if (isBenignPreferenceError(error)) return;
  const now = Date.now();
  if (now - lastPreferenceErrorToastAt < 3000) return;
  lastPreferenceErrorToastAt = now;
  toast({ title: "Erreur", description: getPreferenceErrorMessage(error), variant: "destructive" });
}

/**
 * Indique si l'id de préférence correspond à une ligne réellement persistée en base.
 */
function isPersistedPreferenceId(id: string): boolean {
  return !id.startsWith("optimistic-");
}

/**
 * Lit les préférences depuis le cache React Query pour éviter les lectures périmées.
 */
function readPreferencesFromCache(qc: ReturnType<typeof useQueryClient>): PreferenceRow[] {
  return qc.getQueryData<PreferenceRow[]>(["user_preferences"]) ?? [];
}

/**
 * Applique une écriture optimiste de préférences dans le cache local.
 */
function applyOptimisticPreferenceEntries(
  qc: ReturnType<typeof useQueryClient>,
  entries: PreferenceEntry[],
) {
  qc.setQueryData<PreferenceRow[]>(["user_preferences"], (old) => {
    if (!old) return old;
    const next = [...old];
    for (const { key, value } of entries) {
      const idx = next.findIndex((pref) => pref.key === key);
      if (idx >= 0) next[idx] = { ...next[idx], value };
      else next.push({ id: `optimistic-${key}`, key, value });
    }
    return next;
  });
}

/**
 * Écrit ou met à jour une préférence côté Supabase à partir du cache courant.
 */
async function upsertPreferenceValue(
  qc: ReturnType<typeof useQueryClient>,
  key: string,
  value: any,
) {
  const preferences = readPreferencesFromCache(qc);
  const existing = preferences.find((pref) => pref.key === key);
  if (existing && isPersistedPreferenceId(existing.id)) {
    const { error } = await supabase
      .from("user_preferences")
      .update({ value, updated_at: new Date().toISOString() } as any)
      .eq("id", existing.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ key, value } as any, { onConflict: "user_id,key" });
  if (error) throw error;
}

/** Préférences utilisateur (clé JSON) : lecture via React Query et écriture optimiste. */
export function usePreferences(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["user_preferences"] });

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        qc.invalidateQueries({ queryKey: ["user_preferences"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  const { data: preferences = [], isLoading } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("*");
      if (error) throw error;
      return data as PreferenceRow[];
    },
    retry: (failureCount, error) => {
      if (isBenignPreferenceError(error)) return false;
      return failureCount < 3;
    },
    retryDelay: 500,
    staleTime: 2 * 60 * 1000,
    enabled,
  });

  const getPreference = useCallback(<T>(key: string, defaultValue: T): T => {
    const pref = preferences.find(p => p.key === key);
    return pref ? (pref.value as T) : defaultValue;
  }, [preferences]);

  const setPreference = useMutation({
    mutationFn: async ({ key, value }: PreferenceEntry) => {
      await upsertPreferenceValue(qc, key, value);
    },
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: ["user_preferences"] });
      const previous = readPreferencesFromCache(qc);
      applyOptimisticPreferenceEntries(qc, [{ key, value }]);
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) qc.setQueryData(["user_preferences"], context.previous);
      reportPreferenceError(error);
    },
    onSettled: invalidate,
  });

  /**
   * Met à jour plusieurs préférences en une seule opération pour limiter les courses réseau concurrentes.
   */
  const setPreferencesBatch = useMutation({
    mutationFn: async (entries: PreferenceEntry[]) => {
      for (const { key, value } of entries) {
        await upsertPreferenceValue(qc, key, value);
      }
    },
    onMutate: async (entries) => {
      await qc.cancelQueries({ queryKey: ["user_preferences"] });
      const previous = readPreferencesFromCache(qc);
      applyOptimisticPreferenceEntries(qc, entries);
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) qc.setQueryData(["user_preferences"], context.previous);
      reportPreferenceError(error);
    },
    onSettled: invalidate,
  });

  return { preferences, getPreference, setPreference, setPreferencesBatch, isLoading };
}
