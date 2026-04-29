"use client";
import { useEffect, useState } from "react";
import { AlertCircle, Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
}

export function PushOptIn() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    const ok =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      Boolean(vapidKey);
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setEnabled(!!sub);
    });
  }, [vapidKey]);

  // Auto-clear transient messages so they don't linger past their relevance.
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  async function enable() {
    if (!vapidKey) return;
    setBusy(true);
    setMessage(null);
    let sub: PushSubscription | null = null;
    try {
      const perm = await Notification.requestPermission();
      if (perm === "denied") {
        setMessage("Notifications are blocked in your browser. Re-enable them in site settings.");
        return;
      }
      if (perm !== "granted") {
        setMessage("Permission was not granted.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) {
        // Roll back the local subscription so the UI matches server state.
        await sub.unsubscribe().catch(() => {});
        sub = null;
        const text = await res.text().catch(() => "");
        setMessage(`Couldn't enable notifications (${res.status}). ${text}`.trim());
        return;
      }
      setEnabled(true);
    } catch (err) {
      await sub?.unsubscribe().catch(() => {});
      setMessage(err instanceof Error ? err.message : "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <div className="relative">
      <Button variant="outline" size="icon" onClick={enabled ? disable : enable} disabled={busy} aria-label="Notifications">
        {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
      </Button>
      {message && (
        <div
          role="status"
          className="absolute right-0 top-full mt-2 w-72 z-30 rounded-md border bg-popover p-2 text-xs text-popover-foreground shadow-md flex gap-2"
        >
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-destructive" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
