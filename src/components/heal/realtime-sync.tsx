"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { announceChange } from "@/lib/client-actions"
import { cn } from "@/lib/utils"

// Tables whose changes move the maps, alert feeds, action queues, pipeline board and bell.
// Beds and attendance reach viewers through `forecasts`: every PHC save re-runs that facility's forecast.
// Row-level security applies to Realtime too, so each person only hears about their own scope.
const TABLES = ["transfers", "indents", "alerts", "stock", "outbreaks", "forecasts", "medicine_requests"] as const
const DEBOUNCE_MS = 1500
const MIN_GAP_MS = 6000
const FALLBACK_POLL_MS = 60_000

/**
 * Keeps server-rendered pages live: a change anywhere in scope re-renders the page (debounced),
 * and the bell reloads. Without a Realtime connection it falls back to polling once a minute.
 */
export function RealtimeSync({ userId, label }: { userId: string; label: { live: string; polling: string } }) {
  const router = useRouter()
  const [live, setLive] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef(0)
  const dirty = useRef(false)

  useEffect(() => {
    const supabase = createClient()

    function flush() {
      if (document.hidden) {
        dirty.current = true // catch up when the tab is visible again
        return
      }
      dirty.current = false
      last.current = Date.now()
      router.refresh()
      announceChange()
    }
    function schedule() {
      if (timer.current) clearTimeout(timer.current)
      const wait = Math.max(DEBOUNCE_MS, MIN_GAP_MS - (Date.now() - last.current))
      timer.current = setTimeout(flush, wait)
    }
    function onVisible() {
      if (!document.hidden && dirty.current) flush()
    }

    let channel = supabase.channel(`live-${userId}`)
    for (const table of TABLES) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, schedule)
    }
    channel = channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      () => announceChange(), // the bell only; no page refresh needed
    )
    channel.subscribe((status) => setLive(status === "SUBSCRIBED"))

    // fallback while Realtime is down: poll the page quietly
    const poll = setInterval(() => {
      if (channel.state !== "joined" && !document.hidden) flush()
    }, FALLBACK_POLL_MS)
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      clearInterval(poll)
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener("visibilitychange", onVisible)
      supabase.removeChannel(channel)
    }
  }, [router, userId])

  return (
    <span
      className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:inline-flex"
      title={live ? "Updates appear as soon as anyone in your scope saves" : "Live updates unavailable; refreshing every minute"}
    >
      <span className={cn("size-2 rounded-full", live ? "bg-ok animate-pulse" : "bg-muted-foreground/50")} aria-hidden="true" />
      {live ? label.live : label.polling}
    </span>
  )
}
