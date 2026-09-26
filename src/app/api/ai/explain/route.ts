import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { canAccessScope, getCaller } from "@/lib/api-auth"
import { facilityIdsFor } from "@/lib/engine/run"
import { explainScope } from "@/lib/ai/explain"
import { geminiAvailable } from "@/lib/ai/gemini"

export const maxDuration = 60

const body = z.object({ scope: z.enum(["facility", "district", "state"]), id: z.uuid() })

/** Manual trigger: rewrite pending AI reasons and critical alert summaries with Gemini. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const caller = await getCaller(request)
  if (!caller) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const admin = createAdminClient()
  if (!(await canAccessScope(admin, caller, parsed.data.scope, parsed.data.id))) {
    return NextResponse.json({ error: "Not allowed for this scope" }, { status: 403 })
  }
  if (!geminiAvailable()) return NextResponse.json({ explained: 0, ai: false })
  const result = await explainScope(admin, await facilityIdsFor(parsed.data.scope, parsed.data.id, admin))
  return NextResponse.json({ ...result, ai: true })
}
