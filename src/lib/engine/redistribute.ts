// Redistribution planner. Pure: given receivers, donors and settings, returns the
// transfers and indents to propose. The runner deletes stale AI proposals and inserts these.

export type PlanSettings = {
  targetCoverDays: number
  donorKeepDays: number
  maxDistanceKm: number
  minTransferQty: number
}

export type PlanFacility = {
  id: string
  name: string
  type: "phc" | "chc" | "warehouse"
  districtId: string
  lat: number
  lng: number
  resupplyDays: number
  supplyingWarehouse: string | null
}

export type PairFact = {
  facilityId: string
  medicineId: string
  stock: number
  pdu: number | null
  daysLeft: number | null
  /** demand surge in progress at this facility for this medicine */
  surge?: boolean
}

export type Receiver = PairFact & { alertId: string }

export type ProposedTransfer = {
  kind: "transfer"
  medicineId: string
  fromId: string
  toId: string
  qty: number
  distanceKm: number
  isCrossDistrict: boolean
  priority: 1 | 2
  alertId: string
  reason: string
  /** facts kept for the AI explanation */
  facts: PlanFacts
}

export type ProposedIndent = {
  kind: "indent"
  medicineId: string
  facilityId: string
  warehouseId: string
  qty: number
  alertId: string
  reason: string
  facts: PlanFacts
}

export type PlanFacts = {
  receiverStock: number
  receiverPdu: number
  receiverDaysLeft: number | null
  need: number
  donorStock?: number
  donorDaysAfter?: number | null
  alternatives: string[]
}

export type Proposal = ProposedTransfer | ProposedIndent

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

const r1 = (x: number) => Math.round(x * 10) / 10
const fmtDays = (x: number | null) => (x === null ? "unknown" : x < 10 ? x.toFixed(1) : Math.round(x).toString())

type Donor = { facilityId: string; medicineId: string; spare: number; stock: number; pdu: number }

/**
 * @param receivers facility×medicine pairs with an open stock-out alert
 * @param pairs     every facility×medicine in scope (stock + forecast)
 * @param incoming  qty already on its way / pending to facility×medicine
 * @param outgoing  qty already committed out of facility×medicine
 * @param crossDistrict run the state-level pass for anything left unmet
 */
