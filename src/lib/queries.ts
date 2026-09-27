// Read models shared by server components (user-session client) and client components (browser client).
// Every read goes through the caller's RLS.
import type { SupabaseClient } from "@supabase/supabase-js"
import { subDays, format } from "date-fns"
import type { Database, Enums, ItemType, Json, Tables, Tier, Views } from "@/lib/database.types"
import { toStatus, type StockStatus } from "@/lib/status"

export type DB = SupabaseClient<Database>

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v))
const num = (v: number | null | undefined) => Number(v ?? 0)

// ---------------------------------------------------------------- stock
export type StockRow = {
  facilityId: string
  facilityName: string
  facilityType: Enums<"facility_type">
  facilityCode: string
  districtId: string
  districtName: string
  lat: number
  lng: number
  medicineId: string
  medicineName: string
  unit: string
  category: string
  quantity: number
  pdu: number | null
  lower: number | null
  upper: number | null
  daysLeft: number | null
  stockoutDate: string | null
  mape: number | null
  forecastAt: string | null
  resupplyDays: number
  status: StockStatus
  medicineStatus: "active" | "discontinued" | "withdrawn"
  isChronic: boolean
  method: string | null
  seasonalitySource: string | null
  footfallWeight: number | null
  surge: boolean
  itemType: ItemType
  program: string | null
  tier: Tier
}

export function toStockRow(r: Views<"v_stock_status">): StockRow {
  return {
    facilityId: r.facility_id!,
    facilityName: r.facility_name ?? "",
    facilityType: r.facility_type ?? "phc",
    facilityCode: r.facility_code ?? "",
    districtId: r.district_id!,
    districtName: r.district_name ?? "",
    lat: num(r.lat),
    lng: num(r.lng),
    medicineId: r.medicine_id!,
    medicineName: r.medicine_name ?? "",
    unit: r.unit ?? "",
    category: r.category ?? "",
    quantity: num(r.quantity),
    pdu: n(r.predicted_daily_use),
    lower: n(r.lower_daily),
    upper: n(r.upper_daily),
    daysLeft: n(r.days_left),
    stockoutDate: r.stockout_date,
    mape: n(r.mape),
    forecastAt: r.forecast_at,
    resupplyDays: num(r.resupply_days) || 7,
    status: toStatus(r.status),
    medicineStatus: (r.medicine_status as StockRow["medicineStatus"]) ?? "active",
    isChronic: Boolean(r.is_chronic),
    method: r.method,
    seasonalitySource: r.seasonality_source,
    footfallWeight: n(r.footfall_weight),
    surge: Boolean(r.surge),
    itemType: r.item_type ?? "medicine",
    program: r.program ?? null,
    tier: r.tier ?? "phc_day",
  }
}

export async function getStock(
  db: DB,
  filter: { facilityId?: string; districtId?: string; stateId?: string; facilityType?: Enums<"facility_type"> } = {},
): Promise<StockRow[]> {
  let q = db.from("v_stock_status").select("*")
  if (filter.stateId) q = q.eq("state_id", filter.stateId)
  if (filter.facilityId) q = q.eq("facility_id", filter.facilityId)
  if (filter.districtId) q = q.eq("district_id", filter.districtId)
  if (filter.facilityType) q = q.eq("facility_type", filter.facilityType)
  // PostgREST caps a response at 1000 rows: page through (the national view has ~600+ lines and grows)
  const out: StockRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q.order("facility_id").order("medicine_name").range(from, from + 999)
    if (error) throw error
    out.push(...data.map(toStockRow))
    if (data.length < 1000) break
  }
  return out
}

// ---------------------------------------------------------------- outbreaks & surges
export type Outbreak = Tables<"outbreaks"> & { districtName: string; stateId: string | null }

export async function getOutbreaks(db: DB, filter: { districtIds?: string[]; status?: "open" | "resolved" } = {}): Promise<Outbreak[]> {
  let q = db.from("outbreaks").select("*").eq("status", filter.status ?? "open")
  if (filter.districtIds) q = q.in("district_id", filter.districtIds)
  const [{ data, error }, districts] = await Promise.all([q.order("detected_at", { ascending: false }), db.from("districts").select("id, name, state_id")])
  if (error) throw error
  const d = new Map((districts.data ?? []).map((x) => [x.id, x]))
  return data.map((o) => ({ ...o, districtName: d.get(o.district_id)?.name ?? "", stateId: d.get(o.district_id)?.state_id ?? null }))
}

