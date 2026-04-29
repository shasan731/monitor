"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Activity, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function friendlyAuthError(msg: string): string {
  if (/invalid login credentials/i.test(msg)) {
    return "Email or password is incorrect.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "Please confirm your email before signing in.";
  }
  return msg;
}

// useSearchParams() requires a Suspense boundary for Next's static export.
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginSkeleton() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 opacity-50">
        <div className="flex items-center gap-2 justify-center">
          <Activity className="h-6 w-6" />
          <span className="text-xl font-semibold tracking-tight">Monitor</span>
        </div>
      </div>
    </main>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  // Surface auth-callback errors that arrived via redirect.
  useEffect(() => {
    const e = searchParams.get("error");
    if (e) setError(friendlyAuthError(e));
  }, [searchParams]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Render-phase guard so two fast Enter-presses never fire two requests.
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(friendlyAuthError(error.message));
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2 justify-center">
          <Activity className="h-6 w-6" />
          <span className="text-xl font-semibold tracking-tight">Monitor</span>
        </div>
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to your monitoring dashboard.</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required disabled={loading} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign in
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link href="/signup" className="underline underline-offset-4 hover:text-foreground">Create one</Link>
        </p>
      </form>
    </main>
  );
}
