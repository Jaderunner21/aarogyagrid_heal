"use client"

import { useMemo } from "react"
import { addDays, format, parseISO } from "date-fns"
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { ForecastDetail } from "@/lib/queries"
import { formatNumber } from "@/lib/format"

export const METHOD_LABEL: Record<string, string> = {
  holt_winters_yearly_adj: "Holt-Winters + yearly seasonal adjustment",
  holt_winters_footfall_blend: "Holt-Winters, driver-adjusted",
  moving_average_fallback: "28-day average (fallback)",
  seed_moving_average: "Starter 28-day average",
}

type Row = {
  date: string
  footfall?: number
  actual?: number
  yhat?: number
  band?: [number, number]
  stock?: number
}

export function buildChartRows(detail: ForecastDetail, isWarehouse: boolean): { rows: Row[]; today: string } {
  const today = format(new Date(), "yyyy-MM-dd")
  // footfall is drawn as a 7-day average: a quiet background trend, not daily noise
  const sortedFf = [...detail.footfall].sort((a, b) => a.date.localeCompare(b.date))
  const ff = new Map(
    sortedFf.map((f, i) => {
      const win = sortedFf.slice(Math.max(0, i - 6), i + 1)
      return [f.date, Math.round(win.reduce((sum, w) => sum + w.footfall, 0) / win.length)]
    }),
  )
  const rows: Row[] = detail.history
    .filter((h) => h.date < today)
    .map((h) => ({ date: h.date, actual: isWarehouse ? h.out : h.used, footfall: ff.get(h.date) }))

  // Forecast: stored series, or a flat band from the starter forecast.
  let series = detail.series
  if (!series && detail.forecast) {
    const f = detail.forecast
    series = Array.from({ length: 30 }, (_, i) => ({
      date: format(addDays(new Date(), i + 1), "yyyy-MM-dd"),
      yhat: Number(f.predicted_daily_use),
      lower: Number(f.lower_daily ?? f.predicted_daily_use),
      upper: Number(f.upper_daily ?? f.predicted_daily_use),
    }))
  }

  let stock = detail.stock?.quantity ?? 0
  rows.push({ date: today, stock, actual: detail.history.find((h) => h.date === today)?.[isWarehouse ? "out" : "used"] })
  for (const p of series ?? []) {
    stock = Math.max(0, stock - p.yhat)
    rows.push({
      date: p.date,
      yhat: Math.round(p.yhat * 10) / 10,
      band: [Math.round(p.lower * 10) / 10, Math.round(p.upper * 10) / 10],
      stock: Math.round(stock),
    })
  }
  return { rows, today }
}

