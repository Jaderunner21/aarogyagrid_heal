"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import { formatDaysLeft, formatNumber } from "@/lib/format"
import type { StockRow } from "@/lib/queries"

type Fac = { id: string; name: string; districtName: string }

export function NewTransferDialog({
  facilities,
  medicines,
  stock,
}: {
  facilities: Fac[]
  medicines: { id: string; name: string; unit: string }[]
  stock: StockRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [medicine, setMedicine] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [qty, setQty] = useState("")
  const [reason, setReason] = useState("")

  const byKey = useMemo(() => new Map(stock.map((s) => [`${s.facilityId}:${s.medicineId}`, s])), [stock])
  const groups = useMemo(() => {
    const g = new Map<string, Fac[]>()
    facilities.forEach((f) => g.set(f.districtName, [...(g.get(f.districtName) ?? []), f]))
    return [...g.entries()]
  }, [facilities])
  const unit = medicines.find((m) => m.id === medicine)?.unit ?? ""
  const fromStock = medicine && from ? byKey.get(`${from}:${medicine}`) : undefined
  const toStock = medicine && to ? byKey.get(`${to}:${medicine}`) : undefined
  const valid = medicine && from && to && from !== to && Number(qty) > 0 && (!fromStock || Number(qty) <= fromStock.quantity)

  function hint(s: StockRow | undefined) {
    return s ? `${formatNumber(s.quantity)} ${s.unit}s · ${formatDaysLeft(s.daysLeft)}` : ""
  }

  function submit() {
    if (!valid) return
    startTransition(async () => {
      const ok = await runRpc(
        createClient().rpc("create_manual_transfer", {
          p_medicine: medicine,
          p_from: from,
          p_to: to,
          p_qty: Number(qty),
          p_reason: reason.trim() || undefined,
        }),
        "Transfer created. It is waiting for approval.",
      )
      if (ok) {
        setOpen(false)
        setMedicine("")
        setFrom("")
        setTo("")
        setQty("")
        setReason("")
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-9">
          <Plus aria-hidden="true" />
          New transfer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New transfer</DialogTitle>
          <DialogDescription>Move stock between facilities. It starts as proposed and goes through approve → dispatch → receive.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="nt-med">Medicine</Label>
            <Select value={medicine} onValueChange={setMedicine}>
              <SelectTrigger id="nt-med" className="w-full">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="nt-from">From</Label>
              <FacilitySelect id="nt-from" value={from} onChange={setFrom} label="From facility" groups={groups} />
              <p className="text-muted-foreground h-4 text-xs">{hint(fromStock)}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="nt-to">To</Label>
              <FacilitySelect id="nt-to" value={to} onChange={setTo} label="To facility" groups={groups} />
              <p className="text-muted-foreground h-4 text-xs">{hint(toStock)}</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nt-qty">Quantity {unit ? `(${unit}s)` : ""}</Label>
            <Input id="nt-qty" type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nt-reason">Reason (optional)</Label>
            <Textarea id="nt-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {from && to && from === to ? <p className="text-critical text-xs">Choose two different facilities.</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !valid}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            Create transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FacilitySelect({
  id,
  value,
  onChange,
  label,
  groups,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  label: string
  groups: [string, Fac[]][]
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-label={label}>
        <SelectValue placeholder="Choose facility" />
      </SelectTrigger>
      <SelectContent>
        {groups.map(([district, list]) => (
          <SelectGroup key={district}>
            {groups.length > 1 ? <SelectLabel>{district}</SelectLabel> : null}
            {list.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
