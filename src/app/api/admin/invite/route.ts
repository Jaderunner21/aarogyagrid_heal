import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCaller } from "@/lib/api-auth"

const role = z.enum(["phc_staff", "warehouse_manager", "district_officer", "state_admin", "national_admin"])
const uuid = z.uuid().nullish()
const body = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("person"),
    email: z.email(),
    full_name: z.string().trim().min(2),
    role,
    facility_id: uuid,
    district_id: uuid,
    state_id: uuid,
    phc_position: z.enum(["staff", "medical_officer"]).optional(),
  }),
  z.object({
    purpose: z.literal("handover"),
    email: z.email(),
    full_name: z.string().trim().min(2),
    old_action: z.enum(["demote", "deactivate"]),
    p_demote_role: role.optional(),
    p_demote_facility: z.uuid().optional(),
    p_demote_district: z.uuid().optional(),
    p_demote_state: z.uuid().optional(),
  }),
])

/**
 * Invite someone by email. Creates the sign-in account (or reuses an existing one) and returns a one-time
 * link the admin can send; with SMTP configured in Supabase the same link can be emailed instead.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Check the email, name and scope" }, { status: 400 })
  const input = parsed.data
  const caller = await getCaller(request)
  if (caller?.kind !== "user" || !["state_admin", "national_admin"].includes(caller.profile.role)) {
    return NextResponse.json({ error: "Only an admin can invite people" }, { status: 403 })
  }
  const userDb = await createClient()
  const admin = createAdminClient()

  if (input.purpose === "person") {
    const { data: allowed } = await userDb.rpc("admin_can_manage", {
      p_role: input.role,
      p_facility: input.facility_id ?? null,
      p_district: input.district_id ?? null,
      p_state: input.state_id ?? null,
    })
    if (!allowed) return NextResponse.json({ error: "That role or place is outside your scope" }, { status: 403 })
    if (input.role === "national_admin" || input.role === "state_admin") {
      return NextResponse.json({ error: "Admins are appointed from the Admins tab" }, { status: 400 })
    }
  }

  const email = input.email.toLowerCase()
  const origin = new URL(request.url).origin
  let link = await admin.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: input.full_name } } })
  let type: "invite" | "magiclink" = "invite"
  if (link.error) {
    // already has a sign-in account: send a sign-in link instead
    link = await admin.auth.admin.generateLink({ type: "magiclink", email })
    type = "magiclink"
  }
  if (link.error || !link.data.user) {
    return NextResponse.json({ error: link.error?.message ?? "Could not create the account" }, { status: 500 })
  }
  const userId = link.data.user.id
  const next = input.purpose === "handover" ? "/handover" : "/welcome"
  const url = `${origin}/auth/confirm?token_hash=${link.data.properties.hashed_token}&type=${type}&next=${encodeURIComponent(next)}`

  if (input.purpose === "person") {
    const { data: existing } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle()
    if (existing) return NextResponse.json({ error: "This email already has an AarogyaGrid profile. Edit it in the People list." }, { status: 409 })
    const { error } = await admin.rpc("admin_create_profile", {
      p_actor: caller.profile.id,
      p_user: userId,
      p_email: email,
      p_full_name: input.full_name,
      p_role: input.role,
      p_facility: input.facility_id ?? undefined,
      p_district: input.district_id ?? undefined,
      p_state: input.state_id ?? undefined,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (input.role === "phc_staff" && input.phc_position === "medical_officer") {
      const { error: posError } = await userDb.rpc("admin_set_phc_position", { p_id: userId, p_position: "medical_officer" })
      if (posError) return NextResponse.json({ error: posError.message }, { status: 400 })
    }
    return NextResponse.json({ link: url })
  }

  const { purpose: _purpose, email: _email, full_name: _name, old_action, ...demote } = input
  void _purpose
  void _email
  void _name
  const { error } = await userDb.rpc("request_admin_handover", { p_to_user: userId, p_old_action: old_action, ...demote })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // remember the name they gave, shown until the successor accepts
  await admin.from("admin_handovers").update({ to_name: input.full_name }).eq("to_user", userId).eq("status", "pending").is("to_name", null)
  return NextResponse.json({ link: url })
}
