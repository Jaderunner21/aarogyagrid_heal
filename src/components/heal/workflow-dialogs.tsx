"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, PackageCheck, Truck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { refreshForecast, runRpc } from "@/lib/client-actions"
import type { IndentView, TransferView } from "@/lib/queries"
import type { Enums } from "@/lib/database.types"
import { CARRIER_LABEL } from "@/lib/status"
import { formatNumber } from "@/lib/format"
import { t, type Lang } from "@/lib/i18n"

type Item = TransferView | IndentView
type Size = "sm" | "default" | "lg"

function describe(item: Item) {
  const qty = item.kind === "transfer" ? item.qty : (item.qtyApproved ?? item.qtyRequested)
  const route = item.kind === "transfer" ? `${item.fromName} → ${item.toName}` : `${item.warehouseName} → ${item.facilityName}`
  return { qty, route, text: `${item.medicineName} × ${formatNumber(qty)} ${item.unit}s` }
}

function useAction() {
  const router = useRouter()
  const refresh = () => router.refresh()
  const [pending, startTransition] = useTransition()
  const run = (fn: () => Promise<boolean>, after?: () => void) =>
    startTransition(async () => {
      if (await fn()) {
        after?.()
        router.refresh()
      }
    })
  return { pending, run, refresh }
}

function CarrierFields({
  carrierType,
  setCarrierType,
  name,
  setName,
  contact,
  setContact,
}: {
  carrierType: Enums<"carrier_type">
  setCarrierType: (v: Enums<"carrier_type">) => void
  name: string
  setName: (v: string) => void
  contact?: string
  setContact?: (v: string) => void
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="carrier-type">Carrier</Label>
        <Select value={carrierType} onValueChange={(v) => setCarrierType(v as Enums<"carrier_type">)}>
          <SelectTrigger id="carrier-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CARRIER_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="carrier-name">Carrier name / vehicle</Label>
        <Input id="carrier-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. District van RJ27-GA-1024" />
      </div>
      {setContact ? (
        <div className="grid gap-1.5">
          <Label htmlFor="carrier-contact">Contact (optional)</Label>
          <Input id="carrier-contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone number" inputMode="tel" />
        </div>
      ) : null}
    </div>
  )
}

