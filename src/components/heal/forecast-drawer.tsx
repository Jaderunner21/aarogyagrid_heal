"use client"

import { useEffect, useState } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { ForecastPanel } from "@/components/heal/forecast-panel"
import { StatusBadge } from "@/components/heal/status-badge"
import { createClient } from "@/lib/supabase/client"
import { getForecastDetail, type ForecastDetail } from "@/lib/queries"
import type { Lang } from "@/lib/i18n"

export type DrawerTarget = { facilityId: string; medicineId: string; title: string; subtitle?: string } | null

export function ForecastDrawer({
  target,
  onClose,
  lang = "en",
}: {
  target: DrawerTarget
  onClose: () => void
  lang?: Lang
}) {
  const [loaded, setLoaded] = useState<{ key: string; detail: ForecastDetail } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = target ? `${target.facilityId}:${target.medicineId}` : null

  useEffect(() => {
    if (!target) return
    let cancelled = false
    getForecastDetail(createClient(), target.facilityId, target.medicineId)
      .then((d) => {
        if (!cancelled) {
          setLoaded({ key: `${target.facilityId}:${target.medicineId}`, detail: d })
          setError(null)
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load forecast"))
    return () => {
      cancelled = true
    }
  }, [target])

  const detail = loaded && loaded.key === key ? loaded.detail : null

  return (
    <Sheet open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">
            {target?.title}
            {detail?.stock ? <StatusBadge status={detail.stock.status} lang={lang} /> : null}
          </SheetTitle>
          {target?.subtitle ? <SheetDescription>{target.subtitle}</SheetDescription> : null}
        </SheetHeader>
        <div className="p-4">
          {error ? (
            <p className="text-critical text-sm">{error}</p>
          ) : detail ? (
            <ForecastPanel detail={detail} lang={lang} />
          ) : (
            <div className="space-y-4" aria-busy="true">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
              <Skeleton className="h-72" />
              <Skeleton className="h-40" />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
