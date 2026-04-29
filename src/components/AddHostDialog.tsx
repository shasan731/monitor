"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import type { OsType } from "@/lib/types";

const OS_LABEL: Record<OsType, string> = {
  linux:   "Linux",
  macos:   "macOS",
  windows: "Windows",
};
const OS_OPTIONS: OsType[] = ["linux", "macos", "windows"];

export function AddHostDialog({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [os, setOs] = useState<OsType>("linux");
  const [creating, setCreating] = useState(false);
  const [createdHostId, setCreatedHostId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    if (trimmed.length > 64) {
      setError("Name must be 64 characters or fewer.");
      return;
    }
    setCreating(true);
    setError(null);
    const { data, error } = await supabase
      .from("hosts")
      .insert({ workspace_id: workspaceId, name: trimmed, os_type: os })
      .select("id")
      .single();
    setCreating(false);
    if (error) return setError(error.message);
    setName(trimmed);
    setCreatedHostId(data!.id);
    router.refresh();
  }

  function reset() {
    setOpen(false);
    setTimeout(() => {
      setName("");
      setOs("linux");
      setCreatedHostId(null);
      setError(null);
      setCopied(false);
    }, 200);
  }

  const installUrl = createdHostId
    ? `${window.location.origin}/api/install/${createdHostId}`
    : "";
  const oneLiner =
    os === "windows"
      ? `iwr -useb ${installUrl} | iex`
      : `curl -sSL ${installUrl} | sudo bash`;

  async function copy() {
    await navigator.clipboard.writeText(oneLiner);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> Add host
        </Button>
      </DialogTrigger>
      <DialogContent>
        {!createdHostId ? (
          <form onSubmit={onCreate} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add a new host</DialogTitle>
              <DialogDescription>Give it a name and pick the OS. We&apos;ll generate an install command.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="hname">Name</Label>
              <Input id="hname" placeholder="web-01" required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Operating system</Label>
              <div className="grid grid-cols-3 gap-2">
                {OS_OPTIONS.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => setOs(o)}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors ${os === o ? "border-primary bg-secondary" : "hover:bg-accent"}`}
                  >
                    {OS_LABEL[o]}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create host
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Install agent on {name}</DialogTitle>
              <DialogDescription>
                Run this on your {OS_LABEL[os]} server. It installs and starts the metric reporter.
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border bg-secondary/40 p-3 font-mono text-xs break-all relative">
              <pre className="whitespace-pre-wrap">{oneLiner}</pre>
              <Button
                type="button"
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
              Once running, the host appears as <span className="font-medium">Online</span> within ~60 seconds.
            </p>
            <Button onClick={reset} className="w-full" variant="secondary">Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
