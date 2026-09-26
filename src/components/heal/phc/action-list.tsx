"use client"

import { ArrowDownToLine, ArrowUpFromLine, CircleCheck } from "lucide-react"
import { DispatchDialog, ReceiveDialog } from "@/components/heal/workflow-dialogs"
import { EmptyState } from "@/components/heal/empty-state"
import { formatDate, formatNumber } from "@/lib/format"
import type { IndentView, TransferView } from "@/lib/queries"
import { t, type Lang } from "@/lib/i18n"

export type ActionItem =
  | { mode: "dispatch"; item: TransferView }
  | { mode: "receive"; item: TransferView | IndentView }

/** Mobile-first "Needs your action" list: one big button per item. */
export function ActionList({ items, lang }: { items: ActionItem[]; lang: Lang }) {
  if (items.length === 0) return <EmptyState icon={CircleCheck} title={t(lang, "phc.nothingToDo")} className="py-6" />
  return (
    <ul className="divide-y">
      {items.map(({ mode, item }) => {
        const qty = item.kind === "transfer" ? item.qty : (item.qtyApproved ?? item.qtyRequested)
        const other =
          mode === "dispatch"
            ? (item as TransferView).toName
            : item.kind === "transfer"
              ? item.fromName
              : item.warehouseName
        const Icon = mode === "dispatch" ? ArrowUpFromLine : ArrowDownToLine
        const since = mode === "dispatch" ? item.approvedAt : item.dispatchedAt
        return (
          <li key={item.id} id={`rec-${item.id}`} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="bg-primary-soft text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {item.medicineName}{" "}
                <span className="text-muted-foreground font-normal">
                  × {formatNumber(qty)} {item.unit}s
                </span>
              </p>
              <p className="text-muted-foreground text-xs">
                {t(lang, mode === "dispatch" ? "phc.sendTo" : "phc.arrivingFrom")}{" "}
                <span className="text-foreground font-medium">{other}</span>
                {since ? ` · ${formatDate(since)}` : ""}
                {item.carrierName ? ` · ${item.carrierName}` : ""}
              </p>
            </div>
            <div className="w-full sm:w-auto [&_button]:h-11 [&_button]:w-full sm:[&_button]:w-auto">
              {mode === "dispatch" ? (
                <DispatchDialog item={item as TransferView} size="lg" lang={lang} />
              ) : (
                <ReceiveDialog item={item} size="lg" lang={lang} />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
