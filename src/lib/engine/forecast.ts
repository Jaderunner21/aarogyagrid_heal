// Demand forecast: Holt-Winters additive, damped trend, weekly seasonality,
// year-over-year seasonal adjustment, stock-out and no-report days treated as missing.
// Pure functions only — no I/O — so they can be unit-tested.

export type ForecastParams = {
  alpha: number
  beta: number
  gamma: number
  phi: number
  m: number
  historyDays: number
  horizon: number
}

export const DEFAULT_PARAMS: ForecastParams = {
  alpha: 0.3,
  beta: 0.05,
  gamma: 0.2,
  phi: 0.9,
  m: 7,
  historyDays: 120,
  horizon: 30,
}

export type SeriesInput = {
  /** daily arrays, oldest → yesterday */
  used: number[]
  received: number[]
  outflow: number[]
  reported: boolean[]
  /** current stock (for days left) */
  stock: number
  /** stock at the end of the last day in the series (current stock minus today's movements); defaults to stock */
  stockAtSeriesEnd?: number
  isWarehouse: boolean
}

export type ForecastPoint = { date: string; yhat: number; lower: number; upper: number }

export type SeasonalitySource = "own" | "district" | "state" | "national"

export type ForecastOptions = {
  /** Seasonal ratio pooled from peers; used when this series has less than a year of history. */
  pooled?: { ratio: number; source: Exclude<SeasonalitySource, "own"> } | null
  /** Daily footfall aligned with the series (acute medicines at PHCs only). */
  footfall?: { values: number[]; reported: boolean[] } | null
  /** A surge is in progress: weight recent days more. */
  surge?: boolean
}

export type ForecastResult = {
  method: "holt_winters_yearly_adj" | "holt_winters_footfall_blend" | "moving_average_fallback"
  seasonalitySource: SeasonalitySource | null
  footfallWeight: number | null
  predictedDailyUse: number
  lowerDaily: number
  upperDaily: number
  forecast7d: number
  forecast30d: number
  daysLeft: number | null
  stockoutDate: string | null
  mape: number | null
  yearlyRatio: number
  yhat: number[]
  lower: number[]
  upper: number[]
  series: ForecastPoint[]
}

const EPS = 1e-6
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d

/** Step 1: which days can't be trusted as demand (stock-out, or nothing reported). */
export function missingMask(input: SeriesInput): boolean[] {
  const n = input.used.length
  const eod = new Array<number>(n)
  // Rebuild end-of-day stock backwards from today's stock.
  eod[n - 1] = input.stockAtSeriesEnd ?? input.stock
  for (let d = n - 1; d > 0; d--) {
    eod[d - 1] = eod[d] - input.received[d] + input.used[d] + input.outflow[d]
  }
  return eod.map((s, d) => s <= 0.5 || (!input.isWarehouse && !input.reported[d]))
}

type Fit = {
  level: number
  trend: number
  season: number[]
  n: number
  errors: number[]
}

/** Step 2: fit Holt-Winters additive with damped trend. Missing values are replaced by the one-step prediction. */
export function fitHoltWinters(y: number[], missing: boolean[], p: ForecastParams): Fit {
  const { alpha, beta, gamma, phi, m } = p
  const n = y.length
  const obs = (i: number) => (missing[i] ? null : y[i])
  const meanObs = (from: number, to: number) => {
    const v: number[] = []
    for (let i = from; i < Math.min(to, n); i++) {
      const o = obs(i)
      if (o !== null) v.push(o)
    }
    return v.length ? mean(v) : null
  }

  const overall = meanObs(0, n) ?? 0
  let level = meanObs(0, 14) ?? overall
  const w1 = meanObs(0, 7)
  const w2 = meanObs(7, 14)
  let trend = w1 !== null && w2 !== null ? (w2 - w1) / 7 : 0

  // Seasonal indices: average deviation of each weekday from its week's mean, first 4 weeks.
  const season = new Array<number>(m).fill(0)
  const counts = new Array<number>(m).fill(0)
  for (let w = 0; w < 4; w++) {
    const wm = meanObs(w * m, (w + 1) * m)
    if (wm === null) continue
    for (let k = 0; k < m; k++) {
      const o = w * m + k < n ? obs(w * m + k) : null
      if (o === null) continue
      season[k] += o - wm
      counts[k]++
    }
  }
  for (let k = 0; k < m; k++) season[k] = counts[k] ? season[k] / counts[k] : 0

  const errors: number[] = []
  for (let t = 0; t < n; t++) {
    const s = season[t % m]
    const pred = level + phi * trend + s
    let yt = obs(t)
    if (yt === null) {
      yt = Math.max(0, pred) // impute with the one-step prediction
    } else {
      errors.push(yt - pred)
    }
    const newLevel = alpha * (yt - s) + (1 - alpha) * (level + phi * trend)
    trend = beta * (newLevel - level) + (1 - beta) * phi * trend
    season[t % m] = gamma * (yt - newLevel) + (1 - gamma) * s
    level = newLevel
  }
  return { level, trend, season, n, errors }
}