export function planRedistribution({
  facilities,
  pairs,
  receivers,
  incoming,
  outgoing,
  settings,
  crossDistrict,
  blockedMedicines = new Set<string>(),
}: {
  facilities: PlanFacility[]
  pairs: PairFact[]
  receivers: Receiver[]
  incoming: Map<string, number>
  outgoing: Map<string, number>
  settings: PlanSettings
  crossDistrict: boolean
  /** discontinued / withdrawn medicines: no recommendations */
  blockedMedicines?: Set<string>
}): Proposal[] {
  const fac = new Map(facilities.map((f) => [f.id, f]))
  const key = (f: string, m: string) => `${f}:${m}`
  const proposals: Proposal[] = []

  // Donor spare, decremented as we allocate so nobody is over-committed.
  const spare = new Map<string, Donor>()
  for (const p of pairs) {
    const f = fac.get(p.facilityId)
    if (!f || p.pdu === null || blockedMedicines.has(p.medicineId)) continue
    const committed = outgoing.get(key(p.facilityId, p.medicineId)) ?? 0
    const keep = f.type === "warehouse" ? p.pdu * 30 : p.pdu * settings.donorKeepDays
    const s = Math.floor(p.stock - keep - committed)
    spare.set(key(p.facilityId, p.medicineId), { facilityId: p.facilityId, medicineId: p.medicineId, spare: s, stock: p.stock, pdu: p.pdu })
  }
  const receiverIds = new Set(receivers.map((r) => key(r.facilityId, r.medicineId)))

  const donorsFor = (medicineId: string, target: PlanFacility, sameDistrict: boolean) =>
    [...spare.values()]
      .filter((d) => d.medicineId === medicineId && d.spare >= settings.minTransferQty && d.facilityId !== target.id)
      .filter((d) => !receiverIds.has(key(d.facilityId, d.medicineId)))
      .map((d) => ({ d, f: fac.get(d.facilityId)! }))
      .filter(({ f }) => f && f.type !== "warehouse" && (f.districtId === target.districtId) === sameDistrict)
      .map(({ d, f }) => ({ d, f, km: haversineKm(f, target) }))
      .filter((x) => x.km <= settings.maxDistanceKm)
      .sort((a, b) => a.km - b.km)

  const pushTransfer = (
    r: Receiver,
    target: PlanFacility,
    donor: { d: Donor; f: PlanFacility; km: number },
    qty: number,
    need: number,
    cross: boolean,
    alternatives: string[],
  ) => {
    donor.d.spare -= qty
    const donorAfter = donor.d.pdu > 0 ? (donor.d.stock - qty) / donor.d.pdu : null
    proposals.push({
      kind: "transfer",
      medicineId: r.medicineId,
      fromId: donor.f.id,
      toId: target.id,
      qty,
      distanceKm: r1(donor.km),
      isCrossDistrict: cross,
      priority: r.surge || (r.daysLeft !== null && r.daysLeft < target.resupplyDays) ? 1 : 2,
      alertId: r.alertId,
      reason: `${target.name} has ${fmtDays(r.daysLeft)} days of stock (${Math.round(r.stock)} at ${r1(r.pdu ?? 0)}/day) against a ${target.resupplyDays}-day resupply; ${donor.f.name} can spare ${qty} and still keep ${fmtDays(donorAfter)} days. ${alternatives.join(" ")} Distance ${r1(donor.km)} km.`.replace(/\s+/g, " "),
      facts: {
        receiverStock: r.stock,
        receiverPdu: r.pdu ?? 0,
        receiverDaysLeft: r.daysLeft,
        need,
        donorStock: donor.d.stock,
        donorDaysAfter: donorAfter === null ? null : r1(donorAfter),
        alternatives,
      },
    })
  }

  const unmet: { r: Receiver; target: PlanFacility; remaining: number; need: number; alternatives: string[] }[] = []

  // surging medicines first, then most urgent
  const sorted = [...receivers]
    .filter((r) => !blockedMedicines.has(r.medicineId))
    .sort((a, b) => Number(Boolean(b.surge)) - Number(Boolean(a.surge)) || (a.daysLeft ?? 999) - (b.daysLeft ?? 999))
  for (const r of sorted) {
    const target = fac.get(r.facilityId)
    if (!target || target.type === "warehouse" || r.pdu === null) continue
    const need = Math.ceil(r.pdu * settings.targetCoverDays - r.stock - (incoming.get(key(r.facilityId, r.medicineId)) ?? 0))
    if (need <= 0) continue
    const alternatives: string[] = []

    // 1. Normal channel: indent to the district warehouse, when there's time and stock.
    const whId = target.supplyingWarehouse
    const wh = whId ? spare.get(key(whId, r.medicineId)) : undefined
    const hasTime = !r.surge && r.daysLeft !== null && r.daysLeft >= target.resupplyDays
    if (whId && hasTime && wh && wh.spare >= need) {
      wh.spare -= need
      proposals.push({
        kind: "indent",
        medicineId: r.medicineId,
        facilityId: target.id,
        warehouseId: whId,
        qty: need,
        alertId: r.alertId,
        reason: `${fmtDays(r.daysLeft)} days of stock left (${Math.round(r.stock)} at ${r1(r.pdu)}/day), enough time for the normal ${target.resupplyDays}-day resupply; the district warehouse has ${wh.spare + need} spare. Request ${need} for ${settings.targetCoverDays} days of cover.`,
        facts: { receiverStock: r.stock, receiverPdu: r.pdu, receiverDaysLeft: r.daysLeft, need, donorStock: wh.stock, alternatives: [] },
      })
      continue
    }
    alternatives.push(r.surge ? "Demand is surging, so the normal indent cycle is too slow." : !hasTime ? "Too urgent to wait for the warehouse." : "The district warehouse is short.")

    // 2. Nearest PHC donors in the same district (split across up to 2).
    let remaining = need
    const local = donorsFor(r.medicineId, target, true)
    for (const donor of local.slice(0, 2)) {
      if (remaining < settings.minTransferQty) break
      const qty = Math.min(remaining, donor.d.spare)
      if (qty < settings.minTransferQty) continue
      pushTransfer(r, target, donor, qty, need, false, alternatives)
      remaining -= qty
    }
    if (remaining >= settings.minTransferQty) {
      unmet.push({
        r,
        target,
        remaining,
        need,
        alternatives: [...alternatives, local.length ? "Nearby PHCs can cover only part." : "No PHC in the district has spare stock within range."],
      })
    }
  }

  for (const u of unmet) {
    // 3. State-level pass: nearest cross-district donor within range.
    if (crossDistrict) {
      const donor = donorsFor(u.r.medicineId, u.target, false)[0]
      if (donor) {
        const qty = Math.min(u.remaining, donor.d.spare)
        if (qty >= settings.minTransferQty) {
          pushTransfer(u.r, u.target, donor, qty, u.need, true, u.alternatives)
          u.remaining -= qty
        }
      }
    }
    // 4. Otherwise: indent anyway — urgent if the warehouse has it, escalated if it doesn't.
    if (u.remaining >= settings.minTransferQty && u.target.supplyingWarehouse) {
      const wh = spare.get(key(u.target.supplyingWarehouse, u.r.medicineId))
      const whHas = Boolean(wh && wh.spare >= u.remaining)
      if (wh && whHas) wh.spare -= u.remaining
      const situation = `${fmtDays(u.r.daysLeft)} days of stock left (${Math.round(u.r.stock)} at ${r1(u.r.pdu ?? 0)}/day); ${u.remaining} needed for ${settings.targetCoverDays} days of cover.`
      proposals.push({
        kind: "indent",
        medicineId: u.r.medicineId,
        facilityId: u.target.id,
        warehouseId: u.target.supplyingWarehouse,
        qty: u.remaining,
        alertId: u.r.alertId,
        reason: whHas
          ? `Urgent indent: ${situation} No PHC within ${settings.maxDistanceKm} km can spare enough, so dispatch from the district warehouse (${wh!.spare + u.remaining} spare) without waiting for the normal cycle.`
          : `Warehouse short — escalate to state. ${situation}`,
        facts: {
          receiverStock: u.r.stock,
          receiverPdu: u.r.pdu ?? 0,
          receiverDaysLeft: u.r.daysLeft,
          need: u.need,
          alternatives: u.alternatives,
        },
      })
    }
  }
  return proposals
}

