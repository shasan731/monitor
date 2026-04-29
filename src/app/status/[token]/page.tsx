import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Activity, Server } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/Sparkline";
import { formatRelative } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PublicHost {
  id: string;
  name: string;
  os_type: string;
  status: string;
  last_beat: string | null;
  workspace_name: string;
}

interface PublicMetric {
  host_id: string;
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  created_at: string;
}

export default async function StatusPage({ params }: { params: { token: string } }) {
  // Anon client — public_hosts / public_metrics views handle authorization
  // by filtering on workspaces.is_public.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: hosts } = await supabase
    .from("public_hosts")
    .select("*")
    .eq("public_token", params.token);

  if (!hosts || hosts.length === 0) notFound();

  const generatedAt = new Date();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: metrics } = await supabase
    .from("public_metrics")
    .select("*")
    .eq("public_token", params.token)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  const grouped: Record<string, PublicMetric[]> = {};
  for (const m of (metrics ?? []) as PublicMetric[]) (grouped[m.host_id] ??= []).push(m);

  const wsName = (hosts[0] as PublicHost).workspace_name;
  const allOnline = (hosts as PublicHost[]).every((h) => h.status === "online");

  return (
    <main className="min-h-dvh">
      <header className="border-b">
        <div className="container flex h-14 items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Activity className="h-5 w-5 shrink-0" />
            <span className="font-semibold tracking-tight truncate">{wsName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="text-xs text-muted-foreground tabular-nums hidden sm:inline"
              title={generatedAt.toISOString()}
            >
              Updated {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <Badge variant={allOnline ? "success" : "destructive"}>
              {allOnline ? "All systems operational" : "Issues detected"}
            </Badge>
          </div>
        </div>
      </header>

      <div className="container py-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {(hosts as PublicHost[]).map((h) => {
          const series = (grouped[h.id] ?? []).slice().reverse();
          const latest = grouped[h.id]?.[0];
          const status =
            h.status === "online" ? { text: "Online", variant: "success" as const } :
            h.status === "offline" ? { text: "Offline", variant: "destructive" as const } :
            { text: "Pending", variant: "muted" as const };

          return (
            <Card key={h.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{h.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {h.os_type} · {formatRelative(h.last_beat)}
                      </p>
                    </div>
                  </div>
                  <Badge variant={status.variant}>{status.text}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <Row label="CPU" value={latest?.cpu_usage} series={series.map((m) => m.cpu_usage)} />
                <Row label="RAM" value={latest?.ram_usage} series={series.map((m) => m.ram_usage)} />
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Disk</span>
                  <span className="font-mono tabular-nums">{latest ? `${latest.disk_usage.toFixed(0)}%` : "—"}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <footer className="container py-6 text-center text-xs text-muted-foreground space-y-1">
        <p>Public status — read only.</p>
        <p title={generatedAt.toISOString()}>
          Last refreshed {generatedAt.toLocaleString()}
        </p>
      </footer>
    </main>
  );
}

function Row({ label, value, series }: { label: string; value?: number; series: number[] }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground w-10">{label}</span>
      <div className="flex-1"><Sparkline values={series} width={140} height={28} /></div>
      <span className="text-xs font-mono tabular-nums w-10 text-right">
        {value != null ? `${value.toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}
