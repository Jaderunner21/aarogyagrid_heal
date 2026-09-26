import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCaller } from "@/lib/api-auth"
import { buildScopeFacts } from "@/lib/ai/facts"
import { generateJson, geminiAvailable } from "@/lib/ai/gemini"
import { ASK_SYSTEM } from "@/lib/ai/prompts"
import { askResponseSchema, askSchema } from "@/lib/ai/schemas"

export const maxDuration = 60

const body = z.object({ question: z.string().trim().min(3).max(500) })

/** Ask AarogyaGrid: answers only from the caller's own scope data. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Ask a question (3–500 characters)" }, { status: 400 })
  const caller = await getCaller(request)
  if (!caller || caller.kind !== "user") return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const p = caller.profile
  if (p.role !== "district_officer" && p.role !== "state_admin" && p.role !== "national_admin") {
    return NextResponse.json({ error: "Ask AarogyaGrid is for district, state and national users" }, { status: 403 })
  }
  if (!geminiAvailable()) return NextResponse.json({ error: "Ask AarogyaGrid is unavailable right now" }, { status: 503 })

  const admin = createAdminClient()
  const facts =
    p.role === "district_officer"
      ? await buildScopeFacts(admin, "district", p.district_id!)
      : p.role === "state_admin"
        ? await buildScopeFacts(admin, "state", p.state_id!)
        : await buildScopeFacts(admin, "national", "all")

  const answer = await generateJson({
    system: ASK_SYSTEM,
    parts: [{ text: `DATA (JSON):\n${JSON.stringify(facts)}\n\nQUESTION: ${parsed.data.question}` }],
    jsonSchema: askResponseSchema,
    schema: askSchema,
  })
  if (!answer) return NextResponse.json({ error: "Ask AarogyaGrid is unavailable right now" }, { status: 503 })
  return NextResponse.json(answer)
}
