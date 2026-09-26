"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Ban, Loader2, Pencil, Pill, Plus, RotateCcw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AdminTable, type Column, type Filter } from "@/components/heal/admin/admin-table"
import { Section } from "@/components/heal/section"
import { MedicineRequestList } from "@/components/heal/medicine-requests"
import type { MedicineRequestView } from "@/lib/queries"
import type { Role } from "@/lib/roles"
import { ConfirmDialog } from "@/components/heal/admin/confirm-dialog"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import { formatDate } from "@/lib/format"
import type { Enums, Tables } from "@/lib/database.types"

type Medicine = Tables<"medicines">
const FACILITY_TYPES: { value: Enums<"facility_type">; label: string }[] = [
  { value: "phc", label: "PHC" },
  { value: "chc", label: "CHC" },
  { value: "warehouse", label: "Warehouse" },
]

function StatusBadge({ m }: { m: Medicine }) {
  if (m.status === "active") return <Badge variant="secondary">Active</Badge>
  return (
    <Badge variant="destructive" title={m.status_reason ?? undefined}>
      {m.status === "withdrawn" ? "Withdrawn" : "Discontinued"}
      {m.status_date ? ` · ${formatDate(m.status_date)}` : ""}
    </Badge>
  )
}

type StateOption = { id: string; name: string }

export function MedicinesTab({
  isNational,
  medicines,
  states,
  myStateId,
  requests,
  meId,
  myRole,
}: {
  isNational: boolean
  medicines: Medicine[]
  states: StateOption[]
  myStateId: string | null
  requests: MedicineRequestView[]
  meId: string
  myRole: Role
}) {
  const categories = [...new Set(medicines.map((m) => m.category))].sort()
  const stateName = new Map(states.map((st) => [st.id, st.name]))
  const listName = (m: Medicine) => (m.state_id ? `${stateName.get(m.state_id) ?? "State"} list` : "National list")
  // national admin: every list; state admin: only their own state's list (the national list is read-only for them)
  const canEdit = (m: Medicine) => isNational || (m.state_id !== null && m.state_id === myStateId)
  const myStateName = myStateId ? (stateName.get(myStateId) ?? "your state") : null
  const waiting = requests.filter((r) => r.status === "with_state")
  const earlier = requests.filter((r) => r.status !== "with_state").slice(0, 10)
  const viewer = { id: meId, role: myRole, stateId: myStateId }
  const listed = medicines.filter((m) => m.status === "active").map((m) => ({ id: m.id, name: m.name, listName: listName(m) }))
  const columns: Column<Medicine>[] = [
    {
      key: "name",
      header: "Medicine",
      text: (m) => `${m.name} ${m.generic_name ?? ""}`,
      cell: (m) => (
        <div>
          <p className="font-medium">{m.name}</p>
          <p className="text-muted-foreground text-xs">
            {[m.generic_name, m.strength].filter(Boolean).join(" · ")} · per {m.unit}
          </p>
        </div>
      ),
    },
    {
      key: "list",
      header: "List",
      text: listName,
      cell: (m) => <Badge variant={m.state_id ? "default" : "outline"}>{listName(m)}</Badge>,
    },
    { key: "category", header: "Category", text: (m) => m.category, cell: (m) => m.category },
    {
      key: "kind",
      header: "Forecast",
      text: (m) => (m.is_chronic ? "chronic" : "acute"),
      cell: (m) => (m.is_chronic ? <Badge variant="outline">Chronic · direct only</Badge> : <Badge variant="outline">Acute · footfall-linked</Badge>),
    },
    {
      key: "stocked",
      header: "Stocked at",
      text: (m) => m.stocked_at.join(" "),
      cell: (m) => m.stocked_at.map((t) => FACILITY_TYPES.find((f) => f.value === t)?.label ?? t).join(", "),
    },
    {
      key: "status",
      header: "Status",
      text: (m) => `${m.status} ${m.status_reason ?? ""}`,
      cell: (m) => (
        <div className="space-y-1">
          <StatusBadge m={m} />
          {m.status_reason ? <p className="text-muted-foreground max-w-56 text-xs">{m.status_reason}</p> : null}
        </div>
      ),
    },
  ]
  columns.push({
    key: "actions",
    header: "",
    className: "text-right",
    cell: (m) =>
      canEdit(m) ? (
        <div className="flex justify-end gap-1">
          <MedicineDialog medicine={m} categories={categories} states={states} isNational={isNational} myStateId={myStateId} />
          <StatusAction medicine={m} />
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">National admin</span>
      ),
  })
  const filters: Filter<Medicine>[] = [
    { key: "status", label: "Statuses", options: [{ value: "active", label: "Active" }, { value: "discontinued", label: "Discontinued" }, { value: "withdrawn", label: "Withdrawn" }], match: (m, v) => m.status === v },
    { key: "category", label: "Categories", options: categories.map((c) => ({ value: c, label: c })), match: (m, v) => m.category === v },
    {
      key: "list",
      label: "Lists",
      options: [{ value: "national", label: "National list" }, ...states.map((st) => ({ value: st.id, label: `${st.name} list` }))],
      match: (m, v) => (v === "national" ? m.state_id === null : m.state_id === v),
    },
  ]

  return (
    <div className="space-y-5">
      <Section
        title={`Requests from PHCs for medicines not on the list${waiting.length ? ` (${waiting.length} waiting)` : ""}`}
        description="A PHC doctor asked for it and the district officer supported it. Approve to add it to the state list, or decline with a reason."
        bodyClassName="p-3"
      >
        <MedicineRequestList items={waiting} viewer={viewer} listed={listed} emptyText="No requests are waiting for a decision." />
        {earlier.length ? (
          <details className="mt-3">
            <summary className="text-muted-foreground cursor-pointer text-sm">Earlier and in-progress requests ({earlier.length})</summary>
            <div className="mt-2">
              <MedicineRequestList items={earlier} viewer={viewer} listed={listed} />
            </div>
          </details>
        ) : null}
      </Section>
      <p className="text-muted-foreground bg-muted rounded-lg px-3 py-2 text-sm">
        {isNational
          ? "The national list is used by every state. Each state can also keep its own list of extra medicines; you can manage both."
          : `The national list is shared by every state and managed by the national admin. You manage the ${myStateName} list: medicines only facilities in ${myStateName} stock.`}
      </p>
      <AdminTable
        rows={medicines}
        columns={columns}
        filters={filters}
        rowKey={(m) => m.id}
        csvName="medicines"
        searchPlaceholder="Search medicines"
        rowClassName={(m) => (m.status !== "active" ? "bg-critical/5" : undefined)}
        actions={<MedicineDialog categories={categories} states={states} isNational={isNational} myStateId={myStateId} />}
      />
    </div>
  )
}

