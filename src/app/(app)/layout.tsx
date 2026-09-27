import { redirect } from "next/navigation"
import { AppShell } from "@/components/heal/app-shell"
import { NoProfile } from "@/components/heal/no-profile"
import { getSession } from "@/lib/session"
import { createClient } from "@/lib/supabase/server"
import { NAV } from "@/lib/roles"

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession()
  if (!session) {
    // Signed in but no profile row: the demo-user script hasn't linked this account.
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect("/login")
    // an invited successor gets their profile when they accept the handover
    const { data: handover } = await supabase.from("admin_handovers").select("id").eq("to_user", user.id).eq("status", "pending").limit(1)
    if (handover?.length) redirect("/handover")
    return <NoProfile email={user.email ?? ""} />
  }
  if (!session.profile.is_active) return <NoProfile email={session.email} deactivated />

  const { profile, lang, stateName, districtName, facility } = session
  const crumbs = [profile.role === "national_admin" ? "India" : null, stateName, districtName, facility?.name].filter(
    (c): c is string => Boolean(c),
  )

  return (
    <AppShell
      user={{ id: profile.id, name: profile.full_name, email: session.email, role: profile.role, phcPosition: profile.phc_position ?? "staff", facilityType: session.facility?.type ?? null }}
      nav={NAV[profile.role]}
      crumbs={crumbs}
      lang={lang}
    >
      {children}
    </AppShell>
  )
}
