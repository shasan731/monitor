import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { HostMenu } from "@/components/HostMenu";
import { HostDetailClient } from "@/components/HostDetailClient";
import type { Host, Metric } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HostDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes the host to the owner's workspace.
  const { data: host } = await supabase
    .from("hosts")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!host) notFound();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: metrics } = await supabase
    .from("metrics")
    .select("*")
    .eq("host_id", params.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild aria-label="Back">
          <Link href="/dashboard"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-xl font-semibold tracking-tight truncate flex-1">{host.name}</h1>
        <HostMenu host={host as Host} />
      </div>

      <HostDetailClient initialHost={host as Host} initialMetrics={(metrics ?? []) as Metric[]} />
    </div>
  );
}
