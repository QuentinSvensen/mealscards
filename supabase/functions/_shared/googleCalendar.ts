/**
 * Helpers partagés des Edge Functions Google Calendar (OAuth lecture seule).
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly";

/** Client admin Supabase (service role). */
export function createAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Vérifie le JWT Bearer et renvoie l’utilisateur authentifié. */
export async function requireUser(req: Request): Promise<{ id: string; email?: string } | Response> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.replace("Bearer ", "");
  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { data: { user }, error } = await supabaseAnon.auth.getUser(token);
  if (error || !user) {
    return new Response(JSON.stringify({ success: false, error: "Non autorisé" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return { id: user.id, email: user.email };
}

/** Indique si la valeur est déjà une Response d’erreur. */
export function isErrorResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** URI de redirection OAuth Google (Edge Function callback). */
export function getGoogleRedirectUri(): string {
  const explicit = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (explicit) return explicit;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return `${supabaseUrl}/functions/v1/google-calendar-oauth-callback`;
}

/** URL de retour app après OAuth (frontend). */
export function getAppRedirectBase(): string {
  return Deno.env.get("GOOGLE_APP_REDIRECT") || Deno.env.get("APP_URL") || "http://localhost:3000/planning";
}

/** Échange un refresh_token contre un access_token Google à jour. */
export async function getValidAccessToken(
  admin: SupabaseClient,
  userId: string,
): Promise<{ accessToken: string } | { error: string; status: number }> {
  const { data: row, error } = await admin
    .from("google_calendar_connections")
    .select("refresh_token, access_token, expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("google_calendar_connections read", error);
    return { error: "Erreur lecture connexion", status: 500 };
  }
  if (!row?.refresh_token) {
    return { error: "Google Agenda non connecté", status: 404 };
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expiresAt > Date.now() + 60_000) {
    return { accessToken: row.access_token as string };
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return { error: "OAuth Google non configuré", status: 500 };
  }

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
    console.error("Google refresh failed", tokenJson);
    return { error: "Impossible de rafraîchir le token Google", status: 502 };
  }

  const expiresIn = Number(tokenJson.expires_in) || 3600;
  const newExpires = new Date(Date.now() + expiresIn * 1000).toISOString();

  await admin
    .from("google_calendar_connections")
    .update({
      access_token: tokenJson.access_token,
      expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return { accessToken: tokenJson.access_token as string };
}
