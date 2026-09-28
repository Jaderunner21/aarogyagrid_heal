import { AlertOctagon, Building2, ClipboardCheck, Inbox, Users, Warehouse } from "lucide-react"
import { StatTile } from "@/components/heal/stat-tile"
import { Section } from "@/components/heal/section"
import { FacilityMap } from "@/components/heal/facility-map"
import { toMapTransfer } from "@/lib/map"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { AlertFeed } from "@/components/heal/alert-feed"
import { AiBriefCard } from "@/components/heal/ai-brief-card"
import { ExplainButton } from "@/components/heal/explain-button"
import { SurgeBanner } from "@/components/heal/surge-banner"
import type { DB } from "@/lib/queries"
import {
  enrich,
  getAlerts,
  getDistrictSummaries,
  getFacilitySummaries,
  getIndents,
  getOutbreaks,
  getStock,
  getTransfers,
  sortRecommendations,
} from "@/lib/queries"
import type { Viewer } from "@/lib/permissions"
import { formatNumber, formatPercent } from "@/lib/format"

/** District overview body; used by the district officer and (read + cross-district actions) by the state admin. */
export async function DistrictOverview({ db, districtId, viewer }: { db: DB; districtId: string; viewer: Viewer }) {
  const [facilities, districts, stock, transfers, indents, brief, outbreaks] = await Promise.all([
    getFacilitySummaries(db, { districtId }),
    getDistrictSummaries(db),
    getStock(db, { districtId }),
    getTransfers(db, { districtId, status: ["proposed", "approved", "dispatched"] }),
    getIndents(db, { districtId, status: ["submitted"] }),
    db
      .from("ai_briefs")
      .select("content, generated_at")
      .eq("scope_type", "district")
      .eq("scope_id", districtId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getOutbreaks(db, { districtIds: [districtId] }),
  ])
  const alerts = await getAlerts(db, { facilityIds: facilities.map((f) => f.id), statuses: ["open", "acknowledged"] })

  const summary = districts.find((d) => d.id === districtId)
  const phcs = facilities.filter((f) => f.type !== "warehouse")
  const warehouse = facilities.find((f) => f.type === "warehouse")
  const warehouseLow = stock.filter((s) => s.facilityType === "warehouse" && (s.status === "critical" || s.status === "low")).length
  const queue = sortRecommendations(
    enrich(
      [
        ...transfers.filter((t) => t.status === "proposed" && (t.fromDistrictId === districtId || t.toDistrictId === districtId)),
        // requests still waiting for the PHC doctor are not the district's to decide yet
        ...indents.filter((i) => !i.awaitingMo),
      ],
      stock,
    ),
  )
  const mapTransfers = transfers.filter((t) => t.status === "proposed" || t.status === "approved" || t.status === "dispatched").map(toMapTransfer)
  const pending = (summary?.transfersPending ?? 0) + (summary?.indentsPending ?? 0)

  const surging = stock.filter((s) => s.surge)
  return (
    <div className="space-y-5">
      <SurgeBanner
        outbreaks={outbreaks}
        surgingFacilities={new Set(surging.map((s) => s.facilityId)).size}
        surgingMedicines={[...new Set(surging.map((s) => s.medicineName))]}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Facilities in critical state"
          value={`${formatNumber(summary?.facilitiesCritical ?? 0)} / ${formatNumber(phcs.length)}`}
          status={(summary?.facilitiesCritical ?? 0) > 0 ? "critical" : "ok"}
          icon={Building2}
          sub="at least one medicine critical"
        />
        <StatTile
          label="Critical items"
          value={formatNumber(summary?.criticalItems ?? 0)}
          status={(summary?.criticalItems ?? 0) > 0 ? "critical" : "ok"}
          icon={AlertOctagon}
          sub={`${formatNumber(summary?.lowItems ?? 0)} low`}
        />
        <StatTile
          label="Pending approvals"
          value={formatNumber(pending)}
          icon={ClipboardCheck}
          sub={`${summary?.transfersPending ?? 0} transfers · ${summary?.indentsPending ?? 0} indents`}
          href={viewer.role === "district_officer" ? "/district/transfers" : undefined}
        />
        <StatTile
          label="Staff attendance (7-day)"
          value={formatPercent(summary?.attendance7d)}
          status={(summary?.attendance7d ?? 1) < 0.7 ? "critical" : (summary?.attendance7d ?? 1) < 0.85 ? "low" : "ok"}
          icon={Users}
        />
        <StatTile
          label="Warehouse items low"
          value={formatNumber(warehouseLow)}
          status={warehouseLow > 0 ? "low" : "ok"}
          icon={Warehouse}
          sub={warehouse?.name}
          href={viewer.role === "district_officer" ? "/district/warehouse" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Section title="Facilities" description="Colour = worst medicine status · dashed lines = transfers in progress" className="xl:col-span-2">
          <FacilityMap facilities={facilities} transfers={mapTransfers} linkTo={viewer.role === "district_officer" ? "facility" : undefined} height={460} />
        </Section>
        <Section
          title="Action queue"
          description="AI recommendations waiting for a decision, most urgent first"
          actions={<ExplainButton scope="district" id={districtId} />}
          bodyClassName="p-3 max-h-[560px] overflow-y-auto"
        >
          <RecommendationList
            items={queue}
            viewer={viewer}
            emptyIcon={Inbox}
            emptyText="No recommendations waiting. Run analysis to check again."
          />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section title="Alerts" description="Critical first" bodyClassName="p-4 max-h-[520px] overflow-y-auto">
          <AlertFeed alerts={alerts} showFacility canAcknowledge={viewer.role === "district_officer"} filterable />
        </Section>
        <AiBriefCard scopeType="district" scopeId={districtId} initial={brief.data ?? null} title={`AI district brief · ${summary?.name ?? ""}`} />
      </div>
    </div>
  )
}
