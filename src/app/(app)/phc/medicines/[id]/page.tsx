import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/heal/page-header"
import { StatusBadge } from "@/components/heal/status-badge"
import { ForecastPanel } from "@/components/heal/forecast-panel"
import { requireRole } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { getForecastDetail } from "@/lib/queries"
import { t } from "@/lib/i18n"

export const metadata: Metadata = { title: "Medicine" }

export default async function PhcMedicine({ params }: PageProps<"/phc/medicines/[id]">) {
  const { id } = await params
  const session = await requireRole("phc_staff")
  const db = await createClient()
  const detail = await getForecastDetail(db, session.profile.facility_id!, id)
  if (!detail.stock) notFound()

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/phc">
          <ArrowLeft aria-hidden="true" />
          {t(session.lang, "phc.back")}
        </Link>
      </Button>
      <PageHeader
        title={detail.stock.medicineName}
        description={`${detail.stock.category} · ${session.facility?.name ?? ""}`}
        actions={<StatusBadge status={detail.stock.status} lang={session.lang} />}
      />
      <div className="bg-card rounded-xl border p-4">
        <ForecastPanel detail={detail} lang={session.lang} />
      </div>
    </div>
  )
}
