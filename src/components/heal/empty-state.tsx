import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Icon + one line + next action. */
export function EmptyState({
  icon: Icon,
  title,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-4 py-10 text-center", className)}>
      <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-muted-foreground max-w-xs text-sm">{title}</p>
      {action}
    </div>
  )
}
