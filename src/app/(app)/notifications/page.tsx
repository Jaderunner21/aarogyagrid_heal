import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { NotificationList } from "@/components/heal/notification-list"
import { getSession } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { t } from "@/lib/i18n"
import { redirect } from "next/navigation"

export const metadata: Metadata = { title: "Notifications" }

export default async function NotificationsPage() {
  const session = await getSession()
  if (!session) redirect("/login")
  const db = await createClient()
  const { data } = await db
    .from("notifications")
    .select("*")
    .eq("user_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(200)

  return (
    <div>
      <PageHeader title={t(session.lang, "notif.title")} />
      <NotificationList items={data ?? []} role={session.profile.role} lang={session.lang} />
    </div>
  )
}
