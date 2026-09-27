"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, PackageX, Siren, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createClient } from "@/lib/supabase/client"
import { announceChange } from "@/lib/client-actions"
import { formatNumber } from "@/lib/format"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Item = { id: string; name: string; unit: string; quantity: number }
export type OpenStockoutReport = {
  id: string
  medicineId: string
  medicineName: string
  reportedAt: string
  help: { text: string; status: "proposed" | "submitted" | "approved" | "dispatched" } | null
  planning: boolean
}

/** "We've run out": one tap to tell the district an item ran out mid-day. */
export function StockoutButton({ lang, facilityId, items }: { lang: Lang; facilityId: string; items: Item[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Item | null>(null)
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  function send() {
    if (!picked) return
    startTransition(async () => {
      const res = await fetch("/api/stockout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facilityId, medicineId: picked.id, note: note.trim() || undefined }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? "Could not send the report")
        return
      }
      toast.success(t(lang, "out.sent"), { description: t(lang, "out.finding"), duration: 8000 })
      setOpen(false)
      setPicked(null)
      setNote("")
      announceChange()
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!pending) setOpen(v)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="border-critical/50 text-critical hover:bg-red-50 hover:text-critical h-11 px-4">
          <Siren aria-hidden="true" />
          {t(lang, "out.button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(lang, "out.title")}</DialogTitle>
          <DialogDescription>{t(lang, "out.desc")}</DialogDescription>
        </DialogHeader>
        <Command className="rounded-lg border">
          <CommandInput placeholder={t(lang, "out.search")} />
          <CommandList className="max-h-56">
            <CommandEmpty>—</CommandEmpty>
            {items.map((m) => (
              <CommandItem
                key={m.id}
                value={m.name}
                data-checked={picked?.id === m.id}
                onSelect={() => setPicked(m)}
                className={cn(picked?.id === m.id && "bg-red-50 font-medium text-critical")}
              >
                <PackageX className={cn("text-muted-foreground", picked?.id === m.id && "text-critical")} aria-hidden="true" />
                <span className="truncate">{m.name}</span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {formatNumber(m.quantity)} {m.unit}s {t(lang, "out.onRecord")}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        <div className="grid gap-1.5">
          <Label htmlFor="out-note">{t(lang, "out.note")}</Label>
          <Input id="out-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t(lang, "out.notePlaceholder")} maxLength={300} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t(lang, "out.cancel")}
          </Button>
          <Button variant="destructive" onClick={send} disabled={!picked || pending} className="h-10">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Siren aria-hidden="true" />}
            {pending ? t(lang, "out.sending") : picked ? t(lang, "out.send").replace("{item}", picked.name) : t(lang, "out.pick")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Items this facility has reported out, still waiting for stock. */
export function OpenStockouts({ lang, reports }: { lang: Lang; reports: OpenStockoutReport[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  if (!reports.length) return null
  const time = (iso: string) => new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(iso))
  return (
    <div className="border-critical/40 rounded-xl border bg-red-50/60 px-4 py-3" role="status">
      <p className="text-critical flex items-center gap-2 text-sm font-semibold">
        <Siren className="size-4" aria-hidden="true" />
        {t(lang, "out.openTitle")}
      </p>
      <ul className="mt-2 space-y-1.5">
        {reports.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{r.medicineName}</span>
            <span className="text-muted-foreground text-xs">{time(r.reportedAt)}</span>
            <span className="text-xs">
              {r.help ? (
                <>
                  {t(lang, r.help.status === "dispatched" ? "out.onTheWay" : r.help.status === "approved" ? "out.approved" : "out.suggested")}{" "}
                  <span className="font-medium">{r.help.text}</span>
                </>
              ) : r.planning ? (
                <span className="text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  {t(lang, "out.finding")}
                </span>
              ) : (
                <span className="text-muted-foreground">{t(lang, "out.noSuggestion")}</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground ml-auto h-8"
              disabled={busy === r.id}
              onClick={async () => {
                setBusy(r.id)
                const { error } = await createClient().rpc("withdraw_stockout", { p_id: r.id })
                setBusy(null)
                if (error) toast.error(error.message)
                else {
                  toast.success(t(lang, "out.withdrawn"))
                  announceChange()
                  router.refresh()
                }
              }}
            >
              {busy === r.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}
              {t(lang, "out.withdraw")}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-2 text-xs">{t(lang, "out.openHint")}</p>
    </div>
  )
}