/** Step 3: ŷ_h = level + (φ+…+φ^h)·trend + season[(t+h) mod m], clamped ≥ 0. */
export function forecastFromFit(fit: Fit, h: number, p: ForecastParams): number[] {
  const out: number[] = []
  let damp = 0
  for (let i = 1; i <= h; i++) {
    damp += p.phi ** i
    const s = fit.season[(fit.n - 1 + i) % p.m]
    out.push(Math.max(0, fit.level + damp * fit.trend + s))
  }
  return out
}

/** Step 4: last year's change going into the same period (needs ≥ 395 days). */
export function yearlyRatio(y: number[], missing: boolean[]): number {
  const t = y.length - 1
  if (y.length < 395) return 1
  const win = (from: number, to: number) => {
    const v: number[] = []
    for (let i = Math.max(0, from); i <= to; i++) if (!missing[i]) v.push(y[i])
    return v.length ? mean(v) : 0
  }
  const ahead = win(t - 365 + 1, t - 365 + 30)
  const before = win(t - 365 - 29, t - 365)
  if (ahead < 0.05 && before < 0.05) return 1
  const r = ahead / Math.max(before, EPS)
  return Math.min(3, Math.max(0.5, r))
}

/** Step 7: walk the cumulative forecast until it exceeds stock. */
export function computeDaysLeft(stock: number, yhat: number[]): number | null {
  if (stock <= 0) return 0
  let cum = 0
  for (let h = 0; h < yhat.length; h++) {
    const next = cum + yhat[h]
    if (next >= stock && yhat[h] > 0) return h + (stock - cum) / yhat[h]
    cum = next
  }
  const tail = yhat.slice(Math.max(0, yhat.length - 7))
  const tailMean = mean(tail)
  if (tailMean <= EPS) return null
  return yhat.length + (stock - cum) / tailMean
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0
  const mu = mean(xs)
  return Math.sqrt(sum(xs.map((x) => (x - mu) ** 2)) / (xs.length - 1))
}

/** Days since the series first has a trusted observation (new facilities have missing history). */
export function historyLength(missing: boolean[]): number {
  const first = missing.findIndex((m) => !m)
  return first < 0 ? 0 : missing.length - first
}

/** Step 4 source: own year-over-year ratio with ≥ 395 days of history, otherwise a pooled one. */
export function seasonalRatio(
  y: number[],
  missing: boolean[],
  pooled: ForecastOptions["pooled"],
): { r: number; source: SeasonalitySource | null } {
  if (historyLength(missing) >= 395) return { r: yearlyRatio(y, missing), source: "own" }
  if (pooled) return { r: Math.min(3, Math.max(0.5, pooled.ratio)), source: pooled.source }
  return { r: 1, source: null }
}

/** Core point forecast for a series (used for the real forecast and for the backtest). */
function pointForecast(
  y: number[],
  missing: boolean[],
  p: ForecastParams,
  r: number,
): { method: "holt_winters_yearly_adj" | "moving_average_fallback"; yhat: number[]; sigma: number } {
  const start = Math.max(0, y.length - p.historyDays)
  const wy = y.slice(start)
  const wm = missing.slice(start)
  const observed = wy.filter((_, i) => !wm[i])

  if (observed.length < 28 || observed.every((v) => v === 0)) {
    const last28 = y.filter((_, i) => !missing[i]).slice(-28)
    const mu = mean(last28)
    return { method: "moving_average_fallback", yhat: new Array(p.horizon).fill(mu), sigma: std(last28) }
  }

  const fit = fitHoltWinters(wy, wm, p)
  const factor = 1 + 0.7 * (r - 1)
  const yhat = forecastFromFit(fit, p.horizon, p).map((v) => Math.max(0, v * factor))
  return { method: "holt_winters_yearly_adj", yhat, sigma: std(fit.errors) }
}

