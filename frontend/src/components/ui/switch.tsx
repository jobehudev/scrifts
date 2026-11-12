import { cn } from "@/lib/utils"

/** An on/off switch. */
function Switch({ checked, onCheckedChange, label, disabled, className }: {
  checked: boolean; onCheckedChange: (on: boolean) => void; label: string; disabled?: boolean; className?: string
}) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); onCheckedChange(!checked) }}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-primary bg-primary" : "border-input bg-input/40",
        className
      )}
    >
      <span className={cn("block size-3 rounded-full bg-background shadow-sm transition-transform", checked ? "translate-x-3.5" : "translate-x-0.5")} />
    </button>
  )
}

export { Switch }
