"use client";
import { Activity, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function Header({ workspaceName, email }: { workspaceName: string; email: string }) {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    // replace + refresh: avoid leaving an authenticated history entry behind
    // and force the middleware to re-evaluate session cookies.
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{workspaceName}</p>
            <p className="text-xs text-muted-foreground truncate">{email}</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
