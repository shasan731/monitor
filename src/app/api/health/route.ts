import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — uptime probe. Returns 200 with `{ ok: true, db: "up" }`
 * when the database is reachable, 503 with `{ ok: false }` otherwise.
 */
export async function GET() {
  try {
    const supabase = createAdminClient();
    // Cheap connectivity check: HEAD the workspaces table for a count.
    const { error } = await supabase.from("workspaces").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, db: "up" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
