import { updateSession } from "@/lib/supabase/middleware";
import { type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip static, image, and Next internals — but DO run for API routes.
    "/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|manifest.json|sw.js|api/install|api/ingest|api/commands).*)",
  ],
};
