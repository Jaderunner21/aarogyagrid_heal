"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"

/** Manual trigger for Gemini explanations of pending AI recommendations and critical alerts. */
export function ExplainButton({ scope, id }: { scope: "district" | "state"; id: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await fetch("/api/ai/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope, id }),
          })
          const body = (await res.json().catch(() => ({}))) as { explained?: number; ai?: boolean }
          if (!res.ok || body.ai === false) {
            toast.info("Gemini isn't available right now. The recommendations keep their standard reasons.")
            return
          }
          toast.success(body.explained ? `Gemini explained ${body.explained} items.` : "Everything already has an explanation.")
          router.refresh()
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles className="text-primary" aria-hidden="true" />}
      Explain
    </Button>
  )
}
