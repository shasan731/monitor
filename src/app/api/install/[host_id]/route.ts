import { NextResponse, type NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/install/{host_id}
 * Returns the matching OS agent script with API_KEY and INGEST_URL templated in.
 *
 * No auth: the host_id is unguessable (UUID) and the api_key is the secret —
 * if a viewer doesn't have the host_id they don't get a key. Anyone holding
 * the host_id is, by design, authorized to install it.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { host_id: string } }
) {
  // Validate before hitting Postgres — a malformed id otherwise raises 22P02
  // and gets logged as a server error.
  if (!isUuid(params.host_id)) {
    return new NextResponse("host not found", { status: 404 });
  }

  const supabase = createAdminClient();

  const { data: host, error } = await supabase
    .from("hosts")
    .select("id, os_type, api_key")
    .eq("id", params.host_id)
    .single();

  if (error || !host) {
    return new NextResponse("host not found", { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(_req.url).origin;
  const ingestUrl = `${appUrl.replace(/\/$/, "")}/api/ingest`;

  const file =
    host.os_type === "windows" ? "windows-agent.ps1" :
    host.os_type === "macos"   ? "macos-agent.sh"    :
                                  "linux-agent.sh";
  const tmpl = readFileSync(path.join(process.cwd(), "scripts", file), "utf8");

  const body = tmpl
    .replaceAll("__HOST_ID__", host.id)
    .replaceAll("__API_KEY__", host.api_key)
    .replaceAll("__INGEST_URL__", ingestUrl);

  const isWindows = host.os_type === "windows";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": isWindows ? "text/plain; charset=utf-8" : "application/x-sh; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${file}"`,
    },
  });
}
