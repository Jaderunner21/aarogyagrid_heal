import type { Metadata } from "next"
import Link from "next/link"
import { format, subDays } from "date-fns"
import { Boxes, Building2, ClipboardList, Crown, Pill, Users } from "lucide-react"
import { PageHeader } from "@/components/heal/page-header"
import { FacilitiesTab, type AdminFacility } from "@/components/heal/admin/facilities-tab"
import { PeopleTab, type AdminPerson } from "@/components/heal/admin/people-tab"
import { AdminsTab } from "@/components/heal/admin/admins-tab"
import { MedicinesTab } from "@/components/heal/admin/medicines-tab"
import { BatchesTab, type AdminBatch } from "@/components/heal/admin/batches-tab"
import { AuditTab } from "@/components/heal/admin/audit-tab"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { cn } from "@/lib/utils"
import { getMedicineRequests } from "@/lib/queries"

export const metadata: Metadata = { title: "Admin console" }

const TABS = [
  { key: "facilities", label: "Facilities", icon: Building2 },
  { key: "people", label: "People", icon: Users },
  { key: "admins", label: "Admins", icon: Crown },
  { key: "medicines", label: "Medicines", icon: Pill },
  { key: "batches", label: "Batches & expiry", icon: Boxes },
  { key: "audit", label: "Audit log", icon: ClipboardList },
] as const
type TabKey = (typeof TABS)[number]["key"]

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const session = await requireRole("state_admin", "national_admin")
  const { tab: tabParam } = await searchParams
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "facilities"
  const isNational = session.profile.role === "national_admin"
  const db = await createClient()

  // ---- scope: national sees every state; a state admin only their own
  const statesQ = db.from("states").select("id, name, code").order("name")
  const [statesRes, districtsRes] = await Promise.all([
    isNational ? statesQ : statesQ.eq("id", session.profile.state_id!),
    db.from("districts").select("id, name, code, state_id").order("name"),
  ])
  const states = statesRes.data ?? []
  const stateIds = new Set(states.map((s) => s.id))
  const districts = (districtsRes.data ?? []).filter((d) => stateIds.has(d.state_id))
  const districtIds = districts.map((d) => d.id)
  const districtById = new Map(districts.map((d) => [d.id, d]))
  const stateName = new Map(states.map((s) => [s.id, s.name]))

  const { data: facilityRows } = await db.from("facilities").select("*").in("district_id", districtIds).order("name")
  const facilityById = new Map((facilityRows ?? []).map((f) => [f.id, f]))
  const facilities: AdminFacility[] = (facilityRows ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    code: f.code,
    type: f.type,
    districtId: f.district_id,
    districtName: districtById.get(f.district_id)?.name ?? "",
    stateName: stateName.get(districtById.get(f.district_id)?.state_id ?? "") ?? "",
    lat: f.lat,
    lng: f.lng,
    address: f.address,
    totalBeds: f.total_beds,
    resupplyDays: f.resupply_days,
    supplyingWarehouse: f.supplying_warehouse,
    supplyingWarehouseName: f.supplying_warehouse ? (facilityById.get(f.supplying_warehouse)?.name ?? "") : null,
    isActive: f.is_active,
    openedOn: f.opened_on,
  }))

  const scopeLabel = isNational ? "All states" : (states[0]?.name ?? "")
  const common = {
    isNational,
    states: states.map((s) => ({ id: s.id, name: s.name })),
    districts: districts.map((d) => ({ id: d.id, name: d.name, code: d.code, stateId: d.state_id, stateName: stateName.get(d.state_id) ?? "" })),
    facilities,
  }

  let body: React.ReactNode = null
  if (tab === "facilities") {
    const { data: bedChanges } = await db
      .from("facility_bed_changes")
      .select("facility_id, total_beds, effective_from")
      .is("applied_at", null)
      .in("facility_id", facilities.map((f) => f.id).slice(0, 300))
    body = <FacilitiesTab {...common} pendingBeds={bedChanges ?? []} />
  } else if (tab === "people" || tab === "admins") {
    const { data: people } = await db.from("profiles").select("*").order("full_name")
    const rows: AdminPerson[] = (people ?? [])
      .map((p) => {
        const f = p.facility_id ? facilityById.get(p.facility_id) : null
        const d = p.district_id ? districtById.get(p.district_id) : null
        const inScope = isNational || p.state_id === session.profile.state_id
        return {
          id: p.id,
          fullName: p.full_name,
          email: p.email,
          phone: p.phone,
          role: p.role,
          facilityId: p.facility_id,
          districtId: p.district_id,
          stateId: p.state_id,
          scopeName: f ? `${f.name}, ${districtById.get(f.district_id)?.name ?? ""}` : d ? `${d.name} district` : p.state_id ? (stateName.get(p.state_id) ?? "State") : "India",
          isActive: p.is_active,
          inScope,
          phcPosition: p.phc_position ?? "staff",
        }
      })
      .filter((p) => p.inScope)
    if (tab === "people") {
      body = <PeopleTab {...common} people={rows} meId={session.userId} />
    } else {
      const { data: handovers } = await db.from("admin_handovers").select("*").order("created_at", { ascending: false }).limit(50)
      body = (
        <AdminsTab
          {...common}
          people={rows}
          meId={session.userId}
          myRole={session.profile.role}
          myStateId={session.profile.state_id}
          handovers={(handovers ?? []).map((h) => ({
            ...h,
            fromName: rows.find((p) => p.id === h.from_user)?.fullName ?? "Previous admin",
            stateName: h.scope_id ? (stateName.get(h.scope_id) ?? "") : "India",
          }))}
        />
      )
    }
  } else if (tab === "medicines") {
    // RLS: the national list plus this admin's state list (national admin: every list)
    const [{ data: medicines }, requests] = await Promise.all([
      db.from("medicines").select("*").order("name"),
      getMedicineRequests(db, isNational ? {} : { stateId: session.profile.state_id! }),
    ])
    body = (
      <MedicinesTab
        isNational={isNational}
        medicines={medicines ?? []}
        states={states.map((st) => ({ id: st.id, name: st.name }))}
        myStateId={session.profile.state_id}
        requests={requests}
        meId={session.userId}
        myRole={session.profile.role}
      />
    )
  } else if (tab === "batches") {
    const facilityIds = facilities.map((f) => f.id)
    const batches: AdminBatch[] = []
    const { data: meds } = await db.from("medicines").select("id, name, unit, status")
    const med = new Map((meds ?? []).map((m) => [m.id, m]))
    for (let i = 0; i < facilityIds.length; i += 40) {
      for (let from = 0; ; from += 1000) {
        const { data } = await db
          .from("stock_batches")
          .select("*")
          .in("facility_id", facilityIds.slice(i, i + 40))
          .order("expiry_date")
          .range(from, from + 999)
        for (const b of data ?? []) {
          const f = facilityById.get(b.facility_id)
          const m = med.get(b.medicine_id)
          batches.push({
            id: b.id,
            facilityId: b.facility_id,
            facilityName: f?.name ?? "",
            districtName: districtById.get(f?.district_id ?? "")?.name ?? "",
            medicineId: b.medicine_id,
            medicineName: m?.name ?? "",
            medicineStatus: (m?.status as AdminBatch["medicineStatus"]) ?? "active",
            unit: m?.unit ?? "",
            batchNo: b.batch_no,
            expiryDate: b.expiry_date,
            qty: Number(b.qty),
            status: b.status,
          })
        }
        if ((data ?? []).length < 1000) break
      }
    }
    const since = format(subDays(new Date(), 30), "yyyy-MM-dd")
    const { data: wastage } = await db
      .from("stock_log")
      .select("facility_id, medicine_id, qty_out, log_date, note")
      .eq("source", "wastage")
      .gte("log_date", since)
      .in("facility_id", facilityIds.slice(0, 300))
      .order("log_date", { ascending: false })
      .limit(500)
    body = (
      <BatchesTab
        {...common}
        batches={batches}
        medicines={(meds ?? []).map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
        wastage={(wastage ?? []).map((w) => ({
          facilityName: facilityById.get(w.facility_id)?.name ?? "",
          medicineName: med.get(w.medicine_id)?.name ?? "",
          qty: Number(w.qty_out),
          date: w.log_date,
          note: w.note,
        }))}
      />
    )
  } else {
    const { data: audit } = await db.from("audit_log").select("*").order("at", { ascending: false }).limit(500)
    body = (
      <AuditTab
        entries={(audit ?? []).map((a) => ({ ...a, stateName: a.state_id ? (stateName.get(a.state_id) ?? "") : "National" }))}
      />
    )
  }

  return (
    <div>
      <PageHeader
        title="Admin console"
        description={`${scopeLabel} · every change is scoped to your role and recorded in the audit log.`}
      />
      <nav aria-label="Admin sections" className="bg-muted mb-5 flex flex-wrap gap-1 rounded-lg p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <Link
            key={key}
            href={`/admin?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium",
              tab === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  )
}
