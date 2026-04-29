import { WifiOff } from "lucide-react";

export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 text-center">
      <div className="space-y-3 max-w-sm">
        <WifiOff className="h-10 w-10 mx-auto text-muted-foreground" />
        <h1 className="text-xl font-semibold">You&apos;re offline</h1>
        <p className="text-sm text-muted-foreground">
          Reconnect to load the latest data. Your dashboard refreshes automatically once
          the connection is back.
        </p>
      </div>
    </main>
  );
}
