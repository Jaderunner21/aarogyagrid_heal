// HL7 FHIR R4 (read-only): AarogyaGrid's facilities, catalogue, orders and deliveries as standard resources,
// so state and national systems (and anything built on ABDM / NHCX-style FHIR) can read them.
//
//   facility            → Organization (who) + Location (where), same id
//   district / state    → Organization, ids "district-<uuid>" / "state-<uuid>", linked by partOf
//   medicine, vaccine,  → Medication (GTIN in code)
//   oxygen
//   consumable, test kit→ Device
//   indent / transfer   → SupplyRequest,  ids "indent-<uuid>" / "transfer-<uuid>"
//   dispatch / receipt  → SupplyDelivery, same ids; the batches sent ride along as contained Medications

import type { Tables } from "@/lib/database.types"

export const FHIR_VERSION = "4.0.1"
// identifier / code systems. HFR is India's Health Facility Registry (ABDM).
export const SYS = {
  facilityCode: "https://aarogyagrid.in/fhir/sid/facility-code",
  districtCode: "https://aarogyagrid.in/fhir/sid/district-code",
  stateCode: "https://aarogyagrid.in/fhir/sid/state-code",
  facilityType: "https://aarogyagrid.in/fhir/CodeSystem/facility-type",
  itemType: "https://aarogyagrid.in/fhir/CodeSystem/item-type",
  item: "https://aarogyagrid.in/fhir/CodeSystem/item",
  hfr: "https://facility.abdm.gov.in",
  gtin: "https://www.gs1.org/gtin",
  orgType: "http://terminology.hl7.org/CodeSystem/organization-type",
  supplyKind: "http://terminology.hl7.org/CodeSystem/supplyrequest-kind",
  supplyItemType: "http://terminology.hl7.org/CodeSystem/supply-item-type",
  locationPhysical: "http://terminology.hl7.org/CodeSystem/location-physical-type",
} as const

export type Resource = { resourceType: string; id: string; [k: string]: unknown }

type Facility = Tables<"facilities">
type District = Tables<"districts">
type State = Tables<"states">
type Item = Tables<"medicines">
type Indent = Tables<"indents">
type Transfer = Tables<"transfers">

const FACILITY_TYPE_NAME: Record<Facility["type"], string> = {
  shc: "Sub-centre",
  phc: "Primary health centre",
  chc: "Community health centre",
  dh: "District hospital",
  warehouse: "District drug warehouse",
}
const ITEM_TYPE_NAME: Record<Item["item_type"], string> = {
  medicine: "Medicine",
  oxygen: "Medical oxygen",
  consumable: "Consumable",
  vaccine: "Vaccine",
  diagnostic: "Diagnostic kit",
}

const ref = (type: string, id: string, display?: string) => ({ reference: `${type}/${id}`, ...(display ? { display } : {}) })
const orgId = { district: (id: string) => `district-${id}`, state: (id: string) => `state-${id}` }
export const isDevice = (m: Pick<Item, "item_type">) => m.item_type === "consumable" || m.item_type === "diagnostic"
export const itemRef = (m: Pick<Item, "id" | "name" | "item_type">) => ref(isDevice(m) ? "Device" : "Medication", m.id, m.name)
const laqshya = (f: Facility) =>
  Boolean(f.hfr_extensions && typeof f.hfr_extensions === "object" && !Array.isArray(f.hfr_extensions) && (f.hfr_extensions as Record<string, unknown>).laqshya)

// ---------------------------------------------------------------- places and organisations
export function stateOrganization(s: State): Resource {
  return {
    resourceType: "Organization",
    id: orgId.state(s.id),
    identifier: [{ system: SYS.stateCode, value: s.code }],
    active: true,
    type: [{ coding: [{ system: SYS.orgType, code: "govt", display: "Government" }], text: "State health department" }],
    name: `${s.name} (state)`,
  }
}

export function districtOrganization(d: District): Resource {
  return {
    resourceType: "Organization",
    id: orgId.district(d.id),
    identifier: [{ system: SYS.districtCode, value: d.code }],
    active: true,
    type: [{ coding: [{ system: SYS.orgType, code: "govt", display: "Government" }], text: "District health office" }],
    name: `${d.name} district`,
    partOf: ref("Organization", orgId.state(d.state_id)),
  }
}

