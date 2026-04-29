"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { Host } from "@/lib/types";

export function HostMenu({ host }: { host: Host }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(host.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const installUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/install/${host.id}` : "";
  const oneLiner =
    host.os_type === "windows"
      ? `iwr -useb ${installUrl} | iex`
      : `curl -sSL ${installUrl} | sudo bash`;

  function reset() {
    setConfirmDelete(false);
    setConfirmText("");
    setError(null);
    setName(host.name ?? "");
    setCopied(false);
  }

  async function rename() {
    const trimmed = (name ?? "").trim();
    if (!trimmed || trimmed === host.name) return;
    if (trimmed.length > 64) {
      setError("Name must be 64 characters or fewer.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("hosts").update({ name: trimmed }).eq("id", host.id);
    setBusy(false);
    if (error) return setError(error.message);
    setName(trimmed);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("hosts").delete().eq("id", host.id);
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false);
    reset();
    router.refresh();
  }

  async function copy() {
    await navigator.clipboard.writeText(oneLiner);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Manage host">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage host</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`rename-${host.id}`}>Name</Label>
            <div className="flex gap-2">
              <Input
                id={`rename-${host.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={64}
                disabled={busy}
              />
              <Button onClick={rename} disabled={busy || !(name ?? "").trim() || (name ?? "").trim() === host.name}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Install command</Label>
            <div className="rounded-md border bg-secondary/40 p-3 font-mono text-xs break-all relative">
              <pre className="whitespace-pre-wrap">{oneLiner}</pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1"
                onClick={copy}
                aria-label="Copy"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Re-run on a fresh machine to migrate the agent — the API key stays the same.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="border-t pt-4">
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-sm">
                  Permanently delete <span className="font-medium">{host.name}</span> and all its metrics?
                  Type the host name to confirm.
                </p>
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={host.name}
                  disabled={busy}
                  aria-label="Type host name to confirm deletion"
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => { setConfirmDelete(false); setConfirmText(""); }}
                    disabled={busy}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={remove}
                    disabled={busy || confirmText.trim() !== host.name}
                    className="flex-1"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Delete host
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="destructive" onClick={() => setConfirmDelete(true)} className="w-full">
                <Trash2 className="h-4 w-4" /> Delete host
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
