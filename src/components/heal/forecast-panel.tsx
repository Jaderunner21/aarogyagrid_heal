"use client"

import { Sparkles } from "lucide-react"
import { ForecastChart } from "@/components/heal/forecast-chart"
import { StatusBadge } from "@/components/heal/status-badge"
import { formatDate, formatDaysLeft, formatNumber } from "@/lib/format"
import type { ForecastDetail } from "@/lib/queries"
import type { Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const SOURCE_LABEL: Record<string, string> = {
  manual: "Entry",
  voice: "Voice entry",
  transfer: "Transfer",
  indent: "Indent",
  adjustment: "Adjustment",
  seed: "History",
}

export function ForecastPanel({ detail, lang = "en" }: { detail: ForecastDetail; lang?: Lang }) {
  const s = detail.stock
  const isWarehouse = s?.facilityType === "warehouse"
  const unit = s?.unit ?? ""
  const pdu = s?.pdu

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KeyNumber label="In stock" value={`${formatNumber(s?.quantity)} ${unit}s`} />
        <KeyNumber
          label={isWarehouse ? "Issues / day" : "Predicted use / day"}
          value={pdu !== null && pdu !== undefined ? formatNumber(pdu, 1) : "—"}
          sub={
            s?.lower !== null && s?.lower !== undefined && s?.upper !== null && s?.upper !== undefined
              ? `range ${formatNumber(s.lower, 1)}–${formatNumber(s.upper, 1)}`
              : undefined
          }
        />
        <KeyNumber
          label="Days left"
          value={formatDaysLeft(s?.daysLeft)}
          sub={s ? `resupply takes ${s.resupplyDays} days` : undefined}
          tone={s?.status}
        />
        <KeyNumber
          label="Stock-out date"
          value={s?.stockoutDate ? formatDate(s.stockoutDate) : "—"}
          sub={detail.forecast?.forecast_30d ? `next 30 days: ${formatNumber(Number(detail.forecast.forecast_30d))}` : undefined}
        />
      </dl>

      <ForecastChart detail={detail} isWarehouse={isWarehouse} />

      {detail.alert && detail.alert.status !== "resolved" ? (
        <div
          className={cn(
            "rounded-lg border p-3 text-sm",
            detail.alert.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50",
          )}
        >
          <div className="flex items-center gap-2">
            <StatusBadge status={detail.alert.severity === "critical" ? "critical" : "low"} lang={lang} size="sm" />
            <span className="text-muted-foreground text-xs">since {formatDate(detail.alert.created_at)}</span>
          </div>
          <p className="mt-2">{detail.alert.message}</p>
          {detail.alert.ai_summary ? (
            <p className="text-foreground/80 mt-2 flex gap-1.5">
              <Sparkles className="text-primary mt-0.5 size-4 shrink-0" aria-label="Gemini" />
              {detail.alert.ai_summary}
            </p>
          ) : null}
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">Last 30 days of entries</h3>
        {detail.log.length === 0 ? (
          <p className="text-muted-foreground text-sm">No entries in the last 30 days.</p>
        ) : (
          <div className="max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-muted-foreground sticky top-0 text-xs">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Used</th>
                  <th className="px-3 py-2 text-right font-medium">Received</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {detail.log.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(l.log_date)}</td>
                    <td className="text-muted-foreground px-3 py-1.5">{SOURCE_LABEL[l.source] ?? l.source}</td>
                    <td className="px-3 py-1.5 text-right">{Number(l.qty_used) ? formatNumber(Number(l.qty_used)) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      {Number(l.qty_received) ? formatNumber(Number(l.qty_received)) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">{Number(l.qty_out) ? formatNumber(Number(l.qty_out)) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function KeyNumber({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: "critical" | "low" | "ok" | "overstock" | "unknown"
}) {
  return (
    <div className="bg-muted/40 rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums",
          tone === "critical" && "text-critical",
          tone === "low" && "text-low",
        )}
      >
        {value}
      </dd>
      {sub ? <dd className="text-muted-foreground text-xs">{sub}</dd> : null}
    </div>
  )
}
