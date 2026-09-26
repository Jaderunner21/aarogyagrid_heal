"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeftRight, Bell, BellOff, ClipboardList, FileText, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { createClient } from "@/lib/supabase/client"
import { t, type Lang } from "@/lib/i18n"
import { notificationHref, type Role } from "@/lib/roles"
import type { Tables } from "@/lib/database.types"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/format"
import { REFRESH_EVENT } from "@/lib/client-actions"

type Notification = Pick<Tables<"notifications">, "id" | "type" | "title" | "body" | "ref_table" | "ref_id" | "read_at" | "created_at">

const POLL_MS = 30_000

const TYPE_ICON = { alert: TriangleAlert, transfer: ArrowLeftRight, indent: ClipboardList, brief: FileText }

export function NotificationBell({ userId, role, lang }: { userId: string; role: Role; lang: Lang }) {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const [list, count] = await Promise.all([
      supabase
        .from("notifications")
        .select("id, type, title, body, ref_table, ref_id, read_at, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null),
    ])
    if (!list.error) setItems(list.data)
    if (!count.error) setUnread(count.count ?? 0)
  }, [userId])

  useEffect(() => {
    // Initial fetch, then poll; also refresh when any action announces a change.
    const first = setTimeout(load, 0)
    const timer = setInterval(load, POLL_MS)
    window.addEventListener(REFRESH_EVENT, load)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      window.removeEventListener(REFRESH_EVENT, load)
    }
  }, [load])

  async function markAllRead() {
    await createClient().rpc("mark_notifications_read", {})
    await load()
  }

  async function openItem(n: Notification) {
    setOpen(false)
    if (!n.read_at) {
      await createClient().rpc("mark_notifications_read", { p_ids: [n.id] })
      void load()
    }
    router.push(notificationHref(role, n.ref_table, n.ref_id))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) void load()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-10"
          aria-label={`${t(lang, "notif.title")}${unread ? ` (${unread} ${t(lang, "notif.unread")})` : ""}`}
        >
          <Bell className="size-5" />
          {unread > 0 ? (
            <span className="bg-critical absolute top-1 right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-white">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-semibold">
            {t(lang, "notif.title")}
            {unread > 0 ? (
              <span className="text-muted-foreground ml-1.5 font-normal">
                · {unread} {t(lang, "notif.unread")}
              </span>
            ) : null}
          </div>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={markAllRead} disabled={unread === 0}>
            {t(lang, "notif.markAllRead")}
          </Button>
        </div>
        {items.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-sm">
            <BellOff className="size-6" aria-hidden="true" />
            {t(lang, "notif.empty")}
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto overscroll-contain">
            <ul className="divide-y">
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type as keyof typeof TYPE_ICON] ?? Bell
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className={cn(
                        "hover:bg-muted flex w-full gap-3 px-4 py-3 text-left transition-colors",
                        !n.read_at && "bg-accent/60",
                      )}
                    >
                      <Icon
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          n.type === "alert" ? "text-critical" : "text-primary",
                        )}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("line-clamp-2 text-sm", !n.read_at && "font-medium")}>{n.title}</span>
                        {n.body ? (
                          <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">{n.body}</span>
                        ) : null}
                        <span className="text-muted-foreground mt-1 block text-xs">
                          {timeAgo(n.created_at)}
                        </span>
                      </span>
                      {!n.read_at ? (
                        <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" aria-label="Unread" />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <div className="border-t p-2">
          <Button variant="ghost" className="w-full" asChild>
            <Link href="/notifications" onClick={() => setOpen(false)}>
              {t(lang, "notif.viewAll")}
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
