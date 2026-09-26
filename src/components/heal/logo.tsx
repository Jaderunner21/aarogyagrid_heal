import { cn } from "@/lib/utils"
import { APP_NAME } from "@/lib/brand"

export function HealMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)}>
      <rect width="32" height="32" rx="8" fill="#0F766E" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#CCFBF1" />
      <path
        d="M5 17.5h5.2l2-4 3.2 8 2.6-5.5 1.4 1.5H27"
        fill="none"
        stroke="#0F766E"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function HealLogo({ className, tagline }: { className?: string; tagline?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <HealMark />
      <div className="leading-tight">
        <div className="text-lg font-semibold tracking-tight">{APP_NAME}</div>
        {tagline ? <div className="text-muted-foreground text-xs">{tagline}</div> : null}
      </div>
    </div>
  )
}
