import Link from "next/link"
import { format, subDays } from "date-fns"
import { AlertOctagon, BedDouble, ChevronRight, ClipboardCheck, Stethoscope, Users } from "lucide-react"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { StatTile } from "@/components/heal/stat-tile"
import { AlertFeed } from "@/components/heal/alert-feed"
import { DaysLeftBar } from "@/components/heal/days-left-bar"
import { StatusIcon } from "@/components/heal/status-badge"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { ActionList, type ActionItem } from "@/components/heal/phc/action-list"
import { toViewer, type Session } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getAlerts, getBedsByType, getIndents, getOpenStockouts, getStock, getTransfers } from "@/lib/queries"
import { OpenStockouts, StockoutButton } from "@/components/heal/phc/stockout-button"
import { formatNumber } from "@/lib/format"
import { urgency } from "@/lib/status"
import { t } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * The PHC medical officer's home: patients, beds and staff today, the staff requests waiting for
 * their sign-off, and the medicines that need attention. Same data access as the staff login.
 */
export async function DoctorHome({ session }: { session: Session }) {
  const lang = session.lang
  const fid = session.profile.facility_id!
  const db = await createClient()
  const now = new Date()
  const today = format(now, "yyyy-MM-dd")
  const weekAgo = format(subDays(now, 7), "yyyy-MM-dd")

  const [stock, submitted, transfers, dispatchedIndents, alerts, reports, facility, staff, attendance, bedsByType, fromSubCentres, openOuts] = await Promise.all([
    getStock(db, { facilityId: fid }),
    getIndents(db, { facilityId: fid, status: ["submitted"] }),
    getTransfers(db, { facilityId: fid, status: ["approved", "dispatched"] }),
    getIndents(db, { facilityId: fid, status: ["dispatched"] }),
    getAlerts(db, { facilityIds: [fid] }),
    db.from("daily_reports").select("report_date, footfall, occupied_beds").eq("facility_id", fid).gte("report_date", weekAgo).order("report_date"),
    db.from("facilities").select("total_beds").eq("id", fid).maybeSingle(),
    db.from("staff").select("id, name, role").eq("facility_id", fid).eq("is_active", true).order("name"),
    db.from("attendance").select("staff_id, present, status").eq("att_date", today),
    getBedsByType(db, fid),
    // indents from the sub-centres this PHC supplies
    getIndents(db, { warehouseId: fid, status: ["submitted", "approved"] }),
    getOpenStockouts(db, fid),
  ])
  // the sub-centres' own stock, so their requests show how many days they have left
  const subCentreStock = fromSubCentres.length && stock[0] ? await getStock(db, { districtId: stock[0].districtId, facilityType: "shc" }) : []
  const subCentreWaiting = fromSubCentres.filter((i) => i.status === "submitted" && !i.awaitingMo)
  const subCentreToSend = fromSubCentres.filter((i) => i.status === "approved")

  const waiting = submitted.filter((i) => i.awaitingMo)
  const rows = reports.data ?? []
  const todayReport = rows.find((r) => r.report_date === today)
  const past = rows.filter((r) => r.report_date !== today)
  const avgFootfall = past.length ? past.reduce((s, r) => s + r.footfall, 0) / past.length : null
  const totalBeds = facility.data?.total_beds ?? 0
  const staffRows = staff.data ?? []
  const marks = new Map((attendance.data ?? []).map((a) => [a.staff_id, a.present]))
  const statuses = new Map((attendance.data ?? []).map((a) => [a.staff_id, a.status ?? (a.present ? "present_on_duty" : "absent")]))
  const present = staffRows.filter((s) => marks.get(s.id) === true).length
  const marked = staffRows.filter((s) => marks.has(s.id)).length
  const atRisk = [...stock]
    .filter((r) => r.status === "critical" || r.status === "low")
    .sort((a, b) => urgency(a.status, a.daysLeft) - urgency(b.status, b.daysLeft))
  const actions: ActionItem[] = [
    ...transfers.filter((x) => x.status === "approved" && x.fromId === fid).map((item) => ({ mode: "dispatch" as const, item })),
    ...transfers.filter((x) => x.status === "dispatched" && x.toId === fid).map((item) => ({ mode: "receive" as const, item })),
    ...dispatchedIndents.map((item) => ({ mode: "receive" as const, item })),
    ...subCentreToSend.map((item) => ({ mode: "dispatch" as const, item })),
  ]
  const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${session.facility?.name ?? ""} · ${t(lang, "doc.title")}`}
        description={`${session.districtName ?? ""} · ${session.profile.full_name}`}
        actions={
          <StockoutButton
            lang={lang}
            facilityId={fid}
            items={stock.map((r) => ({ id: r.medicineId, name: r.medicineName, unit: r.unit, quantity: r.quantity }))}
          />
        }
      />
      <OpenStockouts lang={lang} reports={openOuts} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t(lang, "doc.patientsToday")}
          value={todayReport ? formatNumber(todayReport.footfall) : "—"}
          sub={avgFootfall !== null ? t(lang, "doc.vsAvg").replace("{n}", formatNumber(avgFootfall)) : undefined}
          icon={Stethoscope}
        />
        <StatTile
          label={t(lang, "doc.beds")}
          value={todayReport ? `${todayReport.occupied_beds} / ${totalBeds}` : `— / ${totalBeds}`}
          sub={todayReport && totalBeds && todayReport.occupied_beds / totalBeds >= 0.9 ? t(lang, "doc.bedsNearlyFull") : undefined}
          status={todayReport && totalBeds && todayReport.occupied_beds / totalBeds >= 0.9 ? "low" : undefined}
          icon={BedDouble}
        />
        <StatTile
          label={t(lang, "doc.staffPresent")}
          value={marked ? `${present} / ${staffRows.length}` : "—"}
          sub={marked ? undefined : t(lang, "doc.notMarked")}
          status={marked && present / Math.max(staffRows.length, 1) < 0.7 ? "low" : undefined}
          icon={Users}
          href="/phc/entry"
        />
        <StatTile
          label={t(lang, "doc.medsCritical")}
          value={stock.filter((r) => r.status === "critical").length}
          sub={t(lang, "phc.criticalHint")}
          status="critical"
          icon={AlertOctagon}
        />
      </div>

      <Section
        title={t(lang, "doc.waiting")}
        description={t(lang, "doc.waitingHint")}
        className={waiting.length ? "border-rose-300 ring-4 ring-rose-100" : undefined}
        bodyClassName="p-3"
      >
        <RecommendationList
          items={enrich(waiting, stock)}
          viewer={toViewer(session)}
          emptyIcon={ClipboardCheck}
          emptyText={t(lang, "doc.waitingEmpty")}
          compact
          lang={lang}
        />
      </Section>

      {subCentreWaiting.length ? (
        <Section
          title={t(lang, "doc.subCentres")}
          description={t(lang, "doc.subCentresHint")}
          className="border-amber-300 ring-4 ring-amber-100"
          bodyClassName="p-3"
        >
          <RecommendationList items={enrich(subCentreWaiting, subCentreStock)} viewer={toViewer(session)} emptyIcon={ClipboardCheck} emptyText="" compact lang={lang} />
        </Section>
      ) : null}

      {actions.length ? (
        <Section title={t(lang, "phc.needsAction")} className="border-primary/40 ring-primary/10 ring-4">
          <ActionList items={actions} lang={lang} />
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title={t(lang, "doc.medsAtRisk")} bodyClassName="p-0">
          {atRisk.length === 0 ? (
            <p className="text-muted-foreground px-4 py-6 text-sm">{t(lang, "doc.allFine")}</p>
          ) : (
            <ul className="divide-y">
              {atRisk.map((r) => (
                <li key={r.medicineId}>
                  <Link href={`/phc/medicines/${r.medicineId}`} className="hover:bg-accent/50 flex min-h-14 items-center gap-3 px-4 py-2.5">
                    <StatusIcon status={r.status} className="size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.medicineName}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatNumber(r.quantity)} {r.unit}s {t(lang, "phc.inStock")}
                      </p>
                    </div>
                    <DaysLeftBar daysLeft={r.daysLeft} resupplyDays={r.resupplyDays} status={r.status} className="w-32 min-w-0 shrink-0 sm:w-44" />
                    <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-5">
          {bedsByType.length ? (
            <Section title={t(lang, "doc.bedsByType")} bodyClassName="p-0">
              <ul className="divide-y">
                {bedsByType.map((b) => {
                  const full = b.occupied !== null && b.total > 0 && b.occupied / b.total >= 0.9
                  return (
                    <li key={b.bedType} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="flex-1 font-medium">{t(lang, `bed.${b.bedType}`)}</span>
                      <span className={cn("tabular-nums", full ? "text-critical font-semibold" : "text-muted-foreground")}>
                        {b.occupied ?? "—"} / {b.total}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Section>
          ) : null}
          <Section title={t(lang, "doc.staffToday")} bodyClassName="p-0">
            <ul className="divide-y">
              {staffRows.map((s) => {
                const m = marks.get(s.id)
                return (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground block text-xs">{roleLabel(s.role)}</span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        m === true && "bg-green-50 text-ok",
                        m === false && "text-critical bg-red-50",
                        m === undefined && "bg-muted text-muted-foreground",
                      )}
                    >
                      {m === undefined ? t(lang, "doc.notMarkedShort") : t(lang, `att.${statuses.get(s.id) ?? "absent"}`)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Section>
          <Section title={t(lang, "nav.alerts")}>
            <AlertFeed alerts={alerts} limit={4} emptyText={t(lang, "phc.noAlerts")} lang={lang} />
          </Section>
        </div>
      </div>
    </div>
  )
}
