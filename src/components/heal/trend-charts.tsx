"use client"

import { format, parseISO } from "date-fns"
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

type Point = { date: string; footfall: number; occupied: number }

export function TrendCharts({ data, totalBeds }: { data: Point[]; totalBeds: number }) {
  const axis = { tick: { fontSize: 11, fill: "#64748B" }, tickLine: false }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <figure className="bg-card rounded-xl border p-4">
        <figcaption className="mb-2 text-sm font-semibold">Footfall · last 30 days</figcaption>
        <div className="h-60" role="img" aria-label="Daily patient footfall for the last 30 days">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => format(parseISO(d), "d MMM")} interval={6} axisLine={{ stroke: "#E2E8F0" }} />
              <YAxis {...axis} axisLine={false} />
              <Tooltip labelFormatter={(d) => format(parseISO(String(d)), "d MMM")} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Line dataKey="footfall" name="Patients" stroke="#0F766E" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
      <figure className="bg-card rounded-xl border p-4">
        <figcaption className="mb-2 text-sm font-semibold">Bed occupancy · last 30 days ({totalBeds} beds)</figcaption>
        <div className="h-60" role="img" aria-label="Daily occupied beds for the last 30 days">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="date" {...axis} tickFormatter={(d: string) => format(parseISO(d), "d MMM")} interval={6} axisLine={{ stroke: "#E2E8F0" }} />
              <YAxis {...axis} axisLine={false} domain={[0, Math.max(totalBeds, 1)]} allowDecimals={false} />
              <Tooltip labelFormatter={(d) => format(parseISO(String(d)), "d MMM")} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <ReferenceLine y={totalBeds * 0.9} stroke="#D97706" strokeDasharray="4 4" label={{ value: "90%", fontSize: 10, fill: "#D97706", position: "insideTopRight" }} />
              <Line dataKey="occupied" name="Occupied beds" stroke="#2563EB" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  )
}
