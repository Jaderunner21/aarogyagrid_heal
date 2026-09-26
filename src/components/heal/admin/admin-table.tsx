"use client"

import { useMemo, useState } from "react"
import { Download, Search, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/heal/empty-state"
import { cn } from "@/lib/utils"

export type Column<T> = {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** plain value for search + CSV (defaults to nothing) */
  text?: (row: T) => string | number | null | undefined
  className?: string
}

export type Filter<T> = {
  key: string
  label: string
  options: { value: string; label: string }[]
  match: (row: T, value: string) => boolean
}

function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const cols = columns.filter((c) => c.text)
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.map((c) => esc(c.header)).join(","), ...rows.map((r) => cols.map((c) => esc(c.text!(r))).join(","))].join("\n")
}

/** Searchable, filterable table with CSV export, used by every admin console tab. */
export function AdminTable<T>({
  rows,
  columns,
  filters = [],
  rowKey,
  csvName,
  searchPlaceholder = "Search",
  actions,
  rowClassName,
  emptyText = "Nothing matches these filters.",
}: {
  rows: T[]
  columns: Column<T>[]
  filters?: Filter<T>[]
  rowKey: (row: T) => string
  csvName: string
  searchPlaceholder?: string
  actions?: React.ReactNode
  rowClassName?: (row: T) => string | undefined
  emptyText?: string
}) {
  const [query, setQuery] = useState("")
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(filters.map((f) => [f.key, "all"])))

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      for (const f of filters) {
        const v = values[f.key] ?? "all"
        if (v !== "all" && !f.match(r, v)) return false
      }
      if (!q) return true
      return columns.some((c) => String(c.text?.(r) ?? "").toLowerCase().includes(q))
    })
  }, [rows, filters, values, query, columns])

  function exportCsv() {
    const blob = new Blob([toCsv(shown, columns)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${csvName}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-80">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="h-9 pl-8" />
        </div>
        {filters.map((f) => (
          <Select key={f.key} value={values[f.key]} onValueChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}>
            <SelectTrigger className="h-9 w-44" aria-label={`Filter by ${f.label.toLowerCase()}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All {f.label.toLowerCase()}</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <span className="text-muted-foreground text-xs">
          {shown.length} of {rows.length}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {actions}
          <Button variant="outline" size="sm" className="h-9" onClick={exportCsv} disabled={shown.length === 0}>
            <Download aria-hidden="true" />
            CSV
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={SearchX} title={emptyText} className="bg-card rounded-xl border" />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-medium first:pl-4", c.className)}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => (
                <tr key={rowKey(r)} className={cn("align-top", rowClassName?.(r))}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 first:pl-4", c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
