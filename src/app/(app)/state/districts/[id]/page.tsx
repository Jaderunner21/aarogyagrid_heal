import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/heal/page-header"
import { DistrictOverview } from "@/components/heal/district-overview"
import { RunAnalysisButton } from "@/components/heal/run-analysis-button"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "District" }

export default async function StateDistrict({ params }: PageProps<"/state/districts/[id]">) {
  const { id } = await params
  const session = await requireRole("state_admin", "national_admin")
  const db = await createClient()
  let q = db.from("districts").select("*").eq("id", id)
  if (session.profile.role === "state_admin") q = q.eq("state_id", session.profile.state_id!)
  const { data: district } = await q.maybeSingle()
  if (!district) notFound()

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href={session.profile.role === "national_admin" ? `/national/states/${district.state_id}` : "/state"}>
          <ArrowLeft aria-hidden="true" /> State overview
        </Link>
      </Button>
      <PageHeader
        title={`${district.name} district`}
        description="The district officer's view, with state permissions: you can approve cross-district transfers here."
        actions={<RunAnalysisButton scope="district" id={district.id} />}
      />
      <DistrictOverview db={db} districtId={district.id} viewer={toViewer(session)} />
    </div>
  )
}