// ---------------------------------------------------------------------------------------------
// Near-expiry stock: move what a facility won't use in time to one that will
// ---------------------------------------------------------------------------------------------

export type NearExpiryBatch = {
  facilityId: string
  medicineId: string
  batchNo: string
  qty: number
  daysToExpiry: number
}

/**
 * For batches expiring within 90 days, the part the holder won't use before expiry is offered to the
 * nearest facility in the same district that will use its current stock *and* the transfer before
 * that date. Recipients never receive more than they can use in time.
 */
export function planNearExpiry({
  facilities,
  pairs,
  batches,
  incoming,
  settings,
  blockedMedicines = new Set<string>(),
}: {
  facilities: PlanFacility[]
  pairs: PairFact[]
  batches: NearExpiryBatch[]
  incoming: Map<string, number>
  settings: PlanSettings
  blockedMedicines?: Set<string>
}): ProposedTransfer[] {
  const fac = new Map(facilities.map((f) => [f.id, f]))
  const key = (f: string, m: string) => `${f}:${m}`
  const byKey = new Map(pairs.map((p) => [key(p.facilityId, p.medicineId), p]))
  const taken = new Map<string, number>() // capacity already used at a recipient
  const out: ProposedTransfer[] = []

  for (const b of [...batches].sort((a, c) => a.daysToExpiry - c.daysToExpiry)) {
    if (b.daysToExpiry < 7 || b.daysToExpiry > 90 || blockedMedicines.has(b.medicineId)) continue
    const holder = fac.get(b.facilityId)
    const hp = byKey.get(key(b.facilityId, b.medicineId))
    if (!holder || !hp || hp.pdu === null) continue
    // the holder uses other (earlier) stock first too, so what it can use of this batch is bounded by its own pace
    const usable = Math.floor(hp.pdu * b.daysToExpiry)
    let excess = Math.min(b.qty, Math.floor(hp.stock - usable))
    if (excess < settings.minTransferQty) continue

    const candidates = pairs
      .filter((p) => p.medicineId === b.medicineId && p.facilityId !== b.facilityId && p.pdu !== null && p.pdu > 0)
      .map((p) => ({ p, f: fac.get(p.facilityId)! }))
      .filter(({ f }) => f && f.type !== "warehouse" && f.districtId === holder.districtId)
      .map(({ p, f }) => {
        const k = key(p.facilityId, p.medicineId)
        // what it can consume before the expiry date on top of stock it already has or is receiving
        const capacity = Math.floor(p.pdu! * b.daysToExpiry - p.stock - (incoming.get(k) ?? 0) - (taken.get(k) ?? 0))
        return { p, f, capacity, km: haversineKm(f, holder) }
      })
      .filter((c) => c.capacity >= settings.minTransferQty && c.km <= settings.maxDistanceKm)
      .sort((a, c) => a.km - c.km)

    for (const c of candidates) {
      if (excess < settings.minTransferQty) break
      const qty = Math.min(excess, c.capacity)
      if (qty < settings.minTransferQty) continue
      excess -= qty
      const k = key(c.p.facilityId, c.p.medicineId)
      taken.set(k, (taken.get(k) ?? 0) + qty)
      const recvDays = c.p.pdu ? (c.p.stock + qty) / c.p.pdu : null
      out.push({
        kind: "transfer",
        medicineId: b.medicineId,
        fromId: b.facilityId,
        toId: c.p.facilityId,
        qty,
        distanceKm: r1(c.km),
        isCrossDistrict: false,
        priority: 2,
        alertId: "",
        reason: `Near expiry: batch ${b.batchNo} at ${holder.name} expires in ${b.daysToExpiry} days and it will only use about ${usable} by then. ${c.f.name} uses ${r1(c.p.pdu ?? 0)}/day and will finish its stock plus these ${qty} in about ${fmtDays(recvDays)} days, before the expiry. Distance ${r1(c.km)} km.`,
        facts: {
          receiverStock: c.p.stock,
          receiverPdu: c.p.pdu ?? 0,
          receiverDaysLeft: c.p.daysLeft,
          need: qty,
          donorStock: hp.stock,
          donorDaysAfter: hp.pdu ? r1((hp.stock - qty) / hp.pdu) : null,
          alternatives: [`Batch ${b.batchNo} expires in ${b.daysToExpiry} days`],
        },
      })
    }
  }
  return out
}
