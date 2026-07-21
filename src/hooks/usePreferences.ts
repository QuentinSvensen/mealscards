/**
 * usePreferences — Hook de gestion des préférences utilisateur.
 *
 * Lit et écrit les préférences dans la table user_preferences (clé/valeur JSON).
 * Utilisé pour persister les modes de tri, les états de collapse,
 * les paramètres du chronomètre, les menus générés, etc.
 *
 * getPreference(key, default) : lit une préférence avec valeur par défaut
 * setPreference.mutate({ key, value }) : écrit ou met à jour une préférence
 *
 * Source de vérité = Supabase (pas localStorage seul). Le cache React Query /
 * PersistQueryClient n’est qu’un accélérateur ; chaque session recharge depuis le serveur.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { resolveCurrentUserId, setCachedUserId } from "@/lib/authUserId";

type PreferenceRow = { id: string; key: string; value: any };
type PreferenceEntry = { key: string; value: any };

/** Canal BroadcastChannel pour invalider les prefs entre onglets du même navigateur. */
const PREFS_SYNC_CHANNEL = "mealcards-user-preferences-sync";

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
    const next = [...(old ?? [])];
    for (const { key, value } of entries) {
      const idx = next.findIndex((pref) => pref.key === key);
      if (idx >= 0) next[idx] = { ...next[idx], value };
      else next.push({ id: `optimistic-${key}`, key, value });
    }
    return next;
  });
}

/**
 * Notifie les autres onglets qu’il faut recharger les préférences depuis le serveur.
 */
function broadcastPreferencesInvalidation() {
  try {
    const channel = new BroadcastChannel(PREFS_SYNC_CHANNEL);
    channel.postMessage({ type: "invalidate", at: Date.now() });
    channel.close();
  } catch {
    // BroadcastChannel indisponible (contexte privé / navigateur ancien) : ignore.
  }
}

/**
 * Écrit ou met à jour une préférence côté Supabase avec user_id (source partagée entre sessions).
 * Toujours un upsert sur (user_id, key) pour ne pas dépendre d’un id de cache local potentiellement périmé.
 * @param userId - Id déjà résolu (évite un nouvel appel auth par entrée en batch).
 */
async function upsertPreferenceValue(key: string, value: any, userId?: string) {
  const uid = userId ?? (await resolveCurrentUserId());

  const { error } = await supabase.from("user_preferences").upsert(
    {
      user_id: uid,
      key,
      value,
      updated_at: new Date().toISOString(),
    } as any,
    { onConflict: "user_id,key" },
  );
  if (error) throw error;
}

/** Préférences utilisateur (clé JSON) : lecture via React Query et écriture optimiste. */
export function usePreferences(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["user_preferences"] });
    broadcastPreferencesInvalidation();
  };

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Garde le cache auth aligné pour les écritures de préférences concurrentes.
      setCachedUserId(session?.user?.id ?? null);
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        qc.invalidateQueries({ queryKey: ["user_preferences"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  /**
   * Écoute les autres onglets + retour au premier plan pour resynchroniser depuis Supabase.
   */
  useEffect(() => {
    if (!enabled) return;

    const refreshFromServer = () => {
      qc.invalidateQueries({ queryKey: ["user_preferences"] });
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PREFS_SYNC_CHANNEL);
      channel.onmessage = () => refreshFromServer();
    } catch {
      channel = null;
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshFromServer();
    };

    window.addEventListener("online", refreshFromServer);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      channel?.close();
      window.removeEventListener("online", refreshFromServer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
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
    // Cache court : accélère l’UI mais une nouvelle session / focus recharge depuis le serveur.
    staleTime: 30 * 1000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    enabled,
  });

  const getPreference = useCallback(<T>(key: string, defaultValue: T): T => {
    const pref = preferences.find(p => p.key === key);
    return pref ? (pref.value as T) : defaultValue;
  }, [preferences]);

  const setPreference = useMutation({
    mutationFn: async ({ key, value }: PreferenceEntry) => {
      await upsertPreferenceValue(key, value);
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
      // Une seule résolution auth pour tout le lot (évite la salve AbortError locks.js).
      const userId = await resolveCurrentUserId();
      for (const { key, value } of entries) {
        await upsertPreferenceValue(key, value, userId);
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

/**
 * Lit une seule clé de préférence via le cache React Query (`select`),
 * pour éviter de s’abonner à tout le tableau `user_preferences` quand un seul champ suffit.
 */
export function usePreferenceValue<T>(key: string, defaultValue: T, options?: { enabled?: boolean }): T {
  const enabled = options?.enabled ?? true;
  const { data } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("user_preferences")
        .select("*");
      if (error) throw error;
      return rows as PreferenceRow[];
    },
    select: (prefs) => {
      const pref = prefs.find((p) => p.key === key);
      return (pref ? pref.value : defaultValue) as T;
    },
    staleTime: 30 * 1000,
    enabled,
  });
  return (data !== undefined ? data : defaultValue) as T;
}
