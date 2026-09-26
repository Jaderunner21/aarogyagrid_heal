import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { IndentTable } from "@/components/heal/indent-table"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getIndents, getStock, sortRecommendations, type IndentView, type Recommendation } from "@/lib/queries"

export const metadata: Metadata = { title: "Indents" }

export default async function DistrictIndents() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const districtId = session.profile.district_id!
  const [indents, stock] = await Promise.all([getIndents(db, { districtId }), getStock(db, { districtId })])
  const rows = sortRecommendations(enrich(indents, stock)) as (Recommendation & IndentView)[]

  return (
    <div>
      <PageHeader title="Indents" description="Requests from PHCs to the district warehouse. Approve (you can change the quantity) or reject." />
      <IndentTable rows={rows} viewer={toViewer(session)} />
    </div>
  )
}
