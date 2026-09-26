import { Check, X } from "lucide-react"
import { cn } from "@/lib/utils"

const LABEL: Record<string, string> = {
  proposed: "Proposed",
  submitted: "Submitted",
  approved: "Approved",
  dispatched: "Dispatched",
  received: "Received",
}

/** submitted/proposed → approved → dispatched → received; rejected/cancelled shown as a stop. */
export function StatusStepper({
  steps,
  status,
  className,
}: {
  steps: readonly string[]
  status: string
  className?: string
}) {
  const stopped = status === "rejected" || status === "cancelled"
  const current = stopped ? 0 : steps.indexOf(status)
  return (
    <ol className={cn("flex items-center gap-1", className)} aria-label={`Status: ${status}`}>
      {steps.map((s, i) => {
        const done = !stopped && i <= current
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={cn(
                "flex size-4 items-center justify-center rounded-full border text-[9px]",
                done ? "border-primary bg-primary text-white" : "border-border bg-background",
                stopped && i === 1 && "border-critical bg-critical text-white",
              )}
              aria-hidden="true"
            >
              {done ? <Check className="size-2.5" /> : stopped && i === 1 ? <X className="size-2.5" /> : null}
            </span>
            {/* Only the current step is labelled, so the stepper fits narrow cards. */}
            {(stopped ? i === 1 : i === current) ? (
              <span className={cn("text-xs font-medium whitespace-nowrap", stopped ? "text-critical" : "text-foreground")}>
                {stopped ? (status === "rejected" ? "Rejected" : "Cancelled") : LABEL[s]}
              </span>
            ) : (
              <span className="sr-only">{LABEL[s]}</span>
            )}
            {i < steps.length - 1 ? <span className={cn("h-px w-3", done && i < current ? "bg-primary" : "bg-border")} /> : null}
          </li>
        )
      })}
    </ol>
  )
}
