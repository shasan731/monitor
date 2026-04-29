"use client";
import { useMemo, useState } from "react";
import { LayoutGrid, List, Search } from "lucide-react";
import { HostCard } from "@/components/HostCard";
import { HostList } from "@/components/HostList";
import { AddHostDialog } from "@/components/AddHostDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Host, Metric } from "@/lib/types";

interface Props {
  hosts: Host[]; // already filtered to valid rows
  metricsByHost: Record<string, Metric[]>;
  workspaceId?: string;
}

type ViewMode = "grid" | "list";
const VIEW_KEY = "monitor:view";

export function HostsBrowser({ hosts, metricsByHost, workspaceId }: Props) {
  const [query, setQuery] = useState("");
  // Read the saved preference synchronously on mount so list-preferring users
  // don't see a one-frame flash of grid before the effect runs.
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "grid";
    const saved = window.localStorage.getItem(VIEW_KEY);
    return saved === "list" || saved === "grid" ? saved : "grid";
  });

  function changeView(v: ViewMode) {
    setView(v);
    if (typeof window !== "undefined") window.localStorage.setItem(VIEW_KEY, v);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter(
      (h) => h.name.toLowerCase().includes(q) || (h.os_type ?? "").includes(q)
    );
  }, [hosts, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter hosts…"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="inline-flex rounded-md border bg-card p-0.5 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", view === "grid" && "bg-secondary")}
            onClick={() => changeView("grid")}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-8 w-8", view === "list" && "bg-secondary")}
            onClick={() => changeView("list")}
            aria-label="List view"
            aria-pressed={view === "list"}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {hosts.length === 0 ? "No hosts yet — add one to get started." : "No hosts match your filter."}
          </p>
          {hosts.length === 0 && workspaceId && (
            <div className="inline-flex">
              <AddHostDialog workspaceId={workspaceId} />
            </div>
          )}
        </div>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((h) => (
            <HostCard key={h.id} host={h} metrics={metricsByHost[h.id] ?? []} />
          ))}
        </div>
      ) : (
        <HostList hosts={filtered} metricsByHost={metricsByHost} />
      )}
    </div>
  );
}
