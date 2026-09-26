// Database setup over SUPABASE_DB_URL: the base schema and seed (db/base) plus the upgrades (db/migrations, db/seed).
//   npm run db:setup  -> 01_schema.sql (skipped if tables exist) + 02_seed.sql (skipped if already seeded)
//                        + db/migrations/002_upgrade.sql (safe to re-run) + db/seed/002_upgrade_seed.sql (skipped if Gujarat exists)
//                        + db/migrations/003_phc_doctors.sql + 004_state_medicines.sql (safe to re-run)
//   npm run db:reset  -> 03_reset.sql + 01_schema.sql + 02_seed.sql + 002 upgrade + demo users   (wipes all app data)
//   npm run db:types  -> regenerate src/lib/database.types.ts from the live project
import { execSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Client, type QueryResult } from "pg"

const KIT = path.resolve(__dirname, "..", "db", "base")
const ROOT = path.resolve(__dirname, "..")

// kit files by name; the app's own files by their path under heal/
function sql(file: string): string {
  return readFileSync(file.startsWith("db/") ? path.join(ROOT, file) : path.join(KIT, file), "utf8")
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} in .env.local`)
    process.exit(1)
  }
  return value
}

async function connect(): Promise<Client> {
  const client = new Client({
    connectionString: requireEnv("SUPABASE_DB_URL"),
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  return client
}

async function run(client: Client, file: string): Promise<QueryResult[]> {
  const started = Date.now()
  process.stdout.write(`  running ${file} … `)
  const res = (await client.query(sql(file))) as QueryResult | QueryResult[]
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  return Array.isArray(res) ? res : [res]
}

function printSeedSummary(results: QueryResult[]) {
  const last = [...results].reverse().find((r) => r.command === "SELECT" && r.rows.length > 0)
  if (!last) return
  console.log("\nSeed check: PHC medicine lines by status, per district")
  console.table(last.rows)
}

async function setup(client: Client) {
  const { rows } = await client.query<{ exists: boolean }>(
    "select to_regclass('public.facilities') is not null as exists",
  )
  if (rows[0]?.exists) {
    console.log("  schema already present, skipping 01_schema.sql")
  } else {
    await run(client, "01_schema.sql")
  }

  const seeded = await client.query<{ n: string }>("select count(*)::text as n from facilities")
  if (Number(seeded.rows[0]?.n ?? 0) > 0) {
    console.log("  data already seeded, skipping 02_seed.sql (use npm run db:reset to start fresh)")
    const summary = await client.query(
      "select district_name, status, count(*) from v_stock_status where facility_type = 'phc' group by 1, 2 order by 1, 2",
    )
    printSeedSummary([summary])
  } else {
    printSeedSummary(await run(client, "02_seed.sql"))
  }
  await upgrade(client)
}

// national admin, surges, footfall, batches, admin console; then the second state (Gujarat)
async function upgrade(client: Client) {
  await run(client, "db/migrations/002_upgrade.sql")
  const gj = await client.query<{ n: string }>("select count(*)::text as n from states where code = 'GJ'")
  if (Number(gj.rows[0]?.n ?? 0) > 0) console.log("  Gujarat already seeded, skipping 002_upgrade_seed.sql")
  else await run(client, "db/seed/002_upgrade_seed.sql")
  await run(client, "db/migrations/003_phc_doctors.sql")
  await run(client, "db/migrations/004_state_medicines.sql")
}

async function reset(client: Client) {
  await run(client, "03_reset.sql")
  await run(client, "01_schema.sql")
  printSeedSummary(await run(client, "02_seed.sql"))
  await upgrade(client)
}

function demoUsers() {
  console.log("\nCreating demo users …")
  execSync("npx tsx --env-file=.env.local scripts/create-demo-users.ts", { cwd: ROOT, stdio: "inherit" })
}

function types() {
  requireEnv("SUPABASE_ACCESS_TOKEN")
  const ref = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).hostname.split(".")[0]
  console.log(`Generating types for project ${ref} …`)
  const out = execSync(`npx --yes supabase gen types typescript --project-id ${ref} --schema public`, {
    cwd: ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
  writeFileSync(path.join(ROOT, "src", "lib", "database.types.ts"), out)
  console.log("  wrote src/lib/database.types.ts")
}

async function main() {
  const command = process.argv[2]
  if (command === "types") return types()

  const client = await connect()
  try {
    if (command === "setup") await setup(client)
    else if (command === "reset") await reset(client)
    else throw new Error("Usage: db-setup.ts setup | reset | types")
  } finally {
    await client.end()
  }
  if (command === "reset") demoUsers()
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
