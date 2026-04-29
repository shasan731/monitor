import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/Header";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The signup trigger creates a default workspace; just look it up.
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  const ws = workspaces?.[0];

  return (
    <div className="min-h-dvh">
      <Header workspaceName={ws?.name ?? "My Servers"} email={user.email ?? ""} />
      <main id="main" className="container py-4 pb-24">{children}</main>
    </div>
  );
}
