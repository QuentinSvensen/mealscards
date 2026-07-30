/**
 * Hook client pour brancher Google Agenda en lecture seule
 * (OAuth via Edge Functions + événements de la semaine).
 */
import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  /** colorId Google 1–11 si défini sur l'événement. */
  colorId: string | null;
  /** Origine de la couleur : label moderne, colorId événement, ou héritage agenda. */
  colorSource?: "label" | "event" | "calendar";
  /** ID du label Google (sélecteur moderne) si présent. */
  eventLabelId?: string | null;
  /** colorId de l’agenda source (palette calendar). */
  calendarColorId?: string | null;
  /** Couleur de fond résolue (colorId ou héritage du calendrier). */
  backgroundColor: string | null;
  /** Couleur de texte (optionnelle). */
  foregroundColor: string | null;
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/** Appelle une Edge Function Google Calendar avec le JWT de session. */
async function callGoogleFunction<T>(
  name: string,
  options: { method?: string; query?: Record<string, string> } = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Session expirée — reconnecte-toi avec le PIN");
  }
  const base = import.meta.env.VITE_SUPABASE_URL;
  const url = new URL(`${base}/functions/v1/${name}`);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Erreur ${name} (${res.status})`);
  }
  return json as T;
}

/**
 * Gère connexion / déconnexion Google Agenda et charge les événements
 * de la plage ISO [timeMin, timeMax[ pour la vue Planning.
 * Rafraîchit automatiquement (polling + retour d’onglet) pour refléter
 * les modifs faites dans Google Agenda sans F5.
 */
export function useGoogleCalendar(timeMin: string | null, timeMax: string | null, enabled: boolean) {
  const qc = useQueryClient();

  /** Intervalle de sync (ms) tant que l’onglet Agenda est ouvert et visible. */
  const EVENTS_POLL_MS = 20_000;

  const statusQuery = useQuery({
    queryKey: ["google_calendar_status"],
    enabled,
    queryFn: async () => {
      const json = await callGoogleFunction<{ success: boolean; connected: boolean }>(
        "google-calendar-status",
      );
      return Boolean(json.connected);
    },
    staleTime: 60_000,
    retry: false,
  });

  const eventsConnected = enabled && statusQuery.data === true;

  const eventsQuery = useQuery({
    queryKey: ["google_calendar_events", timeMin, timeMax],
    enabled: eventsConnected && Boolean(timeMin && timeMax),
    queryFn: async () => {
      const json = await callGoogleFunction<{
        success: boolean;
        events: GoogleCalendarEvent[];
      }>("google-calendar-events", {
        query: { timeMin: timeMin!, timeMax: timeMax! },
      });
      return json.events || [];
    },
    // Assez court pour qu’un retour d’onglet / poll récupère les nouvelles modifs
    staleTime: 8_000,
    refetchInterval: eventsConnected ? EVENTS_POLL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const json = await callGoogleFunction<{ success: boolean; url: string }>(
        "google-calendar-oauth-start",
        { method: "POST" },
      );
      if (!json.url) throw new Error("URL OAuth manquante");
      window.location.href = json.url;
    },
    onError: (err: Error) => {
      toast({
        title: "Connexion Google impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await callGoogleFunction("google-calendar-disconnect", { method: "POST" });
    },
    onSuccess: () => {
      qc.setQueryData(["google_calendar_status"], false);
      qc.removeQueries({ queryKey: ["google_calendar_events"] });
      toast({ title: "Google Agenda déconnecté" });
    },
    onError: (err: Error) => {
      toast({
        title: "Déconnexion impossible",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  /** Traite le retour OAuth (?google_calendar=connected|error) dans l’URL. */
  const consumeOAuthReturnParams = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("google_calendar");
    if (!status) return;
    const err = params.get("google_calendar_error");
    params.delete("google_calendar");
    params.delete("google_calendar_error");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);

    if (status === "connected") {
      qc.setQueryData(["google_calendar_status"], true);
      qc.invalidateQueries({ queryKey: ["google_calendar_events"] });
      toast({ title: "Google Agenda connecté", description: "Lecture seule — fond de planning." });
    } else {
      toast({
        title: "Connexion Google annulée",
        description: err || "Réessaie plus tard",
        variant: "destructive",
      });
    }
  }, [qc]);

  useEffect(() => {
    if (!enabled) return;
    consumeOAuthReturnParams();
  }, [enabled, consumeOAuthReturnParams]);

  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);

  return {
    connected: statusQuery.data === true,
    statusLoading: statusQuery.isLoading,
    events,
    eventsLoading: eventsQuery.isLoading,
    eventsError: eventsQuery.error as Error | null,
    connect: () => connectMutation.mutate(),
    disconnect: () => disconnectMutation.mutate(),
    connecting: connectMutation.isPending,
    disconnecting: disconnectMutation.isPending,
    refetchEvents: () => eventsQuery.refetch(),
  };
}