// ---------------------------------------------------------------- facilities
export type FacilitySummary = {
  id: string
  name: string
  type: Enums<"facility_type">
  code: string
  lat: number
  lng: number
  totalBeds: number
  resupplyDays: number
  districtId: string
  districtName: string
  critical: number
  low: number
  ok: number
  overstock: number
  minDaysLeft: number | null
  openAlerts: number
  occupiedBeds: number | null
  lastFootfall: number | null
  attendance7d: number | null
  status: StockStatus
  openSurges: number
  tier: Tier
  phc24x7: boolean
  hfrId: string | null
  laqshya: boolean
  supplierId: string | null
  criticalBedsTotal: number
  criticalBedsOccupied: number
}

const hasLaqshya = (ext: Json | null | undefined) =>
  Boolean(ext && typeof ext === "object" && !Array.isArray(ext) && "laqshya" in ext)

export async function getFacilitySummaries(
  db: DB,
  filter: { districtId?: string; stateId?: string } = {},
): Promise<FacilitySummary[]> {
  let q = db.from("v_facility_summary").select("*")
  if (filter.districtId) q = q.eq("district_id", filter.districtId)
  if (filter.stateId) q = q.eq("state_id", filter.stateId)
  const { data, error } = await q.order("name")
  if (error) throw error
  return data.map((r) => ({
    id: r.facility_id!,
    name: r.name ?? "",
    type: r.type ?? "phc",
    code: r.code ?? "",
    lat: num(r.lat),
    lng: num(r.lng),
    totalBeds: num(r.total_beds),
    resupplyDays: num(r.resupply_days) || 7,
    districtId: r.district_id!,
    districtName: r.district_name ?? "",
    critical: num(r.critical_count),
    low: num(r.low_count),
    ok: num(r.ok_count),
    overstock: num(r.overstock_count),
    minDaysLeft: n(r.min_days_left),
    openAlerts: num(r.open_alerts),
    occupiedBeds: n(r.occupied_beds),
    lastFootfall: n(r.last_footfall),
    attendance7d: n(r.attendance_rate_7d),
    status: toStatus(r.overall_status),
    openSurges: num(r.open_surges),
    tier: r.tier ?? "phc_day",
    phc24x7: Boolean(r.phc_24x7),
    hfrId: r.hfr_id ?? null,
    laqshya: hasLaqshya(r.hfr_extensions),
    supplierId: r.supplying_warehouse ?? null,
    criticalBedsTotal: num(r.critical_beds_total),
    criticalBedsOccupied: num(r.critical_beds_occupied),
  }))
}

// ---------------------------------------------------------------- beds by type
export type BedsByType = { bedType: Tables<"facility_beds">["bed_type"]; total: number; occupied: number | null }

/** A facility's beds by type with the latest reported occupancy of each. */
export async function getBedsByType(db: DB, facilityId: string): Promise<BedsByType[]> {
  const [beds, occ] = await Promise.all([
    db.from("facility_beds").select("bed_type, total").eq("facility_id", facilityId),
    db.from("daily_bed_occupancy").select("bed_type, occupied, report_date").eq("facility_id", facilityId)
      .gte("report_date", format(subDays(new Date(), 7), "yyyy-MM-dd")).order("report_date", { ascending: false }),
  ])
  const order = ["icu", "hdu", "nicu", "general", "maternity", "paediatric", "isolation", "observation"]
  return (beds.data ?? [])
    .map((b) => ({ bedType: b.bed_type, total: b.total, occupied: (occ.data ?? []).find((o) => o.bed_type === b.bed_type)?.occupied ?? null }))
    .sort((a, b) => order.indexOf(a.bedType) - order.indexOf(b.bedType))
}

export type DistrictSummary = {
  id: string
  name: string
  stateId: string
  facilities: number
  facilitiesCritical: number
  criticalItems: number
  lowItems: number
  overstockItems: number
  openAlerts: number
  transfersPending: number
  indentsPending: number
  attendance7d: number | null
}

export async function getDistrictSummaries(db: DB): Promise<DistrictSummary[]> {
  const { data, error } = await db.from("v_district_summary").select("*").order("name")
  if (error) throw error
  return data.map((r) => ({
    id: r.district_id!,
    name: r.name ?? "",
    stateId: r.state_id ?? "",
    facilities: num(r.facilities),
    facilitiesCritical: num(r.facilities_critical),
    criticalItems: num(r.critical_items),
    lowItems: num(r.low_items),
    overstockItems: num(r.overstock_items),
    openAlerts: num(r.open_alerts),
    transfersPending: num(r.transfers_pending),
    indentsPending: num(r.indents_pending),
    attendance7d: n(r.attendance_rate_7d),
  }))
}

