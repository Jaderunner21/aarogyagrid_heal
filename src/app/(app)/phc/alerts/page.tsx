import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { AlertFeed } from "@/components/heal/alert-feed"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getAlerts } from "@/lib/queries"
import { t } from "@/lib/i18n"

export const metadata: Metadata = { title: "Alerts" }

export default async function PhcAlerts() {
  const session = await requireRole("phc_staff")
  const db = await createClient()
  const alerts = await getAlerts(db, { facilityIds: [session.profile.facility_id!] })
  return (
    <div>
      <PageHeader title={t(session.lang, "phc.alertsTitle")} description={session.facility?.name} />
      <div className="bg-card rounded-xl border p-4">
        <AlertFeed alerts={alerts} emptyText={t(session.lang, "phc.noAlerts")} lang={session.lang} />
      </div>
    </div>
  )
}