function MedicineDialog({
  medicine,
  categories,
  states,
  isNational,
  myStateId,
}: {
  medicine?: Medicine
  categories: string[]
  states: StateOption[]
  isNational: boolean
  myStateId: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(medicine?.name ?? "")
  const [generic, setGeneric] = useState(medicine?.generic_name ?? "")
  const [strength, setStrength] = useState(medicine?.strength ?? "")
  const [unit, setUnit] = useState(medicine?.unit ?? "tablet")
  const [category, setCategory] = useState(medicine?.category ?? "")
  const [chronic, setChronic] = useState(medicine?.is_chronic ?? false)
  const [stockedAt, setStockedAt] = useState<Enums<"facility_type">[]>(medicine?.stocked_at ?? ["phc", "chc", "warehouse"])
  // which list a new medicine goes on (a state admin's always go on their own state's list)
  const [list, setList] = useState<string>(isNational ? "national" : (myStateId ?? "national"))
  const ready = name.trim() && unit.trim() && category.trim() && stockedAt.length > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {medicine ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${medicine.name}`}>
            <Pencil aria-hidden="true" />
          </Button>
        ) : (
          <Button size="sm" className="h-9">
            <Plus aria-hidden="true" /> Add medicine
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{medicine ? `Edit ${medicine.name}` : "Add a medicine"}</DialogTitle>
          <DialogDescription>Medicines are never deleted. Stop one with Discontinue or Withdraw instead.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!medicine ? (
            isNational ? (
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="m-list">Add to</Label>
                <Select value={list} onValueChange={setList}>
                  <SelectTrigger id="m-list" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="national">National list (every state)</SelectItem>
                    {states.map((st) => (
                      <SelectItem key={st.id} value={st.id}>
                        {st.name} list only
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="bg-muted rounded-md px-3 py-2 text-sm sm:col-span-2">
                This adds it to the {states.find((st) => st.id === myStateId)?.name ?? "state"} list. Only facilities in your state will stock it.
              </p>
            )
          ) : null}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="m-name">Name</Label>
            <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paracetamol 500 mg" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-generic">Generic name</Label>
            <Input id="m-generic" value={generic} onChange={(e) => setGeneric(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-strength">Strength</Label>
            <Input id="m-strength" value={strength} onChange={(e) => setStrength(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-unit">Unit</Label>
            <Input id="m-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-category">Category</Label>
            <Input id="m-category" list="m-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="m-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="accent-primary size-4" checked={chronic} onChange={(e) => setChronic(e.target.checked)} />
            Chronic medicine (forecast from its own history only, not from patient footfall)
          </label>
          <fieldset className="grid gap-1.5 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Stocked at</legend>
            <div className="flex flex-wrap gap-4">
              {FACILITY_TYPES.map((t) => (
                <label key={t.value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary size-4"
                    checked={stockedAt.includes(t.value)}
                    onChange={(e) => setStockedAt((s) => (e.target.checked ? [...s, t.value] : s.filter((x) => x !== t.value)))}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !ready}
            onClick={() =>
              startTransition(async () => {
                const ok = await runRpc(
                  createClient().rpc("admin_save_medicine", {
                    p_id: medicine?.id ?? null,
                    p_name: name.trim(),
                    p_generic: generic.trim(),
                    p_strength: strength.trim(),
                    p_unit: unit.trim(),
                    p_category: category.trim(),
                    p_is_chronic: chronic,
                    p_stocked_at: stockedAt,
                    ...(!medicine && list !== "national" ? { p_state: list } : {}),
                  }),
                  medicine ? "Medicine updated." : "Medicine added.",
                )
                if (ok) {
                  setOpen(false)
                  router.refresh()
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Pill aria-hidden="true" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatusAction({ medicine }: { medicine: Medicine }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<"discontinued" | "withdrawn">("discontinued")
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState("")

  if (medicine.status !== "active") {
    return (
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            <RotateCcw aria-hidden="true" /> Reinstate
          </Button>
        }
        title={`Reinstate ${medicine.name}?`}
        description="It will be forecast, indented and recommended for transfer again."
        confirmLabel="Reinstate"
        onConfirm={async () => {
          const ok = await runRpc(createClient().rpc("admin_set_medicine_status", { p_id: medicine.id, p_status: "active" }), "Medicine reinstated.")
          if (ok) router.refresh()
          return ok
        }}
      />
    )
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-critical">
          <Ban aria-hidden="true" /> Stop
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop {medicine.name}</DialogTitle>
          <DialogDescription>
            New indents and transfer recommendations stop at once, pending ones are cancelled, and every facility&apos;s remaining stock is
            flagged &ldquo;withdrawn: return or quarantine&rdquo;.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="s-status">Action</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "discontinued" | "withdrawn")}>
              <SelectTrigger id="s-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="discontinued">Discontinue</SelectItem>
                <SelectItem value="withdrawn">Withdraw (recall)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="s-date">From date</Label>
            <Input id="s-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="s-reason">Reason</Label>
            <Textarea id="s-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. CDSCO quality alert on batch series" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || !reason.trim() || !date}
            onClick={() =>
              startTransition(async () => {
                const ok = await runRpc(
                  createClient().rpc("admin_set_medicine_status", { p_id: medicine.id, p_status: status, p_date: date, p_reason: reason.trim() }),
                  `${medicine.name} ${status}.`,
                )
                if (ok) {
                  setOpen(false)
                  router.refresh()
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Ban aria-hidden="true" />}
            {status === "withdrawn" ? "Withdraw" : "Discontinue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
