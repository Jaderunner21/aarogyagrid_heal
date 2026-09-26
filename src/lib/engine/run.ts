import "server-only"
// Engine runner: forecast → alerts (stock, surge, expiry, staff, beds) → outbreaks
// → redistribution (incl. near-expiry moves) for a facility, district, state or the whole nation.
// Uses the service-role client; the API route checks the caller before calling this.
import type { DB } from "@/lib/queries"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Json, Tables, TablesInsert } from "@/lib/database.types"
import {
  DEFAULT_PARAMS,
  detectSurge,
  forecastSeries,
  historyLength,
  missingMask,
  yearlyRatio,
  type ForecastParams,
  type ForecastResult,
  type SurgeCheck,
} from "./forecast"
import {
  alertKey,
  bedAlert,
  expiryAlert,
  footfallSurgeAlert,
  staffAlert,
  stockAlerts,
  surgeAlert,
  type DesiredAlert,
  type Thresholds,
} from "./alerts"
import {
  planNearExpiry,
  planRedistribution,
  type NearExpiryBatch,
  type PlanFacility,
  type PlanSettings,
  type Proposal,
} from "./redistribute"

export type Scope = "facility" | "district" | "state" | "national"

export type RunResult = {
  forecasts: number
  alerts_opened: number
  alerts_resolved: number
  transfers_proposed: number
  indents_proposed: number
  surges: number
  outbreaks: number
  expired_written_off: number
}

export type ExplainFact = {
  table: "transfers" | "indents"
  id: string
  medicine: string
  category: string
  unit: string
  receiver: string
  donor: string
  qty: number
  distanceKm: number | null
  receiverStock: number
  receiverPdu: number
  receiverDaysLeft: number | null
  last30Pdu: number | null
  yearlyRatio: number | null
  surgeTimesBaseline: number | null
  donorStockNow: number | null
  donorDaysAfter: number | null
  alternatives: string[]
  month: string
  template: string
}

type RunOutput = RunResult & {
  explain: ExplainFact[]
  /** facility run found a new surge: redistribute its district right away */
  followUpDistrict: string | null
}

const CHUNK = 500
const HISTORY = 425
const NATIONAL_SCOPE = "00000000-0000-0000-0000-000000000000"

async function inChunks<T>(rows: T[], fn: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await fn(rows.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
  }
}

function num(v: Json | undefined, fallback: number): number {
  return typeof v === "number" ? v : fallback
}

// The heaviest query; under load Postgres can hit its statement timeout, so try once more.
async function districtSeries(db: DB, districtId: string) {
  const res = await db.rpc("engine_series2", { p_district: districtId, p_days: HISTORY })
  if (res.error && /timeout/i.test(res.error.message)) return db.rpc("engine_series2", { p_district: districtId, p_days: HISTORY })
  return res
}

async function loadSettings(db: DB) {
  const { data } = await db.from("app_settings").select("*")
  const get = (k: string) => {
    const v = data?.find((s) => s.key === k)?.value
    return v && typeof v === "object" && !Array.isArray(v) ? v : {}
  }
  const f = get("forecast")
  const t = get("thresholds")
  const r = get("redistribution")
  const s = get("staffing")
  const params: ForecastParams = {
    alpha: num(f.alpha, DEFAULT_PARAMS.alpha),
    beta: num(f.beta, DEFAULT_PARAMS.beta),
    gamma: num(f.gamma, DEFAULT_PARAMS.gamma),
    phi: num(f.damping, DEFAULT_PARAMS.phi),
    m: num(f.season_period, DEFAULT_PARAMS.m),
    historyDays: num(f.history_days, DEFAULT_PARAMS.historyDays),
    horizon: num(f.horizon_days, DEFAULT_PARAMS.horizon),
  }
  const thresholds: Thresholds = {
    lowMultiplier: num(t.low_multiplier, 2),
    overstockDays: num(t.overstock_days, 90),
    minAttendanceRate: num(s.min_attendance_rate, 0.7),
  }
  const plan: PlanSettings = {
    targetCoverDays: num(t.target_cover_days, 30),
    donorKeepDays: num(t.donor_keep_days, 45),
    maxDistanceKm: num(r.max_distance_km, 80),
    minTransferQty: num(r.min_transfer_qty, 10),
  }
  return { params, thresholds, plan }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000))
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

