"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, ServerCog } from "lucide-react";
import { DashboardStats } from "@/components/DashboardStats";
import { HostsBrowser } from "@/components/HostsBrowser";
import { TopIssues } from "@/components/TopIssues";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Host, Metric } from "@/lib/types";

interface Props {
  initialHosts: Host[];
  initialMetrics: Record<string, Metric[]>;
  workspaceId: string;
}

type Tab = "overview" | "hosts";

export function DashboardClient({ initialHosts, initialMetrics, workspaceId }: Props) {
  const [hosts, setHosts] = useState<Host[]>(initialHosts);
  const [metricsByHost, setMetricsByHost] = useState<Record<string, Metric[]>>(initialMetrics);
  const [tab, setTab] = useState<Tab>("overview");

  // Subscribe ONCE on mount. Re-subscribing on state change leaks events.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("monitor-stream")
      .on("postgres_changes", { event: "*", schema: "public", table: "hosts" }, (p) => {
        setHosts((prev) => {
          if (p.eventType === "DELETE") {
            const oldId = (p.old as { id?: string } | null)?.id;
            return oldId ? prev.filter((h) => h.id !== oldId) : prev;
          }
          const row = p.new as Partial<Host> & { id?: string };
          if (!row?.id) return prev;
          const idx = prev.findIndex((h) => h.id === row.id);
          if (idx === -1) {
            // Only seed a new row when the payload is plausibly complete.
            if (p.eventType !== "INSERT") return prev;
            if (!row.name || !row.workspace_id || !row.os_type) return prev;
            return [row as Host, ...prev];
          }
          const next = [...prev];
          next[idx] = { ...next[idx], ...row };
          return next;
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "metrics" }, (p) => {
        const m = p.new as Metric;
        setMetricsByHost((prev) => {
          const cur = prev[m.host_id] ?? [];
          const next = [m, ...cur].slice(0, 60);
          return { ...prev, [m.host_id]: next };
        });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Filter out incomplete rows defensively.
  const validHosts = useMemo(
    () => hosts.filter((h) => typeof h.name === "string" && h.name.length > 0),
    [hosts]
  );

  return (
    <div className="space-y-4">
      <nav className="border-b" role="tablist">
        <div className="-mb-px flex gap-1">
          <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<Activity className="h-4 w-4" />}>
            Overview
          </TabButton>
          <TabButton active={tab === "hosts"} onClick={() => setTab("hosts")} icon={<ServerCog className="h-4 w-4" />} count={validHosts.length}>
            Hosts
          </TabButton>
        </div>
      </nav>

      {tab === "overview" ? (
        <div className="space-y-4">
          <DashboardStats hosts={validHosts} metricsByHost={metricsByHost} />
          <TopIssues hosts={validHosts} metricsByHost={metricsByHost} />
        </div>
      ) : (
        <HostsBrowser hosts={validHosts} metricsByHost={metricsByHost} workspaceId={workspaceId} />
      )}
    </div>
  );
}

function TabButton({
  active, onClick, icon, count, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {children}
      {count != null && (
        <span className={cn(
          "ml-1 rounded-full px-1.5 text-[10px] font-mono tabular-nums",
          active ? "bg-secondary text-foreground" : "bg-muted text-muted-foreground"
        )}>
          {count}
        </span>
      )}
    </button>
  );
}
