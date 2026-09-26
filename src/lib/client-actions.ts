"use client"

import { toast } from "sonner"
import type { PostgrestError } from "@supabase/supabase-js"

export const REFRESH_EVENT = "heal:refresh"

/** Tell the bell (and anything else listening) that data changed. */
export function announceChange() {
  window.dispatchEvent(new Event(REFRESH_EVENT))
}

/** Run a workflow RPC: toast the DB's readable error or the success message. Returns true on success. */
export async function runRpc(
  call: PromiseLike<{ error: PostgrestError | null }>,
  success: string,
): Promise<boolean> {
  const { error } = await call
  if (error) {
    toast.error(error.message)
    return false
  }
  toast.success(success)
  announceChange()
  return true
}

export type EngineResult = {
  forecasts: number
  alerts_opened: number
  alerts_resolved: number
  transfers_proposed: number
  indents_proposed: number
}

/** Re-forecast after a stock change. Never blocks or errors the UI. */
export async function runEngine(scope: "facility" | "district" | "state", id: string): Promise<EngineResult | null> {
  try {
    const res = await fetch("/api/engine/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, id }),
    })
    if (!res.ok) return null
    return (await res.json()) as EngineResult
  } catch {
    return null
  }
}

/** Re-forecast a facility in the background, then call onDone (e.g. router.refresh). */
export function refreshForecast(facilityId: string, onDone: () => void) {
  void runEngine("facility", facilityId).then((res) => {
    if (res) {
      announceChange()
      onDone()
    }
  })
}
