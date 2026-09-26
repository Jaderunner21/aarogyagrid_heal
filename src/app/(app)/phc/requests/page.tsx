import type { Metadata } from "next"
import { ArrowLeftRight, ClipboardList, Stethoscope } from "lucide-react"
import { PageHeader } from "@/components/heal/page-header"
import { Section } from "@/components/heal/section"
import { RaiseIndentForm } from "@/components/heal/phc/raise-indent-form"
import { RecommendationList } from "@/components/heal/recommendation-list"
import { MedicineRequestList, NewMedicineRequestForm } from "@/components/heal/medicine-requests"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { enrich, getIndents, getMedicineRequests, getStock, getTransfers } from "@/lib/queries"
import { urgency } from "@/lib/status"
import { t } from "@/lib/i18n"

export const metadata: Metadata = { title: "Requests" }

export default async function PhcRequests() {
  const session = await requireRole("phc_staff")
  const lang = session.lang
  const fid = session.profile.facility_id!
  const db = await createClient()
  const [stock, indents, transfers, medRequests, doctors] = await Promise.all([
    getStock(db, { facilityId: fid }),
    getIndents(db, { facilityId: fid }),
    getTransfers(db, { facilityId: fid }),
    getMedicineRequests(db, { facilityId: fid }),
    // staff cannot read other profiles, so look up this PHC's doctor with the server key (name only)
    createAdminClient().from("profiles").select("full_name").eq("facility_id", fid).eq("phc_position", "medical_officer").eq("is_active", true),
  ])
  const isDoctor = session.profile.phc_position === "medical_officer"
  const doctorName = doctors.data?.[0]?.full_name ?? null
  // new medicines are asked for by the PHC doctor; where the PHC has no doctor account, staff can ask
  const canRequestMedicine = isDoctor || !doctorName
  const viewer = toViewer(session)
  const sortedStock = [...stock].sort((a, b) => urgency(a.status, a.daysLeft) - urgency(b.status, b.daysLeft))

  return (
    <div className="space-y-5">
      <PageHeader title={t(lang, "phc.requestsTitle")} description={session.facility?.name} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-5 self-start">
          <Section title={t(lang, "phc.raiseIndent")}>
            <RaiseIndentForm stock={sortedStock} lang={lang} />
          </Section>
          {canRequestMedicine ? (
            <Section title={t(lang, "mr.title")}>
              <NewMedicineRequestForm lang={lang} />
            </Section>
          ) : null}
        </div>
        <div className="space-y-5">
          <Section title={t(lang, "phc.myIndents")} bodyClassName="p-3">
            <RecommendationList
              items={enrich(indents, stock)}
              viewer={viewer}
              emptyIcon={ClipboardList}
              emptyText={t(lang, "phc.noIndents")}
              compact
              lang={lang}
            />
          </Section>
          <Section title={t(lang, "mr.mine")} bodyClassName="p-3" className="scroll-mt-24">
            <div id="medicine-requests" className="space-y-3">
              {canRequestMedicine ? null : (
                <p className="bg-muted flex items-start gap-2 rounded-md px-3 py-2 text-sm">
                  <Stethoscope className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {doctorName ? t(lang, "mr.askDoctor").replace("{name}", doctorName) : t(lang, "mr.askDoctorGeneric")}
                </p>
              )}
              <MedicineRequestList items={medRequests} viewer={{ id: session.userId, role: session.profile.role }} lang={lang} />
            </div>
          </Section>
          <Section title={t(lang, "phc.transfersInOut")} bodyClassName="p-3">
            <RecommendationList
              items={enrich(transfers, stock)}
              viewer={viewer}
              emptyIcon={ArrowLeftRight}
              emptyText={t(lang, "phc.noTransfers")}
              compact
              lang={lang}
            />
          </Section>
        </div>
      </div>
    </div>
  )
}
