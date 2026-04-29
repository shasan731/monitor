"use client";
import type { ProcessInfo } from "@/lib/types";

interface Props {
  title: string;
  icon: React.ReactNode;
  processes: ProcessInfo[] | null | undefined;
  metric: "cpu" | "ram";
}

export function ProcessTable({ title, icon, processes, metric }: Props) {
  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium">{title}</span>
      </div>
      {!processes || processes.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground text-center">No data yet</p>
      ) : (
        <ul className="divide-y">
          {processes.map((p, i) => {
            const value = metric === "cpu" ? p.cpu_pct : p.ram_pct;
            const color = value > 85 ? "text-destructive" : value > 65 ? "text-warning" : "text-foreground";
            return (
              <li key={`${p.pid}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground tabular-nums w-12 shrink-0">{p.pid}</span>
                <span className="font-medium truncate flex-1">{p.name}</span>
                <span className={`font-mono text-xs tabular-nums w-12 text-right ${color}`}>
                  {value.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
