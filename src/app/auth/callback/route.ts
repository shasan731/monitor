import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing+code", url.origin));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", error.message);
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(new URL("/dashboard", url.origin));
}
