import "server-only"
// Compact, engine-computed facts about a district or state, for briefs and Ask AarogyaGrid.
// Uses the service role (views return nothing for it), so it reads base tables.
import type { DB } from "@/lib/queries"
import { statusFor } from "@/lib/status"
import { missingMask, yearlyRatio } from "@/lib/engine/forecast"

export type ScopeFacts = Awaited<ReturnType<typeof buildScopeFacts>>

const r1 = (x: number) => Math.round(x * 10) / 10

export async function buildScopeFacts(db: DB, scopeType: "district" | "state" | "national", scopeId: string) {
  const { data: districts } =
    scopeType === "district"
      ? await db.from("districts").select("id, name, state_id").eq("id", scopeId)
      : scopeType === "state"
        ? await db.from("districts").select("id, name, state_id").eq("state_id", scopeId)
        : await db.from("districts").select("id, name, state_id")
  const districtIds = (districts ?? []).map((d) => d.id)
  const dName = new Map((districts ?? []).map((d) => [d.id, d.name]))

  const [facs, meds, stock, fcs, transfers, indents, staff] = await Promise.all([
    db.from("facilities").select("id, name, type, district_id, resupply_days, total_beds").in("district_id", districtIds),
    db.from("medicines").select("id, name, category, unit"),
    db.from("stock").select("facility_id, medicine_id, quantity").limit(5000),
    db.from("forecasts").select("facility_id, medicine_id, predicted_daily_use, days_left, forecast_30d, method, surge").limit(5000),
    db.from("transfers").select("id, status, created_at, approved_at, received_at, is_cross_district, from_facility_id, to_facility_id").in("status", ["proposed", "approved", "dispatched", "received"]),
    db.from("indents").select("id, status, created_at, approved_at, received_at, facility_id").in("status", ["submitted", "approved", "dispatched", "received"]),
    db.from("staff").select("id, facility_id").eq("is_active", true),
  ])
  const facilities = facs.data ?? []
  const fac = new Map(facilities.map((f) => [f.id, f]))
  const inScope = (id: string) => fac.has(id)
  const med = new Map((meds.data ?? []).map((m) => [m.id, m]))
  const fcBy = new Map((fcs.data ?? []).map((f) => [`${f.facility_id}:${f.medicine_id}`, f]))

  // Stock lines with status (same buckets as v_stock_status).
  const lines = (stock.data ?? [])
    .filter((s) => inScope(s.facility_id))
    .map((s) => {
      const f = fac.get(s.facility_id)!
      const fc = fcBy.get(`${s.facility_id}:${s.medicine_id}`)
      const daysLeft = fc?.days_left === null || fc?.days_left === undefined ? null : Number(fc.days_left)
      return {
        facility: f.name,
        facilityType: f.type,
        district: dName.get(f.district_id) ?? "",
        medicine: med.get(s.medicine_id)?.name ?? "",
        category: med.get(s.medicine_id)?.category ?? "",
        stock: Number(s.quantity),
        perDay: fc ? r1(Number(fc.predicted_daily_use)) : null,
        next30: fc?.forecast_30d ? Math.round(Number(fc.forecast_30d)) : null,
        daysLeft: daysLeft === null ? null : r1(daysLeft),
        status: statusFor(daysLeft, f.resupply_days),
      }
    })

  const phcLines = lines.filter((l) => l.facilityType !== "warehouse")
  const byDistrict = districtIds.map((id) => {
    const dl = phcLines.filter((l) => l.district === dName.get(id))
    const phcs = new Set(dl.map((l) => l.facility))
    const criticalPhcs = new Set(dl.filter((l) => l.status === "critical").map((l) => l.facility))
    return {
      district: dName.get(id),
      phcs: phcs.size,
      phcsCritical: criticalPhcs.size,
      criticalLines: dl.filter((l) => l.status === "critical").length,
      lowLines: dl.filter((l) => l.status === "low").length,
    }
  })

  const topCritical = phcLines
    .filter((l) => l.status === "critical")
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || (b.perDay ?? 0) - (a.perDay ?? 0))
    .slice(0, 10)
    .map(({ facility, district, medicine, stock, perDay, daysLeft }) => ({ facility, district, medicine, stock, perDay, daysLeft }))

  // Medicines with the most facilities at risk, and total expected demand next 30 days.
  const medRisk = new Map<string, { medicine: string; category: string; critical: number; low: number; next30: number }>()
  for (const l of phcLines) {
    const m = medRisk.get(l.medicine) ?? { medicine: l.medicine, category: l.category, critical: 0, low: 0, next30: 0 }
    if (l.status === "critical") m.critical++
    if (l.status === "low") m.low++
    m.next30 += l.next30 ?? 0
    medRisk.set(l.medicine, m)
  }
  const medicinesAtRisk = [...medRisk.values()].filter((m) => m.critical + m.low > 0).sort((a, b) => b.critical - a.critical || b.low - a.low).slice(0, 6)

  // Rising demand: the engine's year-over-year seasonal ratio (how demand moved going into this
  // period last year), median across PHCs. Last month's raw use would mislead: stock-outs suppress it.
  const ratios = new Map<string, number[]>()
  for (const d of districtIds) {
    const { data } = await db.rpc("engine_series", { p_district: d, p_days: 425 })
    for (const row of data ?? []) {
      if (row.facility_type === "warehouse") continue
      const input = {
        used: row.used.map(Number),
        received: row.received.map(Number),
        outflow: row.outflow.map(Number),
        reported: row.reported,
        stock: Number(row.stock),
        isWarehouse: false,
      }
      const name = med.get(row.medicine_id)?.name ?? ""
      ratios.set(name, [...(ratios.get(name) ?? []), yearlyRatio(input.used, missingMask(input))])
    }
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 1
  const rising = [...ratios.entries()]
    .map(([medicine, rs]) => ({
      medicine,
      category: [...medRisk.values()].find((m) => m.medicine === medicine)?.category ?? "",
      seasonalRisePct: Math.round((median(rs) - 1) * 100),
      next30Forecast: Math.round(medRisk.get(medicine)?.next30 ?? 0),
    }))
    .filter((r) => r.seasonalRisePct >= 15)
    .sort((a, b) => b.seasonalRisePct - a.seasonalRisePct)

  // Approvals and delivery times.
  const tIn = (transfers.data ?? []).filter((t) => inScope(t.to_facility_id) || inScope(t.from_facility_id))
  const iIn = (indents.data ?? []).filter((i) => inScope(i.facility_id))
  const pendingT = tIn.filter((t) => t.status === "proposed")
  const pendingI = iIn.filter((i) => i.status === "submitted")
  const oldest = [...pendingT, ...pendingI].map((x) => x.created_at).sort()[0] ?? null
  const received = [...tIn, ...iIn].filter(
    (x) => x.status === "received" && x.approved_at && x.received_at && Date.parse(x.received_at) > Date.now() - 30 * 86_400_000,
  )
  const hours = received.map((x) => (Date.parse(x.received_at!) - Date.parse(x.approved_at!)) / 36e5)

  // Attendance (7 days).
  const staffIn = (staff.data ?? []).filter((s) => inScope(s.facility_id))
  const staffFac = new Map(staffIn.map((s) => [s.id, s.facility_id]))
  const attendanceIssues: { facility: string; rate: string }[] = []
  if (staffFac.size) {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)
    const rows: { staff_id: string; present: boolean }[] = []
    const ids = [...staffFac.keys()]
    for (let i = 0; i < ids.length; i += 60) {
      const { data } = await db.from("attendance").select("staff_id, present").in("staff_id", ids.slice(i, i + 60)).gt("att_date", since)
      rows.push(...(data ?? []))
    }
    const byFac = new Map<string, { p: number; n: number }>()
    rows.forEach((r) => {
      const f = staffFac.get(r.staff_id)!
      const v = byFac.get(f) ?? { p: 0, n: 0 }
      v.n++
      if (r.present) v.p++
      byFac.set(f, v)
    })
    byFac.forEach((v, f) => {
      if (v.n && v.p / v.n < 0.7) attendanceIssues.push({ facility: fac.get(f)?.name ?? "", rate: `${Math.round((v.p / v.n) * 100)}%` })
    })
  }

  const { data: outbreaks } = await db.from("outbreaks").select("category, message, district_id").eq("status", "open").in("district_id", districtIds)
  const surging = (fcs.data ?? []).filter((f) => f.surge && inScope(f.facility_id)).map((f) => ({
    facility: fac.get(f.facility_id)?.name,
    medicine: med.get(f.medicine_id)?.name,
  }))

  return {
    openOutbreaks: (outbreaks ?? []).map((o) => ({ district: dName.get(o.district_id), category: o.category, message: o.message })),
    surgingNow: surging,
    scope: scopeType === "district" ? `${dName.get(scopeId)} district` : scopeType,
    date: new Date().toISOString().slice(0, 10),
    month: new Date().toLocaleString("en-IN", { month: "long" }),
    districts: byDistrict,
    topCritical,
    medicinesAtRisk,
    risingDemand: rising.slice(0, 5),
    pendingApprovals: {
      transfers: pendingT.length,
      crossDistrictTransfers: pendingT.filter((t) => t.is_cross_district).length,
      indents: pendingI.length,
      oldestPendingSince: oldest,
    },
    approvalToReceiptHours: hours.length ? r1(hours.reduce((a, b) => a + b, 0) / hours.length) : null,
    attendanceIssues,
  }
}

