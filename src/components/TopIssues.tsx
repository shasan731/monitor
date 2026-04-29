"use client";
import Link from "next/link";
import { AlertTriangle, ChevronRight, Server } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RelativeTime } from "@/components/RelativeTime";
import type { Host, Metric } from "@/lib/types";

interface Issue {
  host: Host;
  reasons: string[];
  severity: "warn" | "crit";
}

interface Props {
  hosts: Host[];
  metricsByHost: Record<string, Metric[]>;
  threshold?: number;
}

export function TopIssues({ hosts, metricsByHost, threshold = 90 }: Props) {
  const issues = computeIssues(hosts, metricsByHost, threshold).slice(0, 6);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4" />
          Needs attention
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {issues.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">All hosts healthy.</p>
        ) : (
          <ul className="divide-y">
            {issues.map((it) => (
              <li key={it.host.id}>
                <Link
                  href={`/dashboard/hosts/${it.host.id}`}
                  className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/40 transition-colors"
                >
                  <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{it.host.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      <RelativeTime iso={it.host.last_beat} placeholder="…" />
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {it.reasons.map((r) => (
                      <Badge key={r} variant={it.severity === "crit" ? "destructive" : "warning"} className="whitespace-nowrap">
                        {r}
                      </Badge>
                    ))}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function computeIssues(
  hosts: Host[],
  metricsByHost: Record<string, Metric[]>,
  threshold: number
): Issue[] {
  const issues: Issue[] = [];

  for (const h of hosts) {
    const reasons: string[] = [];
    let severity: "warn" | "crit" = "warn";

    if (h.status === "offline") {
      reasons.push("Offline");
      severity = "crit";
    }

    const latest = metricsByHost[h.id]?.[0];
    if (latest && h.status === "online") {
      if (latest.cpu_usage  >= threshold) { reasons.push(`CPU ${latest.cpu_usage.toFixed(0)}%`);  severity = "crit"; }
      if (latest.ram_usage  >= threshold) { reasons.push(`RAM ${latest.ram_usage.toFixed(0)}%`);  severity = "crit"; }
      if (latest.disk_usage >= threshold) { reasons.push(`Disk ${latest.disk_usage.toFixed(0)}%`); severity = "crit"; }
    }

    if (reasons.length > 0) issues.push({ host: h, reasons, severity });
  }

  // Critical first, then by name.
  issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "crit" ? -1 : 1;
    return a.host.name.localeCompare(b.host.name);
  });

  return issues;
}
