import Link from "next/link"
import { SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HealLogo } from "@/components/heal/logo"

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 text-center">
      <HealLogo />
      <div className="bg-card flex max-w-sm flex-col items-center gap-3 rounded-xl border p-8">
        <SearchX className="text-muted-foreground size-8" aria-hidden="true" />
        <h1 className="text-base font-semibold">Page not found</h1>
        <p className="text-muted-foreground text-sm">It may have moved, or it belongs to another facility or district.</p>
        <Button asChild>
          <Link href="/">Go to my home page</Link>
        </Button>
      </div>
    </main>
  )
}
