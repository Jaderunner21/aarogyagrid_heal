import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { MedicineRequestList } from "@/components/heal/medicine-requests"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getMedicineRequests } from "@/lib/queries"

export const metadata: Metadata = { title: "New medicines" }

// Step 2 of a request for a medicine that is not on the list: the district officer supports it or turns it down.
export default async function DistrictMedicineRequests() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const requests = await getMedicineRequests(db, { districtId: session.profile.district_id! })
  const waiting = requests.filter((r) => r.status === "with_district")
  const rest = requests.filter((r) => r.status !== "with_district")
  const viewer = { id: session.userId, role: session.profile.role, districtId: session.profile.district_id }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Requests for new medicines"
        description="PHC doctors ask here for medicines that are not on the list. Support a request to send it to the state admin, who can add it to the state list; or turn it down with a reason."
      />
      <Section title={`Waiting for you (${waiting.length})`} bodyClassName="p-3">
        <MedicineRequestList items={waiting} viewer={viewer} emptyText="No requests are waiting for you." />
      </Section>
      <Section title="Earlier requests" bodyClassName="p-3">
        <MedicineRequestList items={rest} viewer={viewer} emptyText="No earlier requests." />
      </Section>
    </div>
  )
}
