import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowLeftRight, Check, Users, X } from "lucide-react"
import { format, subDays } from "date-fns"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/heal/page-header"
import { StatusBadge } from "@/components/heal/status-badge"
import { StockTable } from "@/components/heal/stock-table"
import { TrendCharts } from "@/components/heal/trend-charts"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { EmptyState } from "@/components/heal/empty-state"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getBedsByType, getFacilitySummaries, getIndents, getStock, getTransfers } from "@/lib/queries"
import { Badge } from "@/components/ui/badge"
import { BED_TYPE_LABEL, TIER_LABEL } from "@/lib/facility-types"
import { formatDaysLeft, formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "Facility" }

export default async function FacilityDetail({ params }: PageProps<"/district/facilities/[id]">) {
  const { id } = await params
  const session = await requireRole("district_officer")
  const db = await createClient()
  const summaries = await getFacilitySummaries(db, { districtId: session.profile.district_id! })
  const facility = summaries.find((f) => f.id === id)
  if (!facility) notFound()

  const since30 = format(subDays(new Date(), 30), "yyyy-MM-dd")
  const since14 = format(subDays(new Date(), 13), "yyyy-MM-dd")
  const [stock, transfers, indents, reports, staff, beds, supplier] = await Promise.all([
    getStock(db, { facilityId: id }),
    getTransfers(db, { facilityId: id }),
    facility.type === "warehouse" ? getIndents(db, { warehouseId: id }) : getIndents(db, { facilityId: id }),
    db.from("daily_reports").select("report_date, footfall, occupied_beds").eq("facility_id", id).gte("report_date", since30).order("report_date"),
    db.from("staff").select("*").eq("facility_id", id).order("name"),
    getBedsByType(db, id),
    facility.supplierId ? db.from("facilities").select("name, type").eq("id", facility.supplierId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const staffIds = (staff.data ?? []).map((s) => s.id)
  const attendance = staffIds.length
    ? (await db.from("attendance").select("*").in("staff_id", staffIds).gte("att_date", since14)).data ?? []
    : []
  const days = Array.from({ length: 14 }, (_, i) => format(subDays(new Date(), 13 - i), "yyyy-MM-dd"))
  const att = new Map(attendance.map((a) => [`${a.staff_id}:${a.att_date}`, a.present]))
  const attStatus = new Map(attendance.map((a) => [`${a.staff_id}:${a.att_date}`, a.status]))
  const districtStock = await getStock(db, { districtId: facility.districtId })
  const items = enrich([...transfers, ...indents], districtStock)

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/district/facilities">
          <ArrowLeft aria-hidden="true" /> All facilities
        </Link>
      </Button>
      <PageHeader
        title={facility.name}
        description={`${facility.code} · ${TIER_LABEL[facility.tier]}${facility.type === "warehouse" || facility.type === "shc" ? "" : ` · ${facility.totalBeds} beds`} · resupply ${facility.resupplyDays} days · most urgent: ${formatDaysLeft(facility.minDaysLeft).toLowerCase()}`}
        actions={<StatusBadge status={facility.status} />}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {facility.hfrId ? <Badge variant="outline">HFR {facility.hfrId}</Badge> : null}
        {facility.laqshya ? <Badge className="border border-pink-200 bg-pink-50 text-pink-700">LaQshya certified labour room</Badge> : null}
        {supplier.data ? (
          <span className="text-muted-foreground">
            Supplied by <span className="text-foreground font-medium">{supplier.data.name}</span>
          </span>
        ) : null}
      </div>
      {beds.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {beds.map((b) => {
            const full = b.occupied !== null && b.total > 0 && b.occupied / b.total >= 0.9
            return (
              <div key={b.bedType} className={cn("bg-card rounded-lg border px-3 py-2", full && "border-critical/50 bg-red-50/50")}>
                <p className="text-muted-foreground text-[11px]">{BED_TYPE_LABEL[b.bedType]}</p>
                <p className={cn("text-lg font-semibold tabular-nums", full && "text-critical")}>
                  {b.occupied ?? "—"}
                  <span className="text-muted-foreground text-xs font-normal"> / {b.total}</span>
                </p>
              </div>
            )
          })}
        </div>
      ) : null}

      <Tabs defaultValue="stock" className="gap-4">
        <TabsList className="h-auto flex-wrap group-data-horizontal/tabs:h-auto">
          <TabsTrigger value="stock" className="h-9 px-3">Stock</TabsTrigger>
          {facility.type !== "warehouse" ? <TabsTrigger value="trends" className="h-9 px-3">Trends</TabsTrigger> : null}
          <TabsTrigger value="staff" className="h-9 px-3">Staff</TabsTrigger>
          <TabsTrigger value="flows" className="h-9 px-3">Transfers &amp; indents ({items.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <StockTable rows={stock} />
        </TabsContent>

        {facility.type !== "warehouse" ? (
          <TabsContent value="trends">
            <TrendCharts
              totalBeds={facility.totalBeds}
              data={(reports.data ?? []).map((r) => ({ date: r.report_date, footfall: r.footfall, occupied: r.occupied_beds }))}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="staff">
          <div className="bg-card overflow-x-auto rounded-xl border">
            {(staff.data ?? []).length === 0 ? (
              <EmptyState icon={Users} title="No staff recorded for this facility." />
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <caption className="text-muted-foreground px-4 py-3 text-left text-xs">
                  14-day attendance · 7-day rate {formatPercent(facility.attendance7d)}
                </caption>
                <thead className="bg-muted/50 text-muted-foreground text-xs">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Role</th>
                    {days.map((d) => (
                      <th key={d} className="px-0.5 py-2 text-center font-medium">
                        {format(new Date(d), "d")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(staff.data ?? []).map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{s.name}</td>
                      <td className="text-muted-foreground px-3 py-2 whitespace-nowrap">
                        <span className="capitalize">{s.role.replace(/_/g, " ")}</span>
                        {s.hpr_id ? <span className="block text-[10px]">HPR {s.hpr_id}</span> : null}
                      </td>
                      {days.map((d) => {
                        const p = att.get(`${s.id}:${d}`)
                        const st = attStatus.get(`${s.id}:${d}`)
                        const away = st === "on_leave" || st === "on_deputation"
                        return (
                          <td key={d} className="px-0.5 py-2 text-center">
                            <span
                              className={cn(
                                "mx-auto flex size-5 items-center justify-center rounded text-[9px] font-semibold",
                                p === true && "bg-green-100 text-ok",
                                p === false && !away && "bg-red-100 text-critical",
                                away && "bg-amber-100 text-amber-800",
                                p === undefined && "bg-muted",
                              )}
                              aria-label={`${d}: ${p === true ? "on duty" : away ? (st === "on_leave" ? "on leave" : "on deputation") : p === false ? "absent" : "not marked"}`}
                              title={away ? (st === "on_leave" ? "Leave" : "Deputation") : undefined}
                            >
                              {p === true ? <Check className="size-3" /> : away ? (st === "on_leave" ? "L" : "D") : p === false ? <X className="size-3" /> : null}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="flows">
          <RecommendationList
            items={items}
            viewer={toViewer(session)}
            emptyIcon={ArrowLeftRight}
            emptyText={`No transfers or indents for ${facility.name} yet.`}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
