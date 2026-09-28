import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { Heatmap } from "@/components/heal/heatmap"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getStock } from "@/lib/queries"

export const metadata: Metadata = { title: "Medicines" }

export default async function StateMedicines() {
  await requireRole("state_admin")
  const db = await createClient()
  const stock = (await getStock(db)).filter((s) => s.facilityType !== "warehouse")

  const districts = [...new Map(stock.map((s) => [s.districtId, s.districtName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const medicines = [...new Map(stock.map((s) => [s.medicineId, s.medicineName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const cells = districts.flatMap(([did]) =>
    medicines.map(([mid]) => {
      const rows = stock.filter((s) => s.districtId === did && s.medicineId === mid)
      const count = rows.filter((r) => r.status === "critical").length
      return { rowId: did, colId: mid, status: count ? ("critical" as const) : ("ok" as const), count, total: rows.length }
    }),
  )

  return (
    <div>
      <PageHeader title="Medicines across districts" description="How many health facilities in each district are critical for each medicine." />
      <div className="bg-card rounded-xl border p-4">
        <Heatmap
          mode="count"
          rows={districts.map(([id, name]) => ({ id, label: name, sub: `${new Set(stock.filter((s) => s.districtId === id).map((s) => s.facilityId)).size} facilities` }))}
          cols={medicines.map(([id, name]) => ({ id, label: name }))}
          cells={cells}
          rowHref="/state/districts/"
        />
      </div>
    </div>
  )
}
