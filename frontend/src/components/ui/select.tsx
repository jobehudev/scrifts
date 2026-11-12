import * as React from "react"
import { cn } from "@/lib/utils"

/** A native drop-down that looks like Input (same height, border, focus ring), so every form reads the same. */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 *:bg-popover *:text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Select }
