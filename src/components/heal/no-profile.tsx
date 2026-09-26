import { UserX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HealLogo } from "@/components/heal/logo"
import { signOut } from "@/app/actions"

export function NoProfile({ email, deactivated = false }: { email: string; deactivated?: boolean }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <HealLogo />
      <div className="bg-card max-w-md space-y-3 rounded-xl border p-6">
        <UserX className="text-muted-foreground mx-auto size-8" aria-hidden="true" />
        <h1 className="text-base font-semibold">
          {deactivated ? "This account has been deactivated" : "This account has no AarogyaGrid profile"}
        </h1>
        {deactivated ? (
          <p className="text-muted-foreground text-sm">
            {email} no longer has access. Your past entries and approvals are kept. Ask your state admin if this is a mistake.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            {email} can sign in, but isn&apos;t linked to a facility, district or state yet. Ask your administrator, or
            run <code className="bg-muted rounded px-1">npm run demo-users</code> for the demo accounts.
          </p>
        )}
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  )
}
