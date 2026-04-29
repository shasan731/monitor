"use client";
import { ArrowDownToLine, ArrowUpFromLine, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InterfaceInfo } from "@/lib/types";

interface Props {
  interfaces: InterfaceInfo[] | null | undefined;
}

function fmtBps(bps: number): string {
  if (bps < 1024) return `${bps.toFixed(0)} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  if (bps < 1024 * 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

export function InterfaceTable({ interfaces }: Props) {
  if (!interfaces || interfaces.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground text-center">No interface data yet</p>;
  }
  return (
    <ul className="divide-y">
      {interfaces.map((i) => {
        const variant =
          i.status === "up" ? "success" as const :
          i.status === "down" ? "muted" as const :
          "muted" as const;
        return (
          <li key={i.name} className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Wifi className={`h-4 w-4 shrink-0 ${i.status === "up" ? "text-success" : "text-muted-foreground"}`} />
              <span className="font-medium truncate flex-1">{i.name}</span>
              <Badge variant={variant} className="shrink-0 text-[10px] capitalize">
                {i.status}
              </Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 font-mono">
                <ArrowDownToLine className="h-3 w-3" /> {fmtBps(i.rx_bps)}
              </span>
              <span className="flex items-center gap-1 font-mono">
                <ArrowUpFromLine className="h-3 w-3" /> {fmtBps(i.tx_bps)}
              </span>
              {i.ip && <span className="font-mono">{i.ip}</span>}
              {i.mac && <span className="font-mono">{i.mac}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
