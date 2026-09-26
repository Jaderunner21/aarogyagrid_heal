import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { PipelineBoard } from "@/components/heal/pipeline-board"
import { NewTransferDialog } from "@/components/heal/new-transfer-dialog"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getDistricts, getFacilities, getMedicines, getStock, getTransfers } from "@/lib/queries"

export const metadata: Metadata = { title: "Transfers" }

export default async function StateTransfers() {
  const session = await requireRole("state_admin")
  const db = await createClient()
  const districts = await getDistricts(db, session.profile.state_id!)
  const [transfers, stock, facilities, medicines] = await Promise.all([
    getTransfers(db),
    getStock(db),
    getFacilities(db, { stateDistrictIds: districts.map((d) => d.id) }),
    getMedicines(db),
  ])
  const districtName = new Map(districts.map((d) => [d.id, d.name]))

  return (
    <div>
      <PageHeader
        title="Transfers across the state"
        description="Every transfer in every district. Cross-district ones need your approval."
        actions={
          <NewTransferDialog
            facilities={facilities.map((f) => ({ id: f.id, name: f.name, districtName: districtName.get(f.district_id) ?? "" }))}
            medicines={medicines.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
            stock={stock}
          />
        }
      />
      <PipelineBoard items={enrich(transfers, stock)} viewer={toViewer(session)} showCrossDistrictToggle />
    </div>
  )
}
