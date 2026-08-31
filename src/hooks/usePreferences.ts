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
 * Source de vérité = Supabase. Le cache React Query / PersistQueryClient
 * accélère l’UI ; on évite les refetch agressifs (focus / token) pour limiter l’egress.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { resolveCurrentUserId, setCachedUserId } from "@/lib/authUserId";

type PreferenceRow = { id: string; key: string; value: any };
type PreferenceEntry = { key: string; value: any };

/** Canal BroadcastChannel pour synchroniser les prefs entre onglets sans refetch serveur. */
const PREFS_SYNC_CHANNEL = "mealcards-user-preferences-sync";

/** Clés catalogue Bonus : écritures coalescées (dernier état gagne, anti course multi-onglet locale). */
const BONUS_CATALOG_PREF_KEYS = new Set([
  "bonus_zero_calorie_groups",
  "bonus_zero_calorie_lines",
  "bonus_low_calorie_groups",
]);

/** File d’attente par clé : une seule upsert à la fois, toujours avec la dernière valeur. */
const bonusCatalogWriteState = new Map<
  string,
  { pending: unknown | undefined; running: boolean }
>();

/**
 * Enfile une écriture catalogue Bonus : si une upsert est en cours, remplace seulement
 * la valeur en attente (évite qu’une vieille mutation finisse après une plus récente).
 */
async function enqueueBonusCatalogUpsert(
  key: string,
  value: unknown,
  userId?: string,
): Promise<void> {
  if (!BONUS_CATALOG_PREF_KEYS.has(key)) {
    await upsertPreferenceValue(key, value, userId);
    return;
  }
  let state = bonusCatalogWriteState.get(key);
  if (!state) {
    state = { pending: undefined, running: false };
    bonusCatalogWriteState.set(key, state);
  }
  state.pending = value;
  if (state.running) return;
  state.running = true;
  try {
    while (state.pending !== undefined) {
      const nextValue = state.pending;
      state.pending = undefined;
      await upsertPreferenceValue(key, nextValue, userId);
    }
  } finally {
    state.running = false;
    if (state.pending !== undefined) {
      void enqueueBonusCatalogUpsert(key, state.pending, userId);
    }
  }
}

/** Cache prefs : 10 min — réduit fortement les re-téléchargements de user_preferences. */
const PREFERENCES_STALE_TIME_MS = 10 * 60 * 1000;

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
 * Diffuse un patch de préférences aux autres onglets (sans forcer un select(*) serveur).
 */
function broadcastPreferencePatch(entries: PreferenceEntry[]) {
  try {
    const channel = new BroadcastChannel(PREFS_SYNC_CHANNEL);
    channel.postMessage({ type: "patch", entries, at: Date.now() });
    channel.close();
  } catch {
    // BroadcastChannel indisponible : ignore.
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

  useEffect(() => {
    if (!enabled) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setCachedUserId(session?.user?.id ?? null);
      // TOKEN_REFRESHED / INITIAL_SESSION ne doivent pas re-télécharger toute la table prefs.
      if (event === "SIGNED_IN") {
        qc.invalidateQueries({ queryKey: ["user_preferences"] });
      }
    });
    return () => subscription.unsubscribe();
  }, [qc, enabled]);

  /**
   * Synchronise les autres onglets via patch local (pas de refetch focus / visibility).
   */
  useEffect(() => {
    if (!enabled) return;

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PREFS_SYNC_CHANNEL);
      channel.onmessage = (event) => {
        const data = event.data as { type?: string; entries?: PreferenceEntry[] } | null;
        if (data?.type === "patch" && Array.isArray(data.entries)) {
          applyOptimisticPreferenceEntries(qc, data.entries);
        }
      };
    } catch {
      channel = null;
    }

    return () => {
      channel?.close();
    };
  }, [qc, enabled]);

  const { data: preferences = [], isLoading } = useQuery({
    queryKey: ["user_preferences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_preferences")
        .select("id, key, value");
      if (error) throw error;
      return data as PreferenceRow[];
    },
    retry: (failureCount, error) => {
      if (isBenignPreferenceError(error)) return false;
      return failureCount < 3;
    },
    retryDelay: 500,
    staleTime: 0,
    // Toujours relire Supabase au montage et au focus : synchronisation instantanée.
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
      await enqueueBonusCatalogUpsert(key, value);
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
    onSuccess: (_data, vars) => {
      // Cache déjà à jour via onMutate — pas d’invalidate (évite select(*) après chaque write).
      broadcastPreferencePatch([vars]);
    },
  });

  /**
   * Met à jour plusieurs préférences en une seule opération pour limiter les courses réseau concurrentes.
   */
  const setPreferencesBatch = useMutation({
    mutationFn: async (entries: PreferenceEntry[]) => {
      const userId = await resolveCurrentUserId();
      for (const { key, value } of entries) {
        await enqueueBonusCatalogUpsert(key, value, userId);
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
    onSuccess: (_data, entries) => {
      broadcastPreferencePatch(entries);
    },
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
        .select("id, key, value");
      if (error) throw error;
      return rows as PreferenceRow[];
    },
    select: (prefs) => {
      const pref = prefs.find((p) => p.key === key);
      return (pref ? pref.value : defaultValue) as T;
    },
    staleTime: PREFERENCES_STALE_TIME_MS,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled,
  });
  return (data !== undefined ? data : defaultValue) as T;
}
