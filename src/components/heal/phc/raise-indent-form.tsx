"use client"

import { usageRate } from "@/lib/rate"
import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { StatusIcon } from "@/components/heal/status-badge"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import { announceChange } from "@/lib/client-actions"
import { formatDaysLeft, formatNumber } from "@/lib/format"
import type { StockRow } from "@/lib/queries"
import { t, type Lang } from "@/lib/i18n"

export function suggestedQty(r: StockRow): number {
  return Math.max(1, Math.ceil((r.pdu ?? 0) * 30 - r.quantity))
}

export function RaiseIndentForm({ stock, lang }: { stock: StockRow[]; lang: Lang }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [medicineId, setMedicineId] = useState<string>("")
  const [qty, setQty] = useState("")
  const [note, setNote] = useState("")
  const selected = stock.find((s) => s.medicineId === medicineId)

  function choose(id: string) {
    setMedicineId(id)
    const row = stock.find((s) => s.medicineId === id)
    if (row) setQty(String(suggestedQty(row)))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = Number(qty)
    if (!medicineId || !Number.isFinite(q) || q <= 0) return
    startTransition(async () => {
      const { data, error } = await createClient().rpc("raise_indent", { p_medicine: medicineId, p_qty: q, p_note: note.trim() || undefined })
      if (error) toast.error(error.message)
      else {
        // with a doctor at this PHC, a staff request goes to them first
        toast.success(t(lang, data?.awaiting_mo ? "phc.indentSentMo" : "phc.indentSent"))
        announceChange()
      }
      if (!error) {
        setMedicineId("")
        setQty("")
        setNote("")
        router.refresh()
      }
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="indent-medicine">{t(lang, "phc.medicine")}</Label>
        <Select value={medicineId} onValueChange={choose}>
          <SelectTrigger id="indent-medicine" className="h-11 w-full">
            <SelectValue placeholder={t(lang, "phc.chooseMedicine")} />
          </SelectTrigger>
          <SelectContent>
            {stock.filter((s) => s.medicineStatus === "active").map((s) => (
              <SelectItem key={s.medicineId} value={s.medicineId}>
                <StatusIcon status={s.status} className="size-3.5" />
                {s.medicineName}
                <span className="text-muted-foreground text-xs">· {formatDaysLeft(s.daysLeft)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="indent-qty">
          {t(lang, "phc.quantity")}
          {selected ? ` (${selected.unit}s)` : ""}
        </Label>
        <Input
          id="indent-qty"
          type="number"
          inputMode="numeric"
          min={1}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="h-11 text-base"
        />
        {selected ? (
          <p className="text-muted-foreground text-xs">
            {t(lang, "phc.suggested")}: {formatNumber(suggestedQty(selected))} (
            {usageRate(selected.pdu)} for 30 days, minus {formatNumber(selected.quantity)} in stock)
          </p>
        ) : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="indent-note">{t(lang, "phc.note")}</Label>
        <Textarea id="indent-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
      <Button type="submit" className="h-11" disabled={pending || !medicineId || !(Number(qty) > 0)}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
        {t(lang, "phc.sendIndent")}
      </Button>
    </form>
  )
}
