"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AdminTable, type Column, type Filter } from "@/components/heal/admin/admin-table"
import { formatDateTime } from "@/lib/format"
import type { Tables } from "@/lib/database.types"

type Entry = Tables<"audit_log"> & { stateName: string }

const ENTITY_LABEL: Record<string, string> = {
  facility: "Facility",
  person: "Person",
  medicine: "Medicine",
  batch: "Batch",
  handover: "Admin handover",
  bed_change: "Beds",
}

/** Only the keys that changed, so a long row stays readable. */
function changedKeys(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "—"
  return typeof v === "object" ? JSON.stringify(v) : String(v)
}

function Changes({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false)
  const keys = changedKeys(entry.before, entry.after)
  if (keys.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  const b = (entry.before ?? {}) as Record<string, unknown>
  const a = (entry.after ?? {}) as Record<string, unknown>
  return (
    <div>
      <Button variant="ghost" size="sm" className="-ml-2 h-7" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        {keys.length} field{keys.length === 1 ? "" : "s"}
      </Button>
      {open ? (
        <dl className="mt-1 grid max-w-md grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {keys.map((k) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground font-mono">{k}</dt>
              <dd className="break-all">
                <span className="text-critical line-through">{show(b[k])}</span> → <span className="text-ok font-medium">{show(a[k])}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

export function AuditTab({ entries }: { entries: Entry[] }) {
  const columns: Column<Entry>[] = [
    { key: "at", header: "When", text: (e) => e.at, cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.at)}</span> },
    {
      key: "who",
      header: "Who",
      text: (e) => `${e.actor_name ?? "System"} ${e.actor_role ?? ""}`,
      cell: (e) => (
        <span>
          {e.actor_name ?? "System"}
          <span className="text-muted-foreground block text-xs">{e.actor_role?.replace("_", " ") ?? "automatic"}</span>
        </span>
      ),
    },
    { key: "action", header: "Action", text: (e) => e.action, cell: (e) => <Badge variant="outline" className="font-mono">{e.action}</Badge> },
    {
      key: "what",
      header: "What",
      text: (e) => `${ENTITY_LABEL[e.entity_type] ?? e.entity_type}: ${e.entity_name ?? ""}`,
      cell: (e) => (
        <span>
          <span className="text-muted-foreground text-xs">{ENTITY_LABEL[e.entity_type] ?? e.entity_type}</span>
          <span className="block font-medium">{e.entity_name}</span>
        </span>
      ),
    },
    { key: "scope", header: "Scope", text: (e) => e.stateName, cell: (e) => e.stateName },
    { key: "changes", header: "Before → after", text: (e) => `${JSON.stringify(e.before ?? {})} -> ${JSON.stringify(e.after ?? {})}`, cell: (e) => <Changes entry={e} /> },
    { key: "note", header: "Note", text: (e) => e.note, cell: (e) => <span className="text-muted-foreground max-w-56 text-xs">{e.note}</span> },
  ]
  const entityTypes = [...new Set(entries.map((e) => e.entity_type))]
  const actors = [...new Set(entries.map((e) => e.actor_name ?? "System"))].sort()
  const filters: Filter<Entry>[] = [
    { key: "entity", label: "Record types", options: entityTypes.map((t) => ({ value: t, label: ENTITY_LABEL[t] ?? t })), match: (e, v) => e.entity_type === v },
    { key: "actor", label: "People", options: actors.map((a) => ({ value: a, label: a })), match: (e, v) => (e.actor_name ?? "System") === v },
    {
      key: "when",
      label: "Dates",
      options: [
        { value: "1", label: "Last 24 hours" },
        { value: "7", label: "Last 7 days" },
        { value: "30", label: "Last 30 days" },
      ],
      match: (e, v) => Date.now() - new Date(e.at).getTime() <= Number(v) * 86_400_000,
    },
  ]
  return (
    <AdminTable
      rows={entries}
      columns={columns}
      filters={filters}
      rowKey={(e) => String(e.id)}
      csvName="audit-log"
      searchPlaceholder="Search who, what, action or value"
      emptyText="No admin changes recorded yet."
    />
  )
}
