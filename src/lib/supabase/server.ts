import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

type CookieRecord = { name: string; value: string; options?: CookieOptions };

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieRecord[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll inside Server Components throws — middleware handles refresh.
          }
        },
      },
    }
  );
}

let adminClient: SupabaseClient | null = null;

/** Service-role client. Never import from a client component. */
export function createAdminClient(): SupabaseClient {
  // Service-role key path must never run on the edge runtime — that would leak
  // secrets into the V8 isolate and breaks the Node-only `pg`/SDK paths.
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") {
    throw new Error(
      `createAdminClient called from non-node runtime (${process.env.NEXT_RUNTIME}); add 'export const runtime = "nodejs"' to the route.`
    );
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  if (!adminClient) {
    adminClient = createJsClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}
