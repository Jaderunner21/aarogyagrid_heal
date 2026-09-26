import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { DistrictOverview } from "@/components/heal/district-overview"
import { RunAnalysisButton } from "@/components/heal/run-analysis-button"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "District overview" }

export default async function DistrictPage() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const districtId = session.profile.district_id!
  return (
    <div>
      <PageHeader
        title={`${session.districtName} district`}
        description="Medicine stock, alerts and recommendations for every facility in the district."
        actions={<RunAnalysisButton scope="district" id={districtId} />}
      />
      <DistrictOverview db={db} districtId={districtId} viewer={toViewer(session)} />
    </div>
  )
}
