import { describe, expect, it } from "vitest"
import { computeDaysLeft, detectSurge, forecastSeries, missingMask, yearlyRatio, type SeriesInput } from "./forecast"

const TODAY = "2026-09-24"

function series(used: number[], opts: Partial<SeriesInput> = {}): SeriesInput {
  const n = used.length
  return {
    used,
    received: opts.received ?? new Array(n).fill(0),
    outflow: opts.outflow ?? new Array(n).fill(0),
    reported: opts.reported ?? new Array(n).fill(true),
    stock: opts.stock ?? 100_000,
    stockAtSeriesEnd: opts.stockAtSeriesEnd,
    isWarehouse: opts.isWarehouse ?? false,
  }
}

describe("forecastSeries", () => {
  it("forecasts a flat series roughly flat", () => {
    const r = forecastSeries(series(new Array(200).fill(50)), TODAY)
    expect(r.method).toBe("holt_winters_yearly_adj")
    expect(r.predictedDailyUse).toBeGreaterThan(47)
    expect(r.predictedDailyUse).toBeLessThan(53)
    const spread = Math.max(...r.yhat) - Math.min(...r.yhat)
    expect(spread).toBeLessThan(5)
    expect(r.series).toHaveLength(30)
    expect(r.series[0].date).toBe("2026-09-25")
  })

  it("reproduces a weekly pattern", () => {
    const week = [60, 60, 60, 60, 60, 20, 20]
    const used = Array.from({ length: 196 }, (_, i) => week[i % 7])
    const r = forecastSeries(series(used), TODAY)
    // The next 7 forecast days continue the cycle: index 196 is weekday 0.
    for (let h = 0; h < 7; h++) {
      const expected = week[(196 + h) % 7]
      expect(Math.abs(r.yhat[h] - expected)).toBeLessThan(8)
    }
  })

  it("does not let a stock-out gap pull the forecast down", () => {
    const n = 200
    const used = new Array(n).fill(50)
    for (let i = n - 12; i < n; i++) used[i] = 0 // shelves empty: nothing could be given out
    const withGap = forecastSeries(series(used, { stock: 0 }), TODAY)
    expect(missingMask(series(used, { stock: 0 })).slice(-12).every(Boolean)).toBe(true)
    expect(withGap.predictedDailyUse).toBeGreaterThan(45)
    expect(withGap.daysLeft).toBe(0)
  })

  it("still sees the stock-out when stock arrived today", () => {
    const n = 200
    const used = new Array(n).fill(50)
    for (let i = n - 12; i < n; i++) used[i] = 0
    // 500 arrived today: current stock is 500, but the series ended at 0.
    const r = forecastSeries(series(used, { stock: 500, stockAtSeriesEnd: 0 }), TODAY)
    expect(r.predictedDailyUse).toBeGreaterThan(45)
    expect(r.daysLeft).toBeGreaterThan(8)
    expect(r.daysLeft).toBeLessThan(12)
  })

  it("treats days with no report as missing, not zero use", () => {
    const n = 200
    const used = new Array(n).fill(40)
    const reported = new Array(n).fill(true)
    for (let i = n - 30; i < n; i += 2) {
      used[i] = 0
      reported[i] = false
    }
    const r = forecastSeries(series(used, { reported }), TODAY)
    expect(r.predictedDailyUse).toBeGreaterThan(36)
  })

  it("raises the forecast when last year's ratio is above 1", () => {
    const n = 425
    const base = new Array(n).fill(20)
    const seasonal = [...base]
    const t = n - 1
    // Last year, demand tripled going into this period.
    for (let i = t - 365 + 1; i <= t - 365 + 30; i++) seasonal[i] = 60
    expect(yearlyRatio(seasonal, new Array(n).fill(false))).toBeCloseTo(3, 5)
    const flat = forecastSeries(series(base), TODAY)
    const adjusted = forecastSeries(series(seasonal), TODAY)
    expect(adjusted.yearlyRatio).toBeGreaterThan(1)
    expect(adjusted.predictedDailyUse).toBeGreaterThan(flat.predictedDailyUse * 1.5)
  })

  it("falls back to a 28-day average with too little history", () => {
    const r = forecastSeries(series(new Array(20).fill(10)), TODAY)
    expect(r.method).toBe("moving_average_fallback")
    expect(r.predictedDailyUse).toBeCloseTo(10, 5)
  })
})

