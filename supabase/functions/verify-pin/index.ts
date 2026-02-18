import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "https://mealscards.lovable.app",
  "https://id-preview--326b1fb7-892d-4cdb-8e10-68c2c56390f5.lovable.app",
  "http://localhost:5173",
  "http://localhost:8080",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const MAX_ATTEMPTS_PER_IP = 5;
const GLOBAL_MAX_ATTEMPTS = 50;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const APP_USER_EMAIL = "app@internal.local";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }

    const { pin } = body as { pin?: string };

    if (!pin || typeof pin !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "PIN requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Global rate limit ---
    const { data: globalAttempts } = await supabaseAdmin
      .from("pin_attempts")
      .select("id")
      .eq("success", false)
      .gte("created_at", windowStart);

    if (globalAttempts && globalAttempts.length >= GLOBAL_MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ success: false, error: "Trop de tentatives globales. Réessayez dans 15 minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Per-IP rate limit ---
    const { data: ipAttempts } = await supabaseAdmin
      .from("pin_attempts")
      .select("id")
      .eq("ip", clientIp)
      .eq("success", false)
      .gte("created_at", windowStart);

    const ipAttemptCount = ipAttempts?.length ?? 0;

    if (ipAttemptCount >= MAX_ATTEMPTS_PER_IP) {
      return new Response(
        JSON.stringify({ success: false, error: "Trop de tentatives. Réessayez dans 15 minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Progressive delay (exponential backoff) ---
    if (ipAttemptCount > 0) {
      const delayMs = Math.min(Math.pow(2, ipAttemptCount - 1) * 1000, 16000);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const serverPin = Deno.env.get("VITE_APP_PIN");

    if (!serverPin) {
      return new Response(
        JSON.stringify({ success: false, error: "PIN non configuré" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isValid = pin === serverPin;

    if (!isValid) {
      await supabaseAdmin.from("pin_attempts").insert({
        ip: clientIp,
        success: false,
      });
    }

    // Clean up old attempts
    await supabaseAdmin
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - WINDOW_MS).toISOString());

    if (!isValid) {
      return new Response(
        JSON.stringify({ success: false }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PIN is valid — sign in shared app-user
    const appUserPassword = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!.slice(0, 32);

    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let signInResult = await supabaseAnon.auth.signInWithPassword({
      email: APP_USER_EMAIL,
      password: appUserPassword,
    });

    if (signInResult.error) {
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: APP_USER_EMAIL,
        password: appUserPassword,
        email_confirm: true,
      });

      if (createError && !createError.message.includes("already been registered")) {
        console.error("Failed to create app user:", createError);
        return new Response(
          JSON.stringify({ success: false, error: "Erreur interne" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      signInResult = await supabaseAnon.auth.signInWithPassword({
        email: APP_USER_EMAIL,
        password: appUserPassword,
      });
    }

    if (signInResult.error || !signInResult.data?.session) {
      console.error("Sign-in failed:", signInResult.error);
      return new Response(
        JSON.stringify({ success: false, error: "Erreur de session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { access_token, refresh_token } = signInResult.data.session;

    return new Response(
      JSON.stringify({ success: true, access_token, refresh_token }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("verify-pin error:", e);
    return new Response(
      JSON.stringify({ success: false, error: "Requête invalide" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
