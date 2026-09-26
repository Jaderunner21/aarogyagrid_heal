"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import type { Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const OPTIONS: { value: Lang; label: string; aria: string }[] = [
  { value: "en", label: "EN", aria: "English" },
  { value: "hi", label: "हिं", aria: "हिन्दी" },
]

export function LanguageToggle({ lang }: { lang: Lang }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function choose(next: Lang) {
    if (next === lang || pending) return
    startTransition(async () => {
      const { error } = await createClient().rpc("set_my_language", { p_lang: next })
      if (error) {
        toast.error(error.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className={cn("bg-muted flex h-8 items-center rounded-md p-0.5", pending && "opacity-60")}
    >
      {OPTIONS.map((o) => {
        const active = o.value === lang
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.aria}
            onClick={() => choose(o.value)}
            className={cn(
              "h-7 min-w-9 rounded px-2 text-xs font-semibold transition-colors",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
