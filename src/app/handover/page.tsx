import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HealLogo } from "@/components/heal/logo"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatDateTime } from "@/lib/format"
import { HandoverDecision } from "./handover-decision"

export const metadata: Metadata = { title: "Admin handover" }

// Works for existing users and for invitees who have no profile until they accept.
export default async function HandoverPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const [{ data: handovers }, { data: me }] = await Promise.all([
    supabase.from("admin_handovers").select("*").eq("to_user", user.id).eq("status", "pending").order("created_at", { ascending: false }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ])

  // names of the people handing over and their states (an invitee can't read profiles yet)
  const admin = createAdminClient()
  const fromIds = [...new Set((handovers ?? []).map((h) => h.from_user))]
  const stateIds = [...new Set((handovers ?? []).map((h) => h.scope_id).filter((s): s is string => Boolean(s)))]
  const [{ data: from }, { data: states }] = await Promise.all([
    admin.from("profiles").select("id, full_name").in("id", fromIds.length ? fromIds : ["00000000-0000-0000-0000-000000000000"]),
    admin.from("states").select("id, name").in("id", stateIds.length ? stateIds : ["00000000-0000-0000-0000-000000000000"]),
  ])
  const fromName = new Map((from ?? []).map((p) => [p.id, p.full_name]))
  const stateName = new Map((states ?? []).map((s) => [s.id, s.name]))

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <HealLogo />
      <div className="w-full max-w-md space-y-4">
        {!handovers?.length ? (
          <div className="bg-card space-y-3 rounded-xl border p-6 text-center">
            <ArrowRightLeft className="text-muted-foreground mx-auto size-8" aria-hidden="true" />
            <h1 className="font-semibold">No handover is waiting for you</h1>
            <Button asChild variant="outline">
              <Link href="/">Go to AarogyaGrid</Link>
            </Button>
          </div>
        ) : (
          handovers.map((h) => (
            <div key={h.id} className="bg-card space-y-3 rounded-xl border p-6">
              <ArrowRightLeft className="text-primary size-7" aria-hidden="true" />
              <h1 className="text-lg font-semibold">
                Take over as {h.scope_type === "state" ? `state admin of ${stateName.get(h.scope_id ?? "") ?? "your state"}` : "national admin"}?
              </h1>
              <p className="text-muted-foreground text-sm">
                {fromName.get(h.from_user) ?? "The current admin"} asked on {formatDateTime(h.created_at)}. When you accept, you get the
                admin console for {h.scope_type === "state" ? "this state" : "the whole country"} and they{" "}
                {h.old_admin_action === "deactivate" ? "leave AarogyaGrid" : "move to their new role"}. This is recorded in the audit log.
              </p>
              <HandoverDecision id={h.id} needsName={!me} defaultName={h.to_name ?? ""} />
            </div>
          ))
        )}
      </div>
    </main>
  )
}
