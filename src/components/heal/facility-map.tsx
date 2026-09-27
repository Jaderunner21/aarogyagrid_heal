"use client"

import { useState } from "react"
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
  const [showKendras, setShowKendras] = useState(false)
  const types = new Set(facilities.map((f) => f.type))
  return (
    <div className="space-y-2">
      <div style={{ height }} className="relative isolate overflow-hidden rounded-xl border">
        <Inner facilities={facilities} transfers={transfers} linkTo={linkTo} height={height} showKendras={showKendras} />
      </div>
      <MapLegend
        withTransfers={Boolean(transfers?.length)}
        withSurges={facilities.some((f) => (f.openSurges ?? 0) > 0)}
        withHospitals={types.has("chc") || types.has("dh")}
        withSubCentres={types.has("shc")}
        showKendras={showKendras}
        onToggleKendras={() => setShowKendras((v) => !v)}
      />
    </div>
  )
}

function MapLegend({
  withTransfers,
  withSurges,
  withHospitals,
  withSubCentres,
  showKendras,
  onToggleKendras,
}: {
  withTransfers: boolean
  withSurges: boolean
  withHospitals: boolean
  withSubCentres: boolean
  showKendras: boolean
  onToggleKendras: () => void
}) {
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
      {withHospitals ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="flex size-3 items-center justify-center rounded-full border-2 border-slate-500 bg-white text-[8px] leading-none font-bold text-slate-600" aria-hidden="true">
            +
          </span>
          CHC / district hospital
        </span>
      ) : null}
      {withSubCentres ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-slate-500" aria-hidden="true" />
          Sub-centre
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dotted border-red-600" aria-hidden="true" /> District boundary
      </span>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" className="accent-violet-600 size-3.5" checked={showKendras} onChange={onToggleKendras} />
        <span className="size-2.5 rotate-45 border-2 border-violet-600 bg-white" aria-hidden="true" />
        Jan Aushadhi stores
      </label>
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
