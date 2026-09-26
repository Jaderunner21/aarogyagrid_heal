import { NextResponse } from "next/server"
import { z } from "zod"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { getCaller } from "@/lib/api-auth"

const body = z.object({ id: z.uuid(), active: z.boolean(), reason: z.string().optional() })

/** Deactivate / reactivate: the RPC checks scope and writes the audit log; then the sign-in itself is blocked. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const caller = await getCaller(request)
  if (caller?.kind !== "user") return NextResponse.json({ error: "Sign in required" }, { status: 401 })
  const { id, active, reason } = parsed.data
  const userDb = await createClient()
  const { error } = await userDb.rpc("admin_set_person_active", { p_id: id, p_active: active, p_reason: reason || undefined })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  const { error: banError } = await createAdminClient().auth.admin.updateUserById(id, { ban_duration: active ? "none" : "876000h" })
  if (banError) console.error("[person-active] could not update sign-in ban", banError.message)
  return NextResponse.json({ ok: true })
}
