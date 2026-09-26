import "server-only"
import type { DB } from "@/lib/queries"
import type { Json } from "@/lib/database.types"
import type { ExplainFact } from "@/lib/engine/run"
import { generateJson, geminiAvailable } from "./gemini"
import { EXPLAIN_SYSTEM } from "./prompts"
import { explainResponseSchema, explainSchema } from "./schemas"

const BATCH = 10
// Free-tier keys get ~20 requests/day per model: at most 2 proposal batches + 1 alert batch per run.
const MAX_PROPOSALS = 20
const MAX_ALERTS = 10
const MAX_PER_RUN = MAX_PROPOSALS

type AlertFact = {
  id: string
  kind: "critical_alert" | "demand_surge"
  medicine: string
  category: string
  facility: string
  stock: number | null
  predictedPerDay: number | null
  daysLeft: number | null
  resupplyDays: number
  month: string
  message: string
  facts: Json | null
}

type OutbreakFact = { id: string; kind: "outbreak"; message: string; facts: Json | null; month: string }

async function explainBatch(items: (ExplainFact | AlertFact | OutbreakFact)[]) {
  return generateJson({
    system: EXPLAIN_SYSTEM,
    parts: [{ text: `ITEMS (JSON):\n${JSON.stringify(items, null, 1)}` }],
    jsonSchema: explainResponseSchema,
    schema: explainSchema,
  })
}

/** Build facts for AI proposals that were not explained yet (e.g. from an earlier run). */
async function pendingProposalFacts(db: DB, facilityIds: string[], skip: Set<string>): Promise<ExplainFact[]> {
  const [t, i, meds, facs] = await Promise.all([
    db.from("transfers").select("*").eq("origin", "ai").is("ai_generated_at", null).eq("status", "proposed").in("to_facility_id", facilityIds).order("priority").limit(MAX_PER_RUN),
    db.from("indents").select("*").eq("origin", "ai").is("ai_generated_at", null).eq("status", "submitted").in("facility_id", facilityIds).limit(MAX_PER_RUN),
    db.from("medicines").select("id, name, category, unit"),
    db.from("facilities").select("id, name"),
  ])
  const med = new Map((meds.data ?? []).map((m) => [m.id, m]))
  const fac = new Map((facs.data ?? []).map((f) => [f.id, f.name]))
  const rows = [
    ...(t.data ?? []).map((x) => ({ table: "transfers" as const, id: x.id, med: x.medicine_id, to: x.to_facility_id, from: x.from_facility_id, qty: Number(x.qty), km: x.distance_km, reason: x.ai_reason })),
    ...(i.data ?? []).map((x) => ({ table: "indents" as const, id: x.id, med: x.medicine_id, to: x.facility_id, from: x.warehouse_id, qty: Number(x.qty_requested), km: null, reason: x.ai_reason })),
  ].filter((r) => !skip.has(r.id))
  if (!rows.length) return []

  const pairs = [...new Set(rows.flatMap((r) => [`${r.to}:${r.med}`, `${r.from}:${r.med}`]))]
  const fIds = [...new Set(pairs.map((p) => p.split(":")[0]))]
  const { data: fc } = await db.from("forecasts").select("facility_id, medicine_id, predicted_daily_use, days_left").in("facility_id", fIds)
  const { data: st } = await db.from("stock").select("facility_id, medicine_id, quantity").in("facility_id", fIds)
  const fcBy = new Map((fc ?? []).map((f) => [`${f.facility_id}:${f.medicine_id}`, f]))
  const stBy = new Map((st ?? []).map((s) => [`${s.facility_id}:${s.medicine_id}`, Number(s.quantity)]))
  const month = new Date().toLocaleString("en-IN", { month: "long" })

  return rows.map((r) => {
    const m = med.get(r.med)
    const rf = fcBy.get(`${r.to}:${r.med}`)
    const df = fcBy.get(`${r.from}:${r.med}`)
    const donorStock = stBy.get(`${r.from}:${r.med}`) ?? null
    const donorPdu = df ? Number(df.predicted_daily_use) : null
    return {
      table: r.table,
      id: r.id,
      medicine: m?.name ?? "",
      category: m?.category ?? "",
      unit: m?.unit ?? "",
      receiver: fac.get(r.to) ?? "",
      donor: fac.get(r.from) ?? "",
      qty: r.qty,
      distanceKm: r.km === null ? null : Number(r.km),
      receiverStock: stBy.get(`${r.to}:${r.med}`) ?? 0,
      receiverPdu: rf ? Number(rf.predicted_daily_use) : 0,
      receiverDaysLeft: rf?.days_left === null || rf?.days_left === undefined ? null : Number(rf.days_left),
      last30Pdu: null,
      yearlyRatio: null,
      surgeTimesBaseline: null,
      donorStockNow: donorStock,
      donorDaysAfter: donorStock !== null && donorPdu ? Math.round(((donorStock - r.qty) / donorPdu) * 10) / 10 : null,
      alternatives: [],
      month,
      template: r.reason ?? "",
    }
  })
}

