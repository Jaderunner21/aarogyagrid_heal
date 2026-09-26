"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertOctagon, AlertTriangle, BedDouble, CalendarClock, Check, CircleCheck, Info, Loader2, Siren, Sparkles, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/heal/empty-state"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import type { AlertView } from "@/lib/queries"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/format"

const TYPE_TITLE: Record<string, string> = {
  stockout_risk: "Stock-out risk",
  overstock: "Overstock",
  staff_shortage: "Staff shortage",
  bed_pressure: "Bed pressure",
  demand_surge: "Footfall surge",
  expiry_risk: "Expiry",
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "demand_surge", label: "Surge" },
  { key: "stockout_risk", label: "Stock-out" },
  { key: "expiry_risk", label: "Expiry" },
  { key: "people", label: "Staff & beds" },
] as const
type FilterKey = (typeof FILTERS)[number]["key"]

const matches = (a: AlertView, f: FilterKey) =>
  f === "all" ? true : f === "people" ? a.type === "staff_shortage" || a.type === "bed_pressure" : a.type === f

export function AlertFeed({
  alerts,
  showFacility = false,
  canAcknowledge = true,
  limit,
  emptyText = "No open alerts. Everything is within safe levels.",
  lang = "en",
  filterable = false,
}: {
  alerts: AlertView[]
  showFacility?: boolean
  canAcknowledge?: boolean
  limit?: number
  emptyText?: string
  lang?: Lang
  /** show type filter chips (Surge, Stock-out, Expiry, Staff & beds) */
  filterable?: boolean
}) {
  const [filter, setFilter] = useState<FilterKey>("all")
  // surges are the emergencies: list them first within each severity
  const ordered = [...alerts].sort((a, b) => Number(b.type === "demand_surge") - Number(a.type === "demand_surge"))
  const filtered = ordered.filter((a) => matches(a, filter))
  const shown = limit ? filtered.slice(0, limit) : filtered

  return (
    <div className="space-y-3">
      {filterable ? (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter alerts">
          {FILTERS.map((f) => {
            const count = alerts.filter((a) => matches(a, f.key)).length
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
                  active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                  f.key === "demand_surge" && count > 0 && !active && "border-critical text-critical",
                )}
              >
                {f.label} {count ? <span className="opacity-80">({count})</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <EmptyState icon={CircleCheck} title={filter === "all" ? emptyText : "No alerts of this type."} />
      ) : (
        <ul className="divide-y">
          {shown.map((a) => (
            <AlertItem key={a.id} alert={a} showFacility={showFacility} canAcknowledge={canAcknowledge} lang={lang} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AlertItem({
  alert: a,
  showFacility,
  canAcknowledge,
  lang,
}: {
  alert: AlertView
  showFacility: boolean
  canAcknowledge: boolean
  lang: Lang
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const Icon =
    a.type === "demand_surge"
      ? Siren
      : a.type === "expiry_risk"
        ? CalendarClock
        : a.type === "staff_shortage"
      ? Users
      : a.type === "bed_pressure"
        ? BedDouble
        : a.severity === "critical"
          ? AlertOctagon
          : a.severity === "warning"
            ? AlertTriangle
            : Info
  const tone = a.severity === "critical" ? "text-critical" : a.severity === "warning" ? "text-low" : "text-overstock"

  function acknowledge() {
    startTransition(async () => {
      if (await runRpc(createClient().rpc("acknowledge_alert", { p_id: a.id }), "Alert acknowledged.")) router.refresh()
    })
  }

  const label = a.type === "demand_surge" ? "Surge" : a.type === "expiry_risk" ? "Expiry" : t(lang, `alert.${a.severity}`)
  const title = `${label}: ${
    a.medicineName ?? TYPE_TITLE[a.type]
  }${showFacility ? ` at ${a.facilityName}` : ""}`

  return (
    <li id={`alert-${a.id}`} className="flex scroll-mt-24 gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className={cn("mt-0.5 size-5 shrink-0", tone)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm font-semibold">{title}</p>
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {timeAgo(a.created_at)}
          </span>
        </div>
        <p className="text-foreground/80 mt-0.5 text-sm">{a.message}</p>
        {a.ai_summary ? (
          <p className="bg-primary-soft/40 mt-1.5 flex gap-1.5 rounded-md px-2 py-1.5 text-xs leading-relaxed">
            <Sparkles className="text-primary mt-0.5 size-3.5 shrink-0" aria-label="Gemini" />
            {a.ai_summary}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-2">
          {a.status === "acknowledged" ? (
            <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
              <Check className="size-3.5" aria-hidden="true" /> {t(lang, "alert.acknowledged")}
            </span>
          ) : canAcknowledge && a.status === "open" ? (
            <Button size="xs" variant="outline" onClick={acknowledge} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
              {t(lang, "alert.acknowledge")}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  )
}
