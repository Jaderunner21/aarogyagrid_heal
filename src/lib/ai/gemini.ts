import "server-only"
import { GoogleGenAI, type Part } from "@google/genai"
import type { z } from "zod"

// Gemini explains, parses and summarises. It never computes forecast numbers.
// Every call fails soft: callers get null and keep their deterministic text.

// Tried in order after GEMINI_MODEL when it is overloaded, out of quota or times out.
// On the free tier each model has its own daily request quota, so the chain multiplies capacity.
const FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
]
const RETRIES = 1
const TIMEOUT_MS = 20_000

let client: GoogleGenAI | null = null

export function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL)
}

function ai(): GoogleGenAI {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })
  return client
}

/** Daily quota exhausted: retrying the same model is pointless, move to the next one. */
function outOfDailyQuota(err: unknown): boolean {
  return (err as { status?: number })?.status === 429 && /PerDay/i.test((err as Error)?.message ?? "")
}

function retriable(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  if (status === 429 || status === 500 || status === 503 || status === 504) return true
  return (err as Error)?.name === "AbortError" || /timed? ?out|abort/i.test((err as Error)?.message ?? "")
}

async function call(parts: Part[], config: Record<string, unknown>): Promise<string | null> {
  if (!geminiAvailable()) return null
  const models = [...new Set([process.env.GEMINI_MODEL!, ...FALLBACK_MODELS])]
  const seen: string[] = []
  for (const model of models) {
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const res = await ai().models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: { ...config, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
        })
        return res.text ?? null
      } catch (err) {
        seen.push(`${model}:${(err as { status?: number })?.status ?? (err as Error)?.name}`)
        if (outOfDailyQuota(err)) break
        if (!retriable(err)) {
          console.error(`[gemini] ${model}:`, (err as Error)?.message ?? err)
          break
        }
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
      }
    }
  }
  console.error("[gemini] all models unavailable:", seen.join(" "))
  return null
}

/** Structured JSON output validated with zod. Returns null on any failure. */
export async function generateJson<T>({
  system,
  parts,
  jsonSchema,
  schema,
  temperature = 0.2,
}: {
  system: string
  parts: Part[]
  jsonSchema: unknown
  schema: z.ZodType<T>
  temperature?: number
}): Promise<T | null> {
  const text = await call(parts, {
    systemInstruction: system,
    responseMimeType: "application/json",
    responseJsonSchema: jsonSchema,
    temperature,
  })
  if (!text) return null
  try {
    const parsed = schema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      console.error("[gemini] schema mismatch:", parsed.error.issues.slice(0, 3))
      return null
    }
    return parsed.data
  } catch {
    console.error("[gemini] invalid JSON")
    return null
  }
}

/** Free text (markdown) output. Returns null on any failure. */
export async function generateText({
  system,
  prompt,
  temperature = 0.3,
}: {
  system: string
  prompt: string
  temperature?: number
}): Promise<string | null> {
  const text = await call([{ text: prompt }], { systemInstruction: system, temperature })
  return text?.trim() || null
}
