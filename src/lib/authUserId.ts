/**
 * Cache partagé de l’id utilisateur Supabase.
 * Évite les appels concurrents à getUser() (contention Web Locks → AbortError locks.js).
 */
import { supabase } from "@/integrations/supabase/client";

/** Id utilisateur mis en cache après session / getUser. */
let cachedUserId: string | null = null;

/** Promesse unique en cours de résolution (évite les courses). */
let resolveUserIdInFlight: Promise<string> | null = null;

/**
 * Met à jour le cache d’id utilisateur (ex. depuis onAuthStateChange).
 */
export function setCachedUserId(userId: string | null) {
  cachedUserId = userId;
}

/**
 * Retourne l’id utilisateur courant, en réutilisant le cache / une seule requête auth.
 */
export async function resolveCurrentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  if (resolveUserIdInFlight) return resolveUserIdInFlight;

  resolveUserIdInFlight = (async () => {
    // getSession lit d’abord le stockage local — moins conflictuel que getUser() réseau.
    const { data: sessionData } = await supabase.auth.getSession();
    const sessionUserId = sessionData.session?.user?.id;
    if (sessionUserId) {
      cachedUserId = sessionUserId;
      return sessionUserId;
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error("Non connecté — impossible de résoudre l’utilisateur");
    cachedUserId = user.id;
    return user.id;
  })().finally(() => {
    resolveUserIdInFlight = null;
  });

  return resolveUserIdInFlight;
}
