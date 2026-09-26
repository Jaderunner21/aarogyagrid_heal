"use client"

import { useState } from "react"
import { Bot, ClipboardList, Sparkles, UserRound } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApproveDialog, DispatchDialog, ReceiveDialog, RejectDialog } from "@/components/heal/workflow-dialogs"
import { StatusStepper } from "@/components/heal/status-stepper"
import { EmptyState } from "@/components/heal/empty-state"
import { formatDate, formatDaysLeft, formatNumber } from "@/lib/format"
import { indentActions, type Viewer } from "@/lib/permissions"
import type { Recommendation, IndentView } from "@/lib/queries"
import { INDENT_STEPS } from "@/lib/status"
import { cn } from "@/lib/utils"

type Row = Recommendation & IndentView

export function IndentTable({ rows, viewer }: { rows: Row[]; viewer: Viewer }) {
  const [status, setStatus] = useState<string>("open")
  const shown = rows.filter((r) =>
    status === "all" ? true : status === "open" ? ["submitted", "approved", "dispatched"].includes(r.status) : r.status === status,
  )

  return (
    <div className="space-y-3">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="h-9 w-52" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">In progress</SelectItem>
          <SelectItem value="submitted">Waiting for approval</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="dispatched">Dispatched</SelectItem>
          <SelectItem value="received">Received</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>

      {shown.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No indents with this status." className="bg-card rounded-xl border" />
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground text-left text-xs">
              <tr>
                <th className="px-4 py-2.5 font-medium">Facility</th>
                <th className="px-3 py-2.5 font-medium">Medicine</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 font-medium">Days left</th>
                <th className="px-3 py-2.5 font-medium">Why</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => {
                const actions = indentActions(r, viewer)
                return (
                  <tr key={r.id} id={`rec-${r.id}`} className="target:bg-accent align-top">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.facilityName}</p>
                      <p className="text-muted-foreground flex items-center gap-1 text-xs">
                        {r.origin === "ai" ? <Bot className="size-3" aria-hidden="true" /> : <UserRound className="size-3" aria-hidden="true" />}
                        {r.origin === "ai" ? "AI" : (r.raisedByName ?? "Manual")} · {formatDate(r.createdAt)}
                      </p>
                    </td>
                    <td className="px-3 py-3 font-medium">{r.medicineName}</td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">
                      {formatNumber(r.qtyApproved ?? r.qtyRequested)} <span className="text-muted-foreground text-xs">{r.unit}s</span>
                      {r.qtyApproved !== null && r.qtyApproved !== r.qtyRequested ? (
                        <p className="text-muted-foreground text-xs">asked {formatNumber(r.qtyRequested)}</p>
                      ) : null}
                    </td>
                    <td className={cn("px-3 py-3 whitespace-nowrap", r.receiverDaysLeft !== null && r.receiverDaysLeft < 7 && "text-critical font-medium")}>
                      {formatDaysLeft(r.receiverDaysLeft)}
                    </td>
                    <td className="max-w-80 px-3 py-3 text-xs">
                      {r.aiGenerated ? (
                        <span className="text-primary mr-1 inline-flex items-center gap-0.5 font-semibold">
                          <Sparkles className="size-3" aria-hidden="true" />
                          Gemini
                        </span>
                      ) : null}
                      {r.aiReason ?? r.note ?? "—"}
                      {r.rejectedReason ? <p className="text-critical mt-1">Rejected: {r.rejectedReason}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <StatusStepper steps={INDENT_STEPS} status={r.status} />
                      {r.awaitingMo && r.status === "submitted" ? (
                        <span className="mt-1 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">
                          Waiting for the PHC doctor&apos;s sign-off
                        </span>
                      ) : r.moDecidedByName && r.origin === "manual" ? (
                        <span className="text-muted-foreground mt-1 block text-[11px]">Signed off by {r.moDecidedByName}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-2">
                        {actions.includes("reject") ? <RejectDialog item={r} /> : null}
                        {actions.includes("approve") ? <ApproveDialog item={r} /> : null}
                        {actions.includes("dispatch") ? <DispatchDialog item={r} /> : null}
                        {actions.includes("receive") ? <ReceiveDialog item={r} /> : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
