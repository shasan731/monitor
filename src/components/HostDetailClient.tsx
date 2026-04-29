"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Activity, Boxes, Cpu, Globe2, HardDrive, Hash, KeyRound, MemoryStick,
  Eye, EyeOff, Copy, Check, Network,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricChart } from "@/components/MetricChart";
import { ProcessTable } from "@/components/ProcessTable";
import { InterfaceTable } from "@/components/InterfaceTable";
import { TracerouteCard } from "@/components/TracerouteCard";
import { RelativeTime } from "@/components/RelativeTime";
import { createClient } from "@/lib/supabase/client";
import type { Host, Metric } from "@/lib/types";

interface Props {
  initialHost: Host;
  initialMetrics: Metric[]; // newest-first
}

export function HostDetailClient({ initialHost, initialMetrics }: Props) {
  const [host, setHost] = useState<Host>(initialHost);
  const [metrics, setMetrics] = useState<Metric[]>(initialMetrics);
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  // Auto-hide a revealed API key after 30s — small hardening so the key
  // doesn't sit in the DOM until the user navigates away.
  useEffect(() => {
    if (!showKey) return;
    const t = setTimeout(() => setShowKey(false), 30_000);
    return () => clearTimeout(t);
  }, [showKey]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`host-detail-${host.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "hosts", filter: `id=eq.${host.id}` },
        (p) => {
          if (p.eventType === "DELETE") return;
          setHost((prev) => ({ ...prev, ...(p.new as Partial<Host>) }));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "metrics", filter: `host_id=eq.${host.id}` },
        (p) => {
          const m = p.new as Metric;
          setMetrics((prev) => [m, ...prev].slice(0, 240)); // keep up to 4h at 1/min
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [host.id]);

  const status =
    host.status === "online" ? { text: "Online", variant: "success" as const } :
    host.status === "offline" ? { text: "Offline", variant: "destructive" as const } :
    { text: "Pending", variant: "muted" as const };

  const points = metrics.map((m) => ({
    t: new Date(m.created_at).getTime(),
    cpu: m.cpu_usage,
    ram: m.ram_usage,
    disk: m.disk_usage,
  }));

  const latest = metrics[0];
  const pingPoints = useMemo(
    () => metrics
      .filter((m) => m.ping_latency_ms != null)
      .map((m) => ({ t: new Date(m.created_at).getTime(), v: m.ping_latency_ms as number })),
    [metrics]
  );
  // Pick a y-axis max that fits comfortably; round up to a nice number.
  const pingMax = useMemo(() => {
    if (pingPoints.length === 0) return 100;
    const max = Math.max(...pingPoints.map((p) => p.v));
    return Math.max(50, Math.ceil((max * 1.2) / 50) * 50);
  }, [pingPoints]);

  async function copy(value: string, kind: "id" | "key") {
    await navigator.clipboard.writeText(value);
    if (kind === "id") { setCopiedId(true); setTimeout(() => setCopiedId(false), 1500); }
    else                { setCopiedKey(true); setTimeout(() => setCopiedKey(false), 1500); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 text-sm">
          <Meta label="Status">
            <Badge variant={status.variant}>{status.text}</Badge>
          </Meta>
          <Meta label="OS">
            <span className="capitalize">{host.os_type}</span>
          </Meta>
          <Meta label="Last beat">
            <RelativeTime iso={host.last_beat} placeholder="…" />
          </Meta>
          <Meta label="Created">
            <span>{new Date(host.created_at).toLocaleDateString()}</span>
          </Meta>

          <div className="col-span-2 sm:col-span-4 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Hash className="h-3 w-3" /> Host ID
              </p>
              <div className="flex items-center gap-1">
                <code className="text-xs font-mono truncate flex-1">{host.id}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(host.id, "id")} aria-label="Copy ID">
                  {copiedId ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <KeyRound className="h-3 w-3" /> API key
              </p>
              <div className="flex items-center gap-1">
                <code className="text-xs font-mono truncate flex-1">
                  {showKey ? host.api_key : "•".repeat(Math.min(host.api_key?.length ?? 24, 32))}
                </code>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? "Hide key" : "Show key"}>
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => copy(host.api_key, "key")} aria-label="Copy key">
                  {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3">
        <MetricChart
          title="CPU"
          icon={<Cpu className="h-4 w-4" />}
          points={points.map((p) => ({ t: p.t, v: p.cpu }))}
        />
        <MetricChart
          title="Memory"
          icon={<MemoryStick className="h-4 w-4" />}
          points={points.map((p) => ({ t: p.t, v: p.ram }))}
        />
        <MetricChart
          title="Disk"
          icon={<HardDrive className="h-4 w-4" />}
          points={points.map((p) => ({ t: p.t, v: p.disk }))}
        />
      </div>

      {/* Processes */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Boxes className="h-4 w-4" />
              Processes
            </span>
            <span className="text-xs text-muted-foreground font-normal">
              {latest?.process_count != null ? `${latest.process_count} running` : "—"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ProcessTable
            title="Top CPU"
            icon={<Cpu className="h-3.5 w-3.5" />}
            processes={latest?.top_cpu_processes}
            metric="cpu"
          />
          <ProcessTable
            title="Top Memory"
            icon={<MemoryStick className="h-3.5 w-3.5" />}
            processes={latest?.top_ram_processes}
            metric="ram"
          />
        </CardContent>
      </Card>

      {/* Network */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              Interfaces
            </span>
            {latest?.interfaces && (
              <span className="text-xs text-muted-foreground font-normal">
                {latest.interfaces.filter((i) => i.status === "up").length} up · {latest.interfaces.filter((i) => i.status === "down").length} down
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <InterfaceTable interfaces={latest?.interfaces} />
        </CardContent>
      </Card>

      {/* Connectivity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Globe2 className="h-4 w-4" />
              Connectivity
            </span>
            <span className="text-xs text-muted-foreground font-normal">
              {latest?.ping_target ? `ping ${latest.ping_target}` : "—"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs text-muted-foreground">Latency</p>
              <p className="text-2xl font-mono tabular-nums">
                {latest?.ping_latency_ms != null ? `${latest.ping_latency_ms.toFixed(1)} ms` : "—"}
              </p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs text-muted-foreground">Packet loss</p>
              <p className={`text-2xl font-mono tabular-nums ${(latest?.ping_loss_pct ?? 0) > 0 ? "text-destructive" : ""}`}>
                {latest?.ping_loss_pct != null ? `${latest.ping_loss_pct.toFixed(0)}%` : "—"}
              </p>
            </div>
          </div>
          <MetricChart
            title="Latency over time"
            icon={<Activity className="h-4 w-4" />}
            points={pingPoints}
            unit=" ms"
            max={pingMax}
            threshold={{ warn: pingMax * 0.5, crit: pingMax * 0.8 }}
            rightLabel={
              <span className="text-xs text-muted-foreground font-normal">
                Last hour
              </span>
            }
          />
        </CardContent>
      </Card>

      <TracerouteCard hostId={host.id} defaultTarget={latest?.ping_target ?? undefined} />

      {metrics.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">
          Waiting for the first metric to arrive. Make sure the agent is running.
        </p>
      )}
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div>{children}</div>
    </div>
  );
}
