// Bump CACHE on every release that ships static-asset changes; otherwise
// installed clients will keep serving stale shell HTML forever.
const CACHE = "monitor-v2";
const SHELL = ["/", "/dashboard", "/offline", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache API or Supabase calls — always fresh
  if (url.pathname.startsWith("/api/") || url.hostname.includes("supabase")) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(async () => {
        // Try the request itself first.
        const cached = await caches.match(req);
        if (cached) return cached;
        // Only fall back to the dashboard shell for dashboard navigations —
        // never serve an authenticated shell to /login or /status visitors.
        if (req.mode === "navigate" && url.pathname.startsWith("/dashboard")) {
          const dash = await caches.match("/dashboard");
          if (dash) return dash;
        }
        if (req.mode === "navigate") {
          const offline = await caches.match("/offline");
          if (offline) return offline;
        }
        return Response.error();
      })
  );
});

self.addEventListener("push", (e) => {
  let data = { title: "Monitor", body: "Update" };
  try { if (e.data) data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || "Monitor", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: data.url ? { url: data.url } : {},
      tag: data.tag || "monitor",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/dashboard";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((wins) => {
    for (const w of wins) { if (w.url.includes(url)) return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
