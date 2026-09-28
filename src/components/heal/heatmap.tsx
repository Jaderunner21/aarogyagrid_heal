"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ForecastDrawer, type DrawerTarget } from "@/components/heal/forecast-drawer"
import { formatDaysLeft, formatNumber } from "@/lib/format"
import { STATUS_META, type StockStatus } from "@/lib/status"
import { cn } from "@/lib/utils"

export type HeatCell = {
  rowId: string
  colId: string
  status: StockStatus
  /** facility mode */
  daysLeft?: number | null
  quantity?: number
  unit?: string
  /** district mode: number of critical facilities out of total */
  count?: number
  total?: number
}

export type HeatAxis = { id: string; label: string; sub?: string }

/** Rows × medicines. Facility mode colours by days-left status; count mode by number of critical facilities. */
export function Heatmap({
  rows,
  cols,
  cells,
  mode,
  rowHref,
  rowLabel,
}: {
  rows: HeatAxis[]
  cols: HeatAxis[]
  cells: HeatCell[]
  mode: "facility" | "count"
  /** count mode: clicking a cell opens rowHref + rowId */
  rowHref?: string
  rowLabel?: string
}) {
  const router = useRouter()
  const [target, setTarget] = useState<DrawerTarget>(null)
  const byKey = new Map(cells.map((c) => [`${c.rowId}:${c.colId}`, c]))
  const maxCount = Math.max(1, ...cells.map((c) => c.count ?? 0))

  function color(c: HeatCell | undefined): { bg: string; fg: string } {
    if (!c) return { bg: "#F1F5F9", fg: "#94A3B8" }
    if (mode === "count") {
      const v = c.count ?? 0
      if (v === 0) return { bg: "#F0FDF4", fg: "#16A34A" }
      const a = 0.25 + 0.75 * (v / maxCount)
      return { bg: `rgba(220, 38, 38, ${a.toFixed(2)})`, fg: a > 0.55 ? "#fff" : "#7F1D1D" }
    }
    const m = STATUS_META[c.status]
    const fg = c.status === "unknown" ? "#475569" : "#fff"
    return { bg: m.color, fg }
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="bg-card sticky left-0 z-10 min-w-44 border-b p-2 text-left font-medium" scope="col">
                {rowLabel ?? (mode === "count" ? "District" : "Facility")}
              </th>
              {cols.map((c) => (
                <th key={c.id} scope="col" className="h-32 border-b p-1 align-bottom font-medium">
                  <span className="text-muted-foreground block w-8 origin-bottom-left translate-x-5 -rotate-60 whitespace-nowrap">
                    {c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="bg-card sticky left-0 z-10 border-b p-2 text-left font-normal whitespace-nowrap">
                  <span className="font-medium">{r.label}</span>
                  {r.sub ? <span className="text-muted-foreground block text-[11px]">{r.sub}</span> : null}
                </th>
                {cols.map((c) => {
                  const cell = byKey.get(`${r.id}:${c.id}`)
                  const { bg, fg } = color(cell)
                  const text =
                    mode === "count"
                      ? `${cell?.count ?? 0}`
                      : cell?.daysLeft === null || cell?.daysLeft === undefined
                        ? "–"
                        : cell.daysLeft >= 99
                          ? "99+"
                          : cell.daysLeft < 0.05
                            ? "0"
                            : cell.daysLeft < 1
                              ? "<1"
                              : Math.round(cell.daysLeft).toString()
                  const tip =
                    mode === "count"
                      ? `${c.label} · ${r.label}: ${cell?.count ?? 0} of ${cell?.total ?? 0} facilities critical`
                      : `${c.label} · ${r.label}: ${formatDaysLeft(cell?.daysLeft ?? null)}${
                          cell?.quantity !== undefined ? `, ${formatNumber(cell.quantity)} ${cell.unit ?? ""}s in stock` : ""
                        } (${cell ? STATUS_META[cell.status].label : "no data"})`
                  return (
                    <td key={c.id} className="border-b p-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label={tip}
                            onClick={() => {
                              if (!cell) return
                              if (mode === "facility") {
                                setTarget({ facilityId: r.id, medicineId: c.id, title: c.label, subtitle: r.label })
                              } else if (rowHref) {
                                router.push(`${rowHref}${r.id}`)
                              }
                            }}
                            className={cn(
                              "flex h-8 w-11 items-center justify-center rounded text-[11px] font-semibold tabular-nums transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-foreground focus-visible:outline-none",
                            )}
                            style={{ background: bg, color: fg }}
                          >
                            {text}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{tip}</TooltipContent>
                      </Tooltip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {mode === "facility" ? (
          (["critical", "low", "ok", "overstock", "unknown"] as StockStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ background: STATUS_META[s].color }} aria-hidden="true" />
              {STATUS_META[s].label}
            </span>
          ))
        ) : (
          <>
            <span>Cell = number of facilities critical for that medicine.</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-green-50 ring-1 ring-green-200" aria-hidden="true" /> 0
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ background: "rgba(220,38,38,.4)" }} aria-hidden="true" /> few
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ background: "rgba(220,38,38,1)" }} aria-hidden="true" /> many
            </span>
          </>
        )}
        <span className="ml-auto">{mode === "facility" ? "Numbers are days of stock left. Click a cell for its forecast." : `Click a cell to open that ${(rowLabel ?? "district").toLowerCase()}.`}</span>
      </div>
      <ForecastDrawer target={target} onClose={() => setTarget(null)} />
    </div>
  )
}
