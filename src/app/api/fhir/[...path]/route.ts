import type { NextRequest } from "next/server"
import { createClient as createSupabase } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Database, Tables } from "@/lib/database.types"
import type { DB } from "@/lib/queries"
import {
  RESOURCE_TYPES,
  capabilityStatement,
  districtOrganization,
  facilityLocation,
  facilityOrganization,
  indentSupplyDelivery,
  indentSupplyRequest,
  isDevice,
  itemResource,
  operationOutcome,
  searchBundle,
  stateOrganization,
  transferSupplyDelivery,
  transferSupplyRequest,
  type Resource,
  type ResourceType,
  type SentBatch,
} from "@/lib/fhir"

// Read-only FHIR R4 API. Row-level security decides what each caller sees, exactly as in the app.
//   GET /api/fhir/metadata                       CapabilityStatement (no sign-in needed)
//   GET /api/fhir/{type}?param=value             search → Bundle
//   GET /api/fhir/{type}/{id}                    read

const HEADERS = { "content-type": "application/fhir+json; charset=utf-8", "cache-control": "no-store" }
const MAX_ROWS = 2000 // orders and deliveries: the most recent rows per kind

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: HEADERS })

/** The caller's database client: a Bearer access token (other systems) or the browser session. */
async function callerDb(request: NextRequest): Promise<DB | null> {
  const auth = request.headers.get("authorization")
  let db: DB
  if (auth?.startsWith("Bearer ")) {
    db = createSupabase<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as DB
    const { data } = await db.auth.getUser(auth.slice(7))
    if (!data.user) return null
  } else {
    db = await createClient()
    const { data } = await db.auth.getUser()
    if (!data.user) return null
  }
  return db
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/fhir/[...path]">) {
  const { path } = await ctx.params
  const url = new URL(request.url)
  const base = `${url.origin}/api/fhir`
  if (path.length === 1 && path[0] === "metadata") return json(capabilityStatement(base))

  const [type, id] = path as [string, string | undefined]
  if (!RESOURCE_TYPES.includes(type as ResourceType) || path.length > 2) {
    return json(operationOutcome("not-supported", `Unknown resource type. Supported: ${RESOURCE_TYPES.join(", ")}`), 404)
  }
  const db = await callerDb(request)
  if (!db) return json(operationOutcome("security", "Sign in to AarogyaGrid, or send 'Authorization: Bearer <access token>'"), 401)

  const q = url.searchParams
  const count = Math.min(Math.max(Number(q.get("_count") ?? 100) || 100, 1), 500)
  const page = Math.max(Number(q.get("_page") ?? 1) || 1, 1)
  const filters: Filters = {
    id: id ?? q.get("_id") ?? undefined,
    facility: q.get("facility")?.replace(/^(Organization|Location)\//, "") ?? undefined,
    district: q.get("district")?.replace(/^Organization\/district-/, "") ?? undefined,
    status: q.get("status") ?? undefined,
    identifier: (q.get("identifier") ?? q.get("code"))?.split("|").pop() ?? undefined,
  }

  try {
    const all = await load(db, type as ResourceType, filters)
    if (id) {
      const r = all[0]
      return r ? json(r) : json(operationOutcome("not-found", `${type}/${id} not found, or not in your area`), 404)
    }
    const slice = all.slice((page - 1) * count, page * count)
    const next = page * count < all.length ? withParam(url, "_page", String(page + 1)) : undefined
    return json(searchBundle(slice, base, url.toString(), all.length, next))
  } catch (err) {
    console.error("[fhir]", err)
    return json(operationOutcome("exception", err instanceof Error ? err.message : "Server error"), 500)
  }
}

function withParam(url: URL, k: string, v: string) {
  const u = new URL(url)
  u.searchParams.set(k, v)
  return u.toString()
}

type Filters = { id?: string; facility?: string; district?: string; status?: string; identifier?: string }
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
const stripGtin = (g: string) => g.replace(/^0+/, "")

async function load(db: DB, type: ResourceType, f: Filters): Promise<Resource[]> {
  switch (type) {
    case "Organization":
    case "Location":
      return places(db, type, f)
    case "Medication":
    case "Device":
      return catalogue(db, type, f)
    case "SupplyRequest":
    case "SupplyDelivery":
      return orders(db, type, f)
  }
}

// ---------------------------------------------------------------- facilities, districts, states
async function places(db: DB, type: "Organization" | "Location", f: Filters): Promise<Resource[]> {
  const [{ data: facilities }, { data: districts }, { data: states }] = await Promise.all([
    db.from("facilities").select("*").order("code"),
    db.from("districts").select("*").order("name"),
    db.from("states").select("*").order("name"),
  ])
  let fac = facilities ?? []
  const dist = new Map((districts ?? []).map((d) => [d.id, d]))
  const st = new Map((states ?? []).map((s) => [s.id, s]))
  if (f.district) fac = fac.filter((x) => x.district_id === f.district)
  if (f.identifier) fac = fac.filter((x) => x.code === f.identifier || x.hfr_id === f.identifier)

  if (type === "Location") {
    if (f.id) fac = fac.filter((x) => x.id === f.id)
    return fac.map((x) => {
      const d = dist.get(x.district_id)
      return facilityLocation(x, d, d ? st.get(d.state_id) : undefined)
    })
  }

  // organisations: facilities, plus the districts and states they belong to
  const seenDistricts = new Set(fac.map((x) => x.district_id))
  const orgDistricts = [...seenDistricts].map((d) => dist.get(d)).filter((d): d is Tables<"districts"> => Boolean(d))
  const orgStates = [...new Set(orgDistricts.map((d) => d.state_id))].map((s) => st.get(s)).filter((s): s is Tables<"states"> => Boolean(s))
  let out: Resource[] = f.identifier
    ? fac.map(facilityOrganization)
    : [...orgStates.map(stateOrganization), ...orgDistricts.map(districtOrganization), ...fac.map(facilityOrganization)]
  if (f.id) out = out.filter((r) => r.id === f.id)
  return out
}

// ---------------------------------------------------------------- catalogue
async function catalogue(db: DB, type: "Medication" | "Device", f: Filters): Promise<Resource[]> {
  const { data } = await db.from("medicines").select("*").order("name")
  let items = (data ?? []).filter((m) => (type === "Device") === isDevice(m))
  if (f.id) items = items.filter((m) => m.id === f.id)
  if (f.identifier) items = items.filter((m) => m.gtin && stripGtin(m.gtin) === stripGtin(f.identifier!))
  return items.map((m) => itemResource(m))
}

// ---------------------------------------------------------------- orders and deliveries
async function orders(db: DB, type: "SupplyRequest" | "SupplyDelivery", f: Filters): Promise<Resource[]> {
  // "indent-<uuid>" / "transfer-<uuid>"
  const [kind, rawId] = f.id ? [f.id.split("-")[0], f.id.slice(f.id.indexOf("-") + 1)] : [null, null]
  if (f.id && (!isUuid(rawId ?? "") || (kind !== "indent" && kind !== "transfer"))) return []
  if (f.facility && !isUuid(f.facility)) return []

  let districtFacilities: string[] | null = null
  if (f.district) {
    const { data } = await db.from("facilities").select("id").eq("district_id", f.district)
    districtFacilities = (data ?? []).map((x) => x.id)
  }

  let indentQ = db.from("indents").select("*").order("created_at", { ascending: false }).limit(MAX_ROWS)
  let transferQ = db.from("transfers").select("*").order("created_at", { ascending: false }).limit(MAX_ROWS)
  if (type === "SupplyDelivery") {
    indentQ = indentQ.not("dispatched_at", "is", null)
    transferQ = transferQ.not("dispatched_at", "is", null)
  }
  if (f.facility) {
    indentQ = indentQ.or(`facility_id.eq.${f.facility},warehouse_id.eq.${f.facility}`)
    transferQ = transferQ.or(`from_facility_id.eq.${f.facility},to_facility_id.eq.${f.facility}`)
  }
  if (rawId) {
    indentQ = indentQ.eq("id", rawId)
    transferQ = transferQ.eq("id", rawId)
  }
  const [{ data: indents }, { data: transfers }, { data: meds }] = await Promise.all([
    kind === "transfer" ? Promise.resolve({ data: [] as Tables<"indents">[] }) : indentQ,
    kind === "indent" ? Promise.resolve({ data: [] as Tables<"transfers">[] }) : transferQ,
    db.from("medicines").select("*"),
  ])
  const med = new Map((meds ?? []).map((m) => [m.id, m]))
  const inDistrict = (...ids: string[]) => !districtFacilities || ids.some((x) => districtFacilities!.includes(x))
  const ind = (indents ?? []).filter((i) => med.has(i.medicine_id) && inDistrict(i.facility_id, i.warehouse_id))
  const tr = (transfers ?? []).filter((t) => med.has(t.medicine_id) && inDistrict(t.from_facility_id, t.to_facility_id))

  let out: { at: string; r: Resource }[]
  if (type === "SupplyRequest") {
    out = [
      ...ind.map((i) => ({ at: i.created_at, r: indentSupplyRequest(i, med.get(i.medicine_id)!) })),
      ...tr.map((t) => ({ at: t.created_at, r: transferSupplyRequest(t, med.get(t.medicine_id)!) })),
    ]
  } else {
    const batches = await sentBatches([...ind.map((i) => i.id), ...tr.map((t) => t.id)])
    out = [
      ...ind.map((i) => ({ at: i.dispatched_at!, r: indentSupplyDelivery(i, med.get(i.medicine_id)!, batches.get(i.id)) })),
      ...tr.map((t) => ({ at: t.dispatched_at!, r: transferSupplyDelivery(t, med.get(t.medicine_id)!, batches.get(t.id)) })),
    ].filter((x): x is { at: string; r: Resource } => x.r !== null)
  }
  if (f.status) out = out.filter((x) => x.r.status === f.status)
  return out.sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.r)
}

