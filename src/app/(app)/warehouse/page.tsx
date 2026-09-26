import type { Metadata } from "next"
import { AlertTriangle, ClipboardList, PackageOpen, Truck } from "lucide-react"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { StatTile } from "@/components/heal/stat-tile"
import { StockTable } from "@/components/heal/stock-table"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { EmptyState } from "@/components/heal/empty-state"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getIndents, getStock, getTransfers, sortRecommendations } from "@/lib/queries"
import { formatDate, formatNumber } from "@/lib/format"

export const metadata: Metadata = { title: "Warehouse" }

export default async function WarehousePage() {
  const session = await requireRole("warehouse_manager")
  const db = await createClient()
  const wid = session.profile.facility_id!

  const [stock, indents, transfers, issues, medicines] = await Promise.all([
    getStock(db, { facilityId: wid }),
    getIndents(db, { warehouseId: wid, status: ["approved", "dispatched"] }),
    getTransfers(db, { fromFacilityId: wid, status: ["approved", "dispatched"] }),
    db.from("stock_log").select("*").eq("facility_id", wid).gt("qty_out", 0).order("log_date", { ascending: false }).order("created_at", { ascending: false }).limit(15),
    db.from("medicines").select("id, name, unit"),
  ])
  const low = stock.filter((s) => s.status === "critical" || s.status === "low").length
  const indentsToDispatch = indents.filter((i) => i.status === "approved")
  const transfersToDispatch = transfers.filter((t) => t.status === "approved")
  const queue = sortRecommendations(enrich([...indentsToDispatch, ...transfersToDispatch], stock))
  const inTransit = enrich([...indents, ...transfers].filter((x) => x.status === "dispatched"), stock)
  const med = new Map((medicines.data ?? []).map((m) => [m.id, m]))
  const refName = new Map([...indents.map((i) => [i.id, i.facilityName] as const), ...transfers.map((t) => [t.id, t.toName] as const)])

  return (
    <div className="space-y-5">
      <PageHeader title={session.facility?.name ?? "Warehouse"} description={`${session.districtName} district · issues stock to PHCs against approved indents`} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Items low" value={low} status={low > 0 ? "low" : "ok"} icon={AlertTriangle} sub={`of ${stock.length} medicines`} />
        <StatTile label="Indents to dispatch" value={indentsToDispatch.length} icon={ClipboardList} status={indentsToDispatch.length ? "critical" : undefined} />
        <StatTile label="Transfers to dispatch" value={transfersToDispatch.length} icon={Truck} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section title="Ready to dispatch" description="Approved by the district officer" bodyClassName="p-3">
          <RecommendationList items={queue} viewer={toViewer(session)} emptyIcon={PackageOpen} emptyText="Nothing waiting to be dispatched." />
        </Section>
        <div className="space-y-5">
          <Section title="In transit" bodyClassName="p-3">
            <RecommendationList items={inTransit} viewer={toViewer(session)} emptyIcon={Truck} emptyText="Nothing on the road right now." compact />
          </Section>
          <Section title="Recent issues" bodyClassName="p-0">
            {(issues.data ?? []).length === 0 ? (
              <EmptyState icon={PackageOpen} title="No stock issued yet." />
            ) : (
              <ul className="divide-y">
                {(issues.data ?? []).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{med.get(l.medicine_id)?.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {l.ref_id && refName.get(l.ref_id) ? `to ${refName.get(l.ref_id)} · ` : ""}
                        {l.note ?? l.source}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      −{formatNumber(Number(l.qty_out))} <span className="text-muted-foreground text-xs">{med.get(l.medicine_id)?.unit}s</span>
                      <span className="text-muted-foreground block text-xs">{formatDate(l.log_date)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <Section title="Warehouse stock" bodyClassName="p-3">
        <StockTable rows={stock} />
      </Section>
    </div>
  )
}
