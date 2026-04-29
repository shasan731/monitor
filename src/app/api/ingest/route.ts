import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};
const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
};
// process_count: a busy box can have 1500 procs; 100k is comfortably above
// any plausible real value. Caps an obviously-malformed agent payload.
const PROCESS_COUNT_MAX = 100_000;
const clampProcCount = (v: unknown): number | null => {
  const n = int(v);
  if (n == null) return null;
  return Math.max(0, Math.min(PROCESS_COUNT_MAX, n));
};
const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;

interface RawProc { pid?: unknown; name?: unknown; cpu_pct?: unknown; ram_pct?: unknown }
interface RawIface { name?: unknown; status?: unknown; rx_bps?: unknown; tx_bps?: unknown; mac?: unknown; ip?: unknown }

function sanitiseProcs(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 10).map((p: RawProc) => ({
    pid: int(p.pid) ?? 0,
    name: str(p.name, 80) ?? "?",
    cpu_pct: clamp(p.cpu_pct) ?? 0,
    ram_pct: clamp(p.ram_pct) ?? 0,
  }));
}
function sanitiseIfaces(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 32).map((i: RawIface) => {
    const status = i.status === "up" || i.status === "down" ? i.status : "unknown";
    return {
      name: str(i.name, 64) ?? "?",
      status,
      rx_bps: Math.max(0, num(i.rx_bps) ?? 0),
      tx_bps: Math.max(0, num(i.tx_bps) ?? 0),
      mac: str(i.mac, 32),
      ip: str(i.ip, 64),
    };
  });
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ error: "missing api key" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const cpu  = clamp(body.cpu_usage);
  const ram  = clamp(body.ram_usage);
  const disk = clamp(body.disk_usage);
  if (!isUuid(body.host_id) || cpu == null || ram == null || disk == null) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: host } = await supabase
    .from("hosts")
    .select("id, api_key")
    .eq("id", body.host_id)
    .maybeSingle();

  if (!host || host.api_key !== apiKey) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date().toISOString();
  const [{ error: mErr }, { error: hErr }] = await Promise.all([
    supabase.from("metrics").insert({
      host_id: host.id,
      cpu_usage: cpu,
      ram_usage: ram,
      disk_usage: disk,
      process_count: clampProcCount(body.process_count),
      top_cpu_processes: sanitiseProcs(body.top_cpu_processes),
      top_ram_processes: sanitiseProcs(body.top_ram_processes),
      interfaces: sanitiseIfaces(body.interfaces),
      ping_latency_ms: num(body.ping_latency_ms),
      ping_loss_pct: clamp(body.ping_loss_pct),
      ping_target: str(body.ping_target, 120),
    }),
    supabase.from("hosts").update({ last_beat: now, status: "online" }).eq("id", host.id),
  ]);

  if (mErr || hErr) {
    return NextResponse.json({ error: (mErr ?? hErr)!.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
