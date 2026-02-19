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

// ─── Persistent blocked-IP counter stored in a dedicated DB table ─────────────
// We use a simple key-value row in pin_attempts_meta (created lazily via upsert).
// The counter only ever goes up — it tracks how many distinct IPs have EVER been
// blocked at least once (reached MAX_ATTEMPTS failures).

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

    // Parse body (may be admin_stats request)
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body */ }

    // Helper: verify auth token using getUser
    const verifyAuth = async (authHeader: string | null) => {
      if (!authHeader?.startsWith("Bearer ")) return false;
      const token = authHeader.replace("Bearer ", "");
      const supabaseAnon = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data, error } = await supabaseAnon.auth.getUser(token);
      return !error && !!data?.user;
    };

    // Reset blocked count — requires a valid auth session
    if (body.reset_blocked) {
      const authed = await verifyAuth(req.headers.get("authorization"));
      if (!authed) {
        return new Response(
          JSON.stringify({ success: false, error: "Non autorisé" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabaseAdmin.from("pin_attempts_meta").upsert({
        key: "cumulative_blocked_count",
        value: "0",
      }, { onConflict: "key" });

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Admin stats request — requires a valid auth session
    if (body.admin_stats) {
      const authed = await verifyAuth(req.headers.get("authorization"));
      if (!authed) {
        return new Response(
          JSON.stringify({ success: false, error: "Non autorisé" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Read the persisted cumulative count
      const { data: metaRow } = await supabaseAdmin
        .from("pin_attempts_meta")
        .select("value")
        .eq("key", "cumulative_blocked_count")
        .maybeSingle();

      const blocked_count = metaRow ? parseInt(metaRow.value, 10) : 0;

      return new Response(
        JSON.stringify({ blocked_count }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Rate limiting: check recent failed attempts from this IP ──────────────
    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

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

    // ── If this attempt is a failure, check if this IP just hit MAX_ATTEMPTS ──
    // (i.e. this is the blocking threshold crossing — increment persistent counter)
    if (!isValid) {
      // Recount failures within window after inserting this one
      const { data: freshAttempts } = await supabaseAdmin
        .from("pin_attempts")
        .select("id")
        .eq("ip", clientIp)
        .eq("success", false)
        .gte("created_at", windowStart);

      const failCount = freshAttempts?.length ?? 0;

      // Exactly at the threshold — this IP just got blocked for the first time
      // in this window. Increment the cumulative counter.
      if (failCount === MAX_ATTEMPTS) {
        // Read current value
        const { data: metaRow } = await supabaseAdmin
          .from("pin_attempts_meta")
          .select("value")
          .eq("key", "cumulative_blocked_count")
          .maybeSingle();

        const currentCount = metaRow ? parseInt(metaRow.value, 10) : 0;
        const newCount = currentCount + 1;

        // Upsert the new value
        await supabaseAdmin.from("pin_attempts_meta").upsert({
          key: "cumulative_blocked_count",
          value: String(newCount),
        }, { onConflict: "key" });
      }

      // Return 200 with success:false — wrong PIN, not a system error
      // Only the rate-limit block returns 401
      return new Response(
        JSON.stringify({ success: false, error: "Code incorrect" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean up old attempts
    await supabaseAdmin
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - WINDOW_MS).toISOString());

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
