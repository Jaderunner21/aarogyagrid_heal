import { describe, expect, it } from "vitest"
import type { Tables } from "@/lib/database.types"
import {
  SYS,
  capabilityStatement,
  districtOrganization,
  facilityLocation,
  facilityOrganization,
  indentSupplyDelivery,
  indentSupplyRequest,
  itemResource,
  searchBundle,
  transferSupplyRequest,
} from "./fhir"

const facility = (over: Partial<Tables<"facilities">> = {}): Tables<"facilities"> => ({
  id: "f1",
  district_id: "d1",
  type: "phc",
  name: "PHC Sagwara",
  code: "PHC-DGP-01",
  lat: 23.668,
  lng: 74.024,
  address: "Sagwara",
  total_beds: 10,
  resupply_days: 5,
  supplying_warehouse: "w1",
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  opened_on: null,
  phc_24x7: true,
  hfr_id: "IN0810000123",
  hfr_extensions: { laqshya: { labour_room: true } },
  ...over,
})
const item = (over: Partial<Tables<"medicines">> = {}): Tables<"medicines"> => ({
  id: "m1",
  name: "Iron Folic Acid",
  generic_name: null,
  strength: null,
  unit: "tablet",
  category: "Supplements",
  is_essential: true,
  created_at: "2026-01-01T00:00:00Z",
  is_chronic: false,
  status: "active",
  status_date: null,
  status_reason: null,
  stocked_at: ["phc"],
  state_id: null,
  item_type: "medicine",
  phc_24x7_only: false,
  program: null,
  gtin: "8901234005101",
  ...over,
})
const indent = (over: Partial<Tables<"indents">> = {}): Tables<"indents"> => ({
  id: "i1",
  facility_id: "s1",
  warehouse_id: "f1",
  medicine_id: "m1",
  qty_requested: 163,
  qty_approved: null,
  origin: "ai",
  status: "submitted",
  ai_reason: "Urgent: 0.0 days of stock left",
  ai_generated_at: null,
  note: null,
  raised_by: null,
  approved_by: null,
  approved_at: null,
  rejected_reason: null,
  carrier_type: null,
  carrier_name: null,
  dispatched_by: null,
  dispatched_at: null,
  received_by: null,
  received_at: null,
  received_qty: null,
  created_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-27T10:00:00Z",
  awaiting_mo: false,
  mo_decided_by: null,
  mo_decided_at: null,
  ...over,
})

describe("places", () => {
  it("facility → Organization with HFR id, type and district parent", () => {
    const o = facilityOrganization(facility())
    expect(o).toMatchObject({ resourceType: "Organization", id: "f1", name: "PHC Sagwara", partOf: { reference: "Organization/district-d1" } })
    expect(o.identifier).toContainEqual({ system: SYS.hfr, value: "IN0810000123" })
    expect(JSON.stringify(o.type)).toContain('"code":"prov"')
    expect(JSON.stringify(o.extension)).toContain("laqshya")
  })
  it("facility → Location with position and its supplier", () => {
    const l = facilityLocation(facility(), { id: "d1", state_id: "s", name: "Dungarpur", code: "RJ-DGP", created_at: "" })
    expect(l).toMatchObject({ resourceType: "Location", status: "active", position: { latitude: 23.668, longitude: 74.024 }, partOf: { reference: "Location/w1" } })
    expect(l.address).toMatchObject({ district: "Dungarpur", country: "IN" })
  })
  it("district → government Organization under its state", () => {
    expect(districtOrganization({ id: "d1", state_id: "st1", name: "Dungarpur", code: "RJ-DGP", created_at: "" })).toMatchObject({
      id: "district-d1",
      partOf: { reference: "Organization/state-st1" },
    })
  })
})

describe("catalogue", () => {
  it("medicine → Medication with GTIN-14", () => {
    const m = itemResource(item())
    expect(m.resourceType).toBe("Medication")
    expect(JSON.stringify(m.code)).toContain('"code":"08901234005101"')
  })
  it("consumables and test kits → Device", () => {
    expect(itemResource(item({ item_type: "diagnostic", name: "Malaria RDT" })).resourceType).toBe("Device")
    expect(itemResource(item({ item_type: "oxygen" })).resourceType).toBe("Medication")
  })
})

describe("orders and deliveries", () => {
  it("an engine-proposed indent is a draft SupplyRequest, urgent, to its supplier", () => {
    const r = indentSupplyRequest(indent(), item())
    expect(r).toMatchObject({
      id: "indent-i1",
      status: "draft",
      priority: "urgent",
      quantity: { value: 163, unit: "tablet" },
      itemReference: { reference: "Medication/m1" },
      deliverFrom: { reference: "Location/f1" },
      deliverTo: { reference: "Location/s1" },
    })
    expect(indentSupplyRequest(indent({ status: "received", origin: "manual" }), item()).status).toBe("completed")
  })
  it("a transfer becomes a SupplyRequest between facilities", () => {
    const t = transferSupplyRequest(
      {
        id: "t1", medicine_id: "m1", from_facility_id: "a", to_facility_id: "b", qty: 50, distance_km: 12, is_cross_district: false,
        origin: "ai", priority: 1, status: "proposed", ai_reason: null, ai_generated_at: null, alert_id: null, created_by: null,
        approved_by: null, approved_at: null, rejected_reason: null, carrier_type: null, carrier_name: null, carrier_contact: null,
        dispatched_by: null, dispatched_at: null, received_by: null, received_at: null, received_qty: null, created_at: "", updated_at: "",
      },
      item(),
    )
    expect(t).toMatchObject({ id: "transfer-t1", status: "draft", priority: "urgent", deliverFrom: { reference: "Location/a" } })
  })
  it("no delivery before dispatch; a received one carries its batch", () => {
    expect(indentSupplyDelivery(indent(), item())).toBeNull()
    const d = indentSupplyDelivery(
      indent({ status: "received", dispatched_at: "2026-09-27T12:00:00Z", received_at: "2026-09-27T15:00:00Z", received_qty: 160 }),
      item(),
      [{ batchNo: "IRO2702-1339", expiry: "2027-02-11", qty: 163 }],
    )!
    expect(d).toMatchObject({
      resourceType: "SupplyDelivery",
      status: "completed",
      basedOn: [{ reference: "SupplyRequest/indent-i1" }],
      suppliedItem: { quantity: { value: 160 }, itemReference: { reference: "#batch1" } },
      destination: { reference: "Location/s1" },
    })
    expect(d.contained).toEqual([expect.objectContaining({ id: "batch1", batch: { lotNumber: "IRO2702-1339", expirationDate: "2027-02-11" } })])
  })
})

describe("envelopes", () => {
  it("search bundle with full URLs and paging", () => {
    const b = searchBundle([itemResource(item())], "https://x/api/fhir", "https://x/api/fhir/Medication", 3, "https://x/api/fhir/Medication?_page=2")
    expect(b).toMatchObject({ resourceType: "Bundle", type: "searchset", total: 3 })
    expect((b.entry as { fullUrl: string }[])[0].fullUrl).toBe("https://x/api/fhir/Medication/m1")
    expect(JSON.stringify(b.link)).toContain('"relation":"next"')
  })
  it("capability statement lists every resource as read + search", () => {
    const c = capabilityStatement("https://x/api/fhir")
    expect(c).toMatchObject({ resourceType: "CapabilityStatement", fhirVersion: "4.0.1" })
    const res = (c.rest as { resource: { type: string }[] }[])[0].resource.map((r) => r.type)
    expect(res).toEqual(["Organization", "Location", "Medication", "Device", "SupplyRequest", "SupplyDelivery"])
  })
})
