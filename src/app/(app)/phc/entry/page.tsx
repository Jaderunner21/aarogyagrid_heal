import type { Metadata } from "next"
import { PageHeader } from "@/components/heal/page-header"
import { EntryTabs } from "@/components/heal/phc/entry-tabs"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getBedsByType, getStock } from "@/lib/queries"
import { t } from "@/lib/i18n"

export const metadata: Metadata = { title: "Entry" }

export default async function PhcEntry({ searchParams }: PageProps<"/phc/entry">) {
  const { tab } = await searchParams
  const session = await requireRole("phc_staff")
  const fid = session.profile.facility_id!
  const db = await createClient()
  // Postgres current_date (UTC) is the key for today's report and attendance.
  const today = new Date().toISOString().slice(0, 10)

  const [stock, facility, report, staff, bedsByType] = await Promise.all([
    getStock(db, { facilityId: fid }),
    db.from("facilities").select("total_beds").eq("id", fid).single(),
    db.from("daily_reports").select("*").eq("facility_id", fid).eq("report_date", today).maybeSingle(),
    db.from("staff").select("*").eq("facility_id", fid).eq("is_active", true).order("name"),
    getBedsByType(db, fid),
  ])
  // today's occupancy by type pre-fills the form; earlier days don't
  const { data: todayOcc } = await db.from("daily_bed_occupancy").select("bed_type, occupied").eq("facility_id", fid).eq("report_date", today)
  const staffIds = (staff.data ?? []).map((s) => s.id)
  const attendance = staffIds.length
    ? await db.from("attendance").select("*").in("staff_id", staffIds).eq("att_date", today)
    : { data: [] }

  return (
    <div>
      <PageHeader title={t(session.lang, "phc.entryTitle")} description={session.facility?.name} />
      <EntryTabs
        lang={session.lang}
        userId={session.userId}
        facilityId={fid}
        today={today}
        initialTab={typeof tab === "string" ? tab : "usage"}
        stock={[...stock].sort((a, b) => a.medicineName.localeCompare(b.medicineName))}
        totalBeds={facility.data?.total_beds ?? 0}
        report={report.data ?? null}
        staff={staff.data ?? []}
        attendance={attendance.data ?? []}
        beds={bedsByType.map((b) => ({ ...b, occupied: (todayOcc ?? []).find((o) => o.bed_type === b.bedType)?.occupied ?? null }))}
      />
    </div>
  )
}
