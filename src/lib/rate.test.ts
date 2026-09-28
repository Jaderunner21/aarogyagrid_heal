import { describe, expect, it } from "vitest"
import { daysText, stockSituation, usageRange, usageRate } from "./rate"

describe("usageRate", () => {
  it("whole numbers in a period people can picture", () => {
    expect(usageRate(53.8)).toBe("54/day")
    expect(usageRate(4.9)).toBe("5/day")
    expect(usageRate(1.5)).toBe("11/week")
    expect(usageRate(0.7)).toBe("5/week")
    expect(usageRate(0.2)).toBe("6/month")
    expect(usageRate(0.01)).toBe("1/month")
    expect(usageRate(0)).toBe("0/day")
    expect(usageRate(null)).toBe("—")
  })
  it("ranges in the same period", () => {
    expect(usageRange(1.2, 2.0, 1.5)).toBe("8–14/week")
    expect(usageRange(40.2, 67.9, 53.8)).toBe("40–68/day")
  })
})

describe("daysText", () => {
  it("whole days", () => {
    expect(daysText(0)).toBe("0 days")
    expect(daysText(0.4)).toBe("under 1 day")
    expect(daysText(1.4)).toBe("1 day")
    expect(daysText(12.6)).toBe("13 days")
    expect(daysText(null)).toBe("unknown")
  })
  it("says out of stock plainly", () => {
    expect(stockSituation(0, 23.2, 0)).toBe("no stock left (uses about 23/day)")
    expect(stockSituation(690, 106, 6.5)).toBe("7 days of stock left (690 at 106/day)")
  })
})
