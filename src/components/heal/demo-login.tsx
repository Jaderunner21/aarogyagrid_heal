"use client"

import { useMemo, useState, useTransition } from "react"
import { Building2, ChevronsUpDown, Loader2, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { demoSignIn } from "@/app/(auth)/login/actions"
import type { DemoAccount } from "@/lib/demo-accounts"
import { VIEW_ICON } from "@/components/heal/view-badge"
import { VIEW_COLOR, viewKindOf, type ViewKind } from "@/lib/view-kind"
import { cn } from "@/lib/utils"

const STATES = ["Rajasthan", "Gujarat"] as const

export function DemoLogin({ accounts }: { accounts: DemoAccount[] }) {
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [phcOpen, setPhcOpen] = useState(false)
  const [phcCode, setPhcCode] = useState<string | null>(null)
  const [position, setPosition] = useState<"staff" | "medical_officer">("staff")

  const national = accounts.filter((a) => a.role === "national_admin")
  // one entry per PHC in the picker; the Staff / Doctor switch chooses which login
  const phcs = accounts.filter((a) => a.role === "phc_staff" && a.phcPosition !== "medical_officer")
  const phcGroups = useMemo(() => {
    const groups = new Map<string, DemoAccount[]>()
    phcs.forEach((p) => {
      const k = `${p.district} · ${p.state}`
      groups.set(k, [...(groups.get(k) ?? []), p])
    })
    return [...groups.entries()]
  }, [phcs])
  const selectedPhc = phcs.find((p) => p.scope === phcCode)
  const phcAccount = accounts.find((a) => a.role === "phc_staff" && a.scope === phcCode && (a.phcPosition ?? "staff") === position)
  const phcEmail = phcAccount?.email ?? null

  function signInAs(email: string) {
    setPendingEmail(email)
    startTransition(async () => {
      const res = await demoSignIn(email)
      // Success redirects; we only get here on error.
      if (res?.error) toast.error(res.error)
      setPendingEmail(null)
    })
  }

  const busy = pendingEmail !== null
  const button = (acc: DemoAccount, title?: string) => (
    <AccountButton
      key={acc.email}
      acc={acc}
      kind={viewKindOf(acc.role, acc.phcPosition)}
      title={title}
      busy={busy}
      pending={pendingEmail === acc.email}
      onSelect={signInAs}
    />
  )

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Demo accounts</CardTitle>
        <CardDescription>One-click sign-in for judges. Each role sees only its own scope.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-labelledby="demo-national" className="space-y-2">
          <h3 id="demo-national" className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            National
          </h3>
          <div className="grid">{national.map((a) => button(a, "India · national admin"))}</div>
        </section>

        {STATES.map((st) => {
          const inState = accounts.filter((a) => a.state === st)
          const admin = inState.filter((a) => a.role === "state_admin")
          const officers = inState.filter((a) => a.role === "district_officer")
          const warehouses = inState.filter((a) => a.role === "warehouse_manager")
          return (
            <section key={st} aria-labelledby={`demo-${st}`} className="space-y-2">
              <h3 id={`demo-${st}`} className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {st}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {admin.map((a) => button(a, "State admin"))}
                {officers.map((a) => button(a, `${a.district} · district`))}
                {warehouses.map((a) => button(a, `${a.district} · warehouse`))}
              </div>
            </section>
          )
        })}

        <Separator />

        <section aria-labelledby="demo-phc" className="space-y-2">
          <h3 id="demo-phc" className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            PHC · {phcs.length} facilities
          </h3>
          <div className="bg-muted flex gap-1 rounded-lg p-1" role="radiogroup" aria-label="PHC login">
            {(["staff", "medical_officer"] as const).map((p) => {
              const kind: ViewKind = p === "medical_officer" ? "phc_doctor" : "phc_staff"
              const Icon = VIEW_ICON[kind]
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={position === p}
                  onClick={() => setPosition(p)}
                  className={cn(
                    "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium",
                    position === p ? "bg-background shadow-sm" : "text-muted-foreground",
                  )}
                  style={position === p ? { color: VIEW_COLOR[kind].fg } : undefined}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {p === "medical_officer" ? "Doctor" : "Staff"}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <Popover open={phcOpen} onOpenChange={setPhcOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={phcOpen}
                  aria-label="Choose a PHC"
                  className="h-11 min-w-0 flex-1 justify-between px-3 font-normal"
                  disabled={busy}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Building2 className="text-primary" aria-hidden="true" />
                    <span className="truncate">
                      {selectedPhc ? `${selectedPhc.label} · ${selectedPhc.district}` : "Choose a PHC"}
                    </span>
                  </span>
                  <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search PHC, district or state…" />
                  <CommandList>
                    <CommandEmpty>No PHC found.</CommandEmpty>
                    {phcGroups.map(([group, items]) => (
                      <CommandGroup key={group} heading={group}>
                        {items.map((p) => (
                          <CommandItem
                            key={p.email}
                            value={`${p.label} ${p.district} ${p.state} ${p.scope}`}
                            data-checked={p.scope === phcCode}
                            onSelect={() => {
                              setPhcCode(p.scope)
                              setPhcOpen(false)
                            }}
                          >
                            <Building2 className="text-muted-foreground" aria-hidden="true" />
                            <span className="truncate">{p.label}</span>
                            <span className="text-muted-foreground ml-auto text-xs">{p.scope}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              className="h-11 px-4"
              disabled={!phcEmail || busy}
              onClick={() => phcEmail && signInAs(phcEmail)}
            >
              {pendingEmail && pendingEmail === phcEmail ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Sign in
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  )
}

function AccountButton({
  acc,
  kind,
  title,
  busy,
  pending,
  onSelect,
}: {
  acc: DemoAccount
  kind: ViewKind
  title?: string
  busy: boolean
  pending: boolean
  onSelect: (email: string) => void
}) {
  const Icon: LucideIcon = VIEW_ICON[kind]
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-h-11 justify-start gap-2.5 px-3 py-2 text-left"
      disabled={busy}
      onClick={() => onSelect(acc.email)}
      aria-label={`Sign in as ${acc.fullName}, ${title ?? acc.label}`}
    >
      {pending ? (
        <Loader2 className="text-primary animate-spin" aria-hidden="true" />
      ) : (
        <Icon aria-hidden="true" style={{ color: VIEW_COLOR[kind].fg }} />
      )}
      <span className="min-w-0">
        <span className="block truncate font-medium">{title ?? acc.label}</span>
        <span className="text-muted-foreground block truncate text-xs font-normal">{acc.fullName}</span>
      </span>
    </Button>
  )
}