// ---------------------------------------------------------------- transfers & indents
export type TransferView = {
  kind: "transfer"
  id: string
  medicineId: string
  medicineName: string
  unit: string
  fromId: string
  fromName: string
  fromType: Enums<"facility_type">
  fromDistrictId: string
  fromLat: number
  fromLng: number
  toId: string
  toName: string
  toDistrictId: string
  toLat: number
  toLng: number
  qty: number
  distanceKm: number | null
  isCrossDistrict: boolean
  origin: Enums<"origin_type">
  priority: number
  status: Enums<"transfer_status">
  aiReason: string | null
  aiGenerated: boolean
  rejectedReason: string | null
  carrierType: Enums<"carrier_type"> | null
  carrierName: string | null
  carrierContact: string | null
  approvedByName: string | null
  approvedAt: string | null
  dispatchedAt: string | null
  receivedAt: string | null
  receivedQty: number | null
  createdAt: string
}

function toTransfer(r: Views<"v_transfers">): TransferView {
  return {
    kind: "transfer",
    id: r.id!,
    medicineId: r.medicine_id!,
    medicineName: r.medicine_name ?? "",
    unit: r.unit ?? "",
    fromId: r.from_facility_id!,
    fromName: r.from_name ?? "",
    fromType: r.from_type ?? "phc",
    fromDistrictId: r.from_district_id!,
    fromLat: num(r.from_lat),
    fromLng: num(r.from_lng),
    toId: r.to_facility_id!,
    toName: r.to_name ?? "",
    toDistrictId: r.to_district_id!,
    toLat: num(r.to_lat),
    toLng: num(r.to_lng),
    qty: num(r.qty),
    distanceKm: n(r.distance_km),
    isCrossDistrict: Boolean(r.is_cross_district),
    origin: r.origin ?? "ai",
    priority: num(r.priority) || 2,
    status: r.status ?? "proposed",
    aiReason: r.ai_reason,
    aiGenerated: Boolean(r.ai_generated_at),
    rejectedReason: r.rejected_reason,
    carrierType: r.carrier_type,
    carrierName: r.carrier_name,
    carrierContact: r.carrier_contact,
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at,
    dispatchedAt: r.dispatched_at,
    receivedAt: r.received_at,
    receivedQty: n(r.received_qty),
    createdAt: r.created_at ?? "",
  }
}

export async function getTransfers(
  db: DB,
  filter: {
    facilityId?: string
    fromFacilityId?: string
    toFacilityId?: string
    districtId?: string
    status?: Enums<"transfer_status">[]
    crossDistrictOnly?: boolean
  } = {},
): Promise<TransferView[]> {
  let q = db.from("v_transfers").select("*")
  if (filter.facilityId) q = q.or(`from_facility_id.eq.${filter.facilityId},to_facility_id.eq.${filter.facilityId}`)
  if (filter.fromFacilityId) q = q.eq("from_facility_id", filter.fromFacilityId)
  if (filter.toFacilityId) q = q.eq("to_facility_id", filter.toFacilityId)
  if (filter.districtId) q = q.or(`from_district_id.eq.${filter.districtId},to_district_id.eq.${filter.districtId}`)
  if (filter.status) q = q.in("status", filter.status)
  if (filter.crossDistrictOnly) q = q.eq("is_cross_district", true)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500)
  if (error) throw error
  return data.map(toTransfer)
}

export type IndentView = {
  kind: "indent"
  id: string
  facilityId: string
  facilityName: string
  districtId: string
  warehouseId: string
  warehouseName: string
  medicineId: string
  medicineName: string
  unit: string
  qtyRequested: number
  qtyApproved: number | null
  origin: Enums<"origin_type">
  status: Enums<"indent_status">
  aiReason: string | null
  aiGenerated: boolean
  note: string | null
  rejectedReason: string | null
  carrierType: Enums<"carrier_type"> | null
  carrierName: string | null
  raisedByName: string | null
  approvedByName: string | null
  approvedAt: string | null
  dispatchedAt: string | null
  receivedAt: string | null
  receivedQty: number | null
  createdAt: string
  /** raised by PHC staff and waiting for the PHC's medical officer to sign off */
  awaitingMo: boolean
  moDecidedByName: string | null
}

