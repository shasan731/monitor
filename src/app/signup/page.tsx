"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Activity, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PASSWORD_MIN = 8;

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (password.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) {
        setError(error.message);
        return;
      }
      if (data.session) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setMsg("Check your email to confirm your account.");
      }
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
          <h1 className="text-2xl font-semibold">Create account</h1>
          <p className="text-sm text-muted-foreground">Free tier is more than enough for personal servers.</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required disabled={loading} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" required disabled={loading} minLength={PASSWORD_MIN} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">At least {PASSWORD_MIN} characters.</p>
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have one?{" "}
          <Link href="/login" className="underline underline-offset-4 hover:text-foreground">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
