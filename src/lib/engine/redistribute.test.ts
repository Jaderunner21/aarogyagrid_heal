import { describe, expect, it } from "vitest"
import { planNearExpiry, planRedistribution, type PairFact, type PlanFacility } from "./redistribute"
import { stockAlerts } from "./alerts"

const settings = { targetCoverDays: 30, donorKeepDays: 45, maxDistanceKm: 80, minTransferQty: 10 }
const base = { type: "phc" as const, districtId: "D1", resupplyDays: 7, supplyingWarehouse: "W1" }
const facilities: PlanFacility[] = [
  { id: "W1", name: "Warehouse", type: "warehouse", districtId: "D1", lat: 24.58, lng: 73.71, resupplyDays: 3, supplyingWarehouse: null },
  { id: "A", name: "PHC A", ...base, lat: 24.6, lng: 73.7 },
  { id: "B", name: "PHC B", ...base, lat: 24.65, lng: 73.75 }, // ~8 km from A
  { id: "C", name: "PHC C", ...base, lat: 24.9, lng: 74.0 },
  { id: "X", name: "PHC X", ...base, districtId: "D2", supplyingWarehouse: "W2", lat: 24.62, lng: 73.72 },
]
const pair = (facilityId: string, stock: number, pdu: number | null, daysLeft: number | null): PairFact => ({
  facilityId,
  medicineId: "M",
  stock,
  pdu,
  daysLeft,
})
const plan = (pairs: PairFact[], receivers: string[], crossDistrict = false) =>
  planRedistribution({
    facilities,
    pairs,
    receivers: pairs.filter((p) => receivers.includes(p.facilityId)).map((p) => ({ ...p, alertId: `alert-${p.facilityId}` })),
    incoming: new Map(),
    outgoing: new Map(),
    settings,
    crossDistrict,
  })

describe("planRedistribution", () => {
  it("uses the warehouse when there is time and stock", () => {
    const out = plan([pair("A", 100, 10, 10), pair("W1", 5000, 20, 250)], ["A"])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: "indent", facilityId: "A", warehouseId: "W1", qty: 200 })
  })

  it("sends an urgent case to the nearest PHC donor and never over-commits it", () => {
    // A and C both out of stock; B can spare 1000 − 10×45 = 550.
    const out = plan([pair("A", 0, 10, 0), pair("C", 0, 20, 0), pair("B", 1000, 10, 100), pair("W1", 0, 1, 0)], ["A", "C"])
    const transfers = out.filter((p) => p.kind === "transfer")
    const fromB = transfers.filter((t) => t.kind === "transfer" && t.fromId === "B").reduce((s, t) => s + t.qty, 0)
    expect(transfers[0]).toMatchObject({ kind: "transfer", fromId: "B", priority: 1, isCrossDistrict: false })
    expect(fromB).toBeLessThanOrEqual(550)
  })

  it("only crosses districts on the state pass", () => {
    const pairs = [pair("A", 0, 10, 0), pair("X", 2000, 10, 200), pair("W1", 0, 1, 0)]
    expect(plan(pairs, ["A"], false).some((p) => p.kind === "transfer")).toBe(false)
    const cross = plan(pairs, ["A"], true).find((p) => p.kind === "transfer")
    expect(cross).toMatchObject({ fromId: "X", isCrossDistrict: true })
  })

  it("escalates when nobody can help", () => {
    const out = plan([pair("A", 0, 10, 0), pair("W1", 0, 1, 0)], ["A"], true)
    expect(out[0]).toMatchObject({ kind: "indent" })
    expect(out[0].reason).toMatch(/Warehouse short/)
  })
})

describe("surges and blocked medicines", () => {
  it("a surging receiver skips the slow warehouse channel and gets priority 1", () => {
    const pairs = [{ ...pair("A", 200, 10, 20), surge: true }, pair("B", 1000, 10, 100), pair("W1", 5000, 20, 250)]
    const out = planRedistribution({
      facilities,
      pairs,
      receivers: [{ ...pairs[0], alertId: "a" }],
      incoming: new Map(),
      outgoing: new Map(),
      settings,
      crossDistrict: false,
    })
    expect(out[0]).toMatchObject({ kind: "transfer", fromId: "B", priority: 1 })
  })

  it("never recommends a discontinued medicine", () => {
    const out = planRedistribution({
      facilities,
      pairs: [pair("A", 0, 10, 0), pair("B", 1000, 10, 100)],
      receivers: [{ ...pair("A", 0, 10, 0), alertId: "a" }],
      incoming: new Map(),
      outgoing: new Map(),
      settings,
      crossDistrict: true,
      blockedMedicines: new Set(["M"]),
    })
    expect(out).toHaveLength(0)
  })
})

