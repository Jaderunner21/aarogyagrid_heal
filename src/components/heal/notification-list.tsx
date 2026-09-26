"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeftRight, Bell, BellOff, CheckCheck, ClipboardList, FileText, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/heal/empty-state"
import { createClient } from "@/lib/supabase/client"
import { announceChange } from "@/lib/client-actions"
import { notificationHref, type Role } from "@/lib/roles"
import type { Tables } from "@/lib/database.types"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/format"

const TYPE_ICON = { alert: TriangleAlert, transfer: ArrowLeftRight, indent: ClipboardList, brief: FileText }
const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "alert", label: "Alerts" },
  { key: "transfer", label: "Transfers" },
  { key: "indent", label: "Indents" },
] as const

export function NotificationList({ items, role, lang }: { items: Tables<"notifications">[]; role: Role; lang: Lang }) {
  const router = useRouter()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all")
  const [pending, startTransition] = useTransition()
  const shown = items.filter((n) => (filter === "all" ? true : filter === "unread" ? !n.read_at : n.type === filter))
  const unread = items.filter((n) => !n.read_at).length

  function open(n: Tables<"notifications">) {
    startTransition(async () => {
      if (!n.read_at) {
        await createClient().rpc("mark_notifications_read", { p_ids: [n.id] })
        announceChange()
      }
      router.push(notificationHref(role, n.ref_table, n.ref_id))
    })
  }

  function markAll() {
    startTransition(async () => {
      await createClient().rpc("mark_notifications_read", {})
      announceChange()
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="bg-muted flex flex-wrap gap-1 rounded-lg p-1" role="tablist" aria-label="Filter notifications">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium",
                filter === f.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
              {f.key === "unread" && unread ? ` (${unread})` : ""}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="ml-auto" onClick={markAll} disabled={pending || unread === 0}>
          <CheckCheck aria-hidden="true" />
          {t(lang, "notif.markAllRead")}
        </Button>
      </div>
      <div className="bg-card rounded-xl border">
        {shown.length === 0 ? (
          <EmptyState icon={BellOff} title={t(lang, "notif.empty")} />
        ) : (
          <ul className="divide-y">
            {shown.map((n) => {
              const Icon = TYPE_ICON[n.type as keyof typeof TYPE_ICON] ?? Bell
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={cn("hover:bg-muted flex w-full gap-3 px-4 py-3 text-left", !n.read_at && "bg-accent/50")}
                  >
                    <Icon className={cn("mt-0.5 size-4 shrink-0", n.type === "alert" ? "text-critical" : "text-primary")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.read_at && "font-semibold")}>{n.title}</span>
                      {n.body ? <span className="text-muted-foreground block text-sm">{n.body}</span> : null}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {timeAgo(n.created_at)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