export function facilityOrganization(f: Facility): Resource {
  return {
    resourceType: "Organization",
    id: f.id,
    identifier: [{ system: SYS.facilityCode, value: f.code }, ...(f.hfr_id ? [{ system: SYS.hfr, value: f.hfr_id }] : [])],
    active: f.is_active,
    type: [
      {
        coding: [
          f.type === "warehouse"
            ? { system: SYS.orgType, code: "govt", display: "Government" }
            : { system: SYS.orgType, code: "prov", display: "Healthcare Provider" },
          { system: SYS.facilityType, code: f.type, display: FACILITY_TYPE_NAME[f.type] },
        ],
        text: f.type === "phc" ? `Primary health centre (${f.phc_24x7 ? "24×7" : "day"})` : FACILITY_TYPE_NAME[f.type],
      },
    ],
    name: f.name,
    partOf: ref("Organization", orgId.district(f.district_id)),
    ...(laqshya(f) ? { extension: [{ url: "https://aarogyagrid.in/fhir/StructureDefinition/laqshya-certified", valueBoolean: true }] } : {}),
  }
}

export function facilityLocation(f: Facility, district?: District, state?: State): Resource {
  return {
    resourceType: "Location",
    id: f.id,
    identifier: [{ system: SYS.facilityCode, value: f.code }, ...(f.hfr_id ? [{ system: SYS.hfr, value: f.hfr_id }] : [])],
    status: f.is_active ? "active" : "inactive",
    name: f.name,
    mode: "instance",
    type: [{ coding: [{ system: SYS.facilityType, code: f.type, display: FACILITY_TYPE_NAME[f.type] }] }],
    physicalType: { coding: [{ system: SYS.locationPhysical, code: "bu", display: "Building" }] },
    address: {
      ...(f.address ? { text: f.address } : {}),
      ...(district ? { district: district.name } : {}),
      ...(state ? { state: state.name } : {}),
      country: "IN",
    },
    position: { longitude: Number(f.lng), latitude: Number(f.lat) },
    managingOrganization: ref("Organization", f.id, f.name),
    // a sub-centre is supplied by its PHC; everyone else by the district warehouse
    ...(f.supplying_warehouse ? { partOf: ref("Location", f.supplying_warehouse) } : {}),
  }
}

// ---------------------------------------------------------------- catalogue
function itemCoding(m: Item) {
  return [{ system: SYS.item, code: m.id, display: m.name }, ...(m.gtin ? [{ system: SYS.gtin, code: m.gtin.padStart(14, "0"), display: m.name }] : [])]
}

export function itemResource(m: Item, batch?: { lotNumber: string; expirationDate: string }, id = m.id): Resource {
  const active = m.status === "active"
  if (isDevice(m)) {
    return {
      resourceType: "Device",
      id,
      ...(m.gtin ? { identifier: [{ system: SYS.gtin, value: m.gtin.padStart(14, "0") }] } : {}),
      status: active ? "active" : "inactive",
      ...(batch ? { lotNumber: batch.lotNumber, expirationDate: batch.expirationDate } : {}),
      deviceName: [{ name: m.name, type: "user-friendly-name" }],
      type: { coding: [{ system: SYS.itemType, code: m.item_type, display: ITEM_TYPE_NAME[m.item_type] }, ...itemCoding(m)], text: m.name },
    }
  }
  return {
    resourceType: "Medication",
    id,
    code: { coding: itemCoding(m), text: m.name },
    status: active ? "active" : "inactive",
    form: { text: m.unit },
    extension: [{ url: "https://aarogyagrid.in/fhir/StructureDefinition/item-type", valueCode: m.item_type }],
    ...(batch ? { batch } : {}),
  }
}

// ---------------------------------------------------------------- orders
const REQUEST_STATUS: Record<string, string> = {
  submitted: "active",
  proposed: "draft",
  approved: "active",
  dispatched: "active",
  received: "completed",
  rejected: "revoked",
  cancelled: "revoked",
}

