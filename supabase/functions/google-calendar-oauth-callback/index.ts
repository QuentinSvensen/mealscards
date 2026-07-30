import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function getAppRedirectBase(): string {
  return Deno.env.get("GOOGLE_APP_REDIRECT") || Deno.env.get("APP_URL") || "http://localhost:3000/planning";
}

function getGoogleRedirectUri(): string {
  return Deno.env.get("GOOGLE_REDIRECT_URI") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-calendar-oauth-callback`;
}

function redirectToApp(status: "connected" | "error", message?: string): Response {
  const base = getAppRedirectBase();
  const url = new URL(base);
  url.searchParams.set("google_calendar", status);
  if (message) url.searchParams.set("google_calendar_error", message);
  return Response.redirect(url.toString(), 302);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) return redirectToApp("error", oauthError);
    if (!code || !state) return redirectToApp("error", "code_ou_state_manquant");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: stateRow, error: stateReadError } = await admin
      .from("google_calendar_oauth_states")
      .select("user_id, expires_at")
      .eq("state", state)
      .maybeSingle();

    await admin.from("google_calendar_oauth_states").delete().eq("state", state);

    if (stateReadError || !stateRow) return redirectToApp("error", "state_invalide");
    if (new Date(stateRow.expires_at).getTime() < Date.now()) return redirectToApp("error", "state_expire");

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    if (!clientId || !clientSecret) return redirectToApp("error", "oauth_non_configure");

    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: "authorization_code",
    });

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error("token exchange failed", tokenJson);
      return redirectToApp("error", "echange_token");
    }

    const refreshToken = tokenJson.refresh_token as string | undefined;
    const expiresIn = Number(tokenJson.expires_in) || 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const { data: existing } = await admin
      .from("google_calendar_connections")
      .select("refresh_token")
      .eq("user_id", stateRow.user_id)
      .maybeSingle();

    const finalRefresh = refreshToken || existing?.refresh_token;
    if (!finalRefresh) return redirectToApp("error", "refresh_token_manquant");

    const { error: upsertError } = await admin.from("google_calendar_connections").upsert({
      user_id: stateRow.user_id,
      refresh_token: finalRefresh,
      access_token: tokenJson.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });

    if (upsertError) {
      console.error("upsert connection", upsertError);
      return redirectToApp("error", "stockage_token");
    }

    return redirectToApp("connected");
  } catch (e) {
    console.error("google-calendar-oauth-callback", e);
    return redirectToApp("error", "erreur_serveur");
  }
});
