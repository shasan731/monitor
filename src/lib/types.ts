export type OsType = "linux" | "windows" | "macos";
export type HostStatus = "pending" | "online" | "offline";

export interface Host {
  id: string;
  workspace_id: string;
  name: string;
  os_type: OsType;
  api_key: string;
  last_beat: string | null;
  status: HostStatus;
  created_at: string;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu_pct: number;
  ram_pct: number;
}

export interface InterfaceInfo {
  name: string;
  status: "up" | "down" | "unknown";
  rx_bps: number;
  tx_bps: number;
  mac?: string;
  ip?: string;
}

export interface Metric {
  id: number;
  host_id: string;
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  process_count: number | null;
  top_cpu_processes: ProcessInfo[] | null;
  top_ram_processes: ProcessInfo[] | null;
  interfaces: InterfaceInfo[] | null;
  ping_latency_ms: number | null;
  ping_loss_pct: number | null;
  ping_target: string | null;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  is_public: boolean;
  public_token: string;
  created_at: string;
}

export type CommandKind = "traceroute";
export type CommandStatus = "pending" | "running" | "completed" | "failed" | "timeout";

export interface TracerouteHop {
  n: number;
  ip: string | null;
  host?: string | null;
  /** Per-probe latencies in ms, or null for a timeout. Length is typically 3. */
  latencies_ms: (number | null)[];
}

export interface TracerouteResult {
  hops: TracerouteHop[];
  target: string;
  duration_ms: number;
  raw?: string;
  /** Which tool the agent actually ran (e.g. "traceroute" | "tracepath" | "tracert" | "none"). */
  tool?: string;
}

export interface HostCommand {
  id: string;
  host_id: string;
  kind: CommandKind;
  target: string | null;
  status: CommandStatus;
  result: TracerouteResult | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