export function indentSupplyRequest(i: Indent, m: Item): Resource {
  return {
    resourceType: "SupplyRequest",
    id: `indent-${i.id}`,
    identifier: [{ system: "https://aarogyagrid.in/fhir/sid/indent", value: i.id }],
    // an order proposed by the engine but not yet approved is still a draft
    status: i.status === "submitted" && i.origin === "ai" ? "draft" : REQUEST_STATUS[i.status],
    category: { coding: [{ system: SYS.supplyKind, code: "central", display: "Central Supply" }], text: "Indent" },
    priority: /^urgent/i.test(i.ai_reason ?? "") ? "urgent" : "routine",
    itemReference: itemRef(m),
    quantity: { value: Number(i.qty_approved ?? i.qty_requested), unit: m.unit },
    authoredOn: i.created_at,
    requester: ref("Organization", i.facility_id),
    supplier: [ref("Organization", i.warehouse_id)],
    ...(i.ai_reason || i.note || i.rejected_reason ? { reasonCode: [{ text: i.rejected_reason ?? i.ai_reason ?? i.note }] } : {}),
    deliverFrom: ref("Location", i.warehouse_id),
    deliverTo: ref("Location", i.facility_id),
  }
}

export function transferSupplyRequest(t: Transfer, m: Item): Resource {
  return {
    resourceType: "SupplyRequest",
    id: `transfer-${t.id}`,
    identifier: [{ system: "https://aarogyagrid.in/fhir/sid/transfer", value: t.id }],
    status: REQUEST_STATUS[t.status],
    category: { coding: [{ system: SYS.supplyKind, code: "central", display: "Central Supply" }], text: t.is_cross_district ? "Transfer between districts" : "Transfer" },
    priority: t.priority <= 1 ? "urgent" : "routine",
    itemReference: itemRef(m),
    quantity: { value: Number(t.qty), unit: m.unit },
    authoredOn: t.created_at,
    requester: ref("Organization", t.to_facility_id),
    supplier: [ref("Organization", t.from_facility_id)],
    ...(t.ai_reason || t.rejected_reason ? { reasonCode: [{ text: t.rejected_reason ?? t.ai_reason }] } : {}),
    deliverFrom: ref("Location", t.from_facility_id),
    deliverTo: ref("Location", t.to_facility_id),
  }
}

// ---------------------------------------------------------------- deliveries
export type SentBatch = { batchNo: string; expiry: string; qty: number }

function delivery(
  kind: "indent" | "transfer",
  row: { id: string; status: string; dispatched_at: string | null; received_at: string | null; received_qty: number | null },
  qtySent: number,
  from: string,
  to: string,
  m: Item,
  batches: SentBatch[],
): Resource | null {
  if (!row.dispatched_at) return null
  const status = row.status === "received" ? "completed" : row.status === "cancelled" ? "abandoned" : "in-progress"
  // the batches that left the sender, as contained items so the receiver knows lot and expiry
  const contained = batches.map((b, n) => itemResource(m, { lotNumber: b.batchNo, expirationDate: b.expiry }, `batch${n + 1}`))
  const qty = row.status === "received" && row.received_qty !== null ? Number(row.received_qty) : qtySent
  return {
    resourceType: "SupplyDelivery",
    id: `${kind}-${row.id}`,
    ...(contained.length ? { contained } : {}),
    basedOn: [ref("SupplyRequest", `${kind}-${row.id}`)],
    status,
    type: { coding: [{ system: SYS.supplyItemType, code: isDevice(m) ? "device" : "medication", display: isDevice(m) ? "Device" : "Medication" }] },
    suppliedItem: {
      quantity: { value: qty, unit: m.unit },
      // one batch: point at it; several: point at the item, the batches are listed in `contained`
      itemReference: contained.length === 1 ? { reference: "#batch1", display: m.name } : itemRef(m),
    },
    occurrenceDateTime: row.received_at ?? row.dispatched_at,
    supplier: ref("Organization", from),
    destination: ref("Location", to),
    // how much of each batch was sent (a complex extension: batch + quantity)
    ...(contained.length
      ? {
          extension: contained.map((c, n) => ({
            url: "https://aarogyagrid.in/fhir/StructureDefinition/batch-sent",
            extension: [
              { url: "batch", valueReference: { reference: `#${c.id}` } },
              { url: "quantity", valueQuantity: { value: batches[n].qty, unit: m.unit } },
            ],
          })),
        }
      : {}),
  }
}

