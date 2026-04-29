"use client";
import Link from "next/link";
import { ChevronRight, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/Sparkline";
import { HostMenu } from "@/components/HostMenu";
import { RelativeTime } from "@/components/RelativeTime";
import type { Host, Metric } from "@/lib/types";

interface Props {
  hosts: Host[];
  metricsByHost: Record<string, Metric[]>;
}

export function HostList({ hosts, metricsByHost }: Props) {
  return (
    <div className="rounded-lg border bg-card divide-y">
      {hosts.map((h) => (
        <Row key={h.id} host={h} metrics={metricsByHost[h.id] ?? []} />
      ))}
    </div>
  );
}

function Row({ host, metrics }: { host: Host; metrics: Metric[] }) {
  const latest = metrics[0];
  const cpuSeries = [...metrics].reverse().map((m) => m.cpu_usage);
  const status =
    host.status === "online" ? { text: "Online", variant: "success" as const } :
    host.status === "offline" ? { text: "Offline", variant: "destructive" as const } :
    { text: "Pending", variant: "muted" as const };

  const cpuColor = (latest?.cpu_usage ?? 0) > 85 ? "text-destructive" : (latest?.cpu_usage ?? 0) > 65 ? "text-warning" : "text-foreground";
  const ramColor = (latest?.ram_usage ?? 0) > 85 ? "text-destructive" : (latest?.ram_usage ?? 0) > 65 ? "text-warning" : "text-foreground";

  return (
    <div className="relative flex items-center hover:bg-accent/40 transition-colors">
      <Link
        href={`/dashboard/hosts/${host.id}`}
        className="flex-1 min-w-0 flex items-center gap-3 p-3 pr-12"
      >
        <Server className="h-4 w-4 shrink-0 text-muted-foreground" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium truncate">{host.name}</p>
            <Badge variant={status.variant} className="shrink-0 text-[10px] px-1.5 py-0">{status.text}</Badge>
          </div>
          <p className="text-xs text-muted-foreground capitalize truncate">
            {host.os_type} · <RelativeTime iso={host.last_beat} placeholder="…" />
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-3 shrink-0">
          <div className={`${cpuColor} flex items-center gap-1.5`}>
            <Sparkline values={cpuSeries} width={70} height={20} />
            <span className="text-xs font-mono tabular-nums w-9 text-right">
              {latest ? `${latest.cpu_usage.toFixed(0)}%` : "—"}
            </span>
          </div>
          <div className={`${ramColor} text-xs font-mono tabular-nums w-12 text-right`}>
            <span className="text-muted-foreground mr-1">R</span>
            {latest ? `${latest.ram_usage.toFixed(0)}%` : "—"}
          </div>
          <div className="text-xs font-mono tabular-nums w-12 text-right">
            <span className="text-muted-foreground mr-1">D</span>
            {latest ? `${latest.disk_usage.toFixed(0)}%` : "—"}
          </div>
        </div>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </Link>

      <div className="absolute right-1 top-1/2 -translate-y-1/2">
        <HostMenu host={host} />
      </div>
    </div>
  );
}