function toIndent(r: Views<"v_indents">): IndentView {
  return {
    kind: "indent",
    id: r.id!,
    facilityId: r.facility_id!,
    facilityName: r.facility_name ?? "",
    districtId: r.district_id!,
    warehouseId: r.warehouse_id!,
    warehouseName: r.warehouse_name ?? "",
    medicineId: r.medicine_id!,
    medicineName: r.medicine_name ?? "",
    unit: r.unit ?? "",
    qtyRequested: num(r.qty_requested),
    qtyApproved: n(r.qty_approved),
    origin: r.origin ?? "manual",
    status: r.status ?? "submitted",
    aiReason: r.ai_reason,
    aiGenerated: Boolean(r.ai_generated_at),
    note: r.note,
    rejectedReason: r.rejected_reason,
    carrierType: r.carrier_type,
    carrierName: r.carrier_name,
    raisedByName: r.raised_by_name,
    approvedByName: r.approved_by_name,
    approvedAt: r.approved_at,
    dispatchedAt: r.dispatched_at,
    receivedAt: r.received_at,
    receivedQty: n(r.received_qty),
    createdAt: r.created_at ?? "",
    awaitingMo: r.awaiting_mo ?? false,
    moDecidedByName: r.mo_decided_by_name ?? null,
  }
}

export async function getIndents(
  db: DB,
  filter: { facilityId?: string; warehouseId?: string; districtId?: string; status?: Enums<"indent_status">[] } = {},
): Promise<IndentView[]> {
  let q = db.from("v_indents").select("*")
  if (filter.facilityId) q = q.eq("facility_id", filter.facilityId)
  if (filter.warehouseId) q = q.eq("warehouse_id", filter.warehouseId)
  if (filter.districtId) q = q.eq("district_id", filter.districtId)
  if (filter.status) q = q.in("status", filter.status)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(500)
  if (error) throw error
  return data.map(toIndent)
}

// ---------------------------------------------------------------- recommendations
export type Recommendation = (TransferView | IndentView) & {
  receiverDaysLeft: number | null
  receiverStock: number | null
  receiverPdu: number | null
  donorDaysAfter: number | null
}

/** Adds receiver days-left and donor days-after-transfer from stock rows the caller can see. */
export function enrich(items: (TransferView | IndentView)[], stock: StockRow[]): Recommendation[] {
  const byKey = new Map(stock.map((s) => [`${s.facilityId}:${s.medicineId}`, s]))
  return items.map((it) => {
    const receiverId = it.kind === "transfer" ? it.toId : it.facilityId
    const donorId = it.kind === "transfer" ? it.fromId : it.warehouseId
    const qty = it.kind === "transfer" ? it.qty : (it.qtyApproved ?? it.qtyRequested)
    const receiver = byKey.get(`${receiverId}:${it.medicineId}`)
    const donor = byKey.get(`${donorId}:${it.medicineId}`)
    const donorDaysAfter =
      donor && donor.pdu && donor.pdu > 0 ? Math.max(0, (donor.quantity - qty) / donor.pdu) : null
    return {
      ...it,
      receiverDaysLeft: receiver?.daysLeft ?? null,
      receiverStock: receiver?.quantity ?? null,
      receiverPdu: receiver?.pdu ?? null,
      donorDaysAfter,
    }
  })
}

/** Most urgent first: priority, then receiver days-left, then newest. */
export function sortRecommendations<T extends Recommendation>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const pa = a.kind === "transfer" ? a.priority : 2
    const pb = b.kind === "transfer" ? b.priority : 2
    if (pa !== pb) return pa - pb
    const da = a.receiverDaysLeft ?? 999
    const dbb = b.receiverDaysLeft ?? 999
    if (da !== dbb) return da - dbb
    return b.createdAt.localeCompare(a.createdAt)
  })
}

// ---------------------------------------------------------------- alerts
export type AlertView = Tables<"alerts"> & { facilityName: string; medicineName: string | null; unit: string | null }