describe("planNearExpiry", () => {
  it("moves the part a facility won't use in time to a nearby facility that will", () => {
    // B holds 600, uses 2/day; a batch of 300 expires in 45 days -> B can use only 90 of it.
    const out = planNearExpiry({
      facilities,
      pairs: [pair("B", 600, 2, 300), pair("A", 50, 10, 5)],
      batches: [{ facilityId: "B", medicineId: "M", batchNo: "X1", qty: 300, daysToExpiry: 45 }],
      incoming: new Map(),
      settings,
    })
    expect(out).toHaveLength(1)
    // B uses 90 of the batch before expiry, so 210 would expire; A can use 10/day × 45 = 450, minus its own 50 -> room for 400
    expect(out[0]).toMatchObject({ fromId: "B", toId: "A", qty: 210, priority: 2 })
    expect(out[0].reason).toMatch(/Near expiry: batch X1/)
  })

  it("counts batches that expire earlier as used first", () => {
    // B uses 2/day. X0 (100, expires day 20): 40 used, 60 expire.
    // X1 (300, expires day 45): used from day 20 to 45 -> 50 used, 250 expire.
    const out = planNearExpiry({
      facilities,
      pairs: [pair("B", 600, 2, 300), pair("A", 0, 20, 0)],
      batches: [
        { facilityId: "B", medicineId: "M", batchNo: "X0", qty: 100, daysToExpiry: 20 },
        { facilityId: "B", medicineId: "M", batchNo: "X1", qty: 300, daysToExpiry: 45 },
      ],
      incoming: new Map(),
      settings,
    })
    expect(out.find((t) => t.reason.includes("X0"))?.qty).toBe(60)
    expect(out.find((t) => t.reason.includes("X1"))?.qty).toBe(250)
  })

  it("does not overload a recipient that cannot use it in time", () => {
    const out = planNearExpiry({
      facilities,
      pairs: [pair("B", 600, 2, 300), pair("A", 400, 10, 40)],
      batches: [{ facilityId: "B", medicineId: "M", batchNo: "X1", qty: 300, daysToExpiry: 45 }],
      incoming: new Map(),
      settings,
    })
    expect(out.reduce((s, t) => s + t.qty, 0)).toBeLessThanOrEqual(10 * 45 - 400)
  })
})

describe("stockAlerts", () => {
  const th = { lowMultiplier: 2, overstockDays: 90, minAttendanceRate: 0.7 }
  const fact = (daysLeft: number | null) => ({
    facilityId: "A",
    medicineId: "M",
    medicineName: "Paracetamol 500mg",
    unit: "tablet",
    stock: 78,
    pdu: 53.8,
    daysLeft,
    resupplyDays: 7,
  })
  it("grades by resupply time", () => {
    expect(stockAlerts(fact(1.4), th)[0]).toMatchObject({ type: "stockout_risk", severity: "critical" })
    expect(stockAlerts(fact(10), th)[0]).toMatchObject({ type: "stockout_risk", severity: "warning" })
    expect(stockAlerts(fact(30), th)).toHaveLength(0)
    expect(stockAlerts(fact(120), th)[0]).toMatchObject({ type: "overstock", severity: "info" })
  })
  it("uses the brief's message template, with whole numbers", () => {
    expect(stockAlerts(fact(1.4), th)[0].message).toBe("Paracetamol 500mg: 78 tablets left (~1 day at 54/day). Normal resupply takes 7 days.")
    expect(stockAlerts(fact(0.4), th)[0].message).toBe("Paracetamol 500mg: 78 tablets left (under 1 day at 54/day). Normal resupply takes 7 days.")
    expect(stockAlerts({ ...fact(0), stock: 0, pdu: 0.2 }, th)[0].message).toBe("Paracetamol 500mg: out of stock (uses about 6/month). Normal resupply takes 7 days.")
  })
})

describe("sub-centres and priority items", () => {
  const withShc: PlanFacility[] = [
    ...facilities,
    { id: "S", name: "SHC S", type: "shc", districtId: "D1", lat: 24.61, lng: 73.71, resupplyDays: 7, supplyingWarehouse: "A" },
  ]
  const run = (pairs: PairFact[], receivers: { id: string; priority?: boolean }[]) =>
    planRedistribution({
      facilities: withShc,
      pairs,
      receivers: receivers.map((r) => ({ ...pairs.find((p) => p.facilityId === r.id)!, priority: r.priority, alertId: `alert-${r.id}` })),
      incoming: new Map(),
      outgoing: new Map(),
      settings,
      crossDistrict: true,
    })

  it("supplies a sub-centre from its PHC, even when urgent, never by transfer", () => {
    // S is out; its PHC A has 1000 at 10/day (spare 1000 − 450 = 550); PHC B also has spare nearby
    const out = run([pair("S", 0, 2, 0), pair("A", 1000, 10, 100), pair("B", 1000, 10, 100), pair("W1", 5000, 20, 250)], [{ id: "S" }])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: "indent", facilityId: "S", warehouseId: "A", qty: 60 })
    expect(out[0].reason).toMatch(/PHC A has/)
  })

  it("escalates a sub-centre when its PHC is short, instead of pulling from other PHCs", () => {
    const out = run([pair("S", 0, 2, 0), pair("A", 100, 10, 10), pair("B", 1000, 10, 100)], [{ id: "S" }])
    expect(out.every((p) => p.kind === "indent")).toBe(true)
    expect(out[0].reason).toMatch(/PHC A is short too/)
  })

  it("never uses a sub-centre as a donor", () => {
    const out = run([pair("B", 0, 10, 0), pair("S", 5000, 1, 5000), pair("W1", 0, 1, 0)], [{ id: "B" }])
    expect(out.some((p) => p.kind === "transfer" && p.fromId === "S")).toBe(false)
  })

  it("never offers a sub-centre's near-expiry stock to other facilities", () => {
    const out = planNearExpiry({
      facilities: withShc,
      pairs: [pair("S", 600, 2, 300), pair("A", 50, 10, 5)],
      batches: [{ facilityId: "S", medicineId: "M", batchNo: "X1", qty: 300, daysToExpiry: 45 }],
      incoming: new Map(),
      settings,
    })
    expect(out).toHaveLength(0)
  })

  it("plans priority items first and marks them urgent", () => {
    // A (priority, 12 days left) and C (normal, 3 days left) compete for B's spare 550
    const out = run([pair("A", 120, 10, 12), pair("C", 30, 10, 3), pair("B", 1000, 10, 100), pair("W1", 0, 1, 0)], [
      { id: "C" },
      { id: "A", priority: true },
    ])
    const first = out.find((p) => p.kind === "transfer")!
    expect(first).toMatchObject({ toId: "A", priority: 1 })
  })
})
