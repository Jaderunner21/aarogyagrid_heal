import { requireRole } from "@/lib/session"

export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireRole("phc_staff")
  return children
}
