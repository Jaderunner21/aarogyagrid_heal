import { redirect } from "next/navigation"

// The read-only admin page grew into the Admin console.
export default function StateAdminRedirect() {
  redirect("/admin")
}
