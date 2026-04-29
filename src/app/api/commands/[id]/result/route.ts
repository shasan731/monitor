import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/commands/[id]/result
 *
 * Agent reports a command result. Auth: X-API-Key must match the api_key
 * of the host that owns the command — so a leaked key for host A can't
 * tamper with commands on host B.
 *
 * Body: { status: "completed" | "failed" | "timeout", result?: any, error?: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "missing api key" }, { status: 401 });
  }

  let body: { status?: string; result?: unknown; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const status = body.status;
  if (status !== "completed" && status !== "failed" && status !== "timeout") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Look up the command, then verify the api_key matches its host.
  const { data: cmd } = await supabase
    .from("host_commands")
    .select("id, host_id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!cmd) {
    return NextResponse.json({ error: "command not found" }, { status: 404 });
  }

  const { data: host } = await supabase
    .from("hosts")
    .select("api_key")
    .eq("id", cmd.host_id)
    .maybeSingle();
  if (!host || host.api_key !== apiKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cap stored result size — defensive, agents could send anything. Validate
  // size on the stringified copy and store the original object as JSONB.
  // Do NOT slice mid-token: that produced invalid JSON and 500'd the route.
  const RESULT_MAX_BYTES = 200_000;
  let safeResult: unknown = null;
  if (status === "completed" && body.result && typeof body.result === "object") {
    const serialized = JSON.stringify(body.result);
    safeResult = serialized.length <= RESULT_MAX_BYTES ? body.result : null;
  }
  const safeError =
    status !== "completed" && typeof body.error === "string"
      ? body.error.slice(0, 4_000)
      : null;

  const { error } = await supabase
    .from("host_commands")
    .update({
      status,
      result: safeResult,
      error: safeError,
      completed_at: new Date().toISOString(),
    })
    .eq("id", cmd.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
