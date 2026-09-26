import "server-only"
import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { toLang, type Lang } from "@/lib/i18n"
import { HOME_ROUTE, type Role } from "@/lib/roles"
import type { Tables } from "@/lib/database.types"
import type { Viewer } from "@/lib/permissions"

export type Session = {
  userId: string
  email: string
  profile: Tables<"profiles">
  lang: Lang
  stateName: string | null
  districtName: string | null
  facility: Pick<Tables<"facilities">, "id" | "name" | "type" | "code"> | null
}

/** Current user + profile + scope names. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()
  if (!profile) return null

  const [stateRes, districtRes, facilityRes] = await Promise.all([
    profile.state_id
      ? supabase.from("states").select("name").eq("id", profile.state_id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.district_id
      ? supabase.from("districts").select("name").eq("id", profile.district_id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.facility_id
      ? supabase.from("facilities").select("id, name, type, code").eq("id", profile.facility_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    userId: user.id,
    email: user.email ?? "",
    profile,
    lang: toLang(profile.preferred_language),
    stateName: stateRes.data?.name ?? null,
    districtName: districtRes.data?.name ?? null,
    facility: facilityRes.data ?? null,
  }
})

export function toViewer(session: Session): Viewer {
  return {
    role: session.profile.role,
    facilityId: session.profile.facility_id,
    districtId: session.profile.district_id,
    stateId: session.profile.state_id,
    phcPosition: session.profile.phc_position ?? "staff",
  }
}

/** Guard for a role's route segment: anyone else is sent to their own home. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await getSession()
  if (!session) redirect("/login")
  if (!roles.includes(session.profile.role)) redirect(HOME_ROUTE[session.profile.role])
  return session
}
