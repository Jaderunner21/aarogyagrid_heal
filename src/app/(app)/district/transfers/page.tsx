import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { PipelineBoard } from "@/components/heal/pipeline-board"
import { NewTransferDialog } from "@/components/heal/new-transfer-dialog"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getFacilities, getMedicines, getStock, getTransfers } from "@/lib/queries"

export const metadata: Metadata = { title: "Transfers" }

export default async function DistrictTransfers() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const districtId = session.profile.district_id!
  const [transfers, stock, facilities, medicines] = await Promise.all([
    getTransfers(db, { districtId }),
    getStock(db, { districtId }),
    getFacilities(db, { districtId }),
    getMedicines(db),
  ])

  return (
    <div>
      <PageHeader
        title="Transfers"
        description="Every transfer touching the district, from proposal to receipt."
        actions={
          <NewTransferDialog
            facilities={facilities.map((f) => ({ id: f.id, name: f.name, districtName: session.districtName ?? "" }))}
            medicines={medicines.map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
            stock={stock}
          />
        }
      />
      <PipelineBoard items={enrich(transfers, stock)} viewer={toViewer(session)} />
    </div>
  )
}
