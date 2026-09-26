import { redirect } from "next/navigation"
import { getSession } from "@/lib/session"
import { HOME_ROUTE } from "@/lib/roles"

export default async function RoleRedirect() {
  const session = await getSession()
  if (!session) redirect("/login")
  redirect(HOME_ROUTE[session.profile.role])
}