export function ForecastChart({
  detail,
  isWarehouse = false,
  height = 280,
}: {
  detail: ForecastDetail
  isWarehouse?: boolean
  height?: number
}) {
  const { rows, today } = useMemo(() => buildChartRows(detail, isWarehouse), [detail, isWarehouse])
  const stockout = detail.stock?.stockoutDate ?? detail.forecast?.stockout_date ?? null
  const stockoutInRange = stockout && rows.some((r) => r.date === stockout)
  const method = detail.forecast?.method
  const mape = detail.forecast?.mape
  const unit = detail.stock?.unit ?? ""
  const weight = detail.forecast?.footfall_weight
  const pooledFrom = detail.forecast?.seasonality_source && detail.forecast.seasonality_source !== "own" ? detail.forecast.seasonality_source : null
  const showFootfall = !isWarehouse && detail.footfall.length > 0
  const beds = detail.driver === "beds"

  return (
    <figure className="space-y-2">
      <div style={{ height }} className="w-full" role="img" aria-label="Daily use for the last 90 days and 30-day forecast">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => format(parseISO(d), "d MMM")}
              tick={{ fontSize: 11, fill: "#64748B" }}
              interval={Math.ceil(rows.length / 8)}
              tickLine={false}
              axisLine={{ stroke: "#E2E8F0" }}
            />
            <YAxis
              yAxisId="use"
              tick={{ fontSize: 11, fill: "#64748B" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => formatNumber(v)}
            />
            {/* hidden, zero-width: otherwise it takes room on the left and pushes the use axis out of view */}
            <YAxis yAxisId="ff" hide width={0} orientation="right" domain={[0, (max: number) => Math.max(1, max * 1.8)]} />
            <YAxis
              yAxisId="stock"
              orientation="right"
              tick={{ fontSize: 11, fill: "#94A3B8" }}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v: number) => formatNumber(v)}
            />
            <Tooltip
              labelFormatter={(d) => format(parseISO(String(d)), "d MMM yyyy")}
              formatter={(value, name) => {
                if (Array.isArray(value)) return [`${formatNumber(Number(value[0]), 1)} – ${formatNumber(Number(value[1]), 1)}`, "80% band"]
                if (name === "footfall")
                  return beds
                    ? [`${formatNumber(Number(value))} beds`, "Occupied critical-care beds (7-day average)"]
                    : [`${formatNumber(Number(value))} patients / day`, "Footfall (7-day average)"]
                const label =
                  name === "actual" ? "Used" : name === "yhat" ? "Forecast / day" : name === "stock" ? "Projected stock" : String(name)
                return [`${formatNumber(Number(value), 1)} ${unit}s`, label]
              }}
              contentStyle={{ borderRadius: 8, borderColor: "#E2E8F0", fontSize: 12 }}
            />
            <Area
              yAxisId="use"
              dataKey="band"
              stroke="none"
              fill="#0F766E"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Bar yAxisId="use" dataKey="actual" fill="#94A3B8" radius={[2, 2, 0, 0]} maxBarSize={8} isAnimationActive={false} />
            <Line
              yAxisId="use"
              dataKey="yhat"
              stroke="#0F766E"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            {showFootfall ? (
              <Line
                yAxisId="ff"
                dataKey="footfall"
                stroke="#7C3AED"
                strokeWidth={1.25}
                strokeOpacity={0.45}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ) : null}
            <Line
              yAxisId="stock"
              dataKey="stock"
              stroke="#2563EB"
              strokeDasharray="5 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <ReferenceLine
              yAxisId="use"
              x={today}
              stroke="#0F172A"
              strokeDasharray="3 3"
              label={{ value: "Today", position: "insideTopLeft", fontSize: 11, fill: "#0F172A" }}
            />
            {stockoutInRange ? (
              <ReferenceLine
                yAxisId="use"
                x={stockout}
                stroke="#DC2626"
                strokeWidth={2}
                label={{ value: "Stock-out", position: "insideTopRight", fontSize: 11, fill: "#DC2626" }}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <LegendDot color="#94A3B8" label={isWarehouse ? "Issued / day" : "Used / day"} />
        <LegendDot color="#0F766E" label="Forecast (80% band)" />
        <LegendDot color="#2563EB" label="Projected stock (right axis)" dashed />
        {showFootfall ? <LegendDot color="#A78BFA" label={beds ? "Occupied ICU/HDU/NICU beds (7-day trend)" : "Patients (7-day trend)"} /> : null}
        <span className="ml-auto text-right">
          {method ? (METHOD_LABEL[method] ?? method) : "No forecast yet"}
          {method === "holt_winters_footfall_blend" && weight !== null && weight !== undefined
            ? ` (${Math.round(Number(weight) * 100)}% ${beds ? "bed-occupancy" : "footfall"}-based)`
            : ""}
          {mape !== null && mape !== undefined
            ? ` · backtest error ${Number(mape) < 0.01 ? "under 1%" : `${Math.round(Number(mape) * 100)}%`}`
            : ""}
          {pooledFrom ? ` · seasonality pooled from ${pooledFrom}` : ""}
          {detail.forecast?.surge ? " · surge: recent days weighted more" : ""}
        </span>
      </figcaption>
    </figure>
  )
}

function LegendDot({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-4"
        style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color, height: dashed ? 2 : 8, borderRadius: 2 }}
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
