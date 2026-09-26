import type { DictKey } from "@/lib/i18n"

export type StockStatus = "critical" | "low" | "ok" | "overstock" | "unknown"

export const STATUS_ORDER: StockStatus[] = ["critical", "low", "ok", "overstock", "unknown"]

export const STATUS_META: Record<
  StockStatus,
  { label: string; key: DictKey; color: string; text: string; bg: string; soft: string; border: string }
> = {
  critical: {
    label: "Critical",
    key: "status.critical",
    color: "#DC2626",
    text: "text-critical",
    bg: "bg-critical",
    soft: "bg-red-50",
    border: "border-red-200",
  },
  low: {
    label: "Low",
    key: "status.low",
    color: "#D97706",
    text: "text-low",
    bg: "bg-low",
    soft: "bg-amber-50",
    border: "border-amber-200",
  },
  ok: {
    label: "OK",
    key: "status.ok",
    color: "#16A34A",
    text: "text-ok",
    bg: "bg-ok",
    soft: "bg-green-50",
    border: "border-green-200",
  },
  overstock: {
    label: "Overstock",
    key: "status.overstock",
    color: "#2563EB",
    text: "text-overstock",
    bg: "bg-overstock",
    soft: "bg-blue-50",
    border: "border-blue-200",
  },
  unknown: {
    label: "No forecast",
    key: "status.unknown",
    color: "#94A3B8",
    text: "text-unknown",
    bg: "bg-unknown",
    soft: "bg-slate-50",
    border: "border-slate-200",
  },
}

export function toStatus(value: string | null | undefined): StockStatus {
  return value === "critical" || value === "low" || value === "ok" || value === "overstock" ? value : "unknown"
}

/** Same buckets as v_stock_status. */
export function statusFor(daysLeft: number | null | undefined, resupplyDays: number): StockStatus {
  if (daysLeft === null || daysLeft === undefined) return "unknown"
  if (daysLeft < resupplyDays) return "critical"
  if (daysLeft < resupplyDays * 2) return "low"
  if (daysLeft > 90) return "overstock"
  return "ok"
}

/** Sort key: most urgent first, unknown last. */
export function urgency(status: StockStatus, daysLeft: number | null | undefined): number {
  const rank = STATUS_ORDER.indexOf(status)
  return rank * 10_000 + Math.min(daysLeft ?? 9_999, 9_999)
}

export const TRANSFER_STEPS = ["proposed", "approved", "dispatched", "received"] as const
export const INDENT_STEPS = ["submitted", "approved", "dispatched", "received"] as const

export const CARRIER_LABEL: Record<string, string> = {
  warehouse_vehicle: "Warehouse vehicle",
  facility_staff: "Facility staff",
  courier: "Courier",
  other: "Other",
}
