import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Single shared app-user credentials (created on first run)
const APP_USER_EMAIL = "app@internal.local";

serve(async (req) => {
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

    // Helper: count currently blocked IPs
    const getBlockedCount = async (): Promise<number> => {
      const { data } = await supabaseAdmin
        .from("pin_attempts")
        .select("ip")
        .eq("success", false)
        .gte("created_at", windowStart);
      if (!data) return 0;
      const counts: Record<string, number> = {};
      data.forEach(r => { counts[r.ip] = (counts[r.ip] || 0) + 1; });
      return Object.values(counts).filter(c => c >= MAX_ATTEMPTS).length;
    };

    // Parse body (may be admin_stats request)
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }

    // Admin stats request (no pin needed)
    if (body.admin_stats) {
      const blocked_count = await getBlockedCount();
      return new Response(
        JSON.stringify({ blocked_count }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: check recent failed attempts from this IP
    const { data: attempts } = await supabaseAdmin
      .from("pin_attempts")
      .select("id")
      .eq("ip", clientIp)
      .eq("success", false)
      .gte("created_at", windowStart);

    if (attempts && attempts.length >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ success: false, error: "Accès refusé. Veuillez réessayer." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { pin } = body as { pin?: string };

    if (!pin || typeof pin !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "PIN requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serverPin = Deno.env.get("VITE_APP_PIN");

    // If no PIN configured server-side, deny access (fail secure)
    if (!serverPin) {
      return new Response(
        JSON.stringify({ success: false, error: "PIN non configuré" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isValid = pin === serverPin;

    // Record the attempt
    await supabaseAdmin.from("pin_attempts").insert({
      ip: clientIp,
      success: isValid,
    });

    // Clean up old attempts
    await supabaseAdmin
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - WINDOW_MS).toISOString());

    if (!isValid) {
      return new Response(
        JSON.stringify({ success: false, error: "Accès refusé. Veuillez réessayer." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PIN is valid — ensure the shared app-user exists, then sign in to get a real session
    const appUserPassword = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!.slice(0, 32);

    // Try to sign in first
    const supabaseAnon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let signInResult = await supabaseAnon.auth.signInWithPassword({
      email: APP_USER_EMAIL,
      password: appUserPassword,
    });

    // If user doesn't exist yet, create it
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

      // Retry sign-in
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
