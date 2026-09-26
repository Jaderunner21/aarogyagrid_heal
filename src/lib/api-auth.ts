import "server-only"
import { createClient } from "@/lib/supabase/server"
import type { DB } from "@/lib/queries"
import type { Tables } from "@/lib/database.types"

export type Caller = { kind: "cron" } | { kind: "user"; profile: Tables<"profiles"> }

/** Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function isCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`
}

export async function getCaller(request: Request): Promise<Caller | null> {
  if (isCron(request)) return { kind: "cron" }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle()
  return profile && profile.is_active ? { kind: "user", profile } : null
}

/** Engine / AI scope rules. `admin` is the service-role client, used only to look up geography. */
export async function canAccessScope(
  admin: DB,
  caller: Caller,
  scope: "facility" | "district" | "state" | "national",
  id: string,
): Promise<boolean> {
  if (caller.kind === "cron") return true
  const p = caller.profile
  if (p.role === "national_admin") return true
  if (scope === "national") return false
  if (scope === "state") return p.role === "state_admin" && p.state_id === id
  if (scope === "district") {
    if (p.role === "district_officer") return p.district_id === id
    if (p.role === "state_admin") {
      const { data } = await admin.from("districts").select("state_id").eq("id", id).maybeSingle()
      return data?.state_id === p.state_id
    }
    return false
  }
  // facility
  if (p.role === "phc_staff" || p.role === "warehouse_manager") return p.facility_id === id
  const { data: f } = await admin.from("facilities").select("district_id").eq("id", id).maybeSingle()
  if (!f) return false
  if (p.role === "district_officer") return p.district_id === f.district_id
  const { data: d } = await admin.from("districts").select("state_id").eq("id", f.district_id).maybeSingle()
  return d?.state_id === p.state_id
}
