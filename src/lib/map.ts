// Shapes for the facility map, shared by server pages and the client map.
import type { FacilitySummary, TransferView } from "@/lib/queries"

export type MapFacility = Pick<
  FacilitySummary,
  "id" | "name" | "type" | "lat" | "lng" | "critical" | "low" | "openAlerts" | "districtId" | "districtName" | "status"
> & { openSurges?: number }
export type MapTransfer = Pick<TransferView, "id" | "fromLat" | "fromLng" | "toLat" | "toLng" | "status"> & {
  label: string
}

export function toMapTransfer(t: TransferView): MapTransfer {
  return {
    id: t.id,
    fromLat: t.fromLat,
    fromLng: t.fromLng,
    toLat: t.toLat,
    toLng: t.toLng,
    status: t.status,
    label: `${t.medicineName} × ${t.qty}: ${t.fromName} → ${t.toName}`,
  }
}
