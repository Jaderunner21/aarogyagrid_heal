import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { RunAnalysisButton } from "@/components/heal/run-analysis-button"
import { StateOverview } from "@/components/heal/state-overview"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "State overview" }

export default async function StatePage() {
  const session = await requireRole("state_admin")
  const db = await createClient()
  const stateId = session.profile.state_id!
  return (
    <div>
      <PageHeader
        title={`${session.stateName} state overview`}
        description="Every district, every facility, one view. Cross-district transfers wait for you."
        actions={<RunAnalysisButton scope="state" id={stateId} />}
      />
      <StateOverview db={db} stateId={stateId} stateName={session.stateName ?? ""} viewer={toViewer(session)} />
    </div>
  )
}
