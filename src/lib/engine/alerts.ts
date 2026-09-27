// Alert rules. Pure: turns engine facts into the set of alerts that should be live.
import type { Enums, Json } from "@/lib/database.types"
import type { SurgeCheck } from "./forecast"

export type Thresholds = { lowMultiplier: number; overstockDays: number; minAttendanceRate: number }

export type DesiredAlert = {
  facilityId: string
  medicineId: string | null
  type: Enums<"alert_type">
  severity: Enums<"alert_severity">
  daysLeft: number | null
  message: string
  /** numbers behind the alert, for the Gemini explanation */
  facts?: Json
}

export type StockFact = {
  facilityId: string
  medicineId: string
  medicineName: string
  unit: string
  stock: number
  pdu: number
  daysLeft: number | null
  resupplyDays: number
}

const fmt = (x: number) => (x < 10 ? x.toFixed(1) : Math.round(x).toString())
const fmtQty = (x: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(x)

export function stockAlerts(f: StockFact, th: Thresholds): DesiredAlert[] {
  const out: DesiredAlert[] = []
  if (f.daysLeft === null) return out
  if (f.daysLeft < f.resupplyDays * th.lowMultiplier) {
    out.push({
      facilityId: f.facilityId,
      medicineId: f.medicineId,
      type: "stockout_risk",
      severity: f.daysLeft < f.resupplyDays ? "critical" : "warning",
      daysLeft: f.daysLeft,
      message: `${f.medicineName}: ${fmtQty(f.stock)} ${f.unit}s left (~${fmt(f.daysLeft)} days at ${f.pdu.toFixed(1)}/day). Normal resupply takes ${f.resupplyDays} days.`,
    })
  } else if (f.daysLeft > th.overstockDays) {
    out.push({
      facilityId: f.facilityId,
      medicineId: f.medicineId,
      type: "overstock",
      severity: "info",
      daysLeft: f.daysLeft,
      message: `${f.medicineName}: ${fmtQty(f.stock)} ${f.unit}s on hand, about ${Math.round(f.daysLeft)} days of use. Can spare stock for nearby facilities.`,
    })
  }
  return out
}

export function staffAlert(facilityId: string, rate7d: number | null, th: Thresholds): DesiredAlert[] {
  if (rate7d === null || rate7d >= th.minAttendanceRate) return []
  return [
    {
      facilityId,
      medicineId: null,
      type: "staff_shortage",
      severity: "warning",
      daysLeft: null,
      message: `Staff attendance ${Math.round(rate7d * 100)}% over the last 7 days (threshold ${Math.round(th.minAttendanceRate * 100)}%).`,
    },
  ]
}

/** occupied / total ≥ 0.9 in each of the last 3 daily reports. */
export function bedAlert(facilityId: string, totalBeds: number, lastThreeOccupied: number[]): DesiredAlert[] {
  if (totalBeds <= 0 || lastThreeOccupied.length < 3) return []
  if (!lastThreeOccupied.every((o) => o / totalBeds >= 0.9)) return []
  return [
    {
      facilityId,
      medicineId: null,
      type: "bed_pressure",
      severity: "warning",
      daysLeft: null,
      message: `Beds ${lastThreeOccupied.map((o) => `${o}/${totalBeds}`).join(", ")} occupied in the last 3 reports (90%+ each day).`,
    },
  ]
}

export const BED_TYPE_LABEL: Record<string, string> = {
  general: "General ward",
  maternity: "Maternity",
  paediatric: "Paediatric",
  icu: "ICU",
  hdu: "HDU",
  nicu: "NICU / SNCU",
  isolation: "Isolation",
  observation: "Observation",
}
const CRITICAL_CARE = new Set(["icu", "hdu", "nicu"])

/**
 * Beds by type: one alert listing every bed type that was 90%+ full in each of its last 3 reports.
 * Critical when a critical-care type (ICU, HDU, NICU) was completely full all 3 days.
 */
export function bedTypeAlert(
  facilityId: string,
  types: { bedType: string; total: number; lastThree: number[] }[],
): DesiredAlert[] {
  const full = types.filter((t) => t.total > 0 && t.lastThree.length >= 3 && t.lastThree.every((o) => o / t.total >= 0.9))
  if (!full.length) return []
  const critical = full.some((t) => CRITICAL_CARE.has(t.bedType) && t.lastThree.every((o) => o >= t.total))
  const order = (t: { bedType: string }) => (CRITICAL_CARE.has(t.bedType) ? 0 : 1)
  const parts = [...full]
    .sort((a, b) => order(a) - order(b))
    .map((t) => `${BED_TYPE_LABEL[t.bedType] ?? t.bedType} ${t.lastThree.map((o) => `${o}/${t.total}`).join(", ")}`)
  return [
    {
      facilityId,
      medicineId: null,
      type: "bed_pressure",
      severity: critical ? "critical" : "warning",
      daysLeft: null,
      message: `${critical ? "Critical-care beds full. " : ""}Beds 90%+ occupied in the last 3 reports: ${parts.join("; ")}.`,
      facts: { bedTypes: full.map((t) => ({ type: t.bedType, total: t.total, lastThree: t.lastThree })) } as unknown as Json,
    },
  ]
}

export const alertKey = (a: { facilityId: string; medicineId: string | null; type: string }) =>
  `${a.facilityId}:${a.medicineId ?? "-"}:${a.type}`

// ---------------------------------------------------------------------------------------------
// Surges (early warning during outbreaks)
// ---------------------------------------------------------------------------------------------

export type SurgeContext = {
  facilityId: string
  facilityName: string
  medicineId: string
  medicineName: string
  unit: string
  category: string
  /** facility footfall surge, if any (last-3-day ÷ baseline) */
  footfallRatio: number | null
}

export function surgeAlert(c: SurgeContext, s: SurgeCheck): DesiredAlert {
  const perDay = s.last3.reduce((a, b) => a + b, 0) / 3
  return {
    facilityId: c.facilityId,
    medicineId: c.medicineId,
    type: "demand_surge",
    severity: "critical",
    daysLeft: null,
    message:
      `${c.medicineName}: ${fmt(perDay)} ${c.unit}s/day over the last 3 days, against about ${fmt(s.expected)} expected ` +
      `(${s.ratio.toFixed(1)}× the usual ${fmt(s.baseline)}/day).` +
      (c.footfallRatio ? ` Patient footfall is up ${Math.round((c.footfallRatio - 1) * 100)}%.` : ""),
    facts: {
      kind: "demand_surge",
      facility: c.facilityName,
      medicine: c.medicineName,
      category: c.category,
      unit: c.unit,
      last3Days: s.last3,
      expectedPerDay: s.expected,
      upperBandPerDay: s.upper,
      baselinePerDay: s.baseline,
      timesBaseline: s.ratio,
      trigger: s.reason,
      footfallTimesBaseline: c.footfallRatio,
    },
  }
}

export function footfallSurgeAlert(facilityId: string, facilityName: string, s: SurgeCheck): DesiredAlert {
  const perDay = s.last3.reduce((a, b) => a + b, 0) / 3
  return {
    facilityId,
    medicineId: null,
    type: "demand_surge",
    severity: "warning",
    daysLeft: null,
    message:
      `Patient footfall ${Math.round(perDay)}/day over the last 3 days, ${s.ratio.toFixed(1)}× the usual ${Math.round(s.baseline)}. ` +
      `Fever and diarrhoea medicines are being watched more closely.`,
    facts: { kind: "footfall_surge", facility: facilityName, last3Days: s.last3, baselinePerDay: s.baseline, timesBaseline: s.ratio },
  }
}

// ---------------------------------------------------------------------------------------------
// Expiry (90 / 60 / 30 days)
// ---------------------------------------------------------------------------------------------

export type ExpiryFact = {
  facilityId: string
  medicineId: string
  medicineName: string
  unit: string
  batchNo: string
  qty: number
  expiryDate: string
  daysToExpiry: number
  pdu: number | null
}

export function expiryAlert(e: ExpiryFact): DesiredAlert[] {
  if (e.daysToExpiry > 90 || e.daysToExpiry < 0 || e.qty <= 0) return []
  const usable = e.pdu !== null ? Math.min(e.qty, Math.floor(e.pdu * e.daysToExpiry)) : null
  const band = e.daysToExpiry <= 30 ? 30 : e.daysToExpiry <= 60 ? 60 : 90
  // a batch that will be used up in time is recorded quietly (info); only waste risk warns and notifies
  const wasteRisk = usable === null || usable < e.qty
  return [
    {
      facilityId: e.facilityId,
      medicineId: e.medicineId,
      type: "expiry_risk",
      severity: !wasteRisk ? "info" : band === 30 ? "critical" : "warning",
      daysLeft: e.daysToExpiry,
      message:
        `${e.medicineName}: batch ${e.batchNo} (${fmtQty(e.qty)} ${e.unit}s) expires on ${e.expiryDate}, within ${band} days.` +
        (usable !== null
          ? usable >= e.qty
            ? " It will be used up before then."
            : ` At the current rate only about ${fmtQty(usable)} will be used before then.`
          : ""),
      facts: { kind: "expiry", batch: e.batchNo, qty: e.qty, expiry: e.expiryDate, daysToExpiry: e.daysToExpiry, usableBeforeExpiry: usable },
    },
  ]
}
