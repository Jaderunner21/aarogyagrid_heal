import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { FacilityTable } from "@/components/heal/facility-table"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getFacilitySummaries } from "@/lib/queries"

export const metadata: Metadata = { title: "Facilities" }

export default async function DistrictFacilities() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const rows = await getFacilitySummaries(db, { districtId: session.profile.district_id! })
  return (
    <div>
      <PageHeader
        title="Facilities"
        description={`${rows.length} facilities in ${session.districtName}. Most urgent first; click a row for details.`}
      />
      <FacilityTable rows={rows} hrefBase="/district/facilities/" />
    </div>
  )
}
