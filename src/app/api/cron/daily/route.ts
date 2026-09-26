import { NextResponse, after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isCron } from "@/lib/api-auth"
import { facilityIdsFor, runEngine } from "@/lib/engine/run"
import { explainScope } from "@/lib/ai/explain"

export const maxDuration = 60

/** Vercel cron (daily): refresh pooled seasonality, then run every state (each district, then its cross-district pass). */
export async function GET(request: Request) {
  if (!isCron(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const admin = createAdminClient()
  try {
    // district runs inside the national run already redistribute, so no surge follow-up is needed here
    const { explain, followUpDistrict, ...counts } = await runEngine(admin, "national", "all")
    void followUpDistrict
    after(async () => {
      await explainScope(admin, await facilityIdsFor("national", "all", admin), explain)
    })
    return NextResponse.json({ ranAt: new Date().toISOString(), ...counts })
  } catch (err) {
    console.error("[cron]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 })
  }
}
