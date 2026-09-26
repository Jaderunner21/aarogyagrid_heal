import { NextResponse, after } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { canAccessScope, getCaller } from "@/lib/api-auth"
import { facilityIdsFor, runEngine } from "@/lib/engine/run"
import { explainScope } from "@/lib/ai/explain"

export const maxDuration = 60

const body = z.object({
  scope: z.enum(["facility", "district", "state", "national"]),
  id: z.string(),
})

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { scope, id } = parsed.data
  if (scope !== "national" && !z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid id" }, { status: 400 })

  const caller = await getCaller(request)
  if (!caller) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const admin = createAdminClient()
  if (!(await canAccessScope(admin, caller, scope, id))) {
    return NextResponse.json({ error: "You can't run analysis for this scope" }, { status: 403 })
  }

  try {
    const { explain, followUpDistrict, ...counts } = await runEngine(admin, scope, id)
    // After the response: a new surge redistributes its district right away; then Gemini explains.
    // Failures leave the template text in place.
    after(async () => {
      let facts = explain
      if (followUpDistrict) {
        try {
          facts = (await runEngine(admin, "district", followUpDistrict)).explain
        } catch (err) {
          console.error("[engine] surge follow-up", err)
        }
      }
      await explainScope(admin, await facilityIdsFor(followUpDistrict ? "district" : scope, followUpDistrict ?? id), facts)
    })
    return NextResponse.json(counts)
  } catch (err) {
    console.error("[engine]", err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Engine failed" }, { status: 500 })
  }
}
