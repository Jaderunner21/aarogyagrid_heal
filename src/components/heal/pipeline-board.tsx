"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, Inbox } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RecommendationCard } from "@/components/heal/recommendation-card"
import { EmptyState } from "@/components/heal/empty-state"
import type { Viewer } from "@/lib/permissions"
import type { Recommendation } from "@/lib/queries"
import { cn } from "@/lib/utils"

const COLUMNS = [
  { key: "proposed", label: "Proposed", match: ["proposed", "submitted"] },
  { key: "approved", label: "Approved", match: ["approved"] },
  { key: "dispatched", label: "Dispatched", match: ["dispatched"] },
  { key: "received", label: "Received", match: ["received"] },
] as const

export function PipelineBoard({
  items,
  viewer,
  showCrossDistrictToggle = false,
}: {
  items: Recommendation[]
  viewer: Viewer
  showCrossDistrictToggle?: boolean
}) {
  const [medicine, setMedicine] = useState("all")
  const [facility, setFacility] = useState("all")
  const [origin, setOrigin] = useState("all")
  const [crossOnly, setCrossOnly] = useState(false)
  const [showRejected, setShowRejected] = useState(false)

  const medicines = useMemo(() => [...new Set(items.map((i) => i.medicineName))].sort(), [items])
  const facilities = useMemo(
    () =>
      [
        ...new Set(
          items.flatMap((i) => (i.kind === "transfer" ? [i.fromName, i.toName] : [i.facilityName, i.warehouseName])),
        ),
      ].sort(),
    [items],
  )

  const filtered = items.filter((i) => {
    if (medicine !== "all" && i.medicineName !== medicine) return false
    if (origin !== "all" && i.origin !== origin) return false
    if (crossOnly && !(i.kind === "transfer" && i.isCrossDistrict)) return false
    if (facility !== "all") {
      const names = i.kind === "transfer" ? [i.fromName, i.toName] : [i.facilityName, i.warehouseName]
      if (!names.includes(facility)) return false
    }
    return true
  })
  const rejected = filtered.filter((i) => i.status === "rejected" || i.status === "cancelled")

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Medicine" value={medicine} onChange={setMedicine} options={medicines} />
        <FilterSelect label="Facility" value={facility} onChange={setFacility} options={facilities} />
        <Select value={origin} onValueChange={setOrigin}>
          <SelectTrigger className="h-9 w-36" aria-label="Filter by origin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">AI + manual</SelectItem>
            <SelectItem value="ai">AI only</SelectItem>
            <SelectItem value="manual">Manual only</SelectItem>
          </SelectContent>
        </Select>
        {showCrossDistrictToggle ? (
          <label className="bg-card flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
            <input
              type="checkbox"
              checked={crossOnly}
              onChange={(e) => setCrossOnly(e.target.checked)}
              className="accent-primary size-4"
            />
            Cross-district only
          </label>
        ) : null}
        <span className="text-muted-foreground ml-auto text-xs">{filtered.length} items</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colItems = filtered.filter((i) => (col.match as readonly string[]).includes(i.status))
          return (
            <section key={col.key} aria-label={col.label} className="bg-muted/40 flex min-h-40 flex-col rounded-xl border">
              <h2 className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
                {col.label}
                <span className="bg-background text-muted-foreground rounded-full border px-2 text-xs font-medium">
                  {colItems.length}
                </span>
              </h2>
              <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto p-2">
                {colItems.length === 0 ? (
                  <EmptyState icon={Inbox} title="Nothing here." className="py-6" />
                ) : (
                  colItems.map((i) => <RecommendationCard key={i.id} item={i} viewer={viewer} compact />)
                )}
              </div>
            </section>
          )
        })}
      </div>

      <section className="rounded-xl border">
        <button
          type="button"
          onClick={() => setShowRejected((s) => !s)}
          aria-expanded={showRejected}
          className="flex w-full items-center gap-2 px-3 py-2 text-sm font-semibold"
        >
          {showRejected ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Rejected
          <span className="text-muted-foreground rounded-full border px-2 text-xs font-medium">{rejected.length}</span>
        </button>
        {showRejected ? (
          <div className={cn("grid gap-2 border-t p-2 md:grid-cols-2 xl:grid-cols-4")}>
            {rejected.length === 0 ? (
              <p className="text-muted-foreground p-2 text-sm">No rejected items.</p>
            ) : (
              rejected.map((i) => <RecommendationCard key={i.id} item={i} viewer={viewer} compact />)
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-48" aria-label={`Filter by ${label.toLowerCase()}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