// ---------------------------------------------------------------------------------------------
// Shared modelling: seasonal ratios pooled by district → state → nation (refreshed once a day)
// ---------------------------------------------------------------------------------------------
type Pooled = Map<string, { ratio: number; n: number }>

export async function loadSeasonalProfiles(db: DB, today: string, force = false): Promise<Pooled> {
  const pooled: Pooled = new Map()
  const { data: existing } = await db.from("seasonal_profiles").select("*").limit(5000)
  if (!force && existing?.length && existing.every((p) => p.computed_on === today)) {
    existing.forEach((p) => pooled.set(`${p.level}:${p.scope_id}:${p.medicine_id}`, { ratio: Number(p.ratio), n: p.n }))
    return pooled
  }
  const { data: districts } = await db.from("districts").select("id, state_id")
  const groups = new Map<string, number[]>()
  const add = (k: string, r: number) => groups.set(k, [...(groups.get(k) ?? []), r])
  const seriesByDistrict = await Promise.all(
    (districts ?? []).map(async (d) => {
      const { data, error } = await districtSeries(db, d.id)
      if (error) throw new Error(`engine_series2: ${error.message}`)
      return { d, data: data ?? [] }
    }),
  )
  for (const { d, data } of seriesByDistrict) {
    for (const row of data) {
      if (row.facility_type === "warehouse") continue
      const input = {
        used: row.used.map(Number),
        received: row.received.map(Number),
        outflow: row.outflow.map(Number),
        reported: row.reported,
        stock: Number(row.stock),
        isWarehouse: false,
      }
      const missing = missingMask(input)
      if (historyLength(missing) < 395) continue // only facilities with a full year teach the pattern
      const r = yearlyRatio(input.used, missing)
      add(`district:${d.id}:${row.medicine_id}`, r)
      add(`state:${d.state_id}:${row.medicine_id}`, r)
      add(`national:${NATIONAL_SCOPE}:${row.medicine_id}`, r)
    }
  }
  const rows: TablesInsert<"seasonal_profiles">[] = []
  for (const [k, rs] of groups) {
    const [level, scopeId, medicineId] = k.split(":")
    const ratio = Math.round(median(rs) * 1000) / 1000
    pooled.set(k, { ratio, n: rs.length })
    rows.push({ level: level as "district" | "state" | "national", scope_id: scopeId, medicine_id: medicineId, ratio, n: rs.length, computed_on: today })
  }
  await inChunks(rows, (c) => db.from("seasonal_profiles").upsert(c, { onConflict: "level,scope_id,medicine_id" }))
  return pooled
}

