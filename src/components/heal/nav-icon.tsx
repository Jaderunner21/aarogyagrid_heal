import {
  ArrowLeftRight,
  Bell,
  BellRing,
  Building2,
  ClipboardList,
  House,
  NotebookPen,
  Pill,
  PillBottle,
  Send,
  Settings2,
  Warehouse,
  Map as MapIcon,
  type LucideIcon,
} from "lucide-react"
import type { NavIcon as NavIconName } from "@/lib/roles"

const ICONS: Record<NavIconName, LucideIcon> = {
  home: House,
  entry: NotebookPen,
  requests: Send,
  alerts: BellRing,
  facilities: Building2,
  medicines: Pill,
  transfers: ArrowLeftRight,
  indents: ClipboardList,
  warehouse: Warehouse,
  admin: Settings2,
  notifications: Bell,
  states: MapIcon,
  "new-medicines": PillBottle,
}

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name]
  return <Icon className={className} aria-hidden="true" />
}
