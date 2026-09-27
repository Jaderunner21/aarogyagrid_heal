import { NextResponse, after } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { facilityIdsFor, runEngine } from "@/lib/engine/run"
import { explainScope } from "@/lib/ai/explain"

export const maxDuration = 60

const body = z.object({
  facilityId: z.uuid(),
  medicineId: z.uuid(),
  note: z.string().max(300).optional(),
})

/**
 * "We've run out": record the report as the signed-in user (the database checks they work at this
 * facility and notifies the district at once). The reply is immediate; the district is then re-planned
 * in the background, and the suggested transfer or order reaches the screens through Realtime.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { facilityId, medicineId, note } = parsed.data

  const supabase = await createClient()
  const report = await supabase.rpc("report_stockout", { p_facility: facilityId, p_medicine: medicineId, p_note: note ?? null })
  if (report.error) return NextResponse.json({ error: report.error.message }, { status: 400 })

  after(async () => {
    const admin = createAdminClient()
    try {
      const { data: f } = await admin.from("facilities").select("district_id").eq("id", facilityId).single()
      const { explain } = await runEngine(admin, "district", f!.district_id)
      await explainScope(admin, await facilityIdsFor("district", f!.district_id), explain)
    } catch (err) {
      // the report and the notifications stand; the nightly run will plan it
      console.error("[stockout]", err)
    }
  })
  return NextResponse.json({ reportId: report.data.id })
}
