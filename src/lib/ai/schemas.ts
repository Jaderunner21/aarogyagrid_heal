import { z } from "zod"

// ---------------------------------------------------------------- voice / text stock entry
export const voiceParseSchema = z.object({
  transcript: z.string(),
  language: z.string(),
  entries: z.array(
    z.object({
      medicine_id: z.string(),
      qty_used: z.number().min(0),
      qty_received: z.number().min(0),
      confidence: z.number().min(0).max(1),
      heard_as: z.string(),
    }),
  ),
  daily_report: z.object({
    footfall: z.number().min(0).nullish(),
    occupied_beds: z.number().min(0).nullish(),
  }),
  unmatched: z.array(z.string()),
})
export type VoiceParse = z.infer<typeof voiceParseSchema>

/** JSON Schema for Gemini structured output (responseJsonSchema), mirroring voiceParseSchema. */
export const voiceResponseSchema = {
  type: "object",
  properties: {
    transcript: { type: "string", description: "Verbatim transcript of what was said or typed." },
    language: { type: "string", description: "Language(s) detected, e.g. 'Hindi (code-mixed with English)'." },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          medicine_id: { type: "string", description: "id from the catalogue, never invented" },
          qty_used: { type: "number", description: "Quantity given to patients today; 0 if not mentioned" },
          qty_received: { type: "number", description: "Quantity received today; 0 if not mentioned" },
          confidence: { type: "number", description: "0 to 1" },
          heard_as: { type: "string", description: "The words the speaker used for this medicine" },
        },
        required: ["medicine_id", "qty_used", "qty_received", "confidence", "heard_as"],
      },
    },
    daily_report: {
      type: "object",
      properties: {
        footfall: { type: ["number", "null"], description: "Patients seen today, if mentioned" },
        occupied_beds: { type: ["number", "null"], description: "Beds occupied now, if mentioned" },
      },
    },
    unmatched: {
      type: "array",
      items: { type: "string" },
      description: "Medicine words that could not be matched to exactly one catalogue item",
    },
  },
  required: ["transcript", "language", "entries", "daily_report", "unmatched"],
} as const

// ---------------------------------------------------------------- explanations
export const explainSchema = z.array(z.object({ id: z.string(), reason: z.string().min(10).max(600) }))
export type ExplainOut = z.infer<typeof explainSchema>

export const explainResponseSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      reason: { type: "string", description: "At most 2 sentences, plain English, with the key numbers." },
    },
    required: ["id", "reason"],
  },
} as const

// ---------------------------------------------------------------- ask heal
export const askSchema = z.object({ answer: z.string(), grounded: z.boolean() })
export const askResponseSchema = {
  type: "object",
  properties: {
    answer: { type: "string", description: "Short answer in markdown, using only the provided data." },
    grounded: { type: "boolean", description: "false if the data does not contain the answer" },
  },
  required: ["answer", "grounded"],
} as const