/**
 * Footfall-based forecast: usage per patient over the last 60 days × a Holt-Winters forecast of
 * footfall. Returns null when there are too few days with both numbers.
 */
function footfallPoint(
  y: number[],
  missing: boolean[],
  ff: number[],
  ffReported: boolean[],
  p: ForecastParams,
): { yhat: number[]; sigma: number; perPatient: number } | null {
  let sy = 0
  let sf = 0
  let days = 0
  for (let i = Math.max(0, y.length - 60); i < y.length; i++) {
    if (missing[i] || !ffReported[i] || ff[i] <= 0) continue
    sy += y[i]
    sf += ff[i]
    days++
  }
  if (days < 20 || sf <= 0 || sy <= 0) return null
  const perPatient = sy / sf
  const start = Math.max(0, ff.length - p.historyDays)
  const fMissing = ffReported.slice(start).map((r) => !r)
  if (fMissing.filter((m) => !m).length < 28) return null
  const fit = fitHoltWinters(ff.slice(start), fMissing, p)
  const fhat = forecastFromFit(fit, p.horizon, p)
  return { yhat: fhat.map((f) => Math.max(0, f * perPatient)), sigma: std(fit.errors) * perPatient, perPatient }
}

function wape(pred: number[], actual: number[], mask: boolean[]): number | null {
  let sy = 0
  let sp = 0
  for (let i = 0; i < actual.length; i++) {
    if (mask[i]) continue
    sy += actual[i]
    sp += pred[i]
  }
  return sy > EPS ? Math.abs(sp - sy) / sy : null
}

/** Full forecast for one facility × medicine. `today` is the ISO date the forecast starts from. */
export function forecastSeries(
  input: SeriesInput,
  today: string,
  params: ForecastParams = DEFAULT_PARAMS,
  opts: ForecastOptions = {},
): ForecastResult {
  const y = input.isWarehouse ? input.outflow : input.used
  const missing = missingMask(input)
  // During a surge the level follows recent days much more closely.
  const p = opts.surge ? { ...params, alpha: Math.max(params.alpha, 0.6), beta: Math.max(params.beta, 0.15) } : params
  const { r, source } = seasonalRatio(y, missing, opts.pooled)

  const direct = pointForecast(y, missing, p, r)
  const ff = !input.isWarehouse && opts.footfall ? opts.footfall : null
  const foot = ff && direct.method === "holt_winters_yearly_adj" ? footfallPoint(y, missing, ff.values, ff.reported, p) : null

  // Step 8 backtest for each model (refit without the last 14 days), used both for WAPE and the blend weight.
  const bp = { ...p, horizon: 14 }
  let wDirect: number | null = null
  let wFoot: number | null = null
  let btDirect: number[] = []
  let btFoot: number[] | null = null
  const actual = y.slice(-14)
  const mask = missing.slice(-14)
  if (y.length > 14 + 28) {
    const cut = y.length - 14
    const rb = seasonalRatio(y.slice(0, cut), missing.slice(0, cut), opts.pooled).r
    btDirect = pointForecast(y.slice(0, cut), missing.slice(0, cut), bp, rb).yhat
    wDirect = wape(btDirect, actual, mask)
    if (foot && ff) {
      const fb = footfallPoint(y.slice(0, cut), missing.slice(0, cut), ff.values.slice(0, cut), ff.reported.slice(0, cut), bp)
      if (fb) {
        btFoot = fb.yhat
        wFoot = wape(btFoot, actual, mask)
      }
    }
  }

  // Blend weight: inverse backtest error (the model that predicted the last 2 weeks better counts more).
  let weight = 0
  if (foot && wFoot !== null && wDirect !== null) {
    const a = 1 / (wDirect + 0.02)
    const b = 1 / (wFoot + 0.02)
    weight = b / (a + b)
  }
  const blend = (d: number[], f: number[] | null) => (f && weight > 0 ? d.map((v, i) => (1 - weight) * v + weight * f[i]) : d)
  const yhat = blend(direct.yhat, foot?.yhat ?? null).map((v) => Math.max(0, v))
  const sigma = foot && weight > 0 ? (1 - weight) * direct.sigma + weight * foot.sigma : direct.sigma
  const mapeRaw = btDirect.length ? wape(blend(btDirect, btFoot), actual, mask) : null
  const mape = mapeRaw === null ? null : round(mapeRaw, 3)

  // Step 5: 80% band.
  const lower = yhat.map((v, i) => Math.max(0, v - 1.28 * sigma * Math.sqrt(i + 1)))
  const upper = yhat.map((v, i) => v + 1.28 * sigma * Math.sqrt(i + 1))
  // Step 7.
  const daysLeft = computeDaysLeft(input.stock, yhat)

  const first14 = yhat.slice(0, 14)
  const blended = foot !== null && weight >= 0.05
  return {
    method: blended ? "holt_winters_footfall_blend" : direct.method,
    seasonalitySource: direct.method === "moving_average_fallback" ? null : source,
    footfallWeight: foot ? round(weight, 2) : null,
    predictedDailyUse: round(mean(first14), 2),
    lowerDaily: round(mean(lower.slice(0, 14)), 2),
    upperDaily: round(mean(upper.slice(0, 14)), 2),
    forecast7d: round(sum(yhat.slice(0, 7)), 1),
    forecast30d: round(sum(yhat.slice(0, 30)), 1),
    daysLeft: daysLeft === null ? null : round(daysLeft, 1),
    stockoutDate: daysLeft === null ? null : addDays(today, Math.floor(daysLeft)),
    mape,
    yearlyRatio: round(r, 3),
    yhat,
    lower,
    upper,
    series: yhat.map((v, i) => ({
      date: addDays(today, i + 1),
      yhat: round(v, 2),
      lower: round(lower[i], 2),
      upper: round(upper[i], 2),
    })),
  }
}

