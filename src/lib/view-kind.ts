import type { Role } from "@/lib/roles"

/** Which of the six views a signed-in person is looking at. PHC logins split into doctor and staff. */
export type ViewKind = "national" | "state" | "district" | "warehouse" | "phc_doctor" | "phc_staff"
export type PhcPosition = "staff" | "medical_officer"

export function viewKindOf(role: Role, phcPosition?: PhcPosition | null): ViewKind {
  switch (role) {
    case "national_admin":
      return "national"
    case "state_admin":
      return "state"
    case "district_officer":
      return "district"
    case "warehouse_manager":
      return "warehouse"
    case "phc_staff":
      return phcPosition === "medical_officer" ? "phc_doctor" : "phc_staff"
  }
}

/** One colour per view, used for the badge, the header stripe and the demo sign-in panel. */
export const VIEW_COLOR: Record<ViewKind, { fg: string; bg: string; border: string }> = {
  national: { fg: "#4338CA", bg: "#EEF2FF", border: "#C7D2FE" },
  state: { fg: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE" },
  district: { fg: "#0F766E", bg: "#F0FDFA", border: "#99F6E4" },
  warehouse: { fg: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
  phc_doctor: { fg: "#BE123C", bg: "#FFF1F2", border: "#FECDD3" },
  phc_staff: { fg: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
}
