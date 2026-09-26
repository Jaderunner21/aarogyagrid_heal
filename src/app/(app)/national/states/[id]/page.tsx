import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/heal/page-header"
import { RunAnalysisButton } from "@/components/heal/run-analysis-button"
import { StateOverview } from "@/components/heal/state-overview"
import { requireRole, toViewer } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"

export const metadata: Metadata = { title: "State" }

export default async function NationalState({ params }: PageProps<"/national/states/[id]">) {
  const { id } = await params
  const session = await requireRole("national_admin")
  const db = await createClient()
  const { data: state } = await db.from("states").select("*").eq("id", id).maybeSingle()
  if (!state) notFound()
  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link href="/national">
          <ArrowLeft aria-hidden="true" /> India overview
        </Link>
      </Button>
      <PageHeader
        title={`${state.name} state overview`}
        description="The state admin's view, with national permissions."
        actions={<RunAnalysisButton scope="state" id={state.id} />}
      />
      <StateOverview db={db} stateId={state.id} stateName={state.name} viewer={toViewer(session)} />
    </div>
  )
}
