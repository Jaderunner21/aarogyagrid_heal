import { ClipboardList, Globe2, Landmark, MapPinned, Stethoscope, Warehouse, type LucideIcon } from "lucide-react"
import { VIEW_COLOR, type ViewKind } from "@/lib/view-kind"
import { t, type Lang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export const VIEW_ICON: Record<ViewKind, LucideIcon> = {
  national: Globe2,
  state: Landmark,
  district: MapPinned,
  warehouse: Warehouse,
  phc_doctor: Stethoscope,
  phc_staff: ClipboardList,
}

/** "Which screen am I on?" — a coloured pill with the view's symbol, shown in the top bar. */
export function ViewBadge({
  kind,
  lang,
  compact = false,
  className,
  facilityType,
}: {
  kind: ViewKind
  lang: Lang
  compact?: boolean
  className?: string
  /** facility logins at a sub-centre, CHC or district hospital name that level instead of "PHC" */
  facilityType?: string | null
}) {
  const Icon = VIEW_ICON[kind]
  const c = VIEW_COLOR[kind]
  const level = facilityType === "shc" ? "SHC" : facilityType === "chc" ? "CHC" : facilityType === "dh" ? t(lang, "view.hospital") : null
  const label =
    level && (kind === "phc_staff" || kind === "phc_doctor")
      ? `${level} · ${t(lang, kind === "phc_doctor" ? "view.doctorWord" : "view.staffWord")}`
      : t(lang, `view.${kind}`)
  return (
    <span
      className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap", className)}
      style={{ color: c.fg, background: c.bg, borderColor: c.border }}
      title={t(lang, "view.youAreIn").replace("{view}", label)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className={cn(compact && "sr-only sm:not-sr-only")}>{label}</span>
    </span>
  )
}
