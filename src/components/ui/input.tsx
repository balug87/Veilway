import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle",
        "transition-colors duration-[var(--motion-quick,150ms)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        "disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}
