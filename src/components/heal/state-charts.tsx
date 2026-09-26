"use client"

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

const tick = { fontSize: 11, fill: "#64748B" }

export function DistrictStatusChart({ data }: { data: { name: string; critical: number; low: number; ok: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Critical, low and OK medicine lines per district">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#E2E8F0" vertical={false} />
          <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: "#E2E8F0" }} />
          <YAxis tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} cursor={{ fill: "#F1F5F9" }} />
          <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="critical" name="Critical" stackId="s" fill="#DC2626" isAnimationActive={false} />
          <Bar dataKey="low" name="Low" stackId="s" fill="#D97706" isAnimationActive={false} />
          <Bar dataKey="ok" name="OK" stackId="s" fill="#16A34A" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function MedicinesAtRiskChart({ data }: { data: { name: string; facilities: number }[] }) {
  const height = Math.max(160, data.length * 30 + 20)
  return (
    <div style={{ height }} role="img" aria-label="Number of facilities critical per medicine">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke="#E2E8F0" horizontal={false} />
          <XAxis type="number" tick={tick} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={{ ...tick, fill: "#0F172A" }} tickLine={false} axisLine={false} width={150} />
          <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} cursor={{ fill: "#F1F5F9" }} formatter={(v) => [`${v} facilities`, "Critical at"]} />
          <Bar dataKey="facilities" fill="#DC2626" radius={[0, 3, 3, 0]} barSize={16} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
