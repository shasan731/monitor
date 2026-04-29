"use client";
import { useMemo } from "react";
import Link from "next/link";
import { Cpu, HardDrive, MemoryStick, Server } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/Sparkline";
import { HostMenu } from "@/components/HostMenu";
import { RelativeTime } from "@/components/RelativeTime";
import type { Host, Metric } from "@/lib/types";

interface Props {
  host: Host;
  metrics: Metric[]; // newest first
}

export function HostCard({ host, metrics }: Props) {
  const latest = metrics[0];
  // Memoise series so the O(N) reverse+map runs only when metrics change.
  const cpuSeries = useMemo(() => [...metrics].reverse().map((m) => m.cpu_usage), [metrics]);
  const ramSeries = useMemo(() => [...metrics].reverse().map((m) => m.ram_usage), [metrics]);

  const status =
    host.status === "online" ? { text: "Online", variant: "success" as const } :
    host.status === "offline" ? { text: "Offline", variant: "destructive" as const } :
    { text: "Pending", variant: "muted" as const };

  return (
    <Card className="relative overflow-hidden transition-colors hover:bg-accent/30">
      <Link href={`/dashboard/hosts/${host.id}`} className="block">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2 pr-8">
            <div className="flex items-center gap-2 min-w-0">
              <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium truncate">{host.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {host.os_type} · <RelativeTime iso={host.last_beat} placeholder="…" />
                </p>
              </div>
            </div>
            <Badge variant={status.variant} className="shrink-0">{status.text}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Stat icon={<Cpu className="h-3.5 w-3.5" />} label="CPU" value={latest?.cpu_usage} series={cpuSeries} />
          <Stat icon={<MemoryStick className="h-3.5 w-3.5" />} label="RAM" value={latest?.ram_usage} series={ramSeries} />
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" /> Disk
            </span>
            <span className="font-mono tabular-nums">{latest ? `${latest.disk_usage.toFixed(0)}%` : "—"}</span>
          </div>
        </CardContent>
      </Link>

      <div className="absolute right-2 top-2">
        <HostMenu host={host} />
      </div>
    </Card>
  );
}

function Stat({ icon, label, value, series }: { icon: React.ReactNode; label: string; value?: number; series: number[] }) {
  const color = (value ?? 0) > 85 ? "text-destructive" : (value ?? 0) > 65 ? "text-warning" : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground w-12 shrink-0">
        {icon} {label}
      </div>
      <div className={`${color} flex-1`}>
        <Sparkline values={series} width={140} height={28} />
      </div>
      <div className={`${color} text-xs font-mono tabular-nums w-10 text-right`}>
        {value != null ? `${value.toFixed(0)}%` : "—"}
      </div>
    </div>
  );
}
