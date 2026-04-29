"use client";
import { useMemo } from "react";
import {
  CheckCircle2, Cpu, HardDrive, MemoryStick, Server, XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Host, Metric } from "@/lib/types";

interface Props {
  hosts: Host[];
  metricsByHost: Record<string, Metric[]>;
  threshold?: number; // % considered "high"
}

export function DashboardStats({ hosts, metricsByHost, threshold = 90 }: Props) {
  const stats = useMemo(() => {
    const total = hosts.length;
    const online = hosts.filter((h) => h.status === "online").length;
    const offline = hosts.filter((h) => h.status === "offline").length;

    let highCpu = 0;
    let highRam = 0;
    let highDisk = 0;
    for (const h of hosts) {
      if (h.status !== "online") continue;
      const m = metricsByHost[h.id]?.[0];
      if (!m) continue;
      if (m.cpu_usage  >= threshold) highCpu++;
      if (m.ram_usage  >= threshold) highRam++;
      if (m.disk_usage >= threshold) highDisk++;
    }

    return { total, online, offline, highCpu, highRam, highDisk };
  }, [hosts, metricsByHost, threshold]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <Stat
        icon={<Server className="h-4 w-4 text-muted-foreground" />}
        label="Total"
        value={stats.total.toString()}
      />
      <Stat
        icon={<CheckCircle2 className="h-4 w-4 text-success" />}
        label="Online"
        value={stats.online.toString()}
      />
      <Stat
        icon={<XCircle className={stats.offline > 0 ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"} />}
        label="Offline"
        value={stats.offline.toString()}
        tone={stats.offline > 0 ? "alert" : "neutral"}
      />
      <Stat
        icon={<Cpu className={stats.highCpu > 0 ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"} />}
        label={`CPU ≥${threshold}%`}
        value={stats.highCpu.toString()}
        tone={stats.highCpu > 0 ? "alert" : "neutral"}
      />
      <Stat
        icon={<MemoryStick className={stats.highRam > 0 ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"} />}
        label={`RAM ≥${threshold}%`}
        value={stats.highRam.toString()}
        tone={stats.highRam > 0 ? "alert" : "neutral"}
      />
      <Stat
        icon={<HardDrive className={stats.highDisk > 0 ? "h-4 w-4 text-destructive" : "h-4 w-4 text-muted-foreground"} />}
        label={`Disk ≥${threshold}%`}
        value={stats.highDisk.toString()}
        tone={stats.highDisk > 0 ? "alert" : "neutral"}
      />
    </div>
  );
}

function Stat({
  icon, label, value, tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "alert";
}) {
  return (
    <Card className={tone === "alert" ? "border-destructive/40" : ""}>
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground truncate">{label}</span>
          {icon}
        </div>
        <p className={`text-2xl font-semibold tabular-nums leading-tight mt-0.5 ${tone === "alert" ? "text-destructive" : ""}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
