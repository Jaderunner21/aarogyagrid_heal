import type { Metadata } from "next"
import { Truck } from "lucide-react"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { StockTable } from "@/components/heal/stock-table"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getIndents, getStock } from "@/lib/queries"

export const metadata: Metadata = { title: "District warehouse" }

export default async function DistrictWarehouse() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const districtId = session.profile.district_id!
  const districtStock = await getStock(db, { districtId })
  const whStock = districtStock.filter((s) => s.facilityType === "warehouse")
  const warehouseId = whStock[0]?.facilityId
  const indents = warehouseId ? await getIndents(db, { warehouseId, status: ["approved", "dispatched"] }) : []

  return (
    <div className="space-y-5">
      <PageHeader title={whStock[0]?.facilityName ?? "District warehouse"} description="Warehouse stock and the approved indents it must fulfil." />
      <Section title="Indents to fulfil" bodyClassName="p-3">
        <RecommendationList
          items={enrich(indents, districtStock)}
          viewer={toViewer(session)}
          emptyIcon={Truck}
          emptyText="No approved indents waiting for the warehouse."
        />
      </Section>
      <Section title="Warehouse stock" bodyClassName="p-3">
        <StockTable rows={whStock} />
      </Section>
    </div>
  )
}
