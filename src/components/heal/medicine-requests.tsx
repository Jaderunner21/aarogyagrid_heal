"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Loader2, PillBottle, Send, Undo2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/heal/empty-state"
import { createClient } from "@/lib/supabase/client"
import { announceChange, runRpc } from "@/lib/client-actions"
import type { MedicineRequestView } from "@/lib/queries"
import type { Role } from "@/lib/roles"
import { formatDate, formatNumber } from "@/lib/format"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Viewer = { id: string; role: Role; districtId?: string | null; stateId?: string | null }
type ListedMedicine = { id: string; name: string; listName: string }

// ------------------------------------------------------------------ progress
const STEPS = ["mr.stepAsked", "mr.stepDistrict", "mr.stepState", "mr.stepAdded"] as const

function Progress({ r, lang }: { r: MedicineRequestView; lang: Lang }) {
  // steps finished, the step it is waiting at, and the step where it was stopped (if any)
  const state = {
    with_district: { done: 1, current: 1, stopped: null },
    with_state: { done: 2, current: 2, stopped: null },
    approved: { done: 4, current: null, stopped: null },
    rejected: { done: r.stateAt ? 2 : 1, current: null, stopped: r.stateAt ? 2 : 1 },
    cancelled: { done: 1, current: null, stopped: 1 },
  }[r.status]
  return (
    <ol className="flex items-center gap-1 text-[11px]" aria-label="Progress">
      {STEPS.map((k, i) => {
        const done = i < state.done
        const stopped = i === state.stopped
        const current = i === state.current
        return (
          <li key={k} className="flex items-center gap-1">
            {i > 0 ? <span className={cn("h-px w-3", done || stopped || current ? "bg-primary" : "bg-border")} aria-hidden="true" /> : null}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium",
                done && "bg-primary/10 text-primary",
                stopped && "text-critical bg-red-50",
                current && "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
                !done && !stopped && !current && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3" aria-hidden="true" /> : stopped ? <X className="size-3" aria-hidden="true" /> : null}
              {t(lang, k)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function statusText(r: MedicineRequestView, lang: Lang) {
  if (r.status === "approved") return t(lang, "mr.approved").replace("{state}", r.stateName)
  return t(lang, `mr.${r.status}`)
}

// ------------------------------------------------------------------ one request
export function MedicineRequestCard({
  r,
  viewer,
  lang = "en",
  listed = [],
}: {
  r: MedicineRequestView
  viewer: Viewer
  lang?: Lang
  listed?: ListedMedicine[]
}) {
  const canWithdraw = r.status === "with_district" && r.requestedBy === viewer.id
  const districtTurn = r.status === "with_district" && viewer.role === "district_officer" && viewer.districtId === r.districtId
  const stateTurn =
    r.status === "with_state" && (viewer.role === "national_admin" || (viewer.role === "state_admin" && viewer.stateId === r.stateId))

  return (
    <article
      id={`req-${r.id}`}
      className={cn(
        "bg-card scroll-mt-24 rounded-lg border p-3 target:ring-2 target:ring-primary",
        (districtTurn || stateTurn) && "border-l-4 border-l-amber-500",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <PillBottle className="text-primary size-4" aria-hidden="true" />
            {r.medicineName}
            {r.strength ? <span className="text-muted-foreground font-normal">· {r.strength}</span> : null}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {r.facilityName}, {r.districtName} · {r.requestedByName}
            {r.requestedByPosition === "medical_officer" ? " (doctor)" : ""} · {formatDate(r.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">per {r.unit}</Badge>
          {r.monthlyQty ? (
            <Badge variant="outline">
              ~{formatNumber(r.monthlyQty)} {t(lang, "mr.perMonth")}
            </Badge>
          ) : null}
          {r.isChronic ? <Badge variant="secondary">Long-term use</Badge> : null}
        </div>
      </header>

      <p className="mt-2 text-sm leading-relaxed">{r.reason}</p>

      {r.districtNote ? (
        <p className="text-muted-foreground mt-1.5 text-xs">
          <span className="text-foreground font-medium">District officer{r.districtByName ? ` (${r.districtByName})` : ""}:</span> {r.districtNote}
        </p>
      ) : null}
      {r.stateNote ? (
        <p className="text-muted-foreground mt-1 text-xs">
          <span className="text-foreground font-medium">State admin{r.stateByName ? ` (${r.stateByName})` : ""}:</span> {r.stateNote}
        </p>
      ) : null}
      {r.status === "approved" && r.linkedMedicineName && r.linkedMedicineName !== r.medicineName ? (
        <p className="text-muted-foreground mt-1 text-xs">Approved as: {r.linkedMedicineName}</p>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <Progress r={r} lang={lang} />
          <p className={cn("text-xs", r.status === "approved" ? "text-ok" : r.status === "rejected" ? "text-critical" : "text-muted-foreground")}>
            {statusText(r, lang)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canWithdraw ? <WithdrawButton id={r.id} lang={lang} /> : null}
          {districtTurn ? (
            <>
              <DecideDialog r={r} kind="district-no" />
              <DecideDialog r={r} kind="district-yes" />
            </>
          ) : null}
          {stateTurn ? (
            <>
              <DecideDialog r={r} kind="state-no" />
              <ApproveDialog r={r} listed={listed} />
            </>
          ) : null}
        </div>
      </footer>
    </article>
  )
}

export function MedicineRequestList({
  items,
  viewer,
  lang = "en",
  listed,
  emptyText,
}: {
  items: MedicineRequestView[]
  viewer: Viewer
  lang?: Lang
  listed?: ListedMedicine[]
  emptyText?: string
}) {
  if (items.length === 0) return <EmptyState icon={PillBottle} title={emptyText ?? t(lang, "mr.none")} className="py-6" />
  return (
    <div className="space-y-2.5">
      {items.map((r) => (
        <MedicineRequestCard key={r.id} r={r} viewer={viewer} lang={lang} listed={listed} />
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ actions
function WithdrawButton({ id, lang }: { id: string; lang: Lang }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (await runRpc(createClient().rpc("cancel_medicine_request", { p_id: id }), t(lang, "mr.withdrawn"))) router.refresh()
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}
      {t(lang, "mr.withdraw")}
    </Button>
  )
}

const DECIDE = {
  "district-yes": { button: "Support", title: "Support this request", need: false, label: "Note for the state admin (optional)", ok: "Sent to the state admin." },
  "district-no": { button: "Turn down", title: "Turn down this request", need: true, label: "Reason (the PHC will see it)", ok: "Request turned down." },
  "state-no": { button: "Decline", title: "Decline this request", need: true, label: "Reason (the PHC and district will see it)", ok: "Request declined." },
} as const

function DecideDialog({ r, kind }: { r: MedicineRequestView; kind: keyof typeof DECIDE }) {
  const router = useRouter()
  const cfg = DECIDE[kind]
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState("")
  const [pending, start] = useTransition()
  const yes = kind === "district-yes"
  const submit = () =>
    start(async () => {
      const db = createClient()
      const call = kind.startsWith("district")
        ? db.rpc("district_decide_medicine_request", { p_id: r.id, p_support: yes, p_note: note.trim() || undefined })
        : db.rpc("state_decide_medicine_request", { p_id: r.id, p_approve: false, p_note: note.trim() })
      if (await runRpc(call, cfg.ok)) {
        setOpen(false)
        router.refresh()
      }
    })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={yes ? "default" : "outline"}>
          {yes ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
          {cfg.button}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cfg.title}</DialogTitle>
          <DialogDescription>
            {r.medicineName} for {r.facilityName}: {r.reason}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="mr-note">{cfg.label}</Label>
          <Textarea id="mr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant={yes ? "default" : "destructive"} disabled={pending || (cfg.need && !note.trim())} onClick={submit}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {cfg.button}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** State admin: add it to the state list as a new medicine, or link it to one already listed. */
function ApproveDialog({ r, listed }: { r: MedicineRequestView; listed: ListedMedicine[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"new" | "existing">("new")
  // suggest "name + strength" unless the name already says it ("Nifedipine 10mg" already covers "10 mg")
  const squash = (x: string) => x.replace(/\s/g, "").toLowerCase()
  const [name, setName] = useState(
    r.strength && !squash(r.medicineName).includes(squash(r.strength)) ? `${r.medicineName} ${r.strength}` : r.medicineName,
  )
  const [unit, setUnit] = useState(r.unit)
  const [category, setCategory] = useState(r.category ?? "")
  const [existing, setExisting] = useState("")
  const [note, setNote] = useState("")
  const [pending, start] = useTransition()
  const ready = mode === "new" ? name.trim() && unit.trim() : Boolean(existing)
  const submit = () =>
    start(async () => {
      const ok = await runRpc(
        createClient().rpc("state_decide_medicine_request", {
          p_id: r.id,
          p_approve: true,
          p_note: note.trim() || undefined,
          ...(mode === "existing" ? { p_existing: existing } : { p_name: name.trim(), p_unit: unit.trim(), p_category: category.trim() || undefined }),
        }),
        mode === "new" ? `${name.trim()} added to the ${r.stateName} list.` : "Linked to the medicine already on the list.",
      )
      if (ok) {
        setOpen(false)
        router.refresh()
      }
    })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Check aria-hidden="true" /> Approve
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve: {r.medicineName}</DialogTitle>
          <DialogDescription>
            Requested by {r.requestedByName} at {r.facilityName}. Supported by the district officer{r.districtByName ? ` (${r.districtByName})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="bg-muted flex gap-1 rounded-lg p-1" role="radiogroup" aria-label="How to approve">
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn("h-8 flex-1 rounded-md text-sm font-medium", mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {m === "new" ? `Add to the ${r.stateName} list` : "It is already on the list"}
            </button>
          ))}
        </div>
        {mode === "new" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ap-name">Name on the list</Label>
              <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-unit">Unit</Label>
              <Input id="ap-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ap-cat">Category</Label>
              <Input id="ap-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Antibiotic" />
            </div>
            <p className="text-muted-foreground text-xs sm:col-span-2">
              Every PHC, CHC and warehouse in {r.stateName} gets it on their stock list (starting at 0), so any of them can order it.
            </p>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="ap-existing">Medicine already on the list</Label>
            <Select value={existing} onValueChange={setExisting}>
              <SelectTrigger id="ap-existing" className="w-full">
                <SelectValue placeholder="Choose the medicine" />
              </SelectTrigger>
              <SelectContent>
                {listed.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name} · {m.listName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">Use this when the same drug is already listed under another name.</p>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ap-note">Note for the PHC (optional)</Label>
          <Textarea id="ap-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={pending || !ready} onClick={submit}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ PHC form
export function NewMedicineRequestForm({ lang }: { lang: Lang }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [strength, setStrength] = useState("")
  const [unit, setUnit] = useState("")
  const [monthly, setMonthly] = useState("")
  const [reason, setReason] = useState("")
  const [chronic, setChronic] = useState(false)
  const [pending, start] = useTransition()
  const ready = name.trim() && unit.trim() && reason.trim().length >= 5

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const q = Number(monthly)
          const { error } = await createClient().rpc("request_new_medicine", {
            p_name: name.trim(),
            p_strength: strength.trim(),
            p_unit: unit.trim(),
            p_category: "",
            p_reason: reason.trim(),
            p_monthly_qty: Number.isFinite(q) && q > 0 ? q : undefined,
            p_is_chronic: chronic,
          })
          if (error) {
            toast.error(error.message)
            return
          }
          toast.success(t(lang, "mr.sent"))
          announceChange()
          setName("")
          setStrength("")
          setUnit("")
          setMonthly("")
          setReason("")
          setChronic(false)
          router.refresh()
        })
      }}
    >
      <p className="text-muted-foreground text-sm">{t(lang, "mr.hint")}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="nm-name">{t(lang, "mr.name")}</Label>
        <Input id="nm-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(lang, "mr.namePh")} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="nm-strength">{t(lang, "mr.strength")}</Label>
          <Input id="nm-strength" className="h-11" value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="100 mg" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="nm-unit">{t(lang, "mr.unit")}</Label>
          <Input id="nm-unit" className="h-11" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t(lang, "mr.unitPh")} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nm-monthly">{t(lang, "mr.monthly")}</Label>
        <Input id="nm-monthly" className="h-11" type="number" min={1} inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nm-reason">{t(lang, "mr.reason")}</Label>
        <Textarea id="nm-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(lang, "mr.reasonPh")} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-primary size-4" checked={chronic} onChange={(e) => setChronic(e.target.checked)} />
        {t(lang, "mr.chronic")}
      </label>
      <Button type="submit" className="h-11" disabled={pending || !ready}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
        {t(lang, "mr.send")}
      </Button>
    </form>
  )
}
