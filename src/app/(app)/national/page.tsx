import type { Metadata } from "next"
import { format, subDays } from "date-fns"
import Link from "next/link"
import { Activity, AlertOctagon, Building2, Map as MapIcon, Siren } from "lucide-react"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { StatTile } from "@/components/heal/stat-tile"
import { FacilityMap } from "@/components/heal/facility-map"
import { SurgeBanner } from "@/components/heal/surge-banner"
import { AiBriefCard } from "@/components/heal/ai-brief-card"
import { RunAnalysisButton } from "@/components/heal/run-analysis-button"
import { DistrictStatusChart, MedicinesAtRiskChart } from "@/components/heal/state-charts"
import { StateAccuracyChart } from "@/components/heal/national-charts"
import { EmptyState } from "@/components/heal/empty-state"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getDistrictSummaries, getFacilitySummaries, getOutbreaks, getStock } from "@/lib/queries"
import { formatNumber, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "National overview" }

const NATIONAL_SCOPE = "00000000-0000-0000-0000-000000000000"
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)

export default async function NationalPage() {
  await requireRole("national_admin")
  const db = await createClient()
  const [states, facilities, districts, stock, outbreaks, brief, wastage] = await Promise.all([
    db.from("states").select("id, name, code").order("name"),
    getFacilitySummaries(db),
    getDistrictSummaries(db),
    getStock(db),
    getOutbreaks(db),
    db.from("ai_briefs").select("content, generated_at").eq("scope_type", "national").eq("scope_id", NATIONAL_SCOPE).order("generated_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("stock_log").select("facility_id, qty_out").eq("source", "wastage").gte("log_date", format(subDays(new Date(), 30), "yyyy-MM-dd")),
  ])
  const stateList = states.data ?? []
  const districtState = new Map(districts.map((d) => [d.id, d.stateId]))
  const facilityState = new Map(facilities.map((f) => [f.id, districtState.get(f.districtId)]))
  const stateName = new Map(stateList.map((s) => [s.id, s.name]))
  const phcs = facilities.filter((f) => f.type !== "warehouse")
  const surging = stock.filter((s) => s.surge)

  const perState = stateList.map((s) => {
    const ds = districts.filter((d) => d.stateId === s.id)
    const fs = facilities.filter((f) => facilityState.get(f.id) === s.id)
    const st = stock.filter((r) => facilityState.get(r.facilityId) === s.id)
    const errors = st.filter((r) => r.mape !== null && r.method !== "seed_moving_average").map((r) => r.mape! * 100)
    const modelled = st.filter((r) => r.method && r.method !== "seed_moving_average")
    return {
      id: s.id,
      name: s.name,
      districts: ds.length,
      phcs: fs.filter((f) => f.type !== "warehouse").length,
      phcsCritical: ds.reduce((a, d) => a + d.facilitiesCritical, 0),
      critical: fs.reduce((a, f) => a + f.critical, 0),
      low: fs.reduce((a, f) => a + f.low, 0),
      ok: fs.reduce((a, f) => a + f.ok + f.overstock, 0),
      pending: ds.reduce((a, d) => a + d.transfersPending + d.indentsPending, 0),
      attendance: median(ds.map((d) => d.attendance7d ?? 0).filter(Boolean)),
      errorPct: Math.round(median(errors) ?? 0),
      footfallPct: modelled.length ? Math.round((modelled.filter((r) => r.method === "holt_winters_footfall_blend").length / modelled.length) * 100) : 0,
      pooledPct: modelled.length ? Math.round((modelled.filter((r) => r.seasonalitySource && r.seasonalitySource !== "own").length / modelled.length) * 100) : 0,
      surging: new Set(st.filter((r) => r.surge).map((r) => r.facilityId)).size,
      outbreaks: outbreaks.filter((o) => o.stateId === s.id).length,
      wasted: (wastage.data ?? []).filter((w) => facilityState.get(w.facility_id) === s.id).reduce((a, w) => a + Number(w.qty_out), 0),
    }
  })

  const atRisk = new Map<string, number>()
  stock.filter((s) => s.status === "critical" && s.facilityType !== "warehouse").forEach((s) => atRisk.set(s.medicineName, (atRisk.get(s.medicineName) ?? 0) + 1))
  const topMedicines = [...atRisk.entries()].map(([name, n]) => ({ name, facilities: n })).sort((a, b) => b.facilities - a.facilities).slice(0, 8)
  const allErrors = stock.filter((r) => r.mape !== null && r.method !== "seed_moving_average").map((r) => r.mape! * 100)
  const accuracy = allErrors.length ? 100 - (median(allErrors) ?? 0) : null

  return (
    <div className="space-y-5">
      <PageHeader
        title="India overview"
        description="Every state on one system and one model. States, districts and facilities are data, so a new state needs no code."
        actions={<RunAnalysisButton scope="national" id="all" />}
      />

      <SurgeBanner
        outbreaks={outbreaks.map((o) => ({ ...o, districtName: `${o.districtName}, ${stateName.get(o.stateId ?? "") ?? ""}` }))}
        surgingFacilities={new Set(surging.map((s) => s.facilityId)).size}
        surgingMedicines={[...new Set(surging.map((s) => s.medicineName))]}
        showDistrict
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="States" value={stateList.length} icon={MapIcon} sub={`${districts.length} districts`} />
        <StatTile label="Facilities" value={facilities.length} icon={Building2} sub={`${phcs.length} PHCs`} />
        <StatTile
          label="PHCs critical"
          value={perState.reduce((a, s) => a + s.phcsCritical, 0)}
          status="critical"
          icon={AlertOctagon}
          sub={`${formatNumber(perState.reduce((a, s) => a + s.critical, 0))} critical lines`}
        />
        <StatTile
          label="Possible outbreaks"
          value={outbreaks.length}
          status={outbreaks.length ? "critical" : "ok"}
          icon={Siren}
          sub={`${new Set(surging.map((s) => s.facilityId)).size} facilities surging`}
        />
        <StatTile
          label="Forecast accuracy"
          value={accuracy === null ? "—" : `${Math.round(accuracy)}%`}
          icon={Activity}
          sub="1 − median backtest error"
        />
      </div>

      <Section title="All facilities" description="Both states on one map · click a facility to open its district · red rings = demand surge">
        <FacilityMap facilities={facilities} linkTo="district" height={520} />
      </Section>

      <Section title="State comparison" bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-3 py-2.5 text-right font-medium">Districts</th>
                <th className="px-3 py-2.5 text-right font-medium">PHCs critical</th>
                <th className="px-3 py-2.5 text-right font-medium">Critical lines</th>
                <th className="px-3 py-2.5 text-right font-medium">Pending approvals</th>
                <th className="px-3 py-2.5 text-right font-medium">Attendance</th>
                <th className="px-3 py-2.5 text-right font-medium">Forecast error</th>
                <th className="px-3 py-2.5 text-right font-medium">Surging</th>
                <th className="px-3 py-2.5 text-right font-medium">Wasted (30 d)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {perState.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5">
                    <Link href={`/national/states/${s.id}`} className="text-primary font-medium hover:underline">
                      {s.name}
                    </Link>
                    {s.outbreaks ? (
                      <span className="bg-critical ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase">
                        {s.outbreaks} outbreak{s.outbreaks > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right">{s.districts}</td>
                  <td className={cn("px-3 py-2.5 text-right", s.phcsCritical && "text-critical font-medium")}>
                    {s.phcsCritical} / {s.phcs}
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatNumber(s.critical)}</td>
                  <td className="px-3 py-2.5 text-right">{formatNumber(s.pending)}</td>
                  <td className="px-3 py-2.5 text-right">{formatPercent(s.attendance)}</td>
                  <td className="px-3 py-2.5 text-right">{s.errorPct}%</td>
                  <td className={cn("px-3 py-2.5 text-right", s.surging && "text-critical font-semibold")}>{s.surging}</td>
                  <td className="px-3 py-2.5 text-right">{formatNumber(s.wasted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section title="Stock status by state" description="Medicine lines at PHCs and warehouses">
          <DistrictStatusChart data={perState.map((s) => ({ name: s.name, critical: s.critical, low: s.low, ok: s.ok }))} />
        </Section>
        <Section title="Forecast accuracy by state" description="Shared model: same method and parameters everywhere; new facilities borrow pooled seasonality">
          <StateAccuracyChart data={perState.map((s) => ({ name: s.name, errorPct: s.errorPct, footfallPct: s.footfallPct, pooledPct: s.pooledPct }))} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section title="Cross-state surge view" description="Facility × medicine lines above their forecast band right now" bodyClassName="p-0">
          {surging.length === 0 ? (
            <EmptyState icon={Activity} title="No demand surges anywhere right now." />
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground sticky top-0 text-left text-xs">
                  <tr>
                    <th className="px-4 py-2 font-medium">State · District</th>
                    <th className="px-3 py-2 font-medium">Facility</th>
                    <th className="px-3 py-2 font-medium">Medicine</th>
                    <th className="px-3 py-2 text-right font-medium">Forecast / day</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {surging.map((s) => (
                    <tr key={`${s.facilityId}:${s.medicineId}`}>
                      <td className="px-4 py-2 text-xs">
                        {stateName.get(facilityState.get(s.facilityId) ?? "")} · {s.districtName}
                      </td>
                      <td className="px-3 py-2 font-medium">{s.facilityName}</td>
                      <td className="text-critical px-3 py-2 font-medium">{s.medicineName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(s.pdu, 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <div className="space-y-5">
          <AiBriefCard scopeType="national" scopeId={NATIONAL_SCOPE} initial={brief.data ?? null} title="AI national brief" />
          <Section title="Medicines at risk nationally" description="Number of PHCs where the medicine is critical">
            <MedicinesAtRiskChart data={topMedicines} />
          </Section>
        </div>
      </div>
    </div>
  )
}
