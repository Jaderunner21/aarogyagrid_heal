import Link from "next/link"
import { AlertOctagon, ArrowLeftRight, Building2, Map as MapIcon, Timer } from "lucide-react"
import { subDays } from "date-fns"
import { Section } from "@/components/heal/section"
import { StatTile } from "@/components/heal/stat-tile"
import { FacilityMap } from "@/components/heal/facility-map"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { AiBriefCard } from "@/components/heal/ai-brief-card"
import { SurgeBanner } from "@/components/heal/surge-banner"
import { DistrictStatusChart, MedicinesAtRiskChart } from "@/components/heal/state-charts"
import { toMapTransfer } from "@/lib/map"
import type { Viewer } from "@/lib/permissions"
import {
  enrich,
  getDistrictSummaries,
  getFacilitySummaries,
  getOutbreaks,
  getStock,
  getTransfers,
  sortRecommendations,
  type DB,
} from "@/lib/queries"
import { formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

/** State overview body; the state admin's home and the national admin's drill-down into a state. */
export async function StateOverview({
  db,
  stateId,
  stateName,
  viewer,
}: {
  db: DB
  stateId: string
  stateName: string
  viewer: Viewer
}) {
  const since = subDays(new Date(), 30).toISOString()
  const [facilities, allDistricts, stock, allTransfers, receivedT, receivedI, brief] = await Promise.all([
    getFacilitySummaries(db, { stateId }),
    getDistrictSummaries(db),
    getStock(db, { stateId }),
    getTransfers(db, { status: ["proposed", "approved", "dispatched"] }),
    db.from("transfers").select("approved_at, received_at, to_facility_id").eq("status", "received").gte("received_at", since).not("approved_at", "is", null),
    db.from("indents").select("approved_at, received_at, facility_id").eq("status", "received").gte("received_at", since).not("approved_at", "is", null),
    db.from("ai_briefs").select("content, generated_at").eq("scope_type", "state").eq("scope_id", stateId).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  const districts = allDistricts.filter((d) => d.stateId === stateId)
  const inState = new Set(facilities.map((f) => f.id))
  const transfers = allTransfers.filter((t) => inState.has(t.toId) || inState.has(t.fromId))
  const outbreaks = await getOutbreaks(db, { districtIds: districts.map((d) => d.id) })

  const cross = sortRecommendations(enrich(transfers.filter((t) => t.isCrossDistrict && t.status === "proposed"), stock))
  const durations = [
    ...(receivedT.data ?? []).filter((r) => inState.has(r.to_facility_id)),
    ...(receivedI.data ?? []).filter((r) => inState.has(r.facility_id)),
  ].map((r) => (new Date(r.received_at!).getTime() - new Date(r.approved_at!).getTime()) / 36e5)
  const avgHours = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null
  const phcCritical = districts.reduce((s, d) => s + d.facilitiesCritical, 0)
  const criticalItems = districts.reduce((s, d) => s + d.criticalItems, 0)
  const surging = stock.filter((s) => s.surge)

  const statusByDistrict = districts.map((d) => {
    const fs = facilities.filter((f) => f.districtId === d.id)
    return {
      name: d.name,
      critical: fs.reduce((s, f) => s + f.critical, 0),
      low: fs.reduce((s, f) => s + f.low, 0),
      ok: fs.reduce((s, f) => s + f.ok + f.overstock, 0),
    }
  })
  const atRisk = new Map<string, number>()
  stock.filter((s) => s.status === "critical").forEach((s) => atRisk.set(s.medicineName, (atRisk.get(s.medicineName) ?? 0) + 1))
  const topMedicines = [...atRisk.entries()]
    .map(([name, n]) => ({ name, facilities: n }))
    .sort((a, b) => b.facilities - a.facilities)
    .slice(0, 8)

  return (
    <div className="space-y-5">
      <SurgeBanner
        outbreaks={outbreaks}
        surgingFacilities={new Set(surging.map((s) => s.facilityId)).size}
        surgingMedicines={[...new Set(surging.map((s) => s.medicineName))]}
        showDistrict
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Districts" value={districts.length} icon={MapIcon} sub={`${facilities.length} facilities`} />
        <StatTile
          label="Facilities critical"
          value={phcCritical}
          status={phcCritical ? "critical" : "ok"}
          icon={Building2}
          sub={`of ${facilities.filter((f) => f.type !== "warehouse").length} facilities`}
        />
        <StatTile label="Critical items" value={formatNumber(criticalItems)} status={criticalItems ? "critical" : "ok"} icon={AlertOctagon} />
        <StatTile
          label="Cross-district approvals"
          value={cross.length}
          icon={ArrowLeftRight}
          status={cross.length ? "low" : undefined}
          href={viewer.role === "state_admin" ? "/state/transfers" : undefined}
        />
        <StatTile
          label="Approval → receipt"
          value={avgHours === null ? "—" : `${formatNumber(avgHours, 1)} h`}
          icon={Timer}
          sub={durations.length ? `avg of ${durations.length} deliveries, 30 days` : "no deliveries in 30 days"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Section title="All facilities" description="Click a facility to open its district" className="xl:col-span-2">
          <FacilityMap
            facilities={facilities}
            transfers={transfers.filter((t) => t.isCrossDistrict || t.status !== "proposed").map(toMapTransfer)}
            linkTo="district"
            height={480}
          />
        </Section>
        <Section title="Cross-district approvals" description="Approved by the state admin" bodyClassName="p-3 max-h-[580px] overflow-y-auto">
          <RecommendationList items={cross} viewer={viewer} emptyIcon={ArrowLeftRight} emptyText="No cross-district transfers waiting." />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section title="District comparison">
          <DistrictStatusChart data={statusByDistrict} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-muted-foreground text-left text-xs">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">District</th>
                  <th className="px-3 py-2 text-right font-medium">Facilities critical</th>
                  <th className="px-3 py-2 text-right font-medium">Critical items</th>
                  <th className="px-3 py-2 text-right font-medium">Open alerts</th>
                  <th className="px-3 py-2 text-right font-medium">Pending</th>
                  <th className="py-2 pl-3 text-right font-medium">Attendance</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {districts.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/state/districts/${d.id}`} className="text-primary font-medium hover:underline">
                        {d.name}
                      </Link>
                      {outbreaks.some((o) => o.district_id === d.id) ? (
                        <span className="bg-critical ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase">Surge</span>
                      ) : null}
                    </td>
                    <td className={cn("px-3 py-2 text-right", d.facilitiesCritical && "text-critical font-medium")}>
                      {d.facilitiesCritical} / {d.facilities}
                    </td>
                    <td className="px-3 py-2 text-right">{d.criticalItems}</td>
                    <td className="px-3 py-2 text-right">{d.openAlerts}</td>
                    <td className="px-3 py-2 text-right">{d.transfersPending + d.indentsPending}</td>
                    <td className="py-2 pl-3 text-right">{formatPercent(d.attendance7d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <div className="space-y-5">
          <AiBriefCard scopeType="state" scopeId={stateId} initial={brief.data ?? null} title={`AI state brief · ${stateName}`} />
          <Section title="Top medicines at risk" description="Number of facilities where the medicine is critical">
            {topMedicines.length ? (
              <MedicinesAtRiskChart data={topMedicines} />
            ) : (
              <p className="text-muted-foreground text-sm">No medicine is critical anywhere.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  )
}