describe("footfall-driven forecast", () => {
  // footfall with a weekly shape; each patient uses 0.5 tablets
  const weekly = [60, 55, 55, 55, 55, 50, 20]
  const footfall = (n: number, scale: (i: number) => number = () => 1) =>
    Array.from({ length: n }, (_, i) => Math.round(weekly[i % 7] * scale(i)))

  it("blends a footfall-based forecast in when it backtests well", () => {
    const f = footfall(200)
    const used = f.map((v, i) => Math.round(v * 0.5 + ((i * 7) % 3) - 1))
    const r = forecastSeries(series(used), TODAY, undefined, { footfall: { values: f, reported: f.map(() => true) } })
    expect(r.method).toBe("holt_winters_footfall_blend")
    expect(r.footfallWeight).toBeGreaterThan(0.05)
    expect(r.predictedDailyUse).toBeGreaterThan(20)
    expect(r.predictedDailyUse).toBeLessThan(30)
  })

  it("follows a footfall rise the direct series has not caught yet", () => {
    const n = 200
    const f = footfall(n, (i) => (i >= n - 10 ? 1.8 : 1))
    const used = f.map((v) => Math.round(v * 0.5))
    const withFf = forecastSeries(series(used), TODAY, undefined, { footfall: { values: f, reported: f.map(() => true) } })
    const direct = forecastSeries(series(used), TODAY)
    expect(withFf.predictedDailyUse).toBeGreaterThanOrEqual(direct.predictedDailyUse * 0.95)
    expect(withFf.footfallWeight).not.toBeNull()
  })

  it("stays direct-only when no footfall is given (chronic medicines)", () => {
    const r = forecastSeries(series(new Array(200).fill(25)), TODAY)
    expect(r.method).toBe("holt_winters_yearly_adj")
    expect(r.footfallWeight).toBeNull()
  })

  it("ignores footfall with too few matching days", () => {
    const f = footfall(200)
    const reported = f.map((_, i) => i < 150)
    const r = forecastSeries(series(f.map((v) => v / 2)), TODAY, undefined, { footfall: { values: f, reported } })
    expect(r.method).toBe("holt_winters_yearly_adj")
  })
})

describe("pooled seasonality", () => {
  it("a facility with < 1 year of history borrows the pooled seasonal ratio", () => {
    const used = new Array(425).fill(20)
    const reported = used.map((_, i) => i >= 425 - 150) // opened 150 days ago
    const own = forecastSeries(series(used, { reported }), TODAY)
    const pooled = forecastSeries(series(used, { reported }), TODAY, undefined, { pooled: { ratio: 2, source: "district" } })
    expect(own.seasonalitySource).toBeNull()
    expect(pooled.seasonalitySource).toBe("district")
    expect(pooled.predictedDailyUse).toBeGreaterThan(own.predictedDailyUse * 1.5)
  })

  it("a facility with a full year uses its own seasonality", () => {
    const r = forecastSeries(series(new Array(425).fill(20)), TODAY, undefined, { pooled: { ratio: 2, source: "state" } })
    expect(r.seasonalitySource).toBe("own")
  })
})

describe("surges", () => {
  const flat = (n: number, v: number) => Array.from({ length: n }, (_, i) => v + ((i * 5) % 3) - 1)

  it("flags 3 days far above normal", () => {
    const y = [...flat(120, 50), 150, 160, 155]
    const s = detectSurge(y, y.map(() => false))
    expect(s?.surging).toBe(true)
    expect(s?.ratio).toBeGreaterThan(2.5)
    expect(s?.baseline).toBeCloseTo(50, 0)
  })

  it("does not flag normal variation", () => {
    const y = flat(123, 50)
    expect(detectSurge(y, y.map(() => false))?.surging).toBe(false)
  })

  it("does not flag rare items with a couple of extra cases", () => {
    const y = [...new Array(120).fill(0).map((_, i) => (i % 3 === 0 ? 1 : 0)), 2, 3, 2]
    expect(detectSurge(y, y.map(() => false))?.surging).toBe(false)
  })

  it("uses a lower threshold when footfall is also surging", () => {
    const y = [...flat(120, 50), 75, 78, 76]
    expect(detectSurge(y, y.map(() => false), undefined, { threshold: 1.8 })?.reason).not.toBe("baseline")
    expect(detectSurge(y, y.map(() => false), undefined, { threshold: 1.4 })?.surging).toBe(true)
  })

  it("weights recent days more during a surge", () => {
    const used = [...new Array(193).fill(20), 60, 62, 61, 63, 60, 64, 62]
    const normal = forecastSeries(series(used), TODAY)
    const surge = forecastSeries(series(used), TODAY, undefined, { surge: true })
    expect(surge.predictedDailyUse).toBeGreaterThan(normal.predictedDailyUse)
  })
})

describe("computeDaysLeft", () => {
  const flat = new Array(30).fill(10)
  it("interpolates inside the day", () => {
    expect(computeDaysLeft(100, flat)).toBeCloseTo(10, 6)
    expect(computeDaysLeft(15, flat)).toBeCloseTo(1.5, 6)
  })
  it("extends past 30 days with the last week's mean", () => {
    expect(computeDaysLeft(400, flat)).toBeCloseTo(40, 6)
  })
  it("returns 0 when out of stock and null with no demand", () => {
    expect(computeDaysLeft(0, flat)).toBe(0)
    expect(computeDaysLeft(50, new Array(30).fill(0))).toBeNull()
  })
})
