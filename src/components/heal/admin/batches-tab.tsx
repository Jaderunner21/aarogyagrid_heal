"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Boxes, Loader2, Plus, Trash2 } from "lucide-react"
import { differenceInCalendarDays, parseISO } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section } from "@/components/heal/section"
import { AdminTable, type Column, type Filter } from "@/components/heal/admin/admin-table"
import { ConfirmDialog } from "@/components/heal/admin/confirm-dialog"
import type { AdminFacility } from "@/components/heal/admin/facilities-tab"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import { formatDate, formatNumber } from "@/lib/format"

export type AdminBatch = {
  id: string
  facilityId: string
  facilityName: string
  districtName: string
  medicineId: string
  medicineName: string
  medicineStatus: "active" | "discontinued" | "withdrawn"
  unit: string
  batchNo: string
  expiryDate: string
  qty: number
  status: string
}
type Row = AdminBatch & { daysLeft: number }
type Wastage = { facilityName: string; medicineName: string; qty: number; date: string; note: string | null }

function expiryBand(days: number): "expired" | "30" | "60" | "90" | "later" {
  if (days < 0) return "expired"
  if (days <= 30) return "30"
  if (days <= 60) return "60"
  if (days <= 90) return "90"
  return "later"
}

export function BatchesTab({
  facilities,
  districts,
  batches,
  medicines,
  wastage,
}: {
  isNational: boolean
  states: { id: string; name: string }[]
  districts: { id: string; name: string }[]
  facilities: AdminFacility[]
  batches: AdminBatch[]
  medicines: { id: string; name: string; unit: string }[]
  wastage: Wastage[]
}) {
  const [today] = useState(() => new Date())
  const rows: Row[] = useMemo(
    () =>
      batches
        .map((b) => ({ ...b, daysLeft: differenceInCalendarDays(parseISO(b.expiryDate), today) }))
        // batches still on the shelf first (soonest expiry on top), used-up and written-off ones after
        .sort((x, y) => Number(y.status === "active" && y.qty > 0) - Number(x.status === "active" && x.qty > 0) || x.expiryDate.localeCompare(y.expiryDate)),
    [batches, today],
  )
  const live = rows.filter((r) => r.status === "active" && r.qty > 0)
  const count = (band: string) => live.filter((r) => expiryBand(r.daysLeft) === band).length
  const wastedUnits = wastage.reduce((s, w) => s + w.qty, 0)

  const columns: Column<Row>[] = [
    {
      key: "medicine",
      header: "Medicine",
      text: (r) => r.medicineName,
      cell: (r) => (
        <div>
          <p className="font-medium">{r.medicineName}</p>
          {r.medicineStatus !== "active" ? (
            <Badge variant="destructive" className="mt-1">
              Withdrawn: return or quarantine
            </Badge>
          ) : null}
        </div>
      ),
    },
    { key: "facility", header: "Facility", text: (r) => `${r.facilityName}, ${r.districtName}`, cell: (r) => <span>{r.facilityName}<span className="text-muted-foreground block text-xs">{r.districtName}</span></span> },
    { key: "batch", header: "Batch", text: (r) => r.batchNo, cell: (r) => <span className="font-mono text-xs">{r.batchNo}</span> },
    {
      key: "expiry",
      header: "Expiry",
      text: (r) => r.expiryDate,
      cell: (r) => {
        const band = expiryBand(r.daysLeft)
        const tone = band === "expired" || band === "30" ? "text-critical" : band === "60" || band === "90" ? "text-low" : "text-muted-foreground"
        return (
          <span className={tone}>
            {formatDate(r.expiryDate)}
            <span className="block text-xs">
              {r.status === "written_off" ? "written off" : r.daysLeft < 0 ? `expired ${-r.daysLeft}d ago` : `${r.daysLeft} days left`}
            </span>
          </span>
        )
      },
    },
    { key: "qty", header: "Quantity", className: "text-right", text: (r) => r.qty, cell: (r) => `${formatNumber(r.qty)} ${r.unit}` },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (r) => (r.status === "active" && r.qty > 0 ? <WriteOff batch={r} /> : null),
    },
  ]
  const filters: Filter<Row>[] = [
    {
      key: "expiry",
      label: "Expiry windows",
      options: [
        { value: "expired", label: "Expired" },
        { value: "30", label: "Within 30 days" },
        { value: "60", label: "Within 60 days" },
        { value: "90", label: "Within 90 days" },
      ],
      match: (r, v) => r.status === "active" && r.qty > 0 && (v === "expired" ? r.daysLeft < 0 : r.daysLeft >= 0 && r.daysLeft <= Number(v)),
    },
    { key: "district", label: "Districts", options: districts.map((d) => ({ value: d.name, label: d.name })), match: (r, v) => r.districtName === v },
    { key: "status", label: "Statuses", options: [{ value: "active", label: "In stock" }, { value: "written_off", label: "Written off" }], match: (r, v) => r.status === v },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Expired, still on shelf", value: count("expired"), tone: "text-critical" },
          { label: "Expire ≤ 30 days", value: count("30"), tone: "text-critical" },
          { label: "31–60 days", value: count("60"), tone: "text-low" },
          { label: "61–90 days", value: count("90"), tone: "text-low" },
          { label: "Wasted, last 30 days", value: `${formatNumber(wastedUnits)} units`, tone: "text-foreground" },
        ].map((k) => (
          <div key={k.label} className="bg-card rounded-xl border p-3">
            <p className="text-muted-foreground text-xs">{k.label}</p>
            <p className={`text-xl font-semibold tabular-nums ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">
        Stock is issued first-expiry-first-out. Batches expiring within 90 days raise alerts at 90, 60 and 30 days, and the engine recommends
        moving them to a nearby facility that will use them in time. Expired stock is written off automatically each night and counted as
        wastage.
      </p>
      <AdminTable
        rows={rows}
        columns={columns}
        filters={filters}
        rowKey={(r) => r.id}
        csvName="batches"
        searchPlaceholder="Search medicine, facility or batch"
        rowClassName={(r) => (r.status === "active" && r.qty > 0 && r.daysLeft < 0 ? "bg-critical/5" : undefined)}
        actions={<AddBatchDialog facilities={facilities.filter((f) => f.isActive)} medicines={medicines} />}
      />
      <Section title="Wastage, last 30 days" description="Expired or written-off stock. It counts against the facility in reports.">
        {wastage.length === 0 ? (
          <p className="text-muted-foreground text-sm">No wastage recorded.</p>
        ) : (
          <ul className="divide-y text-sm">
            {wastage.slice(0, 30).map((w, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 py-2">
                <span className="text-muted-foreground w-24">{formatDate(w.date)}</span>
                <span className="font-medium">{w.medicineName}</span>
                <span>{w.facilityName}</span>
                <span className="ml-auto tabular-nums">{formatNumber(w.qty)} units</span>
                {w.note ? <span className="text-muted-foreground w-full text-xs">{w.note}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function WriteOff({ batch }: { batch: Row }) {
  const router = useRouter()
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-critical">
          <Trash2 aria-hidden="true" /> Write off
        </Button>
      }
      title={`Write off batch ${batch.batchNo}?`}
      description={`${formatNumber(batch.qty)} ${batch.unit} of ${batch.medicineName} at ${batch.facilityName} leave stock and count as wastage.`}
      confirmLabel="Write off"
      destructive
      reasonLabel="Reason"
      onConfirm={async (reason) => {
        const ok = await runRpc(createClient().rpc("admin_write_off_batch", { p_batch: batch.id, p_reason: reason }), "Batch written off.")
        if (ok) router.refresh()
        return ok
      }}
    />
  )
}

function AddBatchDialog({ facilities, medicines }: { facilities: AdminFacility[]; medicines: { id: string; name: string; unit: string }[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [facility, setFacility] = useState("")
  const [medicine, setMedicine] = useState("")
  const [batchNo, setBatchNo] = useState("")
  const [expiry, setExpiry] = useState("")
  const [qty, setQty] = useState("")
  const ready = facility && medicine && batchNo.trim() && expiry && Number(qty) > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9">
          <Plus aria-hidden="true" /> Register batch
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Register a batch</DialogTitle>
          <DialogDescription>For stock already on the shelf that isn&apos;t in a batch yet. New receipts get batches automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="b-facility">Facility</Label>
            <Select value={facility} onValueChange={setFacility}>
              <SelectTrigger id="b-facility" className="w-full">
                <SelectValue placeholder="Choose facility" />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} · {f.districtName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="b-medicine">Medicine</Label>
            <Select value={medicine} onValueChange={setMedicine}>
              <SelectTrigger id="b-medicine" className="w-full">
                <SelectValue placeholder="Choose medicine" />
              </SelectTrigger>
              <SelectContent>
                {medicines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="b-no">Batch number</Label>
            <Input id="b-no" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="b-expiry">Expiry date</Label>
            <Input id="b-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="b-qty">Quantity</Label>
            <Input id="b-qty" type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
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
                  createClient().rpc("admin_add_batch", { p_facility: facility, p_medicine: medicine, p_batch_no: batchNo.trim(), p_expiry: expiry, p_qty: Number(qty) }),
                  "Batch registered.",
                )
                if (ok) {
                  setOpen(false)
                  setBatchNo("")
                  setQty("")
                  router.refresh()
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Boxes aria-hidden="true" />}
            Register
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
