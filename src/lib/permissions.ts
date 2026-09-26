// UI mirror of the workflow functions' permission checks (the database is the real gate).
import type { IndentView, TransferView } from "@/lib/queries"
import type { Role } from "@/lib/roles"

export type Viewer = {
  role: Role
  facilityId: string | null
  districtId: string | null
  stateId: string | null
  phcPosition?: "staff" | "medical_officer"
}

export type TransferAction = "approve" | "reject" | "dispatch" | "receive"
export type IndentAction = "approve" | "reject" | "dispatch" | "receive" | "sign_off"

export function transferActions(t: TransferView, v: Viewer): TransferAction[] {
  const out: TransferAction[] = []
  const officerOf = (d: string) => v.role === "district_officer" && v.districtId === d
  // the national admin can act on any transfer, like a state admin (same database rule)
  const isState = v.role === "state_admin" || v.role === "national_admin"
  const writesFacility = (f: string) => (v.role === "phc_staff" || v.role === "warehouse_manager") && v.facilityId === f

  if (t.status === "proposed") {
    if (v.role === "national_admin" || (t.isCrossDistrict ? isState : officerOf(t.fromDistrictId))) out.push("approve")
  }
  if (t.status === "proposed" || t.status === "approved") {
    if (officerOf(t.fromDistrictId) || officerOf(t.toDistrictId) || isState) out.push("reject")
  }
  if (t.status === "approved" && (writesFacility(t.fromId) || officerOf(t.fromDistrictId))) out.push("dispatch")
  if (t.status === "dispatched" && (writesFacility(t.toId) || officerOf(t.toDistrictId))) out.push("receive")
  return out
}

export function indentActions(i: IndentView, v: Viewer): IndentAction[] {
  const out: IndentAction[] = []
  const officer = v.role === "district_officer" && v.districtId === i.districtId && !i.awaitingMo
  const doctorHere = v.role === "phc_staff" && v.phcPosition === "medical_officer" && v.facilityId === i.facilityId
  if (i.status === "submitted" && i.awaitingMo && doctorHere) out.push("sign_off")
  if (i.status === "submitted" && officer) out.push("approve")
  if ((i.status === "submitted" || i.status === "approved") && officer) out.push("reject")
  if (i.status === "approved" && v.role === "warehouse_manager" && v.facilityId === i.warehouseId) out.push("dispatch")
  if (i.status === "dispatched" && v.role === "phc_staff" && v.facilityId === i.facilityId) out.push("receive")
  return out
}