export const indentSupplyDelivery = (i: Indent, m: Item, batches: SentBatch[] = []) =>
  delivery("indent", i, Number(i.qty_approved ?? i.qty_requested), i.warehouse_id, i.facility_id, m, batches)
export const transferSupplyDelivery = (t: Transfer, m: Item, batches: SentBatch[] = []) =>
  delivery("transfer", t, Number(t.qty), t.from_facility_id, t.to_facility_id, m, batches)

// ---------------------------------------------------------------- envelopes
export function searchBundle(resources: Resource[], base: string, selfUrl: string, total: number, next?: string): Resource {
  return {
    resourceType: "Bundle",
    id: crypto.randomUUID(),
    meta: { lastUpdated: new Date().toISOString() },
    type: "searchset",
    total,
    link: [{ relation: "self", url: selfUrl }, ...(next ? [{ relation: "next", url: next }] : [])],
    entry: resources.map((r) => ({ fullUrl: `${base}/${r.resourceType}/${r.id}`, resource: r, search: { mode: "match" } })),
  }
}

export function operationOutcome(code: "not-found" | "security" | "invalid" | "not-supported" | "exception", text: string): Resource {
  return {
    resourceType: "OperationOutcome",
    id: crypto.randomUUID(),
    issue: [{ severity: "error", code: code === "security" ? "security" : code, diagnostics: text }],
  }
}

export const RESOURCE_TYPES = ["Organization", "Location", "Medication", "Device", "SupplyRequest", "SupplyDelivery"] as const
export type ResourceType = (typeof RESOURCE_TYPES)[number]

export function capabilityStatement(base: string): Resource {
  const search = (extra: { name: string; type: string; documentation: string }[] = []) => [
    { name: "_id", type: "token", documentation: "Resource id" },
    { name: "_count", type: "number", documentation: "Page size (default 100, max 500)" },
    ...extra,
  ]
  const byFacility = { name: "facility", type: "reference", documentation: "Facility id (either end, for orders and deliveries)" }
  const byDistrict = { name: "district", type: "reference", documentation: "District id" }
  const byStatus = { name: "status", type: "token", documentation: "FHIR status" }
  const params: Record<ResourceType, { name: string; type: string; documentation: string }[]> = {
    Organization: search([byDistrict, { name: "identifier", type: "token", documentation: "Facility code or HFR id" }]),
    Location: search([byDistrict, { name: "identifier", type: "token", documentation: "Facility code or HFR id" }]),
    Medication: search([{ name: "code", type: "token", documentation: "GTIN" }]),
    Device: search([{ name: "identifier", type: "token", documentation: "GTIN" }]),
    SupplyRequest: search([byFacility, byDistrict, byStatus]),
    SupplyDelivery: search([byFacility, byDistrict, byStatus]),
  }
  return {
    resourceType: "CapabilityStatement",
    id: "aarogyagrid",
    status: "active",
    date: "2026-09-27",
    publisher: "AarogyaGrid",
    kind: "instance",
    software: { name: "AarogyaGrid" },
    implementation: { description: "AarogyaGrid FHIR read API: facilities, item catalogue, orders and deliveries", url: base },
    fhirVersion: FHIR_VERSION,
    format: ["application/fhir+json", "json"],
    rest: [
      {
        mode: "server",
        documentation:
          "Read-only. Sign in to AarogyaGrid (browser session) or send a Supabase access token as 'Authorization: Bearer <token>'. Every caller sees only their own area (row-level security).",
        security: {
          description:
            "Same access rules as the AarogyaGrid app. The facility directory and item catalogue are shared with every signed-in user; orders and deliveries are limited to the caller's area (a facility sees its own, a district officer the district, a state admin the state).",
        },
        resource: RESOURCE_TYPES.map((type) => ({
          type,
          interaction: [{ code: "read" }, { code: "search-type" }],
          searchParam: params[type],
        })),
      },
    ],
  }
}
