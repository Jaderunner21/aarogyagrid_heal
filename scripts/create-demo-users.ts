// Creates (or re-links) every demo account. Safe to re-run after a database reset.
// Run: npm run demo-users   (= npx tsx --env-file=.env.local scripts/create-demo-users.ts)
import { createClient } from "@supabase/supabase-js"
import type { Database } from "../src/lib/database.types"
import { DEMO_ACCOUNTS } from "../src/lib/demo-accounts"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = process.env.DEMO_PASSWORD

if (!url || !serviceKey || !password) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or DEMO_PASSWORD in .env.local")
  process.exit(1)
}

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function existingUsers(): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    data.users.forEach((u) => u.email && byEmail.set(u.email.toLowerCase(), u.id))
    if (data.users.length < 1000) break
  }
  return byEmail
}

async function main() {
  const [states, districts, facilities] = await Promise.all([
    supabase.from("states").select("id, code"),
    supabase.from("districts").select("id, code"),
    supabase.from("facilities").select("id, code"),
  ])
  for (const r of [states, districts, facilities]) if (r.error) throw r.error

  const stateId = new Map(states.data!.map((s) => [s.code, s.id]))
  const districtId = new Map(districts.data!.map((d) => [d.code, d.id]))
  const facilityId = new Map(facilities.data!.map((f) => [f.code, f.id]))
  if (facilityId.size === 0) throw new Error("No facilities found. Run 01_schema.sql and 02_seed.sql first.")

  const users = await existingUsers()
  let created = 0
  let reused = 0

  for (const acc of DEMO_ACCOUNTS) {
    let id = users.get(acc.email)
    if (id) {
      const { error } = await supabase.auth.admin.updateUserById(id, { password, email_confirm: true })
      if (error) throw error
      reused++
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: acc.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: acc.fullName },
      })
      if (error) throw error
      id = data.user.id
      created++
    }

    const scope =
      acc.role === "national_admin"
        ? {}
        : acc.role === "state_admin"
          ? { state_id: stateId.get(acc.scope) ?? null }
          : acc.role === "district_officer"
            ? { district_id: districtId.get(acc.scope) ?? null }
            : { facility_id: facilityId.get(acc.scope) ?? null }
    if (Object.values(scope)[0] === null) {
      console.warn(`  ! ${acc.email}: scope ${acc.scope} not found (run db/seed/002_upgrade_seed.sql?) — skipped`)
      continue
    }

    const { error } = await supabase.from("profiles").upsert(
      {
        id,
        full_name: acc.fullName,
        role: acc.role,
        email: acc.email,
        is_active: true,
        facility_id: null,
        district_id: null,
        state_id: null,
        ...scope,
        ...(acc.role === "phc_staff" ? { phc_position: acc.phcPosition ?? "staff" } : {}),
      },
      { onConflict: "id" },
    )
    if (error) throw new Error(`Profile for ${acc.email}: ${error.message}`)
    console.log(`  ✓ ${acc.email.padEnd(28)} ${acc.role.padEnd(18)} ${acc.scope}`)
  }

  console.log(`\nDone: ${created} created, ${reused} re-used, ${DEMO_ACCOUNTS.length} profiles upserted.`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
