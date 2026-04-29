// Supabase Edge Function: heartbeat
// Run from pg_cron every 5 minutes:
//   select cron.schedule(
//     'monitor-heartbeat', '*/5 * * * *',
//     $$ select net.http_post(
//          url := 'https://<project>.supabase.co/functions/v1/heartbeat',
//          headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>')
//        ); $$
//   );
//
// Marks any host whose last_beat is older than 2 minutes as offline,
// then sends a Web Push notification to the workspace owner.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "https://esm.sh/web-push@3.6.7";

interface HostRow {
  id: string; name: string; workspace_id: string; status: string;
}
interface PushRow {
  endpoint: string; p256dh: string; auth: string;
}

Deno.serve(async (req: Request) => {
  // Optional shared-secret check so randoms can't trigger pushes.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response("unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  // Hosts that were online but haven't beat in >2 min.
  const { data: stale, error: selErr } = await supabase
    .from("hosts")
    .select("id, name, workspace_id, status")
    .eq("status", "online")
    .lt("last_beat", cutoff);

  if (selErr) {
    return new Response(JSON.stringify({ error: selErr.message }), { status: 500 });
  }

  const offline = (stale ?? []) as HostRow[];
  if (offline.length === 0) {
    return new Response(JSON.stringify({ ok: true, offline: 0 }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // Flip status.
  await supabase.from("hosts")
    .update({ status: "offline" })
    .in("id", offline.map((h) => h.id));

  // Fan out push notifications per workspace owner.
  const vapidPub  = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject   = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
  const appUrl    = Deno.env.get("APP_URL") ?? "";

  if (vapidPub && vapidPriv) {
    webpush.setVapidDetails(subject, vapidPub, vapidPriv);

    const wsIds = [...new Set(offline.map((h) => h.workspace_id))];
    const { data: workspaces } = await supabase
      .from("workspaces")
      .select("id, owner_id")
      .in("id", wsIds);

    const ownerIds = [...new Set((workspaces ?? []).map((w) => w.owner_id))];
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", ownerIds);

    const ownerByWs = new Map((workspaces ?? []).map((w) => [w.id, w.owner_id]));
    const subsByOwner = new Map<string, PushRow[]>();
    for (const s of subs ?? []) {
      const list = subsByOwner.get(s.user_id) ?? [];
      list.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
      subsByOwner.set(s.user_id, list);
    }

    await Promise.all(offline.flatMap((host) => {
      const owner = ownerByWs.get(host.workspace_id);
      if (!owner) return [];
      const list = subsByOwner.get(owner) ?? [];
      const payload = JSON.stringify({
        title: "Host offline",
        body: `${host.name} stopped reporting`,
        url: `${appUrl}/dashboard`,
        tag: `host-${host.id}`,
      });
      return list.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
        } catch (err) {
          // 410 / 404 → subscription is dead; clean it up.
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      });
    }));
  }

  return new Response(JSON.stringify({ ok: true, offline: offline.length }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
