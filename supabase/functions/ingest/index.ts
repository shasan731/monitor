// Supabase Edge Function: POST /functions/v1/ingest
// Authenticates the agent by X-API-Key, then inserts a metrics row and
// stamps the host's last_beat / status. Service-role key bypasses RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IngestPayload {
  host_id?: string;
  cpu_usage?: number;
  ram_usage?: number;
  disk_usage?: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: cors });
  }

  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "missing api key" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: IngestPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const cpu  = num(body.cpu_usage);
  const ram  = num(body.ram_usage);
  const disk = num(body.disk_usage);
  if (!body.host_id || cpu == null || ram == null || disk == null) {
    return new Response(JSON.stringify({ error: "invalid payload" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // Verify the api_key matches the claimed host_id. Constant-time enough at
  // this scale; the unique index makes the lookup O(log n).
  const { data: host } = await supabase
    .from("hosts")
    .select("id, api_key")
    .eq("id", body.host_id)
    .maybeSingle();

  if (!host || host.api_key !== apiKey) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();

  const [{ error: mErr }, { error: hErr }] = await Promise.all([
    supabase.from("metrics").insert({
      host_id: host.id,
      cpu_usage: cpu,
      ram_usage: ram,
      disk_usage: disk,
    }),
    supabase.from("hosts").update({ last_beat: now, status: "online" }).eq("id", host.id),
  ]);

  if (mErr || hErr) {
    return new Response(JSON.stringify({ error: (mErr ?? hErr)!.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
