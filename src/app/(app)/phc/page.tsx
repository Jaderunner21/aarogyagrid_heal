import type { Metadata } from "next"
import Link from "next/link"
import { AlertOctagon, AlertTriangle, BellRing, CheckCircle2, ChevronRight, NotebookPen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { StatTile } from "@/components/heal/stat-tile"
import { AlertFeed } from "@/components/heal/alert-feed"
import { DaysLeftBar } from "@/components/heal/days-left-bar"
import { StatusIcon } from "@/components/heal/status-badge"
import { ActionList, type ActionItem } from "@/components/heal/phc/action-list"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getAlerts, getIndents, getOpenStockouts, getStock, getTransfers } from "@/lib/queries"
import { OpenStockouts, StockoutButton } from "@/components/heal/phc/stockout-button"
import { formatDateTime, formatNumber } from "@/lib/format"
import { urgency } from "@/lib/status"
import { t } from "@/lib/i18n"
import { DoctorHome } from "@/components/heal/phc/doctor-home"

export const metadata: Metadata = { title: "Today" }

export default async function PhcToday() {
  const session = await requireRole("phc_staff")
  if (session.profile.phc_position === "medical_officer") return <DoctorHome session={session} />
  const lang = session.lang
  const fid = session.profile.facility_id!
  const db = await createClient()

  const [stock, transfers, indents, alerts, lastEntry, subCentreIndents, openOuts] = await Promise.all([
    getStock(db, { facilityId: fid }),
    getTransfers(db, { facilityId: fid, status: ["approved", "dispatched"] }),
    getIndents(db, { facilityId: fid, status: ["dispatched"] }),
    getAlerts(db, { facilityIds: [fid] }),
    db
      .from("stock_log")
      .select("created_at")
      .eq("facility_id", fid)
      .in("source", ["manual", "voice", "adjustment"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // approved indents from the sub-centres this PHC supplies: this PHC sends them
    getIndents(db, { warehouseId: fid, status: ["approved"] }),
    getOpenStockouts(db, fid),
  ])

  const count = (s: string) => stock.filter((r) => r.status === s).length
  const openAlerts = alerts.filter((a) => a.status === "open").length
  const actions: ActionItem[] = [
    ...transfers.filter((x) => x.status === "approved" && x.fromId === fid).map((item) => ({ mode: "dispatch" as const, item })),
    ...transfers.filter((x) => x.status === "dispatched" && x.toId === fid).map((item) => ({ mode: "receive" as const, item })),
    ...indents.map((item) => ({ mode: "receive" as const, item })),
    ...subCentreIndents.map((item) => ({ mode: "dispatch" as const, item })),
  ]
  const sorted = [...stock].sort((a, b) => urgency(a.status, a.daysLeft) - urgency(b.status, b.daysLeft))

  return (
    <div className="space-y-5">
      <PageHeader
        title={session.facility?.name ?? t(lang, "nav.today")}
        description={`${session.districtName ?? ""} · ${t(lang, "phc.lastEntry")}: ${
          lastEntry.data ? formatDateTime(lastEntry.data.created_at) : t(lang, "phc.never")
        }`}
        actions={
          <div className="flex flex-wrap gap-2">
            <StockoutButton
              lang={lang}
              facilityId={fid}
              items={stock.map((r) => ({ id: r.medicineId, name: r.medicineName, unit: r.unit, quantity: r.quantity }))}
            />
            <Button asChild className="h-11 px-4">
              <Link href="/phc/entry">
                <NotebookPen aria-hidden="true" />
                {t(lang, "phc.recordToday")}
              </Link>
            </Button>
          </div>
        }
      />
      <OpenStockouts lang={lang} reports={openOuts} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t(lang, "phc.critical")} value={count("critical")} sub={t(lang, "phc.criticalHint")} status="critical" icon={AlertOctagon} />
        <StatTile label={t(lang, "phc.low")} value={count("low")} sub={t(lang, "phc.lowHint")} status="low" icon={AlertTriangle} />
        <StatTile label={t(lang, "phc.ok")} value={count("ok") + count("overstock")} sub={t(lang, "phc.okHint")} status="ok" icon={CheckCircle2} />
        <StatTile label={t(lang, "phc.openAlerts")} value={openAlerts} sub={t(lang, "phc.alertsHint")} icon={BellRing} href="/phc/alerts" />
      </div>

      <Section
        title={t(lang, "phc.needsAction")}
        className={actions.length ? "border-primary/40 ring-primary/10 ring-4" : undefined}
      >
        <ActionList items={actions} lang={lang} />
      </Section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Section title={t(lang, "nav.alerts")} actions={<Link href="/phc/alerts" className="text-primary text-sm font-medium">{t(lang, "notif.viewAll")}</Link>}>
          <AlertFeed alerts={alerts} limit={4} emptyText={t(lang, "phc.noAlerts")} lang={lang} />
        </Section>

        <Section title={t(lang, "phc.allMedicines")} bodyClassName="p-0">
          <ul className="divide-y">
            {sorted.map((r) => (
              <li key={r.medicineId}>
                <Link
                  href={`/phc/medicines/${r.medicineId}`}
                  className="hover:bg-accent/50 focus-visible:bg-accent/60 flex min-h-14 items-center gap-3 px-4 py-2.5 outline-none"
                >
                  <StatusIcon status={r.status} className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.medicineName}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatNumber(r.quantity)} {r.unit}s {t(lang, "phc.inStock")}
                    </p>
                  </div>
                  <DaysLeftBar daysLeft={r.daysLeft} resupplyDays={r.resupplyDays} status={r.status} className="w-32 min-w-0 shrink-0 sm:w-52" />
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}
