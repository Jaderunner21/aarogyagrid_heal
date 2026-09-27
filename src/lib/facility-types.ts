// Labels for the care hierarchy, item types and bed types (English; PHC screens use the i18n keys).
import type { BedType, Enums, ItemType, Tier } from "@/lib/database.types"

export const FACILITY_TYPE_LABEL: Record<Enums<"facility_type">, string> = {
  shc: "Sub health centre",
  phc: "Primary health centre",
  chc: "Community health centre",
  dh: "District hospital",
  warehouse: "District warehouse",
}

export const FACILITY_TYPE_SHORT: Record<Enums<"facility_type">, string> = {
  shc: "SHC",
  phc: "PHC",
  chc: "CHC",
  dh: "DH",
  warehouse: "Warehouse",
}

export const TIER_LABEL: Record<Tier, string> = {
  shc: "Sub-centre",
  phc_day: "PHC (day)",
  phc_24x7: "PHC (24×7)",
  chc: "CHC",
  dh: "District hospital",
  warehouse: "Warehouse",
}

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  medicine: "Medicine",
  oxygen: "Oxygen",
  consumable: "Consumable",
  vaccine: "Vaccine",
  diagnostic: "Diagnostic",
}

export const ITEM_TYPES = Object.keys(ITEM_TYPE_LABEL) as ItemType[]

export const BED_TYPE_LABEL: Record<BedType, string> = {
  icu: "ICU",
  hdu: "HDU",
  nicu: "NICU / SNCU",
  general: "General ward",
  maternity: "Maternity",
  paediatric: "Paediatric",
  isolation: "Isolation",
  observation: "Observation",
}

export const BED_TYPES = Object.keys(BED_TYPE_LABEL) as BedType[]
export const CRITICAL_CARE: BedType[] = ["icu", "hdu", "nicu"]

/** Which bed types each tier may have (mirrors tier_bed_types in the database). */
export const TIER_BED_TYPES: Record<Tier, BedType[]> = {
  shc: [],
  phc_day: ["observation"],
  phc_24x7: ["general", "maternity", "observation"],
  chc: ["general", "maternity", "paediatric", "isolation", "hdu"],
  dh: ["general", "maternity", "paediatric", "isolation", "icu", "hdu", "nicu"],
  warehouse: [],
}

export function tierOf(type: Enums<"facility_type">, phc24x7: boolean): Tier {
  return type === "phc" ? (phc24x7 ? "phc_24x7" : "phc_day") : type
}

/** Tiers in the order care escalates, for catalogue tables. */
export const TIERS: Tier[] = ["shc", "phc_day", "phc_24x7", "chc", "dh", "warehouse"]