async function pendingAlertFacts(db: DB, facilityIds: string[]): Promise<AlertFact[]> {
  const base = () =>
    db
      .from("alerts")
      .select("*")
      .in("facility_id", facilityIds)
      .eq("severity", "critical")
      .neq("status", "resolved")
      .is("ai_summary", null)
      .not("medicine_id", "is", null)
  const [surges, others] = await Promise.all([
    base().eq("type", "demand_surge").limit(MAX_PER_RUN),
    base().neq("type", "demand_surge").order("days_left").limit(MAX_PER_RUN),
  ])
  const alerts = [...(surges.data ?? []), ...(others.data ?? [])]
  if (!alerts.length) return []
  const [meds, facs, fc, st] = await Promise.all([
    db.from("medicines").select("id, name, category"),
    db.from("facilities").select("id, name, resupply_days").in("id", [...new Set(alerts.map((a) => a.facility_id))]),
    db.from("forecasts").select("facility_id, medicine_id, predicted_daily_use, days_left").in("facility_id", [...new Set(alerts.map((a) => a.facility_id))]),
    db.from("stock").select("facility_id, medicine_id, quantity").in("facility_id", [...new Set(alerts.map((a) => a.facility_id))]),
  ])
  const med = new Map((meds.data ?? []).map((m) => [m.id, m]))
  const fac = new Map((facs.data ?? []).map((f) => [f.id, f]))
  const fcBy = new Map((fc.data ?? []).map((f) => [`${f.facility_id}:${f.medicine_id}`, f]))
  const stBy = new Map((st.data ?? []).map((s) => [`${s.facility_id}:${s.medicine_id}`, Number(s.quantity)]))
  const month = new Date().toLocaleString("en-IN", { month: "long" })
  return alerts.map((a) => {
    const f = fcBy.get(`${a.facility_id}:${a.medicine_id}`)
    return {
      id: a.id,
      kind: a.type === "demand_surge" ? ("demand_surge" as const) : ("critical_alert" as const),
      medicine: med.get(a.medicine_id!)?.name ?? "",
      category: med.get(a.medicine_id!)?.category ?? "",
      facility: fac.get(a.facility_id)?.name ?? "",
      stock: stBy.get(`${a.facility_id}:${a.medicine_id}`) ?? null,
      predictedPerDay: f ? Number(f.predicted_daily_use) : null,
      daysLeft: a.days_left === null ? null : Number(a.days_left),
      resupplyDays: fac.get(a.facility_id)?.resupply_days ?? 7,
      month,
      message: a.message,
      facts: a.facts,
    }
  })
}

async function pendingOutbreakFacts(db: DB, facilityIds: string[]): Promise<OutbreakFact[]> {
  const { data: facs } = await db.from("facilities").select("district_id").in("id", facilityIds)
  const districts = [...new Set((facs ?? []).map((f) => f.district_id))]
  if (!districts.length) return []
  const { data } = await db.from("outbreaks").select("*").in("district_id", districts).eq("status", "open").is("ai_summary", null).limit(5)
  const month = new Date().toLocaleString("en-IN", { month: "long" })
  return (data ?? []).map((o) => ({ id: o.id, kind: "outbreak" as const, message: o.message, facts: o.facts, month }))
}

/** Rewrite AI proposal reasons and critical alert summaries with Gemini. Never throws. */
export async function explainScope(db: DB, facilityIds: string[], fresh: ExplainFact[] = []) {
  if (!geminiAvailable() || facilityIds.length === 0) return { explained: 0 }
  try {
    const skip = new Set(fresh.map((f) => f.id))
    const proposals = [...fresh, ...(await pendingProposalFacts(db, facilityIds, skip))]
      .sort((a, b) => (a.table === b.table ? (a.receiverDaysLeft ?? 0) - (b.receiverDaysLeft ?? 0) : a.table === "transfers" ? -1 : 1))
      .slice(0, MAX_PROPOSALS)
    const alerts = (await pendingAlertFacts(db, facilityIds)).slice(0, MAX_ALERTS)
    const outbreaks = await pendingOutbreakFacts(db, facilityIds)
    let explained = 0
    const now = new Date().toISOString()

    // outbreaks and surges first: they are the emergencies
    const batches: (ExplainFact | AlertFact | OutbreakFact)[][] = []
    const urgent = [...outbreaks, ...alerts.filter((a) => a.kind === "demand_surge")]
    for (let i = 0; i < urgent.length; i += BATCH) batches.push(urgent.slice(i, i + BATCH))
    for (let i = 0; i < proposals.length; i += BATCH) batches.push(proposals.slice(i, i + BATCH))
    const rest = alerts.filter((a) => a.kind !== "demand_surge")
    for (let i = 0; i < rest.length; i += BATCH) batches.push(rest.slice(i, i + BATCH))

    // Two calls at a time keeps us under free-tier rate limits; transfers first (they matter most in the queue).
    const run = async (batch: (ExplainFact | AlertFact | OutbreakFact)[]) => {
      const out = await explainBatch(batch)
      if (!out) return
      const byId = new Map(batch.map((b) => [b.id, b]))
      for (const { id, reason } of out) {
        const item = byId.get(id)
        if (!item) continue
        const res =
          "table" in item
            ? await db.from(item.table).update({ ai_reason: reason, ai_generated_at: now }).eq("id", id)
            : item.kind === "outbreak"
              ? await db.from("outbreaks").update({ ai_summary: reason, ai_generated_at: now }).eq("id", id)
              : await db.from("alerts").update({ ai_summary: reason, ai_generated_at: now }).eq("id", id)
        if (!res.error) explained++
      }
    }
    for (let i = 0; i < batches.length; i += 2) await Promise.all(batches.slice(i, i + 2).map(run))
    return { explained }
  } catch (err) {
    console.error("[explain]", err)
    return { explained: 0 }
  }
}
