import { daysText } from "@/lib/rate"
import { format, formatDistanceToNowStrict, isThisYear, parseISO } from "date-fns"

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 })
const inr1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 })

/** Indian grouping: 1,23,456 */
export function formatNumber(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return decimals > 0 ? inr1.format(n) : inr.format(Math.round(n))
}

/** "23 Sep", or "23 Sep 2025" when not the current year */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? parseISO(value) : value
  return isThisYear(d) ? format(d, "d MMM") : format(d, "d MMM yyyy")
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? parseISO(value) : value
  return `${formatDate(d)}, ${format(d, "HH:mm")}`
}

/** One decimal under 10 days, whole numbers above, "Out of stock" at 0. */
export function formatDaysLeft(days: number | null | undefined): string {
  if (days === null || days === undefined) return "No forecast"
  if (days < 0.05) return "Out of stock"
  return daysText(days)
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return "—"
  return `${Math.round(rate * 100)}%`
}

/** "5 minutes ago"; clamps small clock skew between the database and the browser to "just now". */
export function timeAgo(value: string | Date): string {
  const d = typeof value === "string" ? parseISO(value) : value
  if (Date.now() - d.getTime() < 60_000) return "just now"
  return formatDistanceToNowStrict(d, { addSuffix: true })
}
