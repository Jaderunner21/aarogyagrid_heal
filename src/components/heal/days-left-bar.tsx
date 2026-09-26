import { formatDaysLeft } from "@/lib/format"
import { STATUS_META, type StockStatus } from "@/lib/status"
import { cn } from "@/lib/utils"

const MAX_DAYS = 60

/** 0 → 60 days maps to width; a tick marks the resupply time; fill coloured by status. */
export function DaysLeftBar({
  daysLeft,
  resupplyDays,
  status,
  className,
  showLabel = true,
}: {
  daysLeft: number | null
  resupplyDays: number
  status: StockStatus
  className?: string
  showLabel?: boolean
}) {
  const pct = daysLeft === null ? 0 : Math.min(100, Math.max(0, (daysLeft / MAX_DAYS) * 100))
  const tick = Math.min(100, (resupplyDays / MAX_DAYS) * 100)
  const label = formatDaysLeft(daysLeft)
  return (
    <div className={cn("flex min-w-32 items-center gap-2", className)}>
      <div
        className="bg-muted relative h-2 flex-1 overflow-hidden rounded-full"
        role="img"
        aria-label={`${label}; resupply takes ${resupplyDays} days`}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(pct, daysLeft === null ? 0 : 2)}%`, background: STATUS_META[status].color }}
        />
        <div className="bg-foreground/60 absolute inset-y-0 w-0.5" style={{ left: `${tick}%` }} />
      </div>
      {showLabel ? (
        <span
          className={cn(
            "w-20 shrink-0 text-right text-xs font-medium tabular-nums",
            status === "critical" ? "text-critical" : status === "low" ? "text-low" : "text-foreground",
            daysLeft === null && "text-muted-foreground font-normal",
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  )
}
