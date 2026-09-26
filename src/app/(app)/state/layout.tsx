import { requireRole } from "@/lib/session"

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRole("state_admin", "national_admin")
  return children
}