// ------------------------------------------------------------------ approve
export function ApproveDialog({ item, size = "sm" }: { item: Item; size?: Size }) {
  const [open, setOpen] = useState(false)
  const [carrierType, setCarrierType] = useState<Enums<"carrier_type">>("warehouse_vehicle")
  const [name, setName] = useState("")
  const [contact, setContact] = useState("")
  const [qty, setQty] = useState(String(item.kind === "indent" ? item.qtyRequested : ""))
  const { pending, run } = useAction()
  const d = describe(item)

  function submit() {
    const db = createClient()
    if (item.kind === "transfer") {
      run(
        () =>
          runRpc(
            db.rpc("approve_transfer", {
              p_id: item.id,
              p_carrier_type: carrierType,
              p_carrier_name: name.trim() || undefined,
              p_carrier_contact: contact.trim() || undefined,
            }),
            "Transfer approved. The sending facility has been asked to dispatch.",
          ),
        () => setOpen(false),
      )
    } else {
      const q = Number(qty)
      if (!Number.isFinite(q) || q <= 0) return
      run(
        () => runRpc(db.rpc("approve_indent", { p_id: item.id, p_qty_approved: q }), "Indent approved. The warehouse has been asked to dispatch."),
        () => setOpen(false),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size}>
          <Check aria-hidden="true" />
          Approve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve {item.kind}</DialogTitle>
          <DialogDescription>
            {d.text} · {d.route}
          </DialogDescription>
        </DialogHeader>
        {item.kind === "transfer" ? (
          <CarrierFields
            carrierType={carrierType}
            setCarrierType={setCarrierType}
            name={name}
            setName={setName}
            contact={contact}
            setContact={setContact}
          />
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="qty-approved">Quantity to approve ({item.unit}s)</Label>
            <Input
              id="qty-approved"
              type="number"
              min={1}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            <p className="text-muted-foreground text-xs">Requested: {formatNumber(item.qtyRequested)}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ reject
export function RejectDialog({ item, size = "sm" }: { item: Item; size?: Size }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const { pending, run } = useAction()
  const d = describe(item)

  function submit() {
    if (!reason.trim()) return
    const db = createClient()
    const call =
      item.kind === "transfer"
        ? db.rpc("reject_transfer", { p_id: item.id, p_reason: reason.trim() })
        : db.rpc("reject_indent", { p_id: item.id, p_reason: reason.trim() })
    run(() => runRpc(call, `${item.kind === "transfer" ? "Transfer" : "Indent"} rejected.`), () => setOpen(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline">
          <X aria-hidden="true" />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject {item.kind}</DialogTitle>
          <DialogDescription>
            {d.text} · {d.route}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Donor needs this stock for an outreach camp next week"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending || !reason.trim()}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ dispatch
export function DispatchDialog({
  item,
  size = "sm",
  lang = "en",
  fromFacility = false,
}: {
  item: Item
  size?: Size
  lang?: Lang
  /** sent by a PHC or CHC (e.g. to its sub-centre), not a warehouse: its own staff carry it */
  fromFacility?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [carrierType, setCarrierType] = useState<Enums<"carrier_type">>(
    item.kind === "indent" ? (fromFacility ? "facility_staff" : "warehouse_vehicle") : (item.carrierType ?? "facility_staff"),
  )
  const [name, setName] = useState(item.carrierName ?? "")
  const { pending, run, refresh } = useAction()
  const d = describe(item)

  function submit() {
    const db = createClient()
    const call =
      item.kind === "transfer"
        ? db.rpc("dispatch_transfer", { p_id: item.id })
        : db.rpc("dispatch_indent", { p_id: item.id, p_carrier_type: carrierType, p_carrier_name: name.trim() || undefined })
    const donorId = item.kind === "transfer" ? item.fromId : item.warehouseId
    run(
      () => runRpc(call, "Dispatched. The receiving facility will confirm on arrival."),
      () => {
        setOpen(false)
        refreshForecast(donorId, refresh)
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size}>
          <Truck aria-hidden="true" />
          {t(lang, "phc.dispatch")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dispatch {item.kind}</DialogTitle>
          <DialogDescription>
            {d.text} · {d.route}
          </DialogDescription>
        </DialogHeader>
        {item.kind === "indent" ? (
          <CarrierFields carrierType={carrierType} setCarrierType={setCarrierType} name={name} setName={setName} />
        ) : (
          <p className="text-sm">
            {formatNumber(d.qty)} {item.unit}s will be deducted from {item.fromName}&apos;s stock now.
            {item.carrierName ? (
              <span className="text-muted-foreground block pt-1">
                Carrier: {CARRIER_LABEL[item.carrierType ?? "other"]} · {item.carrierName}
                {item.carrierContact ? ` · ${item.carrierContact}` : ""}
              </span>
            ) : null}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Truck aria-hidden="true" />}
            Confirm dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ receive
export function ReceiveDialog({ item, size = "sm", lang = "en" }: { item: Item; size?: Size; lang?: Lang }) {
  const d = describe(item)
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(String(d.qty))
  const { pending, run, refresh } = useAction()

  function submit() {
    const q = Number(qty)
    if (!Number.isFinite(q) || q < 0 || q > d.qty) return
    const db = createClient()
    const call =
      item.kind === "transfer"
        ? db.rpc("receive_transfer", { p_id: item.id, p_received_qty: q })
        : db.rpc("receive_indent", { p_id: item.id, p_received_qty: q })
    const receiverId = item.kind === "transfer" ? item.toId : item.facilityId
    run(
      () => runRpc(call, "Receipt confirmed. Stock updated."),
      () => {
        setOpen(false)
        refreshForecast(receiverId, refresh)
      },
    )
  }

  const invalid = !(Number(qty) >= 0 && Number(qty) <= d.qty)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size}>
          <PackageCheck aria-hidden="true" />
          {t(lang, "phc.confirmReceipt")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(lang, "phc.confirmReceipt")}</DialogTitle>
          <DialogDescription>
            {d.text} · {d.route}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="received-qty">Quantity received ({item.unit}s)</Label>
          <Input
            id="received-qty"
            type="number"
            inputMode="numeric"
            min={0}
            max={d.qty}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-11 text-base"
            aria-invalid={invalid}
          />
          <p className="text-muted-foreground text-xs">Sent: {formatNumber(d.qty)}. Change it only if some didn&apos;t arrive.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || invalid}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PackageCheck aria-hidden="true" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------ PHC doctor sign-off
/** The PHC's medical officer signs off a staff request (it then goes to the district) or sends it back. */
export function SignOffButtons({ item, lang = "en", size = "sm" }: { item: IndentView; lang?: Lang; size?: Size }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const { pending, run } = useAction()
  const d = describe(item)
  const decide = (approve: boolean) =>
    run(
      () =>
        runRpc(
          createClient().rpc("mo_decide_indent", { p_id: item.id, p_approve: approve, p_reason: approve ? undefined : reason.trim() }),
          t(lang, approve ? "mo.signedOff" : "mo.sentBack"),
        ),
      () => setOpen(false),
    )

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size={size} variant="outline" disabled={pending}>
            <X aria-hidden="true" />
            {t(lang, "mo.sendBack")}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(lang, "mo.sendBack")}</DialogTitle>
            <DialogDescription>
              {d.text} · {item.raisedByName ?? ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="mo-reason">{t(lang, "mo.reason")}</Label>
            <Textarea id="mo-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(lang, "mo.reasonHint")} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => decide(false)} disabled={pending || !reason.trim()}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <X aria-hidden="true" />}
              {t(lang, "mo.sendBack")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Button size={size} onClick={() => decide(true)} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
        {t(lang, "mo.signOff")}
      </Button>
    </div>
  )
}