function pooledFor(pooled: Pooled, districtId: string, stateId: string, medicineId: string) {
  const levels = [
    ["district", districtId],
    ["state", stateId],
    ["national", NATIONAL_SCOPE],
  ] as const
  for (const [level, id] of levels) {
    const p = pooled.get(`${level}:${id}:${medicineId}`)
    if (p && p.n >= 2) return { ratio: p.ratio, source: level }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------
/** Bed changes that fall due and expired batches (global, so run once per engine run). */
async function housekeeping(db: DB): Promise<number> {
  await db.rpc("apply_due_bed_changes")
  const { data } = await db.rpc("write_off_expired")
  return Number(data ?? 0)
}

export async function runEngine(
  db: DB,
  scope: Scope,
  id: string,
  { skipHousekeeping = false }: { skipHousekeeping?: boolean } = {},
): Promise<RunOutput> {
  if (scope === "national") {
    const { data: states } = await db.from("states").select("id")
    const total: RunOutput = {
      forecasts: 0, alerts_opened: 0, alerts_resolved: 0, transfers_proposed: 0, indents_proposed: 0,
      surges: 0, outbreaks: 0, expired_written_off: 0, explain: [], followUpDistrict: null,
    }
    const [written] = await Promise.all([housekeeping(db), loadSeasonalProfiles(db, isoDay(new Date()), true)])
    total.expired_written_off = written
    // states are independent: run them side by side (housekeeping already done once above)
    const results = await Promise.all((states ?? []).map((s) => runEngine(db, "state", s.id, { skipHousekeeping: true })))
    for (const r of results) {
      for (const k of Object.keys(total) as (keyof RunResult)[]) if (typeof r[k] === "number") total[k] += r[k]
      total.explain.push(...r.explain)
    }
    return total
  }

  const today = isoDay(new Date())
  const { params, thresholds, plan } = await loadSettings(db)

  // housekeeping on district/state runs: scheduled bed changes and expired batches
  const expiredWrittenOff = scope !== "facility" && !skipHousekeeping ? await housekeeping(db) : 0

  // ---------------------------------------------------------------- scope
  let districtIds: string[]
  let onlyFacility: string | null = null
  if (scope === "facility") {
    const { data, error } = await db.from("facilities").select("district_id").eq("id", id).single()
    if (error) throw new Error("Facility not found")
    districtIds = [data.district_id]
    onlyFacility = id
  } else if (scope === "district") {
    districtIds = [id]
  } else {
    const { data } = await db.from("districts").select("id").eq("state_id", id)
    districtIds = (data ?? []).map((d) => d.id)
  }

  const [facRes, medRes, distRes] = await Promise.all([
    db.from("facilities").select("*").in("district_id", districtIds).eq("is_active", true),
    db.from("medicines").select("*"),
    db.from("districts").select("id, name, state_id").in("id", districtIds),
  ])
  const facilities = facRes.data ?? []
  const fac = new Map(facilities.map((f) => [f.id, f]))
  const med = new Map((medRes.data ?? []).map((m) => [m.id, m]))
  const districtState = new Map((distRes.data ?? []).map((d) => [d.id, d.state_id]))
  const districtName = new Map((distRes.data ?? []).map((d) => [d.id, d.name]))
  const scopeFacilityIds = onlyFacility ? [onlyFacility] : facilities.map((f) => f.id)
  const blocked = new Set([...med.values()].filter((m) => m.status !== "active").map((m) => m.id))
  const pooled = await loadSeasonalProfiles(db, today)

  // Today's movements (in current stock, not yet in the series that ends yesterday)
  const todayNet = new Map<string, number>()
  const todayUsed = new Map<string, number>()
  const reportedToday = new Set<string>()
  for (let i = 0; i < scopeFacilityIds.length; i += 50) {
    const { data } = await db
      .from("stock_log")
      .select("facility_id, medicine_id, qty_used, qty_received, qty_out, source")
      .in("facility_id", scopeFacilityIds.slice(i, i + 50))
      .eq("log_date", today)
      .limit(1000)
    for (const l of data ?? []) {
      const key = `${l.facility_id}:${l.medicine_id}`
      todayNet.set(key, (todayNet.get(key) ?? 0) + Number(l.qty_received) - Number(l.qty_used) - Number(l.qty_out))
      todayUsed.set(key, (todayUsed.get(key) ?? 0) + Number(l.qty_used))
      if (l.source !== "wastage" && l.source !== "seed") reportedToday.add(l.facility_id)
    }
  }
  const todayFootfall = new Map<string, number>()
  {
    const { data } = await db.from("daily_reports").select("facility_id, footfall").in("facility_id", scopeFacilityIds).eq("report_date", today)
    ;(data ?? []).forEach((r) => todayFootfall.set(r.facility_id, r.footfall))
  }

  // ---------------------------------------------------------------- 1. forecast (+ surge detection)
  type Pair = {
    facilityId: string
    medicineId: string
    stock: number
    used: number[]
    fc: ForecastResult
    surge: SurgeCheck | null
  }
  const pairs: Pair[] = []
  const footfallSurge = new Map<string, SurgeCheck>()
  const inputs = await Promise.all(
    districtIds.map(async (districtId) => {
      const [series, footfall] = await Promise.all([
        districtSeries(db, districtId),
        db.rpc("engine_footfall", { p_district: districtId, p_days: HISTORY }),
      ])
      return { districtId, series, footfall }
    }),
  )
  for (const { districtId, series, footfall } of inputs) {
    const stateId = districtState.get(districtId) ?? ""
    if (series.error) throw new Error(`engine_series2: ${series.error.message}`)
    const ff = new Map((footfall.data ?? []).map((f) => [f.facility_id, { values: f.footfall.map(Number), reported: f.reported }]))

    // facility-level footfall surge: an early signal for acute medicines
    for (const [fid, f] of ff) {
      if (onlyFacility && fid !== onlyFacility) continue
      const t = todayFootfall.get(fid)
      const values = t !== undefined ? [...f.values, t] : f.values
      const missing = (t !== undefined ? [...f.reported, true] : f.reported).map((r) => !r)
      const s = detectSurge(values, missing, params, { threshold: 1.5, minPerDay: 20 })
      if (s?.surging) footfallSurge.set(fid, s)
    }

    for (const row of series.data ?? []) {
      if (onlyFacility && row.facility_id !== onlyFacility) continue
      const m = med.get(row.medicine_id)
      const key = `${row.facility_id}:${row.medicine_id}`
      const input = {
        used: row.used.map(Number),
        received: row.received.map(Number),
        outflow: row.outflow.map(Number),
        reported: row.reported,
        stock: Number(row.stock),
        stockAtSeriesEnd: Number(row.stock) - (todayNet.get(key) ?? 0),
        isWarehouse: row.facility_type === "warehouse",
      }
      const missing = missingMask(input)
      const acute = Boolean(m && !m.is_chronic)

      // surge: the last 3 days (today included once the facility has reported) vs forecast and baseline
      let surge: SurgeCheck | null = null
      if (!input.isWarehouse && m?.status === "active") {
        const withToday = reportedToday.has(row.facility_id)
        const y = withToday ? [...input.used, todayUsed.get(key) ?? 0] : input.used
        const miss = withToday ? [...missing, false] : missing
        surge = detectSurge(y, miss, params, { threshold: footfallSurge.has(row.facility_id) && acute ? 1.4 : 1.8, minPerDay: 5 })
      }

      const fc = forecastSeries(input, today, params, {
        pooled: pooledFor(pooled, districtId, stateId, row.medicine_id),
        footfall: !input.isWarehouse && acute ? (ff.get(row.facility_id) ?? null) : null,
        surge: Boolean(surge?.surging),
      })
      pairs.push({
        facilityId: row.facility_id,
        medicineId: row.medicine_id,
        stock: input.stock,
        used: input.isWarehouse ? input.outflow : input.used,
        fc,
        surge: surge?.surging ? surge : null,
      })
    }
  }

  const forecastRows: TablesInsert<"forecasts">[] = pairs.map((p) => ({
    facility_id: p.facilityId,
    medicine_id: p.medicineId,
    generated_at: new Date().toISOString(),
    method: p.fc.method,
    predicted_daily_use: p.fc.predictedDailyUse,
    lower_daily: p.fc.lowerDaily,
    upper_daily: p.fc.upperDaily,
    forecast_7d: p.fc.forecast7d,
    forecast_30d: p.fc.forecast30d,
    days_left: p.fc.daysLeft,
    stockout_date: p.fc.stockoutDate,
    mape: p.fc.mape,
    series: p.fc.series as unknown as Json,
    footfall_weight: p.fc.footfallWeight,
    seasonality_source: p.fc.seasonalitySource,
    surge: Boolean(p.surge),
  }))
  await inChunks(forecastRows, (c) => db.from("forecasts").upsert(c, { onConflict: "facility_id,medicine_id" }))

  // ---------------------------------------------------------------- 2. alerts
  const desired: DesiredAlert[] = []
  for (const p of pairs) {
    const f = fac.get(p.facilityId)
    const m = med.get(p.medicineId)
    if (!f || !m) continue
    if (m.status === "active") {
      desired.push(
        ...stockAlerts(
          {
            facilityId: p.facilityId,
            medicineId: p.medicineId,
            medicineName: m.name,
            unit: m.unit,
            stock: p.stock,
            pdu: p.fc.predictedDailyUse,
            daysLeft: p.fc.daysLeft,
            resupplyDays: f.resupply_days,
          },
          thresholds,
        ),
      )
    }
    if (p.surge) {
      desired.push(
        surgeAlert(
          {
            facilityId: p.facilityId,
            facilityName: f.name,
            medicineId: p.medicineId,
            medicineName: m.name,
            unit: m.unit,
            category: m.category,
            footfallRatio: footfallSurge.get(p.facilityId)?.ratio ?? null,
          },
          p.surge,
        ),
      )
    }
  }
  for (const [fid, s] of footfallSurge) desired.push(footfallSurgeAlert(fid, fac.get(fid)?.name ?? "", s))

  // expiry: nearest active batch per facility×medicine expiring within 90 days
  const nearExpiry: NearExpiryBatch[] = []
  const pairByKey = new Map(pairs.map((p) => [`${p.facilityId}:${p.medicineId}`, p]))
  for (let i = 0; i < scopeFacilityIds.length; i += 25) {
    const { data } = await db
      .from("stock_batches")
      .select("facility_id, medicine_id, batch_no, expiry_date, qty")
      .in("facility_id", scopeFacilityIds.slice(i, i + 25))
      .eq("status", "active")
      .gt("qty", 0)
      .gte("expiry_date", today)
      .lte("expiry_date", daysAgo(-90))
      .order("expiry_date")
      .limit(1000)
    const seen = new Set<string>()
    for (const b of data ?? []) {
      const key = `${b.facility_id}:${b.medicine_id}`
      const m = med.get(b.medicine_id)
      const days = daysBetween(today, b.expiry_date)
      nearExpiry.push({ facilityId: b.facility_id, medicineId: b.medicine_id, batchNo: b.batch_no, qty: Number(b.qty), daysToExpiry: days })
      if (seen.has(key) || !m) continue
      seen.add(key)
      desired.push(
        ...expiryAlert({
          facilityId: b.facility_id,
          medicineId: b.medicine_id,
          medicineName: m.name,
          unit: m.unit,
          batchNo: b.batch_no,
          qty: Number(b.qty),
          expiryDate: b.expiry_date,
          daysToExpiry: days,
          pdu: pairByKey.get(key)?.fc.predictedDailyUse ?? null,
        }),
      )
    }
  }

  const phcIds = scopeFacilityIds.filter((fid) => fac.get(fid)?.type !== "warehouse")
  for (const districtId of districtIds) {
    const ids = phcIds.filter((fid) => fac.get(fid)?.district_id === districtId)
    if (!ids.length) continue
    const [staff, reports] = await Promise.all([
      db.from("staff").select("id, facility_id").in("facility_id", ids).eq("is_active", true),
      db.from("daily_reports").select("facility_id, report_date, occupied_beds").in("facility_id", ids).gte("report_date", daysAgo(10)).order("report_date", { ascending: false }),
    ])
    const staffFac = new Map((staff.data ?? []).map((s) => [s.id, s.facility_id]))
    const att = staffFac.size
      ? ((await db.from("attendance").select("staff_id, present").in("staff_id", [...staffFac.keys()]).gt("att_date", daysAgo(7))).data ?? [])
      : []
    for (const fid of ids) {
      const rows = att.filter((a) => staffFac.get(a.staff_id) === fid)
      const rate = rows.length ? rows.filter((a) => a.present).length / rows.length : null
      desired.push(...staffAlert(fid, rate, thresholds))
      const last3 = (reports.data ?? []).filter((r) => r.facility_id === fid).slice(0, 3).map((r) => r.occupied_beds)
      desired.push(...bedAlert(fid, fac.get(fid)?.total_beds ?? 0, last3))
    }
  }

  const live: Tables<"alerts">[] = []
  for (let i = 0; i < scopeFacilityIds.length; i += 100) {
    const { data } = await db.from("alerts").select("*").in("facility_id", scopeFacilityIds.slice(i, i + 100)).neq("status", "resolved")
    live.push(...(data ?? []))
  }
  const liveByKey = new Map(live.map((a) => [alertKey({ facilityId: a.facility_id, medicineId: a.medicine_id, type: a.type }), a]))
  const desiredByKey = new Map(desired.map((d) => [alertKey(d), d]))

  const toInsert: TablesInsert<"alerts">[] = []
  const toUpdate: { id: string; patch: Partial<Tables<"alerts">> }[] = []
  for (const [k, d] of desiredByKey) {
    const existing = liveByKey.get(k)
    if (!existing) {
      toInsert.push({
        facility_id: d.facilityId,
        medicine_id: d.medicineId,
        type: d.type,
        severity: d.severity,
        days_left: d.daysLeft,
        message: d.message,
        facts: d.facts ?? null,
      })
    } else if (existing.severity !== d.severity || existing.message !== d.message || Number(existing.days_left) !== d.daysLeft) {
      const escalated = existing.severity !== d.severity
      toUpdate.push({
        id: existing.id,
        patch: {
          severity: d.severity,
          days_left: d.daysLeft,
          message: d.message,
          facts: d.facts ?? null,
          // a changed situation needs a fresh explanation
          ...(escalated ? { ai_summary: null, ai_generated_at: null } : {}),
        },
      })
    }
  }
  const toResolve = live.filter((a) => !desiredByKey.has(alertKey({ facilityId: a.facility_id, medicineId: a.medicine_id, type: a.type })))

  await inChunks(toInsert, (c) => db.from("alerts").insert(c))
  // one upsert per chunk instead of one update per alert (existing rows merged with the patch)
  const liveById = new Map(live.map((a) => [a.id, a]))
  await inChunks(
    toUpdate.map((u) => ({ ...liveById.get(u.id)!, ...u.patch })),
    (c) => db.from("alerts").upsert(c, { onConflict: "id" }),
  )
  const resolveIds = toResolve.map((a) => a.id)
  for (let i = 0; i < resolveIds.length; i += 100) {
    const { error } = await db
      .from("alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .in("id", resolveIds.slice(i, i + 100))
    if (error) throw new Error(error.message)
  }
  const newSurges = toInsert.filter((a) => a.type === "demand_surge" && a.medicine_id)

  // ---------------------------------------------------------------- 3. outbreaks (3+ PHCs, one category, 7 days)
  let outbreaksOpen = 0
  for (const districtId of districtIds) {
    const distFacIds = facilities.filter((f) => f.district_id === districtId).map((f) => f.id)
    const [{ data: surges }, { data: open }] = await Promise.all([
      db
        .from("alerts")
        .select("facility_id, medicine_id, status, created_at, facts")
        .eq("type", "demand_surge")
        .not("medicine_id", "is", null)
        .in("facility_id", distFacIds)
        .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()),
      db.from("outbreaks").select("*").eq("district_id", districtId).eq("status", "open"),
    ])
    const byCategory = new Map<string, { facilities: Set<string>; medicines: Set<string>; live: number }>()
    for (const s of surges ?? []) {
      const m = med.get(s.medicine_id!)
      if (!m) continue
      const g = byCategory.get(m.category) ?? { facilities: new Set(), medicines: new Set(), live: 0 }
      g.facilities.add(s.facility_id)
      g.medicines.add(s.medicine_id!)
      if (s.status !== "resolved") g.live++
      byCategory.set(m.category, g)
    }
    for (const [category, g] of byCategory) {
      if (g.facilities.size < 3) continue
      const names = [...g.facilities].map((fid) => fac.get(fid)?.name ?? "").filter(Boolean)
      const meds = [...g.medicines].map((mid) => med.get(mid)?.name ?? "")
      const message = `Possible outbreak: ${meds.join(" and ")} demand surged at ${g.facilities.size} PHCs in ${districtName.get(districtId)} within 7 days (${names.join(", ")}).`
      const facts = {
        kind: "outbreak",
        district: districtName.get(districtId),
        category,
        medicines: meds,
        facilities: names,
        surges: (surges ?? []).filter((s) => med.get(s.medicine_id!)?.category === category).map((s) => s.facts),
      } as unknown as Json
      const current = (open ?? []).find((o) => o.category === category)
      if (current) {
        await db
          .from("outbreaks")
          .update({ facility_ids: [...g.facilities], medicine_ids: [...g.medicines], message, facts, updated_at: new Date().toISOString() })
          .eq("id", current.id)
      } else {
        await db.from("outbreaks").insert({ district_id: districtId, category, facility_ids: [...g.facilities], medicine_ids: [...g.medicines], message, facts })
      }
      outbreaksOpen++
    }
    // an outbreak ends when fewer than 3 PHCs surged in 7 days and none is still surging
    for (const o of open ?? []) {
      const g = byCategory.get(o.category)
      if (!g || (g.facilities.size < 3 && g.live === 0)) {
        await db.from("outbreaks").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", o.id)
      }
    }
  }

  const result: RunResult = {
    forecasts: forecastRows.length,
    alerts_opened: toInsert.filter((a) => a.severity !== "info").length,
    alerts_resolved: toResolve.filter((a) => a.severity !== "info").length,
    transfers_proposed: 0,
    indents_proposed: 0,
    surges: pairs.filter((p) => p.surge).length,
    outbreaks: outbreaksOpen,
    expired_written_off: expiredWrittenOff,
  }
  if (scope === "facility") {
    // a new surge at this facility: redistribute its district now instead of waiting for the next run
    return { ...result, explain: [], followUpDistrict: newSurges.length ? districtIds[0] : null }
  }

  // ---------------------------------------------------------------- 4. redistribution
  const scopeSet = new Set(scopeFacilityIds)
  for (let i = 0; i < scopeFacilityIds.length; i += 100) {
    const ids = scopeFacilityIds.slice(i, i + 100)
    let del = db.from("transfers").delete().eq("origin", "ai").eq("status", "proposed").in("to_facility_id", ids)
    if (scope === "district") del = del.eq("is_cross_district", false)
    const t = await del
    if (t.error) throw new Error(t.error.message)
    const n = await db.from("indents").delete().eq("origin", "ai").eq("status", "submitted").in("facility_id", ids)
    if (n.error) throw new Error(n.error.message)
  }

  const k = (f: string, m: string) => `${f}:${m}`
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, number>()
  const add = (map: Map<string, number>, key: string, q: number) => map.set(key, (map.get(key) ?? 0) + q)
  const [openT, openI] = await Promise.all([
    db.from("transfers").select("from_facility_id, to_facility_id, medicine_id, qty, status").in("status", ["proposed", "approved", "dispatched"]),
    db.from("indents").select("facility_id, warehouse_id, medicine_id, qty_requested, qty_approved, status").in("status", ["submitted", "approved", "dispatched"]),
  ])
  for (const t of openT.data ?? []) {
    if (!scopeSet.has(t.to_facility_id) && !scopeSet.has(t.from_facility_id)) continue
    add(incoming, k(t.to_facility_id, t.medicine_id), Number(t.qty))
    if (t.status !== "dispatched") add(outgoing, k(t.from_facility_id, t.medicine_id), Number(t.qty))
  }
  for (const i of openI.data ?? []) {
    if (!scopeSet.has(i.facility_id)) continue
    const q = Number(i.qty_approved ?? i.qty_requested)
    add(incoming, k(i.facility_id, i.medicine_id), q)
    if (i.status === "approved") add(outgoing, k(i.warehouse_id, i.medicine_id), q)
  }

  const liveStockout: Tables<"alerts">[] = []
  for (let i = 0; i < scopeFacilityIds.length; i += 100) {
    const { data } = await db
      .from("alerts")
      .select("*")
      .in("facility_id", scopeFacilityIds.slice(i, i + 100))
      .eq("type", "stockout_risk")
      .neq("status", "resolved")
    liveStockout.push(...(data ?? []))
  }
  const receivers = liveStockout
    .filter((a) => a.medicine_id && pairByKey.has(k(a.facility_id, a.medicine_id)))
    .map((a) => {
      const p = pairByKey.get(k(a.facility_id, a.medicine_id!))!
      return {
        facilityId: p.facilityId,
        medicineId: p.medicineId,
        stock: p.stock,
        pdu: p.fc.predictedDailyUse,
        daysLeft: p.fc.daysLeft,
        surge: Boolean(p.surge),
        alertId: a.id,
      }
    })

  const planFacilities: PlanFacility[] = facilities.map((f) => ({
    id: f.id,
    name: f.name,
    type: f.type,
    districtId: f.district_id,
    lat: f.lat,
    lng: f.lng,
    resupplyDays: f.resupply_days,
    supplyingWarehouse: f.supplying_warehouse,
  }))
  const planPairs = pairs.map((p) => ({
    facilityId: p.facilityId,
    medicineId: p.medicineId,
    stock: p.stock,
    pdu: p.fc.predictedDailyUse,
    daysLeft: p.fc.daysLeft,
    surge: Boolean(p.surge),
  }))
  const proposals: Proposal[] = [
    ...planRedistribution({
      facilities: planFacilities,
      pairs: planPairs,
      receivers,
      incoming,
      outgoing,
      settings: plan,
      crossDistrict: scope === "state",
      blockedMedicines: blocked,
    }),
    ...planNearExpiry({ facilities: planFacilities, pairs: planPairs, batches: nearExpiry, incoming, settings: plan, blockedMedicines: blocked }),
  ]

  const transferRows: TablesInsert<"transfers">[] = []
  const indentRows: TablesInsert<"indents">[] = []
  for (const p of proposals) {
    if (p.kind === "transfer") {
      transferRows.push({
        medicine_id: p.medicineId,
        from_facility_id: p.fromId,
        to_facility_id: p.toId,
        qty: p.qty,
        distance_km: p.distanceKm,
        is_cross_district: p.isCrossDistrict,
        origin: "ai",
        priority: p.priority,
        status: "proposed",
        ai_reason: p.reason,
        alert_id: p.alertId || null,
      })
    } else {
      indentRows.push({
        facility_id: p.facilityId,
        warehouse_id: p.warehouseId,
        medicine_id: p.medicineId,
        qty_requested: p.qty,
        origin: "ai",
        status: "submitted",
        ai_reason: p.reason,
      })
    }
  }
  const insertedT: { id: string }[] = []
  const insertedI: { id: string }[] = []
  for (let i = 0; i < transferRows.length; i += CHUNK) {
    const { data, error } = await db.from("transfers").insert(transferRows.slice(i, i + CHUNK)).select("id")
    if (error) throw new Error(error.message)
    insertedT.push(...(data ?? []))
  }
  for (let i = 0; i < indentRows.length; i += CHUNK) {
    const { data, error } = await db.from("indents").insert(indentRows.slice(i, i + CHUNK)).select("id")
    if (error) throw new Error(error.message)
    insertedI.push(...(data ?? []))
  }

  // Facts for Gemini explanations (numbers come from the engine, never from the model).
  const month = new Date().toLocaleString("en-IN", { month: "long" })
  const last30 = (used: number[]) => {
    const tail = used.slice(-30)
    return tail.length ? Math.round((tail.reduce((a, b) => a + b, 0) / tail.length) * 10) / 10 : null
  }
  const explain: ExplainFact[] = []
  let ti = 0
  let ii = 0
  for (const p of proposals) {
    const m = med.get(p.medicineId)
    const receiverId = p.kind === "transfer" ? p.toId : p.facilityId
    const donorId = p.kind === "transfer" ? p.fromId : p.warehouseId
    const rp = pairByKey.get(k(receiverId, p.medicineId))
    const row = p.kind === "transfer" ? insertedT[ti++] : insertedI[ii++]
    if (!row || !m) continue
    explain.push({
      table: p.kind === "transfer" ? "transfers" : "indents",
      id: row.id,
      medicine: m.name,
      category: m.category,
      unit: m.unit,
      receiver: fac.get(receiverId)?.name ?? "",
      donor: fac.get(donorId)?.name ?? "",
      qty: p.qty,
      distanceKm: p.kind === "transfer" ? p.distanceKm : null,
      receiverStock: p.facts.receiverStock,
      receiverPdu: p.facts.receiverPdu,
      receiverDaysLeft: p.facts.receiverDaysLeft,
      last30Pdu: rp ? last30(rp.used) : null,
      yearlyRatio: rp ? rp.fc.yearlyRatio : null,
      surgeTimesBaseline: rp?.surge?.ratio ?? null,
      donorStockNow: p.facts.donorStock ?? null,
      donorDaysAfter: p.facts.donorDaysAfter ?? null,
      alternatives: p.facts.alternatives,
      month,
      template: p.reason,
    })
  }

  return {
    ...result,
    transfers_proposed: transferRows.length,
    indents_proposed: indentRows.length,
    explain,
    followUpDistrict: null,
  }
}

/** All facility ids in a scope (service role). */
export async function facilityIdsFor(scope: Scope, id: string, db: DB = createAdminClient()): Promise<string[]> {
  if (scope === "facility") return [id]
  let districtIds = [id]
  if (scope === "state") {
    const { data } = await db.from("districts").select("id").eq("state_id", id)
    districtIds = (data ?? []).map((d) => d.id)
  } else if (scope === "national") {
    const { data } = await db.from("districts").select("id")
    districtIds = (data ?? []).map((d) => d.id)
  }
  const { data } = await db.from("facilities").select("id").in("district_id", districtIds)
  return (data ?? []).map((f) => f.id)
}
