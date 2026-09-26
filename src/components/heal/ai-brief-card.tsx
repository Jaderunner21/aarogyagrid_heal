"use client"

import { Fragment, useState, useTransition } from "react"
import { toast } from "sonner"
import { Loader2, RefreshCw, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { timeAgo } from "@/lib/format"

type Brief = { content: string; generated_at: string } | null

/** Minimal markdown for brief bullets: "- " items and **bold**. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

export function BriefMarkdown({ content }: { content: string }) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean)
  return (
    <ul className="space-y-2">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed">
          <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" aria-hidden="true" />
          <span>{renderInline(l.replace(/^[-*•]\s*/, ""))}</span>
        </li>
      ))}
    </ul>
  )
}

export function AiBriefCard({
  scopeType,
  scopeId,
  initial,
  title,
}: {
  scopeType: "district" | "state" | "national"
  scopeId: string
  initial: Brief
  title: string
}) {
  const [brief, setBrief] = useState<Brief>(initial)
  const [pending, startTransition] = useTransition()

  function regenerate(force: boolean) {
    startTransition(async () => {
      const res = await fetch("/api/ai/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope_type: scopeType, scope_id: scopeId, force }),
      })
      const body = (await res.json().catch(() => null)) as { content?: string; generated_at?: string; error?: string } | null
      if (!res.ok || !body?.content || !body.generated_at) {
        toast.error(body?.error ?? "Could not generate the brief right now.")
        return
      }
      setBrief({ content: body.content, generated_at: body.generated_at })
    })
  }

  return (
    <section aria-labelledby="brief-title" className="bg-card min-w-0 rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 id="brief-title" className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="text-primary size-4" aria-hidden="true" />
            {title}
          </h2>
          <p className="text-muted-foreground text-xs">
            Written by Gemini from AarogyaGrid&apos;s own numbers
            {brief ? ` · ${timeAgo(brief.generated_at)}` : ""}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => regenerate(Boolean(brief))} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {brief ? "Regenerate" : "Generate"}
        </Button>
      </div>
      <div className="p-4" aria-live="polite">
        {pending && !brief ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading the latest numbers…
          </p>
        ) : brief ? (
          <BriefMarkdown content={brief.content} />
        ) : (
          <p className="text-muted-foreground text-sm">
            No brief yet. Generate one for a short summary of what&apos;s wrong, what to do today and what&apos;s coming.
          </p>
        )}
      </div>
    </section>
  )
}
