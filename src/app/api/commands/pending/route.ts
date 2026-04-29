import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/commands/pending?host_id=<uuid>
 *
 * Called by agents on every iteration. Authenticates via X-API-Key matching the
 * host's per-row api_key. Atomically claims any 'pending' commands by flipping
 * them to 'running' and returns them.
 *
 * Response format defaults to JSON. Pass `?fmt=tsv` to get pipe-delimited
 * lines (`id|kind|target`) which is much easier to parse from bash.
 *
 * No commands → empty body (status 200).
 */
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "missing api key" }, { status: 401 });
  }

  const url = new URL(req.url);
  const hostId = url.searchParams.get("host_id");
  const fmt = url.searchParams.get("fmt") ?? "json";
  if (!isUuid(hostId)) {
    return NextResponse.json({ error: "missing host_id" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: host } = await supabase
    .from("hosts")
    .select("id, api_key")
    .eq("id", hostId)
    .maybeSingle();
  if (!host || host.api_key !== apiKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Atomic claim: only updates rows currently 'pending', returns them.
  const { data: claimed, error } = await supabase
    .from("host_commands")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("host_id", hostId)
    .eq("status", "pending")
    .select("id, kind, target");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const cmds = claimed ?? [];

  if (fmt === "tsv") {
    const body = cmds.map((c) => `${c.id}|${c.kind}|${c.target ?? ""}`).join("\n");
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json({ commands: cmds }, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
