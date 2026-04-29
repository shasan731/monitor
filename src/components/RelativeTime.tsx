"use client";
import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/utils";

/**
 * Renders a humanised "x seconds ago" string. Server output is empty so
 * hydration always matches; the actual text appears on mount and refreshes
 * every 30s. Caller can pass `placeholder` for the SSR/empty state.
 */
export function RelativeTime({
  iso,
  placeholder = "",
  className,
}: {
  iso: string | null | undefined;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState<string>(placeholder);

  useEffect(() => {
    const update = () => setText(formatRelative(iso));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [iso]);

  return <span className={className} suppressHydrationWarning>{text || placeholder}</span>;
}
