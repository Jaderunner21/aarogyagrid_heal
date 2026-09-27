"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { differenceInCalendarDays, format, parseISO } from "date-fns"
import { AlertTriangle, Loader2, PackageCheck, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState } from "@/components/heal/empty-state"
import { ScanButton } from "@/components/heal/barcode-scanner"
import { createClient } from "@/lib/supabase/client"
import { announceChange, refreshForecast } from "@/lib/client-actions"
import { formatDate } from "@/lib/format"
import { samplePackCode, toGtin14, type PackScan } from "@/lib/gs1"
import type { StockRow } from "@/lib/queries"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Line = { key: string; medicineId: string; batch: string; expiry: string; qty: string }
type Notice = { tone: "error" | "info"; text: string; pick?: { batch: string; expiry: string } }

/** Receive stock by scanning packs: the batch and expiry come off the barcode. */
export function ScanReceive({ lang, stock, facilityId, userId, today }: { lang: Lang; stock: StockRow[]; facilityId: string; userId: string; today: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [gtins, setGtins] = useState<Map<string, { id: string; name: string }>>(new Map()) // GTIN-14 → item
  const [lines, setLines] = useState<Line[]>([])
  const [notice, setNotice] = useState<Notice | null>(null)
  const byId = new Map(stock.map((r) => [r.medicineId, r]))

  useEffect(() => {
    let live = true
    createClient()
      .from("medicines")
      .select("id, name, gtin")
      .not("gtin", "is", null)
      .then(({ data }) => {
        if (live) setGtins(new Map((data ?? []).map((m) => [toGtin14(m.gtin!), { id: m.id, name: m.name }])))
      })
    return () => {
      live = false
    }
  }, [])

  const daysTo = (d: string) => differenceInCalendarDays(parseISO(d), parseISO(today))

  function add(medicineId: string, batch: string, expiry: string) {
    const r = byId.get(medicineId)
    if (!r) return
    if (expiry && daysTo(expiry) <= 0) {
      setNotice({ tone: "error", text: `${r.medicineName} · ${batch}: ${t(lang, "scan.expired").replace("{date}", formatDate(expiry))}` })
      return
    }
    if (batch && lines.some((l) => l.medicineId === medicineId && l.batch.toUpperCase() === batch.toUpperCase())) {
      setNotice({ tone: "info", text: `${r.medicineName} · ${batch}: ${t(lang, "scan.already")}` })
      return
    }
    setNotice(null)
    setLines((ls) => [{ key: `${medicineId}:${batch}:${Date.now()}`, medicineId, batch, expiry, qty: "" }, ...ls])
  }

  function onScan(s: PackScan) {
    const batch = s.batch ?? ""
    const expiry = s.expiry ?? ""
    const item = s.gtin ? gtins.get(s.gtin) : undefined
    if (!item) {
      setNotice({ tone: "info", text: t(lang, "scan.unknownGtin").replace("{gtin}", s.gtin ?? "—"), pick: { batch, expiry } })
      return
    }
    if (!byId.has(item.id)) {
      setNotice({ tone: "error", text: t(lang, "scan.notStocked").replace("{item}", item.name) })
      return
    }
    add(item.id, batch, expiry)
  }

  // demo: a code as it would be printed on a pack of one of this facility's items
  function sample() {
    const withCode = [...gtins.entries()].filter(([, m]) => byId.has(m.id))
    if (!withCode.length) return null
    const [gtin] = withCode[Math.floor(Math.random() * withCode.length)]
    const batch = `B${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const expiry = new Date(parseISO(today).getTime() + (240 + Math.floor(Math.random() * 400)) * 86_400_000)
    return samplePackCode(gtin, batch, expiry)
  }

  const set = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const complete = lines.every((l) => l.batch.trim() && l.expiry && Number(l.qty) > 0)

  function save() {
    if (!lines.length) return
    if (!complete) {
      toast.error(t(lang, "scan.missing"))
      return
    }
    startTransition(async () => {
      const { error } = await createClient()
        .from("stock_log")
        .insert(
          lines.map((l) => ({
            facility_id: facilityId,
            medicine_id: l.medicineId,
            qty_received: Number(l.qty),
            source: "manual" as const,
            batch_no: l.batch.trim(),
            expiry_date: l.expiry,
            note: "Scanned receipt",
            created_by: userId,
          })),
        )
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(t(lang, "scan.saved"))
      setLines([])
      refreshForecast(facilityId, () => router.refresh())
      announceChange()
      router.refresh()
    })
  }

  return (
    <div className="bg-card rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-muted-foreground max-w-prose text-sm">{t(lang, "scan.intro")}</p>
        <ScanButton lang={lang} onScan={onScan} sample={sample} variant="default" className="h-11 px-5" />
      </div>

      {notice ? (
        <div className={cn("mx-4 mt-3 rounded-lg border p-3 text-sm", notice.tone === "error" ? "border-critical/40 bg-red-50 text-critical" : "bg-muted")} role="status">
          <p className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {notice.text}
          </p>
          {notice.pick ? (
            <Select onValueChange={(id) => add(id, notice.pick!.batch, notice.pick!.expiry)}>
              <SelectTrigger className="bg-background mt-2 h-10 w-full sm:w-80">
                <SelectValue placeholder={t(lang, "scan.chooseItem")} />
              </SelectTrigger>
              <SelectContent>
                {stock.map((r) => (
                  <SelectItem key={r.medicineId} value={r.medicineId}>
                    {r.medicineName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="p-4">
          <EmptyState icon={PackageCheck} title={t(lang, "scan.empty")} />
        </div>
      ) : (
        <ul className="divide-y">
          {lines.map((l) => {
            const r = byId.get(l.medicineId)!
            const days = l.expiry ? daysTo(l.expiry) : null
            return (
              <li key={l.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_10rem_8rem_auto] sm:items-end">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.medicineName}</p>
                  {days !== null && days <= 0 ? (
                    <p className="text-critical text-xs">{t(lang, "scan.expired").replace("{date}", formatDate(l.expiry))}</p>
                  ) : days !== null && days <= 90 ? (
                    <p className="text-xs text-amber-700">{t(lang, "scan.expiresSoon").replace("{days}", String(days))}</p>
                  ) : null}
                </div>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">{t(lang, "scan.batch")}</span>
                  <Input value={l.batch} onChange={(e) => set(l.key, { batch: e.target.value })} className="h-10 font-mono uppercase" />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">{t(lang, "scan.expiry")}</span>
                  <Input
                    type="date"
                    min={format(parseISO(today), "yyyy-MM-dd")}
                    value={l.expiry}
                    onChange={(e) => set(l.key, { expiry: e.target.value })}
                    className="h-10"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  <span className="text-muted-foreground">
                    {t(lang, "scan.qty")} ({r.unit}s)
                  </span>
                  <Input type="number" inputMode="numeric" min={1} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} className="h-10 text-base" />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground size-10 justify-self-end"
                  aria-label={`Remove ${r.medicineName}`}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="bg-background/95 sticky bottom-16 flex items-center justify-between gap-3 rounded-b-xl border-t px-4 py-3 backdrop-blur lg:bottom-0">
        <span className="text-muted-foreground text-sm">{lines.length === 1 ? "1 line" : `${lines.length} lines`}</span>
        <Button onClick={save} disabled={pending || !lines.length || lines.some((l) => l.expiry && daysTo(l.expiry) <= 0)} className="h-11 px-6">
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PackageCheck aria-hidden="true" />}
          {t(lang, "phc.save")}
        </Button>
      </div>
    </div>
  )
}
