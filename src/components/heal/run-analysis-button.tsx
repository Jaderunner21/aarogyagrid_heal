"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Activity, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { announceChange } from "@/lib/client-actions"

export function RunAnalysisButton({ scope, id }: { scope: "district" | "state" | "national"; id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function run() {
    startTransition(async () => {
      const started = Date.now()
      const res = await fetch("/api/engine/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, id }),
      })
      const body = (await res.json().catch(() => ({}))) as Record<string, number | string>
      if (!res.ok) {
        toast.error(typeof body.error === "string" ? body.error : "Analysis failed")
        return
      }
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      toast.success(`Analysis finished in ${secs}s`, {
        description: `${body.forecasts} forecasts · ${body.alerts_opened} alerts opened · ${body.alerts_resolved} resolved · ${body.transfers_proposed} transfers and ${body.indents_proposed} indents proposed${body.surges ? ` · ${body.surges} surges` : ""}${body.outbreaks ? ` · ${body.outbreaks} possible outbreaks` : ""}`,
        duration: 8000,
      })
      announceChange()
      router.refresh()
    })
  }

  return (
    <Button onClick={run} disabled={pending} className="h-9">
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Activity aria-hidden="true" />}
      {pending ? "Analysing…" : "Run analysis"}
    </Button>
  )
}
