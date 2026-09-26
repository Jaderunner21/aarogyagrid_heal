"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, PackageSearch, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DaysLeftBar } from "@/components/heal/days-left-bar"
import { StatusBadge } from "@/components/heal/status-badge"
import { EmptyState } from "@/components/heal/empty-state"
import { ForecastDrawer, type DrawerTarget } from "@/components/heal/forecast-drawer"
import { formatDate, formatNumber } from "@/lib/format"
import type { StockRow } from "@/lib/queries"
import { STATUS_META, STATUS_ORDER, urgency, type StockStatus } from "@/lib/status"
import { cn } from "@/lib/utils"

type SortKey = "medicine" | "category" | "quantity" | "pdu" | "days" | "stockout"

export function StockTable({ rows, showFacility = false }: { rows: StockRow[]; showFacility?: boolean }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StockStatus | "all">("all")
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "days", dir: 1 })
  const [target, setTarget] = useState<DrawerTarget>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    rows.forEach((r) => (c[r.status] = (c[r.status] ?? 0) + 1))
    return c
  }, [rows])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows.filter(
      (r) =>
        (status === "all" || r.status === status) &&
        (!q ||
          r.medicineName.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.facilityName.toLowerCase().includes(q)),
    )
    const val = (r: StockRow): number | string => {
      switch (sort.key) {
        case "medicine":
          return r.medicineName
        case "category":
          return r.category
        case "quantity":
          return r.quantity
        case "pdu":
          return r.pdu ?? -1
        case "days":
          return urgency(r.status, r.daysLeft)
        case "stockout":
          return r.stockoutDate ?? "9999"
      }
    }
    return [...filtered].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
    })
  }, [rows, query, status, sort])

  function header(label: string, key: SortKey, className?: string) {
    const active = sort.key === key
    const Icon = active ? (sort.dir === 1 ? ArrowUp : ArrowDown) : ArrowUpDown
    return (
      <th
        scope="col"
        className={cn("px-3 py-2 font-medium", className)}
        aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className="hover:text-foreground inline-flex items-center gap-1"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))}
        >
          {label}
          <Icon className={cn("size-3", !active && "opacity-40")} aria-hidden="true" />
        </button>
      </th>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={showFacility ? "Search medicine or facility" : "Search medicine or category"}
            aria-label="Search stock"
            className="h-9 pl-8"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as StockStatus | "all")}>
          <SelectTrigger className="h-9 w-44" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses ({rows.length})</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label} ({counts[s] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={PackageSearch} title="No medicines match these filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                {showFacility ? <th className="px-3 py-2 font-medium">Facility</th> : null}
                {header("Medicine", "medicine")}
                {header("Category", "category")}
                {header("Quantity", "quantity", "text-right")}
                {header("Predicted / day", "pdu", "text-right")}
                {header("Days left", "days")}
                <th className="px-3 py-2 font-medium">Status</th>
                {header("Stock-out", "stockout")}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.map((r) => (
                <tr
                  key={`${r.facilityId}:${r.medicineId}`}
                  tabIndex={0}
                  onClick={() =>
                    setTarget({
                      facilityId: r.facilityId,
                      medicineId: r.medicineId,
                      title: r.medicineName,
                      subtitle: `${r.facilityName} · ${r.category}`,
                    })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setTarget({ facilityId: r.facilityId, medicineId: r.medicineId, title: r.medicineName, subtitle: `${r.facilityName} · ${r.category}` })
                    }
                  }}
                  className="hover:bg-accent/50 focus-visible:bg-accent/60 cursor-pointer outline-none"
                >
                  {showFacility ? <td className="px-3 py-2 whitespace-nowrap">{r.facilityName}</td> : null}
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {r.medicineName}
                    {r.medicineStatus !== "active" ? (
                      <span className="bg-critical/10 text-critical ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium">
                        Withdrawn: return or quarantine
                      </span>
                    ) : null}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">{r.category}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {formatNumber(r.quantity)} <span className="text-muted-foreground text-xs">{r.unit}s</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.pdu !== null ? formatNumber(r.pdu, 1) : "—"}</td>
                  <td className="px-3 py-2">
                    <DaysLeftBar daysLeft={r.daysLeft} resupplyDays={r.resupplyDays} status={r.status} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} size="sm" />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.stockoutDate ? formatDate(r.stockoutDate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ForecastDrawer target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
