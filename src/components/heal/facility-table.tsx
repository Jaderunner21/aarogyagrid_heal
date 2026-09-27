"use client"

import { useRouter } from "next/navigation"
import { Warehouse } from "lucide-react"
import { StatusBadge } from "@/components/heal/status-badge"
import { formatDaysLeft, formatNumber, formatPercent } from "@/lib/format"
import type { FacilitySummary } from "@/lib/queries"
import { TIER_LABEL } from "@/lib/facility-types"
import { STATUS_ORDER } from "@/lib/status"
import { cn } from "@/lib/utils"

export function FacilityTable({ rows, hrefBase }: { rows: FacilitySummary[]; hrefBase: string }) {
  const router = useRouter()
  const sorted = [...rows].sort(
    (a, b) =>
      Number(a.type === "warehouse") - Number(b.type === "warehouse") ||
      STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
      b.critical - a.critical ||
      (a.minDaysLeft ?? 999) - (b.minDaysLeft ?? 999),
  )
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr>
            <th className="px-4 py-2.5 font-medium">Facility</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 text-right font-medium">Critical</th>
            <th className="px-3 py-2.5 text-right font-medium">Low</th>
            <th className="px-3 py-2.5 text-right font-medium">Min days left</th>
            <th className="px-3 py-2.5 text-right font-medium">Beds occupied</th>
            <th className="px-3 py-2.5 text-right font-medium">Attendance 7d</th>
            <th className="px-3 py-2.5 text-right font-medium">Open alerts</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((f) => {
            const href = `${hrefBase}${f.id}`
            return (
              <tr
                key={f.id}
                tabIndex={0}
                role="link"
                aria-label={`Open ${f.name}`}
                onClick={() => router.push(href)}
                onKeyDown={(e) => e.key === "Enter" && router.push(href)}
                className="hover:bg-accent/50 focus-visible:bg-accent/60 cursor-pointer outline-none"
              >
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2 font-medium">
                    {f.type === "warehouse" ? <Warehouse className="text-muted-foreground size-4" aria-label="Warehouse" /> : null}
                    {f.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {f.code} · {TIER_LABEL[f.tier]}
                    {f.laqshya ? " · LaQshya" : ""}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={f.status} size="sm" />
                </td>
                <td className={cn("px-3 py-2.5 text-right font-medium", f.critical > 0 && "text-critical")}>{f.critical}</td>
                <td className={cn("px-3 py-2.5 text-right", f.low > 0 && "text-low")}>{f.low}</td>
                <td className="px-3 py-2.5 text-right">{formatDaysLeft(f.minDaysLeft)}</td>
                <td className="px-3 py-2.5 text-right">
                  {f.type === "warehouse" || f.type === "shc" ? "—" : `${formatNumber(f.occupiedBeds ?? 0)} / ${formatNumber(f.totalBeds)}`}
                  {f.criticalBedsTotal ? (
                    <span className={cn("block text-[11px]", f.criticalBedsOccupied >= f.criticalBedsTotal ? "text-critical font-medium" : "text-muted-foreground")}>
                      ICU/HDU/NICU {f.criticalBedsOccupied}/{f.criticalBedsTotal}
                    </span>
                  ) : null}
                </td>
                <td className={cn("px-3 py-2.5 text-right", (f.attendance7d ?? 1) < 0.7 && "text-critical font-medium")}>
                  {formatPercent(f.attendance7d)}
                </td>
                <td className="px-3 py-2.5 text-right">{f.openAlerts}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
