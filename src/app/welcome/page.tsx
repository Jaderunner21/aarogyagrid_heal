import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { HealLogo } from "@/components/heal/logo"
import { createClient } from "@/lib/supabase/server"
import { SetPasswordForm } from "./set-password-form"

export const metadata: Metadata = { title: "Welcome" }

// Invited people land here from their link and choose a password.
export default async function WelcomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
  const { data: handover } = await supabase.from("admin_handovers").select("id").eq("to_user", user.id).eq("status", "pending").limit(1)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <HealLogo />
      <div className="bg-card w-full max-w-sm space-y-4 rounded-xl border p-6">
        <div>
          <h1 className="text-lg font-semibold">Welcome{profile?.full_name ? `, ${profile.full_name}` : ""}</h1>
          <p className="text-muted-foreground text-sm">Choose a password for {user.email}. You&apos;ll use it to sign in next time.</p>
        </div>
        <SetPasswordForm next={handover?.length ? "/handover" : "/"} />
      </div>
    </main>
  )
}
