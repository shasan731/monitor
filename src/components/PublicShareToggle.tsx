"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

interface Props {
  workspaceId: string;
  isPublic: boolean;
  publicToken: string;
}

export function PublicShareToggle({ workspaceId, isPublic, publicToken }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  const url =
    typeof window !== "undefined" ? `${window.location.origin}/status/${publicToken}` : "";

  async function toggle() {
    setPending(true);
    await supabase.from("workspaces").update({ is_public: !isPublic }).eq("id", workspaceId);
    setPending(false);
    router.refresh();
  }

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Public status">
          <Globe className={`h-4 w-4 ${isPublic ? "text-success" : ""}`} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Public status page</DialogTitle>
          <DialogDescription>
            Share a read-only view of your hosts. No login required for viewers, no API keys exposed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border bg-secondary/40 p-3 font-mono text-xs break-all relative">
            <pre className="whitespace-pre-wrap">{url}</pre>
            <Button variant="ghost" size="icon" className="absolute right-1 top-1" onClick={copy} aria-label="Copy">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button onClick={toggle} disabled={pending} variant={isPublic ? "destructive" : "default"} className="w-full">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isPublic ? "Disable public access" : "Enable public access"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
