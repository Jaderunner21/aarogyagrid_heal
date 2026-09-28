import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { Heatmap } from "@/components/heal/heatmap"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getStock } from "@/lib/queries"

export const metadata: Metadata = { title: "Medicines" }

export default async function NationalMedicines() {
  await requireRole("national_admin")
  const db = await createClient()
  const [allStock, states, districts] = await Promise.all([
    getStock(db),
    db.from("states").select("id, name").order("name"),
    db.from("districts").select("id, state_id"),
  ])
  // every health facility (sub-centre, PHC, CHC, district hospital); warehouses are not counted
  const stock = allStock.filter((s) => s.facilityType !== "warehouse")
  const districtState = new Map((districts.data ?? []).map((d) => [d.id, d.state_id]))
  const medicines = [...new Map(stock.map((s) => [s.medicineId, s.medicineName])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const cells = (states.data ?? []).flatMap((st) =>
    medicines.map(([mid]) => {
      const rows = stock.filter((s) => districtState.get(s.districtId) === st.id && s.medicineId === mid)
      const count = rows.filter((r) => r.status === "critical").length
      return { rowId: st.id, colId: mid, status: count ? ("critical" as const) : ("ok" as const), count, total: rows.length }
    }),
  )
  return (
    <div>
      <PageHeader title="Medicines across states" description="How many health facilities in each state are critical for each medicine." />
      <div className="bg-card rounded-xl border p-4">
        <Heatmap
          mode="count"
          rows={(states.data ?? []).map((s) => ({
            id: s.id,
            label: s.name,
            sub: `${new Set(stock.filter((r) => districtState.get(r.districtId) === s.id).map((r) => r.facilityId)).size} facilities`,
          }))}
          cols={medicines.map(([id, name]) => ({ id, label: name }))}
          cells={cells}
          rowHref="/national/states/"
          rowLabel="State"
        />
      </div>
    </div>
  )
}
