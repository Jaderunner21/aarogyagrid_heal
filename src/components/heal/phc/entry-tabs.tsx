"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BedDouble, Check, Loader2, Mic, NotebookPen, Plus, Save, UserMinus, UserPlus, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EmptyState } from "@/components/heal/empty-state"
import { ConfirmDialog } from "@/components/heal/admin/confirm-dialog"
import { StatusIcon } from "@/components/heal/status-badge"
import { VoiceEntry } from "@/components/heal/phc/voice-entry"
import { createClient } from "@/lib/supabase/client"
import { announceChange, refreshForecast } from "@/lib/client-actions"
import { formatNumber } from "@/lib/format"
import type { StockRow } from "@/lib/queries"
import type { Enums, Tables } from "@/lib/database.types"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Props = {
  lang: Lang
  userId: string
  facilityId: string
  today: string
  initialTab: string
  stock: StockRow[]
  totalBeds: number
  report: Tables<"daily_reports"> | null
  staff: Tables<"staff">[]
  attendance: Tables<"attendance">[]
}

export function EntryTabs(props: Props) {
  const { lang } = props
  const tabs = [
    { value: "usage", label: t(lang, "phc.usage"), icon: NotebookPen },
    { value: "voice", label: t(lang, "phc.voice"), icon: Mic },
    { value: "report", label: t(lang, "phc.dailyReport"), icon: BedDouble },
    { value: "attendance", label: t(lang, "phc.attendance"), icon: Users },
  ]
  return (
    <Tabs defaultValue={tabs.some((x) => x.value === props.initialTab) ? props.initialTab : "usage"} className="gap-4">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-auto">
        {tabs.map(({ value, label, icon: Icon }) => (
          <TabsTrigger key={value} value={value} className="h-10 px-3">
            <Icon aria-hidden="true" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="usage">
        <UsageForm {...props} />
      </TabsContent>
      <TabsContent value="voice">
        <VoiceEntry lang={lang} userId={props.userId} facilityId={props.facilityId} today={props.today} stock={props.stock} totalBeds={props.totalBeds} />
      </TabsContent>
      <TabsContent value="report">
        <ReportForm {...props} />
      </TabsContent>
      <TabsContent value="attendance">
        <AttendanceForm {...props} />
      </TabsContent>
    </Tabs>
  )
}

// ------------------------------------------------------------------ usage & receipts
function UsageForm({ lang, stock, facilityId, userId }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [values, setValues] = useState<Record<string, { used: string; received: string }>>({})

  const set = (id: string, key: "used" | "received", v: string) =>
    setValues((s) => ({ ...s, [id]: { used: s[id]?.used ?? "", received: s[id]?.received ?? "", [key]: v } }))

  const lines = stock
    .map((r) => ({ r, used: Number(values[r.medicineId]?.used || 0), received: Number(values[r.medicineId]?.received || 0) }))
    .filter((l) => l.used > 0 || l.received > 0)
  const overdrawn = lines.filter((l) => l.used > l.r.quantity + l.received)

  function save() {
    if (lines.length === 0) {
      toast.info(t(lang, "phc.nothingToSave"))
      return
    }
    if (overdrawn.length) {
      toast.error(`${overdrawn[0].r.medicineName}: used is more than stock + received.`)
      return
    }
    startTransition(async () => {
      const { error } = await createClient()
        .from("stock_log")
        .insert(
          lines.map((l) => ({
            facility_id: facilityId,
            medicine_id: l.r.medicineId,
            qty_used: l.used,
            qty_received: l.received,
            source: "manual" as const,
            created_by: userId,
          })),
        )
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(t(lang, "phc.entrySaved"))
      refreshForecast(facilityId, () => router.refresh())
      setValues({})
      announceChange()
      router.refresh()
    })
  }

  return (
    <div className="bg-card rounded-xl border">
      <p className="text-muted-foreground border-b px-4 py-3 text-sm">{t(lang, "phc.usageHint")}</p>
      <div className="text-muted-foreground hidden grid-cols-[minmax(0,1fr)_7rem_8rem_8rem] gap-3 border-b px-4 py-2 text-xs font-medium sm:grid">
        <span>{t(lang, "phc.medicine")}</span>
        <span className="text-right">{t(lang, "phc.currentStock")}</span>
        <span>{t(lang, "phc.usedToday")}</span>
        <span>{t(lang, "phc.receivedToday")}</span>
      </div>
      <ul className="divide-y">
        {stock.map((r) => {
          const bad = overdrawn.some((o) => o.r.medicineId === r.medicineId)
          return (
            <li
              key={r.medicineId}
              className="grid grid-cols-2 items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem]"
            >
              <div className="col-span-2 flex min-w-0 items-center gap-2 sm:col-span-1">
                <StatusIcon status={r.status} className="size-4 shrink-0" />
                <span className="truncate font-medium">{r.medicineName}</span>
                {r.medicineStatus !== "active" ? (
                  <span className="bg-critical/10 text-critical shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium">{t(lang, "stock.withdrawn")}</span>
                ) : null}
                <span className="text-muted-foreground ml-auto text-xs sm:hidden">
                  {formatNumber(r.quantity)} {r.unit}s
                </span>
              </div>
              <span className="hidden text-right tabular-nums sm:block">
                {formatNumber(r.quantity)} <span className="text-muted-foreground text-xs">{r.unit}s</span>
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="0"
                aria-label={`${r.medicineName}: ${t(lang, "phc.usedToday")}`}
                value={values[r.medicineId]?.used ?? ""}
                onChange={(e) => set(r.medicineId, "used", e.target.value)}
                className={cn("h-11 text-base", bad && "border-critical")}
                aria-invalid={bad}
              />
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="0"
                aria-label={`${r.medicineName}: ${t(lang, "phc.receivedToday")}`}
                value={values[r.medicineId]?.received ?? ""}
                onChange={(e) => set(r.medicineId, "received", e.target.value)}
                className="h-11 text-base"
              />
            </li>
          )
        })}
      </ul>
      <div className="bg-background/95 sticky bottom-16 flex items-center justify-between gap-3 rounded-b-xl border-t px-4 py-3 backdrop-blur lg:bottom-0">
        <span className="text-muted-foreground text-sm">{lines.length} lines</span>
        <Button onClick={save} disabled={pending} className="h-11 px-6">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
          {t(lang, "phc.save")}
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ daily report
function ReportForm({ lang, facilityId, userId, today, totalBeds, report }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [footfall, setFootfall] = useState(report ? String(report.footfall) : "")
  const [beds, setBeds] = useState(report ? String(report.occupied_beds) : "")
  const bedsInvalid = Number(beds) > totalBeds || Number(beds) < 0

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (bedsInvalid) return
    startTransition(async () => {
      const { error } = await createClient()
        .from("daily_reports")
        .upsert(
          {
            facility_id: facilityId,
            report_date: today,
            footfall: Number(footfall || 0),
            occupied_beds: Number(beds || 0),
            created_by: userId,
          },
          { onConflict: "facility_id,report_date" },
        )
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(t(lang, "phc.reportSaved"))
      router.refresh()
      // footfall and beds feed the forecast and bed alerts; the re-run also pushes the change live upstream
      refreshForecast(facilityId, () => router.refresh())
    })
  }

  return (
    <form onSubmit={save} className="bg-card grid max-w-md gap-4 rounded-xl border p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="footfall">{t(lang, "phc.footfall")}</Label>
        <Input id="footfall" type="number" inputMode="numeric" min={0} value={footfall} onChange={(e) => setFootfall(e.target.value)} className="h-11 text-base" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="beds">
          {t(lang, "phc.occupiedBeds")} ({t(lang, "phc.bedsOf")} {totalBeds})
        </Label>
        <Input
          id="beds"
          type="number"
          inputMode="numeric"
          min={0}
          max={totalBeds}
          value={beds}
          onChange={(e) => setBeds(e.target.value)}
          className={cn("h-11 text-base", bedsInvalid && "border-critical")}
          aria-invalid={bedsInvalid}
        />
      </div>
      <Button type="submit" disabled={pending || bedsInvalid} className="h-11">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
        {t(lang, "phc.save")}
      </Button>
    </form>
  )
}

// ------------------------------------------------------------------ attendance + staff list
// Removing keeps the person's past attendance; they just leave today's roster.
function RemoveStaff({ lang, staffId, name }: { lang: Lang; staffId: string; name: string }) {
  const router = useRouter()
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon" className="text-muted-foreground size-11" aria-label={`${t(lang, "phc.removeStaff")}: ${name}`}>
          <UserMinus aria-hidden="true" />
        </Button>
      }
      title={`${t(lang, "phc.removeStaff")}: ${name}?`}
      description={t(lang, "phc.removeStaffHint")}
      confirmLabel={t(lang, "phc.removeStaff")}
      destructive
      onConfirm={async () => {
        const { error } = await createClient().from("staff").update({ is_active: false }).eq("id", staffId)
        if (error) {
          toast.error(error.message)
          return false
        }
        toast.success(t(lang, "phc.staffRemoved"))
        router.refresh()
        return true
      }}
    />
  )
}

const STAFF_ROLES: Enums<"staff_role">[] = ["medical_officer", "nurse", "pharmacist", "lab_technician", "health_worker", "other"]
const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

function AttendanceForm({ lang, facilityId, userId, today, staff, attendance }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [marks, setMarks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(attendance.map((a) => [a.staff_id, a.present])),
  )
  const [name, setName] = useState("")
  const [role, setRole] = useState<Enums<"staff_role">>("nurse")

  function save() {
    const rows = Object.entries(marks).map(([staff_id, present]) => ({ staff_id, att_date: today, present, marked_by: userId }))
    if (rows.length === 0) {
      toast.info(t(lang, "phc.nothingToSave"))
      return
    }
    startTransition(async () => {
      const { error } = await createClient().from("attendance").upsert(rows, { onConflict: "staff_id,att_date" })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(t(lang, "phc.attendanceSaved"))
      router.refresh()
      refreshForecast(facilityId, () => router.refresh())
    })
  }

  function addStaff(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    startTransition(async () => {
      const { error } = await createClient().from("staff").insert({ facility_id: facilityId, name: name.trim(), role })
      if (error) {
        toast.error(error.message)
        return
      }
      setName("")
      toast.success(t(lang, "phc.saved"))
      router.refresh()
    })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="bg-card rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-semibold">{t(lang, "phc.attendance")} · {today}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMarks(Object.fromEntries(staff.map((s) => [s.id, true])))}
            disabled={staff.length === 0}
          >
            <Check aria-hidden="true" />
            {t(lang, "phc.markAll")}
          </Button>
        </div>
        {staff.length === 0 ? (
          <EmptyState icon={Users} title={t(lang, "phc.noStaff")} />
        ) : (
          <ul className="divide-y">
            {staff.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-muted-foreground text-xs">{roleLabel(s.role)}</p>
                </div>
                <RemoveStaff lang={lang} staffId={s.id} name={s.name} />
                <div className="flex gap-1" role="radiogroup" aria-label={`${s.name} attendance`}>
                  {[true, false].map((present) => {
                    const active = marks[s.id] === present
                    return (
                      <button
                        key={String(present)}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setMarks((m) => ({ ...m, [s.id]: present }))}
                        className={cn(
                          "flex h-11 min-w-24 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
                          active && present && "border-ok bg-green-50 text-ok",
                          active && !present && "border-critical bg-red-50 text-critical",
                          !active && "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {present ? <Check className="size-4" aria-hidden="true" /> : <X className="size-4" aria-hidden="true" />}
                        {t(lang, present ? "phc.present" : "phc.absent")}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end border-t px-4 py-3">
          <Button onClick={save} disabled={pending || staff.length === 0} className="h-11 px-6">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            {t(lang, "phc.save")}
          </Button>
        </div>
      </div>

      <form onSubmit={addStaff} className="bg-card grid content-start gap-3 self-start rounded-xl border p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <UserPlus className="size-4" aria-hidden="true" />
          {t(lang, "phc.addStaff")}
        </h2>
        <div className="grid gap-1.5">
          <Label htmlFor="staff-name">{t(lang, "phc.staffName")}</Label>
          <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="staff-role">{t(lang, "phc.staffRole")}</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Enums<"staff_role">)}>
            <SelectTrigger id="staff-role" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="outline" disabled={pending || !name.trim()} className="h-11">
          <Plus aria-hidden="true" />
          {t(lang, "phc.addStaff")}
        </Button>
      </form>
    </div>
  )
}
