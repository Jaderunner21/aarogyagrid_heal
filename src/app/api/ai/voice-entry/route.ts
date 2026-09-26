import { NextResponse } from "next/server"
import { z } from "zod"
import type { Part } from "@google/genai"
import { getCaller } from "@/lib/api-auth"
import { createClient } from "@/lib/supabase/server"
import { generateJson, geminiAvailable } from "@/lib/ai/gemini"
import { VOICE_SYSTEM } from "@/lib/ai/prompts"
import { voiceParseSchema, voiceResponseSchema } from "@/lib/ai/schemas"

export const maxDuration = 60

const MAX_AUDIO_BYTES = 8 * 1024 * 1024 // ~60 s of compressed audio, with headroom
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac", "audio/x-m4a"]
const textSchema = z.string().trim().min(2).max(2000)

/** Parse a spoken or typed stock note into structured entries. Nothing is saved here. */
export async function POST(request: Request) {
  const caller = await getCaller(request)
  if (!caller || caller.kind !== "user" || !caller.profile.facility_id) {
    return NextResponse.json({ error: "Only facility staff can use voice entry" }, { status: 403 })
  }
  if (!geminiAvailable()) return NextResponse.json({ error: "unavailable" }, { status: 503 })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const audio = form.get("audio")
  const text = form.get("text")

  const parts: Part[] = []
  if (audio instanceof File && audio.size > 0) {
    const mimeType = audio.type.split(";")[0] || "audio/webm"
    if (!AUDIO_TYPES.includes(mimeType)) return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 })
    if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Recording too long" }, { status: 413 })
    parts.push({ inlineData: { mimeType, data: Buffer.from(await audio.arrayBuffer()).toString("base64") } })
  } else {
    const parsed = textSchema.safeParse(text)
    if (!parsed.success) return NextResponse.json({ error: "Say or type the note first" }, { status: 400 })
    parts.push({ text: `NOTE (typed):\n${parsed.data}` })
  }

  // The facility's catalogue: every medicine it stocks.
  const db = await createClient()
  const { data: stock } = await db.from("stock").select("medicine_id").eq("facility_id", caller.profile.facility_id)
  const ids = (stock ?? []).map((s) => s.medicine_id)
  const { data: meds } = await db.from("medicines").select("id, name, generic_name, strength, unit").in("id", ids)
  const catalogue = meds ?? []
  parts.push({
    text: `CATALOGUE (JSON):\n${JSON.stringify(catalogue)}\n\n${audio instanceof File ? "The note is the audio above." : ""}`,
  })

  const result = await generateJson({
    system: VOICE_SYSTEM,
    parts,
    jsonSchema: voiceResponseSchema,
    schema: voiceParseSchema,
    temperature: 0.1,
  })
  if (!result) return NextResponse.json({ error: "unavailable" }, { status: 503 })

  // Never trust ids from the model: keep only catalogue items, merge duplicates.
  const known = new Set(catalogue.map((m) => m.id))
  const merged = new Map<string, (typeof result.entries)[number]>()
  for (const e of result.entries) {
    if (!known.has(e.medicine_id)) {
      result.unmatched.push(e.heard_as)
      continue
    }
    const prev = merged.get(e.medicine_id)
    merged.set(
      e.medicine_id,
      prev
        ? { ...prev, qty_used: prev.qty_used + e.qty_used, qty_received: prev.qty_received + e.qty_received, confidence: Math.min(prev.confidence, e.confidence) }
        : e,
    )
  }
  return NextResponse.json({ ...result, entries: [...merged.values()].filter((e) => e.qty_used > 0 || e.qty_received > 0) })
}