export async function getAlerts(
  db: DB,
  filter: { facilityIds?: string[]; statuses?: Enums<"alert_status">[]; includeInfo?: boolean } = {},
): Promise<AlertView[]> {
  let q = db.from("alerts").select("*")
  if (filter.facilityIds) q = q.in("facility_id", filter.facilityIds)
  q = q.in("status", filter.statuses ?? ["open", "acknowledged"])
  if (!filter.includeInfo) q = q.neq("severity", "info")
  const [alerts, facilities, medicines] = await Promise.all([
    q.order("created_at", { ascending: false }).limit(300),
    db.from("facilities").select("id, name"),
    db.from("medicines").select("id, name, unit"),
  ])
  if (alerts.error) throw alerts.error
  const fac = new Map((facilities.data ?? []).map((f) => [f.id, f.name]))
  const med = new Map((medicines.data ?? []).map((m) => [m.id, m]))
  const sevRank = { critical: 0, warning: 1, info: 2 } as const
  return alerts.data
    .map((a) => ({
      ...a,
      facilityName: fac.get(a.facility_id) ?? "",
      medicineName: a.medicine_id ? (med.get(a.medicine_id)?.name ?? null) : null,
      unit: a.medicine_id ? (med.get(a.medicine_id)?.unit ?? null) : null,
    }))
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.created_at.localeCompare(a.created_at))
}

// ---------------------------------------------------------------- directory
export async function getMedicines(db: DB) {
  const { data, error } = await db.from("medicines").select("*").order("name")
  if (error) throw error
  return data
}

export async function getFacilities(db: DB, filter: { districtId?: string; stateDistrictIds?: string[] } = {}) {
  let q = db.from("facilities").select("*").eq("is_active", true)
  if (filter.districtId) q = q.eq("district_id", filter.districtId)
  if (filter.stateDistrictIds) q = q.in("district_id", filter.stateDistrictIds)
  const { data, error } = await q.order("name")
  if (error) throw error
  return data
}

export async function getDistricts(db: DB, stateId?: string) {
  let q = db.from("districts").select("*")
  if (stateId) q = q.eq("state_id", stateId)
  const { data, error } = await q.order("name")
  if (error) throw error
  return data
}

// ---------------------------------------------------------------- forecast detail
export type SeriesPoint = { date: string; yhat: number; lower: number; upper: number }

export function parseSeries(json: Json | null): SeriesPoint[] | null {
  if (!Array.isArray(json)) return null
  const out: SeriesPoint[] = []
  for (const p of json) {
    if (p && typeof p === "object" && !Array.isArray(p) && typeof p.date === "string") {
      out.push({
        date: p.date,
        yhat: Number(p.yhat ?? 0),
        lower: Number(p.lower ?? 0),
        upper: Number(p.upper ?? 0),
      })
    }
  }
  return out.length ? out : null
}

export type ForecastDetail = {
  stock: StockRow | null
  forecast: Tables<"forecasts"> | null
  series: SeriesPoint[] | null
  history: { date: string; used: number; received: number; out: number }[]
  /** the demand driver per day: patient footfall, or occupied (critical-care) beds for oxygen */
  footfall: { date: string; footfall: number }[]
  driver: "patients" | "beds"
  log: Tables<"stock_log">[]
  alert: Tables<"alerts"> | null
}