/**
 * The batches that left the sender for each order / transfer. The caller can already see the delivery;
 * the sender's batch rows may sit outside their area (a PHC cannot read the warehouse), so this lookup
 * uses the service role, limited to the deliveries found above.
 */
async function sentBatches(refIds: string[]): Promise<Map<string, SentBatch[]>> {
  const out = new Map<string, SentBatch[]>()
  if (!refIds.length) return out
  const admin = createAdminClient()
  for (let i = 0; i < refIds.length; i += 200) {
    const { data: logs } = await admin.from("stock_log").select("id, ref_id").in("ref_id", refIds.slice(i, i + 200)).gt("qty_out", 0)
    const logRef = new Map((logs ?? []).map((l) => [l.id, l.ref_id!]))
    if (!logRef.size) continue
    const { data: moves } = await admin
      .from("batch_movements")
      .select("stock_log_id, qty, stock_batches(batch_no, expiry_date)")
      .in("stock_log_id", [...logRef.keys()])
      .lt("qty", 0)
    for (const m of moves ?? []) {
      const b = (m as unknown as { stock_batches: { batch_no: string; expiry_date: string } | null }).stock_batches
      const ref = logRef.get(m.stock_log_id)
      if (!b || !ref) continue
      const list = out.get(ref) ?? []
      const same = list.find((x) => x.batchNo === b.batch_no)
      if (same) same.qty += -Number(m.qty)
      else list.push({ batchNo: b.batch_no, expiry: b.expiry_date, qty: -Number(m.qty) })
      out.set(ref, list)
    }
  }
  return out
}
