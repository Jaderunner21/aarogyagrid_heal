"use client"

import { useEffect, useState, useTransition } from "react"
import { CornerDownLeft, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BriefMarkdown } from "@/components/heal/ai-brief-card"

const SUGGESTIONS = [
  "Which PHCs will run out of paracetamol this week?",
  "What needs my approval today?",
  "Which medicines are rising fastest?",
  "Where is staff attendance a problem?",
]

/** Command-palette style Q&A over the caller's own scope (⌘K / Ctrl+K). */
export function AskHeal() {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<{ text: string; grounded: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function ask(q: string) {
    if (q.trim().length < 3) return
    setQuestion(q)
    setError(null)
    startTransition(async () => {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      })
      const body = (await res.json().catch(() => ({}))) as { answer?: string; grounded?: boolean; error?: string }
      if (!res.ok || !body.answer) {
        setAnswer(null)
        setError(body.error ?? "Ask AarogyaGrid is unavailable right now")
        return
      }
      setAnswer({ text: body.answer, grounded: Boolean(body.grounded) })
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" className="hidden h-8 gap-2 md:inline-flex" onClick={() => setOpen(true)}>
        <Sparkles className="text-primary" aria-hidden="true" />
        Ask AarogyaGrid
        <kbd className="bg-muted text-muted-foreground rounded px-1.5 text-[10px] font-medium">Ctrl K</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="text-primary size-4" aria-hidden="true" />
              Ask AarogyaGrid
            </DialogTitle>
            <DialogDescription>Answers come only from your facilities&apos; live numbers.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              ask(question)
            }}
            className="relative"
          >
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about stock, alerts, approvals…"
              aria-label="Question"
              className="border-input focus-visible:ring-ring/50 h-11 w-full rounded-lg border bg-transparent pr-11 pl-3 text-sm outline-none focus-visible:ring-3"
            />
            <Button type="submit" size="icon-sm" className="absolute top-2 right-2" disabled={pending} aria-label="Ask">
              {pending ? <Loader2 className="animate-spin" /> : <CornerDownLeft />}
            </Button>
          </form>
          {!answer && !pending && !error ? (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="bg-muted hover:bg-accent rounded-full px-3 py-1 text-xs">
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <div aria-live="polite">
            {pending ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading your data…
              </p>
            ) : error ? (
              <p className="text-critical text-sm">{error}</p>
            ) : answer ? (
              <div className="bg-muted/40 max-h-80 overflow-y-auto rounded-lg border p-3">
                {answer.text.includes("\n- ") || answer.text.startsWith("- ") ? (
                  <BriefMarkdown content={answer.text} />
                ) : (
                  <p className="text-sm leading-relaxed whitespace-pre-line">{answer.text.replace(/\*\*/g, "")}</p>
                )}
                {!answer.grounded ? <p className="text-muted-foreground mt-2 text-xs">The data doesn&apos;t fully answer this.</p> : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