// ---------------------------------------------------------------------------------------------
// Surge detection (early warning during outbreaks)
// ---------------------------------------------------------------------------------------------

export type SurgeCheck = {
  surging: boolean
  reason: "band" | "baseline" | null
  last3: number[]
  /** what the model expected for those 3 days (mean per day) */
  expected: number
  /** 80% upper band for those days (mean per day) */
  upper: number
  /** mean of the 28 observed days before them */
  baseline: number
  /** last-3-day mean ÷ baseline */
  ratio: number
}

/**
 * A series is surging when each of its last 3 days is above the forecast's upper band (and at least
 * 25% above baseline), or when the last-3-day average exceeds `threshold` × its 28-day baseline.
 * `minPerDay` keeps rare items (e.g. antivenom) from raising alarms on a single extra case.
 */
export function detectSurge(
  y: number[],
  missing: boolean[],
  params: ForecastParams = DEFAULT_PARAMS,
  { threshold = 1.8, minPerDay = 5 }: { threshold?: number; minPerDay?: number } = {},
): SurgeCheck | null {
  const n = y.length
  if (n < 40) return null
  if (missing.slice(-3).some(Boolean)) return null
  const last3 = y.slice(-3)
  const hist = y.slice(0, -3)
  const hMissing = missing.slice(0, -3)
  const obs = hist.filter((_, i) => !hMissing[i]).slice(-28)
  if (obs.length < 10) return null
  const baseline = mean(obs)

  const pf = pointForecast(hist, hMissing, { ...params, horizon: 3 }, 1)
  const upper = pf.yhat.map((v, i) => v + 1.28 * pf.sigma * Math.sqrt(i + 1))
  const lastMean = mean(last3)
  const ratio = lastMean / Math.max(baseline, EPS)
  const volumeOk = lastMean >= minPerDay
  const aboveBand = last3.every((v, i) => v > upper[i]) && ratio >= 1.25
  const aboveBaseline = ratio > threshold
  const surging = volumeOk && (aboveBand || aboveBaseline)
  return {
    surging,
    reason: !surging ? null : aboveBand ? "band" : "baseline",
    last3,
    expected: round(mean(pf.yhat), 1),
    upper: round(mean(upper), 1),
    baseline: round(baseline, 1),
    ratio: round(ratio, 2),
  }
}
