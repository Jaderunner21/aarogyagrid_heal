"use client"

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

const tick = { fontSize: 11, fill: "#64748B" }

/** Backtest error by state, and how many forecasts use footfall or pooled seasonality. */
export function StateAccuracyChart({
  data,
}: {
  data: { name: string; errorPct: number; footfallPct: number; pooledPct: number }[]
}) {
  return (
    <div className="h-64" role="img" aria-label="Median forecast error and modelling mix by state">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#E2E8F0" vertical={false} />
          <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: "#E2E8F0" }} />
          <YAxis tick={tick} tickLine={false} axisLine={false} unit="%" />
          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} cursor={{ fill: "#F1F5F9" }} formatter={(v) => `${v}%`} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="errorPct" name="Median backtest error" fill="#DC2626" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="footfallPct" name="Forecasts using footfall" fill="#0F766E" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="pooledPct" name="Seasonality pooled from peers" fill="#2563EB" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