/** Deterministic brief used when Gemini is unavailable. */
export function templateBrief(f: ScopeFacts): string {
  const b: string[] = []
  const worst = f.topCritical.slice(0, 3).map((c) => `**${c.medicine}** at **${c.facility}** (${c.daysLeft ?? 0} days)`)
  const critical = f.districts.reduce((s, d) => s + d.criticalLines, 0)
  const phcs = f.districts.reduce((s, d) => s + d.phcsCritical, 0)
  b.push(`- ${critical} medicine lines are critical across ${phcs} PHCs${worst.length ? `; most urgent: ${worst.join(", ")}` : ""}.`)
  if (f.medicinesAtRisk.length) {
    b.push(`- Most affected medicines: ${f.medicinesAtRisk.slice(0, 3).map((m) => `**${m.medicine}** (${m.critical} critical, ${m.low} low)`).join(", ")}.`)
  }
  const p = f.pendingApprovals
  b.push(`- Waiting for a decision: ${p.transfers} transfers${p.crossDistrictTransfers ? ` (${p.crossDistrictTransfers} cross-district)` : ""} and ${p.indents} indents${p.oldestPendingSince ? `, oldest since ${p.oldestPendingSince.slice(0, 10)}` : ""}.`)
  if (f.attendanceIssues.length) b.push(`- Low staff attendance: ${f.attendanceIssues.map((a) => `**${a.facility}** ${a.rate}`).join(", ")}.`)
  if (f.risingDemand.length) b.push(`- Next 2 weeks: demand rising for ${f.risingDemand.slice(0, 3).map((r) => `**${r.medicine}** (usually +${r.seasonalRisePct}% at this time of year)`).join(", ")}.`)
  return b.join("\n")
}
