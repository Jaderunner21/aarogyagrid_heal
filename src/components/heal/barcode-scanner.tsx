"use client"

import { useEffect, useRef, useState } from "react"
import { CameraOff, Loader2, ScanBarcode, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parsePackCode, type PackScan } from "@/lib/gs1"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

// The browser's built-in barcode reader (Chrome on Android, Edge, Chrome OS). Not in TypeScript's DOM types yet.
type DetectedCode = { rawValue: string; format: string }
type Detector = { detect: (source: HTMLVideoElement) => Promise<DetectedCode[]> }
type DetectorClass = {
  new (options?: { formats: string[] }): Detector
  getSupportedFormats: () => Promise<string[]>
}
const WANTED = ["data_matrix", "qr_code", "code_128", "ean_13", "ean_8", "upc_a", "itf"]

function detectorClass(): DetectorClass | null {
  if (typeof window === "undefined") return null
  return (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector ?? null
}

/**
 * A "Scan barcode" button. Opens the camera where the browser can read barcodes; everywhere else (and
 * always, below the camera) a text box that a handheld scanner can type into, or a person can fill by hand.
 */
export function ScanButton({
  lang,
  onScan,
  sample,
  label,
  className,
  variant = "outline",
}: {
  lang: Lang
  onScan: (scan: PackScan) => void
  /** demo helper: returns a code as printed on one of this facility's items */
  sample?: () => string | null
  label?: string
  className?: string
  variant?: "outline" | "default"
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} className={cn("h-10", className)}>
          <ScanBarcode aria-hidden="true" />
          {label ?? t(lang, "scan.button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(lang, "scan.title")}</DialogTitle>
          <DialogDescription>{t(lang, "scan.hint")}</DialogDescription>
        </DialogHeader>
        {open ? (
          <ScanPanel
            lang={lang}
            sample={sample}
            onDone={(scan) => {
              setOpen(false)
              onScan(scan)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ScanPanel({ lang, sample, onDone }: { lang: Lang; sample?: () => string | null; onDone: (scan: PackScan) => void }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const Detector = detectorClass()

  function use(raw: string) {
    const scan = parsePackCode(raw)
    if (scan.kind === "unknown") {
      setError(t(lang, "scan.unreadable"))
      return
    }
    if (scan.gtin && scan.badCheckDigit) {
      setError(t(lang, "scan.badCheck"))
      return
    }
    onDone(scan)
  }

  return (
    <div className="grid gap-3">
      {Detector ? (
        <Camera lang={lang} Detector={Detector} onCode={use} />
      ) : (
        <p className="bg-muted text-muted-foreground flex gap-2 rounded-lg p-3 text-sm">
          <CameraOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t(lang, "scan.noCamera")}
        </p>
      )}
      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) use(text)
        }}
      >
        <Label htmlFor="scan-text">{t(lang, "scan.orType")}</Label>
        <div className="flex gap-2">
          <Input
            id="scan-text"
            // a handheld scanner types the code and presses Enter
            autoFocus={!Detector}
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            placeholder="(01)08901234500019(17)270531(10)AB123"
            className="h-10 font-mono text-sm"
          />
          <Button type="submit" className="h-10" disabled={!text.trim()}>
            {t(lang, "scan.use")}
          </Button>
        </div>
      </form>
      {error ? (
        <p className="text-critical text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {sample ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground justify-self-start"
          onClick={() => {
            const code = sample()
            if (code) setText(code)
          }}
        >
          <Sparkles aria-hidden="true" /> {t(lang, "scan.sample")}
        </Button>
      ) : null}
    </div>
  )
}

function Camera({ lang, Detector, onCode }: { lang: Lang; Detector: DetectorClass; onCode: (raw: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<"starting" | "on" | "blocked">("starting")
  const done = useRef(false)
  const onCodeRef = useRef(onCode)
  useEffect(() => {
    onCodeRef.current = onCode
  })

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let live = true
    ;(async () => {
      try {
        const supported = await Detector.getSupportedFormats()
        const detector = new Detector({ formats: WANTED.filter((f) => supported.includes(f)) })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
        if (!live || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        setState("on")
        timer = setInterval(async () => {
          if (done.current || !video.current || video.current.readyState < 2) return
          try {
            const codes = await detector.detect(video.current)
            if (codes.length && !done.current) {
              done.current = true
              navigator.vibrate?.(60)
              onCodeRef.current(codes[0].rawValue)
            }
          } catch {
            // a frame that could not be read; try the next one
          }
        }, 250)
      } catch {
        if (live) setState("blocked")
      }
    })()
    return () => {
      live = false
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((tr) => tr.stop())
    }
  }, [Detector])

  if (state === "blocked") {
    return (
      <p className="bg-muted text-muted-foreground flex gap-2 rounded-lg p-3 text-sm">
        <CameraOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {t(lang, "scan.cameraBlocked")}
      </p>
    )
  }
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black">
      <video ref={video} className="size-full object-cover" muted playsInline aria-label={t(lang, "scan.title")} />
      {/* aiming box */}
      <div className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" aria-hidden="true" />
      {state === "starting" ? (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <Loader2 className="animate-spin" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  )
}
