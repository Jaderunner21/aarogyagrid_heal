import type { Enums } from "@/lib/database.types"
import type { DictKey } from "@/lib/i18n"

export type Role = Enums<"user_role">

export type NavIcon =
  | "home"
  | "entry"
  | "requests"
  | "alerts"
  | "facilities"
  | "medicines"
  | "transfers"
  | "indents"
  | "warehouse"
  | "admin"
  | "notifications"
  | "states"
  | "new-medicines"

export type NavItem = { href: string; label: DictKey; icon: NavIcon; exact?: boolean }

export const HOME_ROUTE: Record<Role, string> = {
  phc_staff: "/phc",
  warehouse_manager: "/warehouse",
  district_officer: "/district",
  state_admin: "/state",
  national_admin: "/national",
}

export const NAV: Record<Role, NavItem[]> = {
  phc_staff: [
    { href: "/phc", label: "nav.today", icon: "home", exact: true },
    { href: "/phc/entry", label: "nav.entry", icon: "entry" },
    { href: "/phc/requests", label: "nav.requests", icon: "requests" },
    { href: "/phc/alerts", label: "nav.alerts", icon: "alerts" },
  ],
  warehouse_manager: [{ href: "/warehouse", label: "nav.overview", icon: "home", exact: true }],
  district_officer: [
    { href: "/district", label: "nav.overview", icon: "home", exact: true },
    { href: "/district/facilities", label: "nav.facilities", icon: "facilities" },
    { href: "/district/medicines", label: "nav.medicines", icon: "medicines" },
    { href: "/district/transfers", label: "nav.transfers", icon: "transfers" },
    { href: "/district/indents", label: "nav.indents", icon: "indents" },
    { href: "/district/medicine-requests", label: "nav.newMedicines", icon: "new-medicines" },
    { href: "/district/warehouse", label: "nav.warehouse", icon: "warehouse" },
  ],
  state_admin: [
    { href: "/state", label: "nav.overview", icon: "home", exact: true },
    { href: "/state/medicines", label: "nav.medicines", icon: "medicines" },
    { href: "/state/transfers", label: "nav.transfers", icon: "transfers" },
    { href: "/admin", label: "nav.admin", icon: "admin" },
  ],
  national_admin: [
    { href: "/national", label: "nav.overview", icon: "home", exact: true },
    { href: "/national/medicines", label: "nav.medicines", icon: "medicines" },
    { href: "/admin", label: "nav.admin", icon: "admin" },
  ],
}

/** Roles that may open the admin console. */
export const ADMIN_ROLES: Role[] = ["state_admin", "national_admin"]

/** Where a notification should open, given the viewer's role. */
export function notificationHref(role: Role, refTable: string | null, refId: string | null): string {
  const q = refId ? `?focus=${refId}` : ""
  if (refTable === "admin_handovers") return "/handover"
  if (refTable === "medicine_requests") {
    const anchor = refId ? `#req-${refId}` : ""
    if (role === "phc_staff") return `/phc/requests${anchor}`
    if (role === "district_officer") return `/district/medicine-requests${anchor}`
    if (role === "state_admin" || role === "national_admin") return `/admin?tab=medicines${anchor}`
  }
  if (refTable === "outbreaks") {
    return role === "national_admin" ? "/national" : role === "state_admin" ? "/state" : "/district"
  }
  switch (role) {
    case "phc_staff":
      return refTable === "alerts" ? `/phc/alerts${q}` : `/phc/requests${q}`
    case "warehouse_manager":
      return `/warehouse${q}`
    case "district_officer":
      if (refTable === "transfers") return `/district/transfers${q}`
      if (refTable === "indents") return `/district/indents${q}`
      return `/district${q}`
    case "state_admin":
      return refTable === "transfers" ? `/state/transfers${q}` : `/state${q}`
    case "national_admin":
      return `/national${q}`
  }
}
