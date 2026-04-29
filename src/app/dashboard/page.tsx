import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardClient } from "@/components/DashboardClient";
import { AddHostDialog } from "@/components/AddHostDialog";
import { PublicShareToggle } from "@/components/PublicShareToggle";
import { PushOptIn } from "@/components/PushOptIn";
import type { Host, Metric } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, is_public, public_token")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);
  const ws = workspaces?.[0];
  if (!ws) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No workspace found. Sign out and back in.
      </div>
    );
  }

  const { data: hosts } = await supabase
    .from("hosts")
    .select("*")
    .eq("workspace_id", ws.id)
    .order("created_at", { ascending: false });

  // One round-trip for last hour of metrics across all hosts.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const hostIds = (hosts ?? []).map((h) => h.id);
  const metrics =
    hostIds.length === 0
      ? []
      : (
          await supabase
            .from("metrics")
            .select("*")
            .in("host_id", hostIds)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
        ).data ?? [];

  const grouped: Record<string, Metric[]> = {};
  for (const m of metrics as Metric[]) (grouped[m.host_id] ??= []).push(m);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <div className="flex items-center gap-2">
          <PushOptIn />
          <PublicShareToggle workspaceId={ws.id} isPublic={ws.is_public} publicToken={ws.public_token} />
          <AddHostDialog workspaceId={ws.id} />
        </div>
      </div>
      <DashboardClient initialHosts={(hosts ?? []) as Host[]} initialMetrics={grouped} workspaceId={ws.id} />
    </div>
  );
}
