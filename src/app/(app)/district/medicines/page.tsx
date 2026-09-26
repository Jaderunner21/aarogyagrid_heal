import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { Heatmap } from "@/components/heal/heatmap"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getStock } from "@/lib/queries"

export const metadata: Metadata = { title: "Medicines" }

export default async function DistrictMedicines() {
  const session = await requireRole("district_officer")
  const db = await createClient()
  const stock = await getStock(db, { districtId: session.profile.district_id! })

  const facilities = [...new Map(stock.map((s) => [s.facilityId, s])).values()].sort(
    (a, b) => Number(a.facilityType === "warehouse") - Number(b.facilityType === "warehouse") || a.facilityName.localeCompare(b.facilityName),
  )
  const medicines = [...new Map(stock.map((s) => [s.medicineId, s])).values()].sort((a, b) => a.medicineName.localeCompare(b.medicineName))

  return (
    <div>
      <PageHeader
        title="Medicines across facilities"
        description={`Days of stock left for every medicine at every facility in ${session.districtName}.`}
      />
      <div className="bg-card rounded-xl border p-4">
        <Heatmap
          mode="facility"
          rows={facilities.map((f) => ({ id: f.facilityId, label: f.facilityName, sub: f.facilityType === "warehouse" ? "Warehouse" : f.facilityCode }))}
          cols={medicines.map((m) => ({ id: m.medicineId, label: m.medicineName }))}
          cells={stock.map((s) => ({
            rowId: s.facilityId,
            colId: s.medicineId,
            status: s.status,
            daysLeft: s.daysLeft,
            quantity: s.quantity,
            unit: s.unit,
          }))}
        />
      </div>
    </div>
  )
}
