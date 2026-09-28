// Numbers people can picture. The engine works with average use per day (1.5 tablets a day is a
// fine average), but nobody hands out half a tablet: rates are shown as whole numbers per day,
// per week or per month, and days of stock as whole days.

/** The period that gives a sensible whole number for this rate. */
function period(perDay: number): { factor: number; per: "day" | "week" | "month" } {
  if (perDay >= 3) return { factor: 1, per: "day" }
  if (perDay * 7 >= 2.5) return { factor: 7, per: "week" }
  return { factor: 30, per: "month" }
}

/** "54/day", "11/week", "9/month"; "—" when there is no forecast. */
export function usageRate(perDay: number | null | undefined): string {
  if (perDay === null || perDay === undefined || !Number.isFinite(perDay)) return "—"
  if (perDay <= 0) return "0/day"
  const { factor, per } = period(perDay)
  return `${Math.max(1, Math.round(perDay * factor))}/${per}`
}

/** The likely range in the same period as the rate: "40–68/day", "8–15/week". */
export function usageRange(lower: number, upper: number, perDay: number): string {
  const { factor, per } = period(Math.max(perDay, 0.0001))
  return `${Math.round(lower * factor)}–${Math.round(upper * factor)}/${per}`
}

/** "0 days", "under 1 day", "1 day", "12 days"; "unknown" when there is no forecast. */
export function daysText(days: number | null | undefined): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return "unknown"
  if (days < 0.05) return "0 days"
  if (days < 1) return "under 1 day"
  const n = Math.round(days)
  return n === 1 ? "1 day" : `${n} days`
}

/** How long a stock line lasts, for the planner's reasons: "6 days of stock left (690 at 106/day)", or "no stock left (uses about 23/day)". */
export function stockSituation(stock: number, perDay: number | null | undefined, days: number | null | undefined): string {
  if (stock <= 0) return perDay && perDay > 0 ? `no stock left (uses about ${usageRate(perDay)})` : "no stock left"
  return `${daysText(days)} of stock left (${Math.round(stock)} at ${usageRate(perDay)})`
}
