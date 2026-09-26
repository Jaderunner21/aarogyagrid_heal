"use client"

import { ArrowRight, Bot, MapPin, Sparkles, Truck, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ApproveDialog, DispatchDialog, ReceiveDialog, RejectDialog, SignOffButtons } from "@/components/heal/workflow-dialogs"
import { StatusStepper } from "@/components/heal/status-stepper"
import { formatDate, formatDaysLeft, formatNumber } from "@/lib/format"
import { indentActions, transferActions, type Viewer } from "@/lib/permissions"
import type { Recommendation } from "@/lib/queries"
import { CARRIER_LABEL, INDENT_STEPS, TRANSFER_STEPS, statusFor } from "@/lib/status"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function RecommendationCard({
  item,
  viewer,
  compact = false,
  lang = "en",
  className,
}: {
  item: Recommendation
  viewer: Viewer
  compact?: boolean
  lang?: Lang
  className?: string
}) {
  const isTransfer = item.kind === "transfer"
  const qty = isTransfer ? item.qty : (item.qtyApproved ?? item.qtyRequested)
  const from = isTransfer ? item.fromName : item.warehouseName
  const to = isTransfer ? item.toName : item.facilityName
  const priority = isTransfer ? item.priority : item.receiverDaysLeft !== null && item.receiverDaysLeft < 7 ? 1 : 2
  const actions = isTransfer ? transferActions(item, viewer) : indentActions(item, viewer)
  const reason = item.aiReason ?? (item.kind === "indent" ? item.note : null)
  const receiverStatus = statusFor(item.receiverDaysLeft, 7)

  return (
    <article
      id={`rec-${item.id}`}
      className={cn(
        "bg-card scroll-mt-24 rounded-lg border p-3 transition-shadow target:ring-2 target:ring-primary",
        priority === 1 && (item.status === "proposed" || item.status === "submitted") && "border-l-4 border-l-critical",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm leading-snug font-semibold">
            {item.medicineName}{" "}
            <span className="text-muted-foreground font-normal whitespace-nowrap">
              × {formatNumber(qty)} {item.unit}s
            </span>
          </h3>
          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1 text-xs">
            <span className="text-foreground">{from}</span>
            <ArrowRight className="size-3" aria-label="to" />
            <span className="text-foreground">{to}</span>
            {isTransfer && item.distanceKm !== null ? (
              <span className="inline-flex items-center gap-0.5">
                · <MapPin className="size-3" aria-hidden="true" />
                {formatNumber(item.distanceKm, 1)} km
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {priority === 1 ? (
            <Badge className="bg-red-50 text-critical border-red-200 border">Urgent</Badge>
          ) : (
            <Badge variant="outline">Normal</Badge>
          )}
          <Badge variant="secondary" className="gap-1">
            {item.origin === "ai" ? <Bot className="size-3" aria-hidden="true" /> : <UserRound className="size-3" aria-hidden="true" />}
            {item.origin === "ai" ? "AI" : "Manual"} {isTransfer ? "transfer" : "indent"}
          </Badge>
          {!isTransfer && item.awaitingMo && item.status === "submitted" ? (
            <Badge className="border border-rose-200 bg-rose-50 text-rose-700">{t(lang, "mo.waiting")}</Badge>
          ) : null}
          {isTransfer && item.isCrossDistrict ? (
            <Badge variant="outline" className="border-overstock/40 text-overstock">
              Cross-district
            </Badge>
          ) : null}
        </div>
      </header>

      {!compact ? (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <dt className="text-muted-foreground">{to} has</dt>
            <dd className={cn("font-semibold", receiverStatus === "critical" && "text-critical", receiverStatus === "low" && "text-low")}>
              {item.receiverDaysLeft === null ? "—" : formatDaysLeft(item.receiverDaysLeft)}
            </dd>
          </div>
          <div className="bg-muted/50 rounded-md px-2 py-1.5">
            <dt className="text-muted-foreground">{from} keeps</dt>
            <dd className="font-semibold">{item.donorDaysAfter !== null ? formatDaysLeft(item.donorDaysAfter) : "—"}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">
          Receiver: <span className="text-foreground font-medium">{item.receiverDaysLeft === null ? "—" : formatDaysLeft(item.receiverDaysLeft)}</span>
          {item.donorDaysAfter !== null ? <> · donor keeps {formatDaysLeft(item.donorDaysAfter)}</> : null}
        </p>
      )}

      {reason ? (
        <p className={cn("mt-2.5 flex gap-1.5 text-xs leading-relaxed", compact && "line-clamp-3")}>
          {item.aiGenerated ? (
            <span className="text-primary inline-flex shrink-0 items-center gap-0.5 font-semibold">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Gemini
            </span>
          ) : null}
          <span className="text-foreground/80">{reason}</span>
        </p>
      ) : null}

      {!isTransfer && item.moDecidedByName && !item.awaitingMo && item.origin === "manual" ? (
        <p className="text-muted-foreground mt-2 text-xs">{t(lang, "mo.signedOffBy").replace("{name}", item.moDecidedByName)}</p>
      ) : null}

      {item.status === "rejected" && item.rejectedReason ? (
        <p className="text-critical mt-2 text-xs">Rejected: {item.rejectedReason}</p>
      ) : null}

      {(item.status === "approved" || item.status === "dispatched") && item.carrierName ? (
        <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
          <Truck className="size-3.5" aria-hidden="true" />
          {CARRIER_LABEL[item.carrierType ?? "other"]} · {item.carrierName}
          {isTransfer && item.carrierContact ? ` · ${item.carrierContact}` : ""}
        </p>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <StatusStepper steps={isTransfer ? TRANSFER_STEPS : INDENT_STEPS} status={item.status} />
          <span className="text-muted-foreground text-[11px]">
            {item.status === "received" && item.receivedAt
              ? `Received ${formatDate(item.receivedAt)}${item.receivedQty !== null ? ` · ${formatNumber(item.receivedQty)}` : ""}`
              : item.status === "dispatched" && item.dispatchedAt
                ? `Dispatched ${formatDate(item.dispatchedAt)}`
                : item.approvedAt && item.status === "approved"
                  ? `Approved ${formatDate(item.approvedAt)}${item.approvedByName ? ` by ${item.approvedByName}` : ""}`
                  : `Raised ${formatDate(item.createdAt)}`}
          </span>
        </div>
        {actions.length ? (
          <div className="flex flex-wrap gap-2">
            {!isTransfer && actions.includes("sign_off") ? <SignOffButtons item={item} lang={lang} /> : null}
            {actions.includes("reject") ? <RejectDialog item={item} /> : null}
            {actions.includes("approve") ? <ApproveDialog item={item} /> : null}
            {actions.includes("dispatch") ? <DispatchDialog item={item} lang={lang} /> : null}
            {actions.includes("receive") ? <ReceiveDialog item={item} lang={lang} /> : null}
          </div>
        ) : null}
      </footer>
    </article>
  )
}