/** One facility x one medicine: last 90 days of history plus the forecast (never bulk stock_log). */
export async function getForecastDetail(db: DB, facilityId: string, medicineId: string): Promise<ForecastDetail> {
  const since = format(subDays(new Date(), 90), "yyyy-MM-dd")
  const [stock, forecast, log, alert, reports] = await Promise.all([
    db.from("v_stock_status").select("*").eq("facility_id", facilityId).eq("medicine_id", medicineId).maybeSingle(),
    db.from("forecasts").select("*").eq("facility_id", facilityId).eq("medicine_id", medicineId).maybeSingle(),
    db
      .from("stock_log")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("medicine_id", medicineId)
      .gte("log_date", since)
      .order("log_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(1000),
    db
      .from("alerts")
      .select("*")
      .eq("facility_id", facilityId)
      .eq("medicine_id", medicineId)
      .eq("type", "stockout_risk")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("daily_reports").select("report_date, footfall, occupied_beds").eq("facility_id", facilityId).gte("report_date", since).order("report_date"),
  ])
  const oxygen = stock.data?.item_type === "oxygen"
  let driverRows = (reports.data ?? []).map((r) => ({ date: r.report_date, footfall: oxygen ? r.occupied_beds : r.footfall }))
  if (oxygen) {
    const { data: crit } = await db
      .from("daily_bed_occupancy")
      .select("report_date, occupied")
      .eq("facility_id", facilityId)
      .in("bed_type", ["icu", "hdu", "nicu"])
      .gte("report_date", since)
    if (crit?.length) {
      const byDate = new Map<string, number>()
      for (const c of crit) byDate.set(c.report_date, (byDate.get(c.report_date) ?? 0) + c.occupied)
      driverRows = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, footfall]) => ({ date, footfall }))
    }
  }

  const byDay = new Map<string, { used: number; received: number; out: number }>()
  for (const l of log.data ?? []) {
    const d = byDay.get(l.log_date) ?? { used: 0, received: 0, out: 0 }
    d.used += Number(l.qty_used)
    d.received += Number(l.qty_received)
    d.out += Number(l.qty_out)
    byDay.set(l.log_date, d)
  }
  const history: ForecastDetail["history"] = []
  for (let i = 90; i >= 1; i--) {
    const date = format(subDays(new Date(), i), "yyyy-MM-dd")
    history.push({ date, ...(byDay.get(date) ?? { used: 0, received: 0, out: 0 }) })
  }
  const today = format(new Date(), "yyyy-MM-dd")
  if (byDay.has(today)) history.push({ date: today, ...byDay.get(today)! })

  return {
    stock: stock.data ? toStockRow(stock.data) : null,
    forecast: forecast.data ?? null,
    series: parseSeries(forecast.data?.series ?? null),
    history,
    footfall: driverRows,
    driver: oxygen ? "beds" : "patients",
    log: (log.data ?? []).filter((l) => l.log_date >= format(subDays(new Date(), 30), "yyyy-MM-dd")),
    alert: alert.data ?? null,
  }
}

// ---------------------------------------------------------------- requests for medicines not on the list
export type MedicineRequestView = {
  id: string
  facilityId: string
  facilityName: string
  districtId: string
  districtName: string
  stateId: string
  stateName: string
  requestedBy: string
  requestedByName: string
  requestedByPosition: "staff" | "medical_officer"
  medicineName: string
  strength: string | null
  unit: string
  category: string | null
  isChronic: boolean
  monthlyQty: number | null
  reason: string
  status: "with_district" | "with_state" | "approved" | "rejected" | "cancelled"
  districtByName: string | null
  districtAt: string | null
  districtNote: string | null
  stateByName: string | null
  stateAt: string | null
  stateNote: string | null
  medicineId: string | null
  linkedMedicineName: string | null
  createdAt: string
}

/** Requests the caller can see (RLS: own PHC, own district, own state, or all for national). */
export async function getMedicineRequests(
  db: DB,
  filter: { facilityId?: string; districtId?: string; stateId?: string; statuses?: MedicineRequestView["status"][] } = {},
): Promise<MedicineRequestView[]> {
  let q = db.from("v_medicine_requests").select("*")
  if (filter.facilityId) q = q.eq("facility_id", filter.facilityId)
  if (filter.districtId) q = q.eq("district_id", filter.districtId)
  if (filter.stateId) q = q.eq("state_id", filter.stateId)
  if (filter.statuses) q = q.in("status", filter.statuses)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200)
  if (error) {
    // before migration 004 has been run the view does not exist yet: show nothing rather than break the page
    if (/v_medicine_requests|does not exist|schema cache/i.test(error.message)) return []
    throw error
  }
  return data.map((r) => ({
    id: r.id!,
    facilityId: r.facility_id!,
    facilityName: r.facility_name ?? "",
    districtId: r.district_id!,
    districtName: r.district_name ?? "",
    stateId: r.state_id!,
    stateName: r.state_name ?? "",
    requestedBy: r.requested_by!,
    requestedByName: r.requested_by_name ?? "",
    requestedByPosition: r.requested_by_position ?? "staff",
    medicineName: r.medicine_name ?? "",
    strength: r.strength,
    unit: r.unit ?? "",
    category: r.category,
    isChronic: r.is_chronic ?? false,
    monthlyQty: r.monthly_qty === null ? null : Number(r.monthly_qty),
    reason: r.reason ?? "",
    status: r.status ?? "with_district",
    districtByName: r.district_by_name,
    districtAt: r.district_at,
    districtNote: r.district_note,
    stateByName: r.state_by_name,
    stateAt: r.state_at,
    stateNote: r.state_note,
    medicineId: r.medicine_id,
    linkedMedicineName: r.linked_medicine_name,
    createdAt: r.created_at ?? "",
  }))
}
