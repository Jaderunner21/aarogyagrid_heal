import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, PackagePlus, type LucideIcon } from "lucide-react"
import { STATUS_META, type StockStatus } from "@/lib/status"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const STATUS_ICON: Record<StockStatus, LucideIcon> = {
  critical: AlertOctagon,
  low: AlertTriangle,
  ok: CheckCircle2,
  overstock: PackagePlus,
  unknown: CircleHelp,
}

/** Status is always colour + icon + text. */
export function StatusBadge({
  status,
  lang = "en",
  className,
  size = "default",
}: {
  status: StockStatus
  lang?: Lang
  className?: string
  size?: "default" | "sm"
}) {
  const meta = STATUS_META[status]
  const Icon = STATUS_ICON[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-6 px-2 text-xs",
        meta.soft,
        meta.border,
        meta.text,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden="true" />
      {t(lang, meta.key)}
    </span>
  )
}

export function StatusIcon({ status, className }: { status: StockStatus; className?: string }) {
  const Icon = STATUS_ICON[status]
  return <Icon className={cn(STATUS_META[status].text, className)} aria-label={STATUS_META[status].label} />
}
