"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"
import { STATUS_META, type StockStatus } from "@/lib/status"
import type { MapFacility, MapTransfer } from "@/lib/map"

const Inner = dynamic(() => import("@/components/heal/facility-map-inner"), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-xl" />,
})

export function FacilityMap({
  facilities,
  transfers,
  linkTo,
  height = 420,
}: {
  facilities: MapFacility[]
  transfers?: MapTransfer[]
  /** Popup "Open" link: the facility page (district officer) or the district page (state admin). */
  linkTo?: "facility" | "district"
  height?: number
}) {
  return (
    <div className="space-y-2">
      <div style={{ height }} className="relative isolate overflow-hidden rounded-xl border">
        <Inner facilities={facilities} transfers={transfers} linkTo={linkTo} height={height} />
      </div>
      <MapLegend withTransfers={Boolean(transfers?.length)} withSurges={facilities.some((f) => (f.openSurges ?? 0) > 0)} />
    </div>
  )
}

function MapLegend({ withTransfers, withSurges }: { withTransfers: boolean; withSurges: boolean }) {
  const statuses: StockStatus[] = ["critical", "low", "ok"]
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {statuses.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: STATUS_META[s].color }} aria-hidden="true" />
          {STATUS_META[s].label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px] border-2 border-slate-500 bg-white" aria-hidden="true" />
        Warehouse
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dotted border-red-600" aria-hidden="true" /> District boundary
      </span>
      {withSurges ? (
        <span className="text-critical inline-flex items-center gap-1.5 font-medium">
          <span className="border-critical size-3 rounded-full border-2 bg-red-100" aria-hidden="true" /> Demand surge
        </span>
      ) : null}
      {withTransfers ? (
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-amber-600" aria-hidden="true" /> Proposed transfer
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="border-primary w-4 border-t-2 border-dashed" aria-hidden="true" /> Approved
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-blue-600" aria-hidden="true" /> Dispatched
          </span>
        </>
      ) : null}
    </div>
  )
}
