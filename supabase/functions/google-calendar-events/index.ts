import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function getValidAccessToken(admin: ReturnType<typeof createClient>, userId: string) {
  const { data: row, error } = await admin
    .from("google_calendar_connections")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { error: "Erreur lecture connexion", status: 500 };
  if (!row?.refresh_token) return { error: "Google Agenda non connecté", status: 404 };

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expiresAt > Date.now() + 60_000) {
    return { accessToken: row.access_token as string };
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { error: "OAuth Google non configuré", status: 500 };

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: row.refresh_token as string,
    grant_type: "refresh_token",
  });

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    return { error: "Impossible de rafraîchir le token Google", status: 502 };
  }

  const expiresIn = Number(tokenJson.expires_in) || 3600;
  const newExpires = new Date(Date.now() + expiresIn * 1000).toISOString();
  await admin
    .from("google_calendar_connections")
    .update({ access_token: tokenJson.access_token, expires_at: newExpires, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  return { accessToken: tokenJson.access_token as string };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const timeMin = url.searchParams.get("timeMin");
    const timeMax = url.searchParams.get("timeMax");
    if (!timeMin || !timeMax) {
      return new Response(JSON.stringify({ success: false, error: "timeMin et timeMax requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const tokenResult = await getValidAccessToken(admin, user.id);
    if ("error" in tokenResult) {
      return new Response(JSON.stringify({ success: false, error: tokenResult.error }), {
        status: tokenResult.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authH = { Authorization: `Bearer ${tokenResult.accessToken}` };

    const [calListRes, colorsRes] = await Promise.all([
      fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { headers: authH }),
      fetch("https://www.googleapis.com/calendar/v3/colors", { headers: authH }),
    ]);

    // Mappe colorId → couleurs (événements + agendas)
    const eventColorMap: Record<string, { background: string; foreground: string }> = {};
    const calendarColorMap: Record<string, { background: string; foreground: string }> = {};
    if (colorsRes.ok) {
      const colorsJson = await colorsRes.json();
      for (const [id, val] of Object.entries(
        (colorsJson.event || {}) as Record<string, { background?: string; foreground?: string }>,
      )) {
        if (val?.background) {
          eventColorMap[id] = {
            background: val.background,
            foreground: val.foreground || "#1d1d1d",
          };
        }
      }
      for (const [id, val] of Object.entries(
        (colorsJson.calendar || {}) as Record<string, { background?: string; foreground?: string }>,
      )) {
        if (val?.background) {
          calendarColorMap[id] = {
            background: val.background,
            foreground: val.foreground || "#1d1d1d",
          };
        }
      }
    }

    type CalMeta = {
      id: string;
      backgroundColor: string | null;
      foregroundColor: string | null;
      colorId: string | null;
      /** Labels modernes (sélecteur 24 couleurs / catégories) → hex. */
      labelColors: Record<string, string>;
    };
    const calendars: CalMeta[] = [];
    if (calListRes.ok) {
      const calListJson = await calListRes.json();
      for (const cal of (calListJson.items || []) as Array<Record<string, unknown>>) {
        if (cal.selected === false) continue;
        if (!cal.id) continue;
        calendars.push({
          id: String(cal.id),
          backgroundColor: cal.backgroundColor ? String(cal.backgroundColor) : null,
          foregroundColor: cal.foregroundColor ? String(cal.foregroundColor) : null,
          colorId: cal.colorId ? String(cal.colorId) : null,
          labelColors: {},
        });
      }
    }
    if (calendars.length === 0) {
      calendars.push({
        id: "primary",
        backgroundColor: null,
        foregroundColor: null,
        colorId: null,
        labelColors: {},
      });
    }

    // Labels modernes (eventLabelVersion=1) : hex réels du sélecteur Agenda
    await Promise.all(
      calendars.map(async (cal) => {
        try {
          const res = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}`,
            { headers: authH },
          );
          if (!res.ok) return;
          const json = await res.json();
          const labels = (json?.labelProperties?.eventLabels || []) as Array<{
            id?: string;
            backgroundColor?: string;
          }>;
          for (const label of labels) {
            if (label?.id && label?.backgroundColor) {
              cal.labelColors[String(label.id)] = String(label.backgroundColor);
            }
          }
        } catch {
          // Ignore : on retombe sur colorId legacy
        }
      }),
    );

    const query = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      // Obligatoire pour recevoir eventLabelId (couleurs du sélecteur moderne)
      eventLabelVersion: "1",
    }).toString();

    // Charge les événements de tous les agendas visibles (pas seulement primary)
    const eventResponses = await Promise.all(
      calendars.map(async (cal) => {
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${query}`,
          { headers: authH },
        );
        if (!res.ok) return { cal, items: [] as Record<string, unknown>[] };
        const json = await res.json();
        return { cal, items: (json.items || []) as Record<string, unknown>[] };
      }),
    );

    const seen = new Set<string>();
    const events: Array<Record<string, unknown>> = [];

    for (const { cal, items } of eventResponses) {
      for (const item of items) {
        const id = String(item.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const startObj = (item.start || {}) as { dateTime?: string; date?: string };
        const endObj = (item.end || {}) as { dateTime?: string; date?: string };
        const allDay = Boolean(startObj.date && !startObj.dateTime);
        const colorId = item.colorId ? String(item.colorId) : null;
        const eventLabelId = item.eventLabelId ? String(item.eventLabelId) : null;
        const labelHex = eventLabelId ? cal.labelColors[eventLabelId] || null : null;

        // Priorité : label moderne (hex) > colorId legacy événement > couleur agenda
        let backgroundColor: string | null = null;
        let foregroundColor: string | null = null;
        let colorSource: "label" | "event" | "calendar" = "calendar";

        if (labelHex) {
          colorSource = "label";
          backgroundColor = labelHex;
          foregroundColor = "#1d1d1d";
        } else if (colorId && eventColorMap[colorId]) {
          colorSource = "event";
          backgroundColor = eventColorMap[colorId].background;
          foregroundColor = eventColorMap[colorId].foreground;
        } else if (cal.colorId && calendarColorMap[cal.colorId]) {
          backgroundColor = calendarColorMap[cal.colorId].background;
          foregroundColor = calendarColorMap[cal.colorId].foreground;
        } else if (cal.backgroundColor) {
          backgroundColor = cal.backgroundColor;
          foregroundColor = cal.foregroundColor;
        }

        events.push({
          id,
          summary: String(item.summary || "(Sans titre)"),
          start: startObj.dateTime || startObj.date || "",
          end: endObj.dateTime || endObj.date || "",
          allDay,
          colorId,
          eventLabelId,
          colorSource,
          calendarColorId: cal.colorId,
          backgroundColor,
          foregroundColor,
          calendarId: cal.id,
        });
      }
    }

    return new Response(JSON.stringify({ success: true, connected: true, events }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("google-calendar-events", e);
    return new Response(JSON.stringify({ success: false, error: "Erreur serveur" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
