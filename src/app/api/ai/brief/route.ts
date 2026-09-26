import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { canAccessScope, getCaller } from "@/lib/api-auth"
import { buildScopeFacts, templateBrief } from "@/lib/ai/facts"
import { generateText } from "@/lib/ai/gemini"
import { BRIEF_SYSTEM } from "@/lib/ai/prompts"
import type { Json } from "@/lib/database.types"

export const maxDuration = 60

const CACHE_HOURS = 6
const body = z.object({
  scope_type: z.enum(["district", "state", "national"]),
  scope_id: z.uuid(),
  force: z.boolean().optional(),
})

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const { scope_type, scope_id, force } = parsed.data

  const caller = await getCaller(request)
  if (!caller) return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const admin = createAdminClient()
  if (!(await canAccessScope(admin, caller, scope_type, scope_id))) {
    return NextResponse.json({ error: "Not allowed for this scope" }, { status: 403 })
  }

  if (!force) {
    const { data: cached } = await admin
      .from("ai_briefs")
      .select("content, generated_at")
      .eq("scope_type", scope_type)
      .eq("scope_id", scope_id)
      .gte("generated_at", new Date(Date.now() - CACHE_HOURS * 36e5).toISOString())
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cached) return NextResponse.json({ ...cached, cached: true })
  }

  try {
    const facts = await buildScopeFacts(admin, scope_type, scope_id)
    const ai = await generateText({ system: BRIEF_SYSTEM, prompt: `FACTS (JSON):\n${JSON.stringify(facts)}` })
    const content = ai
      ? ai
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^[-*•]\s/.test(l))
          .slice(0, 6)
          .map((l) => `- ${l.replace(/^[-*•]\s*/, "")}`)
          .join("\n")
      : ""
    if (!content) {
      // Gemini unavailable: show the deterministic summary, don't cache it.
      return NextResponse.json({ content: templateBrief(facts), generated_at: new Date().toISOString(), ai: false })
    }
    const { data, error } = await admin
      .from("ai_briefs")
      .insert({ scope_type, scope_id, content, facts: facts as unknown as Json })
      .select("content, generated_at")
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ ...data, ai: true })
  } catch (err) {
    console.error("[brief]", err)
    return NextResponse.json({ error: "Could not build the brief" }, { status: 500 })
  }
}
