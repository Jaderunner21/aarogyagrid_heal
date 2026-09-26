"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Mic, Sparkles, Square, Trash2, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { createClient } from "@/lib/supabase/client"
import { announceChange, refreshForecast } from "@/lib/client-actions"
import { formatNumber } from "@/lib/format"
import type { StockRow } from "@/lib/queries"
import type { VoiceParse } from "@/lib/ai/schemas"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const MAX_SECONDS = 60

type Line = { medicineId: string; used: string; received: string; confidence: number; heardAs: string }

function pickMime(): string {
  // Formats Gemini reads directly first; Chrome falls back to webm/opus.
  const options = ["audio/mp4", "audio/ogg;codecs=opus", "audio/ogg", "audio/webm;codecs=opus", "audio/webm"]
  return options.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? ""
}

export function VoiceEntry({
  lang,
  userId,
  facilityId,
  today,
  stock,
  totalBeds,
}: {
  lang: Lang
  userId: string
  facilityId: string
  today: string
  stock: StockRow[]
  totalBeds: number
}) {
  const router = useRouter()
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [text, setText] = useState("")
  const [parsing, setParsing] = useState(false)
  const [saving, startSaving] = useTransition()
  const [result, setResult] = useState<{ transcript: string; language: string; unmatched: string[] } | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [footfall, setFootfall] = useState("")
  const [beds, setBeds] = useState("")
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const byId = new Map(stock.map((s) => [s.medicineId, s]))

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current)
      recorder.current?.stream.getTracks().forEach((tr) => tr.stop())
    },
    [],
  )

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = pickMime()
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" })
        void send({ audio: blob })
      }
      rec.start()
      recorder.current = rec
      setRecording(true)
      setSeconds(0)
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) stop()
          return s + 1
        })
      }, 1000)
    } catch {
      toast.error("Microphone not available. Allow microphone access, or type the note instead.")
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setRecording(false)
    if (recorder.current?.state === "recording") recorder.current.stop()
  }

  async function send(input: { audio?: Blob; text?: string }) {
    setParsing(true)
    setResult(null)
    try {
      const form = new FormData()
      if (input.audio) form.append("audio", input.audio, `note.${input.audio.type.includes("mp4") ? "mp4" : input.audio.type.includes("ogg") ? "ogg" : "webm"}`)
      if (input.text) form.append("text", input.text)
      const res = await fetch("/api/ai/voice-entry", { method: "POST", body: form })
      const body = (await res.json()) as VoiceParse | { error: string }
      if (!res.ok || "error" in body) {
        toast.error(t(lang, "voice.unavailable"))
        return
      }
      const parsed = body.entries.filter((e) => byId.has(e.medicine_id))
      if (parsed.length === 0 && !body.daily_report.footfall && !body.daily_report.occupied_beds) {
        toast.info(t(lang, "voice.nothing"))
      }
      setResult({ transcript: body.transcript, language: body.language, unmatched: body.unmatched })
      setLines(
        parsed.map((e) => ({
          medicineId: e.medicine_id,
          used: e.qty_used ? String(e.qty_used) : "",
          received: e.qty_received ? String(e.qty_received) : "",
          confidence: e.confidence,
          heardAs: e.heard_as,
        })),
      )
      setFootfall(body.daily_report.footfall ? String(body.daily_report.footfall) : "")
      setBeds(body.daily_report.occupied_beds ? String(body.daily_report.occupied_beds) : "")
    } catch {
      toast.error(t(lang, "voice.unavailable"))
    } finally {
      setParsing(false)
    }
  }

  function discard() {
    setResult(null)
    setLines([])
    setFootfall("")
    setBeds("")
  }

  function confirm() {
    const rows = lines
      .map((l) => ({ l, used: Number(l.used || 0), received: Number(l.received || 0) }))
      .filter((x) => x.used > 0 || x.received > 0)
    startSaving(async () => {
      const db = createClient()
      if (rows.length) {
        const { error } = await db.from("stock_log").insert(
          rows.map((x) => ({
            facility_id: facilityId,
            medicine_id: x.l.medicineId,
            qty_used: x.used,
            qty_received: x.received,
            source: "voice" as const,
            note: x.l.heardAs ? `Voice: "${x.l.heardAs}"` : "Voice entry",
            created_by: userId,
          })),
        )
        if (error) {
          toast.error(error.message)
          return
        }
      }
      if (footfall || beds) {
        const { error } = await db.from("daily_reports").upsert(
          {
            facility_id: facilityId,
            report_date: today,
            footfall: Number(footfall || 0),
            occupied_beds: Math.min(Number(beds || 0), totalBeds),
            created_by: userId,
          },
          { onConflict: "facility_id,report_date" },
        )
        if (error) {
          toast.error(error.message)
          return
        }
      }
      toast.success(t(lang, "phc.entrySaved"))
      if (rows.length) refreshForecast(facilityId, () => router.refresh())
      discard()
      setText("")
      announceChange()
      router.refresh()
    })
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="bg-card grid content-start gap-4 self-start rounded-xl border p-4">
        <p className="text-muted-foreground text-sm">{t(lang, "voice.hint")}</p>
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={parsing}
          aria-pressed={recording}
          aria-label={recording ? t(lang, "voice.stop") : t(lang, "voice.record")}
          className={cn(
            "mx-auto flex size-32 flex-col items-center justify-center gap-1 rounded-full text-white shadow-lg transition-all disabled:opacity-50",
            recording ? "bg-critical animate-pulse" : "bg-primary hover:bg-primary/90",
          )}
        >
          {recording ? <Square className="size-9" aria-hidden="true" /> : <Mic className="size-10" aria-hidden="true" />}
          <span className="text-xs font-medium">
            {recording ? `${t(lang, "voice.stop")} · ${MAX_SECONDS - seconds}s` : t(lang, "voice.record")}
          </span>
        </button>
        <div className="grid gap-1.5">
          <Label htmlFor="voice-text">{t(lang, "voice.orType")}</Label>
          <Textarea
            id="voice-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t(lang, "voice.placeholder")}
            rows={3}
            className="text-base"
          />
          <Button variant="outline" className="h-11" onClick={() => send({ text })} disabled={parsing || recording || !text.trim()}>
            {parsing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wand2 aria-hidden="true" />}
            {t(lang, "voice.understand")}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Sparkles className="text-primary size-4" aria-hidden="true" />
          <h2 className="text-base font-semibold">{t(lang, "voice.preview")}</h2>
          <span className="text-muted-foreground ml-auto text-xs">Gemini</span>
        </div>
        {parsing ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 px-4 py-16 text-sm" aria-live="polite">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t(lang, "voice.working")}
          </div>
        ) : !result ? (
          <p className="text-muted-foreground px-4 py-16 text-center text-sm">{t(lang, "voice.hint")}</p>
        ) : (
          <div className="space-y-4 p-4">
            <blockquote className="bg-muted/50 rounded-md border-l-4 border-l-primary px-3 py-2 text-sm italic">
              “{result.transcript}”
              <span className="text-muted-foreground mt-1 block text-xs not-italic">{result.language}</span>
            </blockquote>

            {lines.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="px-3 py-2 font-medium">{t(lang, "phc.medicine")}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, "phc.usedToday")}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, "phc.receivedToday")}</th>
                      <th className="px-3 py-2 font-medium">{t(lang, "voice.confidence")}</th>
                      <th className="sr-only">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {lines.map((l, i) => {
                      const s = byId.get(l.medicineId)
                      const upd = (k: "used" | "received", v: string) =>
                        setLines((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
                      return (
                        <tr key={`${l.medicineId}-${i}`}>
                          <td className="px-3 py-2">
                            <p className="font-medium">{s?.medicineName}</p>
                            <p className="text-muted-foreground text-xs">
                              {t(lang, "voice.heardAs")}: “{l.heardAs}” · {formatNumber(s?.quantity)} {s?.unit}s
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" min={0} inputMode="numeric" value={l.used} onChange={(e) => upd("used", e.target.value)} className="h-10 w-24" aria-label={`${s?.medicineName} used`} />
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" min={0} inputMode="numeric" value={l.received} onChange={(e) => upd("received", e.target.value)} className="h-10 w-24" aria-label={`${s?.medicineName} received`} />
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "rounded-full border px-2 py-0.5 text-xs font-medium",
                                l.confidence >= 0.8
                                  ? "border-green-200 bg-green-50 text-ok"
                                  : l.confidence >= 0.5
                                    ? "border-amber-200 bg-amber-50 text-low"
                                    : "border-red-200 bg-red-50 text-critical",
                              )}
                            >
                              {Math.round(l.confidence * 100)}%
                            </span>
                          </td>
                          <td className="px-1 py-2">
                            <Button variant="ghost" size="icon-sm" aria-label={`Remove ${s?.medicineName}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                              <Trash2 />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            {footfall || beds ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="v-footfall">{t(lang, "phc.footfall")}</Label>
                  <Input id="v-footfall" type="number" min={0} value={footfall} onChange={(e) => setFootfall(e.target.value)} className="h-10" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="v-beds">
                    {t(lang, "phc.occupiedBeds")} ({t(lang, "phc.bedsOf")} {totalBeds})
                  </Label>
                  <Input id="v-beds" type="number" min={0} max={totalBeds} value={beds} onChange={(e) => setBeds(e.target.value)} className="h-10" />
                </div>
              </div>
            ) : null}

            {result.unmatched.length ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
                <p className="text-low font-medium">{t(lang, "voice.unmatched")}</p>
                <p className="mt-0.5">{result.unmatched.map((u) => `“${u}”`).join(", ")}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="h-11" onClick={discard}>
                {t(lang, "voice.discard")}
              </Button>
              <Button className="h-11 px-6" onClick={confirm} disabled={saving || (lines.length === 0 && !footfall && !beds)}>
                {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {t(lang, "voice.confirm")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
