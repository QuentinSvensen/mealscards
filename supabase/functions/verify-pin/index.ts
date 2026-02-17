import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check recent failed attempts from this IP
    const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();
    const { data: attempts } = await supabase
      .from("pin_attempts")
      .select("id")
      .eq("ip", clientIp)
      .eq("success", false)
      .gte("created_at", windowStart);

    if (attempts && attempts.length >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ success: false, error: "Trop de tentatives. Réessayez dans 15 minutes." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { pin } = await req.json();

    if (!pin || typeof pin !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "PIN requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serverPin = Deno.env.get("VITE_APP_PIN");

    // If no PIN is configured server-side, allow access
    if (!serverPin) {
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isValid = pin === serverPin;

    // Record the attempt
    await supabase.from("pin_attempts").insert({
      ip: clientIp,
      success: isValid,
    });

    // Clean up old attempts (older than 15 min) to keep table small
    await supabase
      .from("pin_attempts")
      .delete()
      .lt("created_at", new Date(Date.now() - WINDOW_MS).toISOString());

    return new Response(
      JSON.stringify({ success: isValid }),
      { status: isValid ? 200 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Requête invalide" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
