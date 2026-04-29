"use client";
import { useEffect, useState } from "react";
import { Loader2, Play, Wifi, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import type { HostCommand, TracerouteHop, TracerouteResult } from "@/lib/types";

const TARGET_RE = /^[a-zA-Z0-9._:\-]+$/;

interface Props {
  hostId: string;
  defaultTarget?: string;
}

export function TracerouteCard({ hostId, defaultTarget }: Props) {
  const supabase = createClient();
  const [target, setTarget] = useState(defaultTarget && TARGET_RE.test(defaultTarget) ? defaultTarget : "1.1.1.1");
  const [active, setActive] = useState<HostCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the most recent traceroute (if any) on mount, so a refresh keeps
  // the last result visible.
  useEffect(() => {
    let cancelled = false;
    supabase
      .from("host_commands")
      .select("*")
      .eq("host_id", hostId)
      .eq("kind", "traceroute")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setActive(data as HostCommand);
      });
    return () => { cancelled = true; };
  }, [hostId, supabase]);

  // Subscribe to UPDATE events for the active command so progress lands live.
  useEffect(() => {
    if (!active) return;
    const channel = supabase
      .channel(`cmd-${active.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "host_commands", filter: `id=eq.${active.id}` },
        (p) => {
          setActive((prev) => (prev ? { ...prev, ...(p.new as Partial<HostCommand>) } : prev));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [active?.id, supabase]);

  const isRunning = active?.status === "pending" || active?.status === "running";

  async function run() {
    const t = target.trim();
    if (!t) return;
    if (!TARGET_RE.test(t)) {
      setError("Target must be a hostname or IP (letters, digits, '.' '-' '_' ':' only).");
      return;
    }
    setBusy(true);
    setError(null);
    // Drop the prior result so the previous run's channel effect tears down
    // before the next id is in flight.
    setActive(null);
    const { data, error: insErr } = await supabase
      .from("host_commands")
      .insert({ host_id: hostId, kind: "traceroute", target: t })
      .select("*")
      .single();
    setBusy(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setActive(data as HostCommand);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wifi className="h-4 w-4" />
          Traceroute
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && !isRunning) run();
          }}
        >
          <Input
            placeholder="hostname or IP"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy || isRunning}
            spellCheck={false}
          />
          <Button type="submit" disabled={busy || isRunning || !target.trim()}>
            {busy || isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run
          </Button>
        </form>

        {error && <p className="text-sm text-destructive flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}

        {active && <ActiveCommand command={active} />}
      </CardContent>
    </Card>
  );
}

function ActiveCommand({ command }: { command: HostCommand }) {
  const variant: "muted" | "default" | "success" | "destructive" =
    command.status === "completed" ? "success" :
    command.status === "failed" || command.status === "timeout" ? "destructive" :
    command.status === "running" ? "default" : "muted";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant={variant} className="capitalize">{command.status}</Badge>
        <span className="text-muted-foreground">to</span>
        <span className="font-mono">{command.target}</span>
        {command.result?.duration_ms != null && (
          <span className="text-muted-foreground ml-auto">
            {(command.result.duration_ms / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {command.status === "pending" && (
        <p className="text-sm text-muted-foreground">
          Queued. Agent will pick this up on its next cycle (~within 60s).
        </p>
      )}
      {command.status === "running" && (
        <p className="text-sm text-muted-foreground">Agent is running tracert/traceroute…</p>
      )}
      {command.status === "completed" && command.result && (
        <HopsTable result={command.result} />
      )}
      {(command.status === "failed" || command.status === "timeout") && (
        <p className="text-sm text-destructive">{command.error ?? "Failed."}</p>
      )}
    </div>
  );
}

function HopsTable({ result }: { result: TracerouteResult }) {
  if (!result.hops || result.hops.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hops returned.{result.raw ? ` (${result.raw})` : ""}
      </p>
    );
  }
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <ul className="divide-y">
        {result.hops.map((hop) => (
          <HopRow key={hop.n} hop={hop} />
        ))}
      </ul>
    </div>
  );
}

function HopRow({ hop }: { hop: TracerouteHop }) {
  const valid = hop.latencies_ms.filter((l): l is number => typeof l === "number");
  const avg = valid.length > 0 ? valid.reduce((s, n) => s + n, 0) / valid.length : null;
  const allTimeout = valid.length === 0;

  return (
    <li className="px-3 py-2 flex items-center gap-3 text-sm">
      <span className="font-mono text-xs text-muted-foreground w-6 text-right tabular-nums">{hop.n}</span>
      <div className="min-w-0 flex-1">
        <p className={`font-mono truncate ${allTimeout ? "text-muted-foreground" : ""}`}>
          {hop.host || hop.ip || "*"}
        </p>
        {hop.host && hop.ip && hop.host !== hop.ip && (
          <p className="font-mono text-xs text-muted-foreground truncate">{hop.ip}</p>
        )}
      </div>
      <div className="flex gap-1.5 font-mono text-xs tabular-nums shrink-0">
        {hop.latencies_ms.map((l, i) => (
          <span key={i} className={l == null ? "text-muted-foreground w-10 text-right" : "w-10 text-right"}>
            {l == null ? "*" : `${l.toFixed(0)}ms`}
          </span>
        ))}
      </div>
      {avg != null && (
        <span className="hidden sm:inline-block w-12 text-right font-mono text-xs text-muted-foreground tabular-nums">
          avg {avg.toFixed(0)}
        </span>
      )}
    </li>
  );
}
