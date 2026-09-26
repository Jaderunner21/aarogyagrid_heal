import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { STATUS_META, type StockStatus } from "@/lib/status"
import { cn } from "@/lib/utils"

type Props = {
  label: string
  value: string | number
  sub?: string
  status?: StockStatus
  icon?: LucideIcon
  href?: string
  className?: string
}

export function StatTile({ label, value, sub, status, icon: Icon, href, className }: Props) {
  const meta = status ? STATUS_META[status] : null
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">{label}</span>
        {Icon ? <Icon className={cn("size-4", meta ? meta.text : "text-muted-foreground")} aria-hidden="true" /> : null}
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums tracking-tight", meta?.text)}>{value}</div>
      {sub ? <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">{sub}</div> : null}
    </>
  )
  const classes = cn(
    "bg-card relative block rounded-xl border p-4 transition-colors",
    meta && "border-l-4",
    href && "hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
    className,
  )
  const style = meta ? { borderLeftColor: meta.color } : undefined
  return href ? (
    <Link href={href} className={classes} style={style}>
      {body}
    </Link>
  ) : (
    <div className={classes} style={style}>
      {body}
    </div>
  )
}
