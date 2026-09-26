"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowRightLeft, Crown, Loader2, ShieldCheck, UserCog, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Section } from "@/components/heal/section"
import { EmptyState } from "@/components/heal/empty-state"
import { CopyLink, ROLE_LABEL, ScopeFields, scopeComplete, type AdminPerson, type ScopeOptions } from "@/components/heal/admin/people-tab"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import { formatDateTime } from "@/lib/format"
import type { Enums, Tables } from "@/lib/database.types"

type Handover = Tables<"admin_handovers"> & { fromName: string; stateName: string }

export function AdminsTab({
  people,
  meId,
  myRole,
  myStateId,
  handovers,
  ...scope
}: ScopeOptions & {
  people: AdminPerson[]
  meId: string
  myRole: Enums<"user_role">
  myStateId: string | null
  handovers: Handover[]
}) {
  const router = useRouter()
  const national = people.filter((p) => p.role === "national_admin" && p.isActive)
  const pending = handovers.filter((h) => h.status === "pending")
  const history = handovers.filter((h) => h.status !== "pending").slice(0, 10)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <HandoverDialog people={people} meId={meId} myRole={myRole} myStateId={myStateId} {...scope} />
        {scope.isNational ? <AssignStateAdminDialog people={people} {...scope} /> : null}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section title="Current admins" description="Every state keeps at least one active admin, and the country one national admin.">
          <ul className="divide-y">
            {scope.isNational
              ? national.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <Crown className="text-low size-4" aria-hidden="true" />
                    <span className="font-medium">{p.fullName}</span>
                    <span className="text-muted-foreground text-xs">{p.email}</span>
                    <Badge variant="secondary" className="ml-auto">National</Badge>
                  </li>
                ))
              : null}
            {scope.states.map((s) => {
              const admins = people.filter((p) => p.role === "state_admin" && p.isActive && p.stateId === s.id)
              return (
                <li key={s.id} className="py-2.5">
                  <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{s.name}</p>
                  {admins.length ? (
                    admins.map((p) => (
                      <p key={p.id} className="flex items-center gap-2">
                        <ShieldCheck className="text-primary size-4" aria-hidden="true" />
                        <span className="font-medium">{p.fullName}</span>
                        <span className="text-muted-foreground text-xs">{p.email}</span>
                        {p.id === meId ? <Badge variant="outline" className="ml-auto">You</Badge> : null}
                      </p>
                    ))
                  ) : (
                    <p className="text-critical text-sm">No state admin yet — assign one.</p>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>

        <Section title="Pending handovers" description="The successor accepts from their Handover page; then the change happens in one step.">
          {pending.length === 0 ? (
            <EmptyState icon={ArrowRightLeft} title="No handovers waiting." className="py-6" />
          ) : (
            <ul className="divide-y">
              {pending.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                  <span>
                    <b>{h.fromName}</b> → <b>{h.to_name ?? h.to_email}</b> · {h.scope_type === "state" ? `${h.stateName} state admin` : "national admin"}
                    <span className="text-muted-foreground block text-xs">
                      Asked {formatDateTime(h.created_at)} · old admin will be {h.old_admin_action === "demote" ? `moved to ${ROLE_LABEL[h.demote_role ?? ""] ?? "another role"}` : "deactivated"}
                    </span>
                  </span>
                  {h.to_user === meId ? (
                    <Button asChild size="sm" className="ml-auto">
                      <Link href="/handover">Review</Link>
                    </Button>
                  ) : h.from_user === meId || scope.isNational ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={async () => {
                        if (await runRpc(createClient().rpc("decide_admin_handover", { p_id: h.id, p_decision: "cancelled" }), "Handover cancelled.")) router.refresh()
                      }}
                    >
                      <X aria-hidden="true" /> Cancel
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {history.length ? (
            <div className="mt-4 border-t pt-3">
              <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">Recent</p>
              <ul className="space-y-1 text-xs">
                {history.map((h) => (
                  <li key={h.id}>
                    {h.fromName} → {h.to_name ?? h.to_email}: <b>{h.status}</b> {h.decided_at ? `· ${formatDateTime(h.decided_at)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- hand over my role
function HandoverDialog({
  people,
  meId,
  myRole,
  myStateId,
  ...scope
}: ScopeOptions & { people: AdminPerson[]; meId: string; myRole: Enums<"user_role">; myStateId: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<"existing" | "invite">("existing")
  const [successor, setSuccessor] = useState("")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [action, setAction] = useState<"demote" | "deactivate">("demote")
  const [role, setRole] = useState<Enums<"user_role">>(myRole === "national_admin" ? "state_admin" : "district_officer")
  const [facilityId, setFacilityId] = useState("")
  const [districtId, setDistrictId] = useState("")
  const [stateId, setStateId] = useState(myStateId ?? "")
  const [link, setLink] = useState<string | null>(null)
  const candidates = people.filter((p) => p.id !== meId && p.isActive && (myRole === "national_admin" || p.stateId === myStateId))
  const demoteRoles: Enums<"user_role">[] =
    myRole === "national_admin" ? ["state_admin", "district_officer"] : ["district_officer", "warehouse_manager", "phc_staff"]
  const ready =
    (mode === "existing" ? Boolean(successor) : /\S+@\S+\.\S+/.test(email) && name.trim()) &&
    (action === "deactivate" || scopeComplete(role, facilityId, districtId, stateId))

  function submit() {
    startTransition(async () => {
      const demote =
        action === "demote"
          ? { p_demote_role: role, p_demote_facility: facilityId || undefined, p_demote_district: districtId || undefined, p_demote_state: stateId || undefined }
          : {}
      if (mode === "existing") {
        const ok = await runRpc(
          createClient().rpc("request_admin_handover", { p_to_user: successor, p_old_action: action, ...demote }),
          "Handover requested. It takes effect when your successor accepts.",
        )
        if (ok) {
          setOpen(false)
          router.refresh()
        }
        return
      }
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "handover", email, full_name: name, old_action: action, ...demote }),
      })
      const body = (await res.json().catch(() => ({}))) as { link?: string; error?: string }
      if (!res.ok || !body.link) {
        toast.error(body.error ?? "Could not invite the successor")
        return
      }
      toast.success("Successor invited. The handover completes when they accept.")
      setLink(body.link)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setLink(null)
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <ArrowRightLeft aria-hidden="true" /> Hand over my admin role
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand over your admin role</DialogTitle>
          <DialogDescription>
            Your successor accepts first, so your {myRole === "national_admin" ? "country" : "state"} is never left without an admin.
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <CopyLink link={link} />
        ) : (
          <div className="grid gap-3">
            <div className="bg-muted flex gap-1 rounded-lg p-1" role="radiogroup" aria-label="Successor">
              {(["existing", "invite"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={`h-8 flex-1 rounded-md text-sm font-medium ${mode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                >
                  {m === "existing" ? "Someone already here" : "Invite someone new"}
                </button>
              ))}
            </div>
            {mode === "existing" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="h-successor">Successor</Label>
                <Select value={successor} onValueChange={setSuccessor}>
                  <SelectTrigger id="h-successor" className="w-full">
                    <SelectValue placeholder="Choose a person" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.fullName} · {ROLE_LABEL[p.role]} · {p.scopeName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="h-email">Successor&apos;s email</Label>
                  <Input id="h-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="h-name">Full name</Label>
                  <Input id="h-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="h-action">After the handover, you will be</Label>
              <Select value={action} onValueChange={(v) => setAction(v as "demote" | "deactivate")}>
                <SelectTrigger id="h-action" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="demote">Moved to another role</SelectItem>
                  <SelectItem value="deactivate">Deactivated (leaving)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {action === "demote" ? (
              <ScopeFields
                {...scope}
                roles={demoteRoles}
                role={role}
                setRole={setRole}
                facilityId={facilityId}
                setFacilityId={setFacilityId}
                districtId={districtId}
                setDistrictId={setDistrictId}
                stateId={stateId}
                setStateId={setStateId}
              />
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {link ? "Done" : "Cancel"}
          </Button>
          {!link ? (
            <Button onClick={submit} disabled={pending || !ready}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowRightLeft aria-hidden="true" />}
              Request handover
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- national: assign a state admin directly
function AssignStateAdminDialog({ people, ...scope }: ScopeOptions & { people: AdminPerson[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [stateId, setStateId] = useState("")
  const [person, setPerson] = useState("")
  const [oldAdmin, setOldAdmin] = useState("none")
  const [action, setAction] = useState<"demote" | "deactivate">("demote")
  const [districtId, setDistrictId] = useState("")
  const currentAdmins = people.filter((p) => p.role === "state_admin" && p.isActive && p.stateId === stateId)
  const candidates = people.filter((p) => p.isActive && p.role !== "national_admin" && !(p.role === "state_admin" && p.stateId === stateId))
  const districtsInState = scope.districts.filter((d) => d.stateId === stateId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserCog aria-hidden="true" /> Assign state admin
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign a state admin</DialogTitle>
          <DialogDescription>As national admin you can do this directly, with no acceptance step.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="a-state">State</Label>
            <Select value={stateId} onValueChange={(v) => { setStateId(v); setOldAdmin("none") }}>
              <SelectTrigger id="a-state" className="w-full">
                <SelectValue placeholder="Choose state" />
              </SelectTrigger>
              <SelectContent>
                {scope.states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="a-person">New state admin</Label>
            <Select value={person} onValueChange={setPerson} disabled={!stateId}>
              <SelectTrigger id="a-person" className="w-full">
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.fullName} · {ROLE_LABEL[p.role]} · {p.scopeName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {currentAdmins.length ? (
            <div className="grid gap-1.5">
              <Label htmlFor="a-old">Replace current admin</Label>
              <Select value={oldAdmin} onValueChange={setOldAdmin}>
                <SelectTrigger id="a-old" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No — add alongside</SelectItem>
                  {currentAdmins.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {oldAdmin !== "none" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="a-action">Previous admin will be</Label>
                <Select value={action} onValueChange={(v) => setAction(v as "demote" | "deactivate")}>
                  <SelectTrigger id="a-action" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="demote">District officer</SelectItem>
                    <SelectItem value="deactivate">Deactivated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {action === "demote" ? (
                <div className="grid gap-1.5">
                  <Label htmlFor="a-district">Of district</Label>
                  <Select value={districtId} onValueChange={setDistrictId}>
                    <SelectTrigger id="a-district" className="w-full">
                      <SelectValue placeholder="Choose district" />
                    </SelectTrigger>
                    <SelectContent>
                      {districtsInState.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !stateId || !person || (oldAdmin !== "none" && action === "demote" && !districtId)}
            onClick={() =>
              startTransition(async () => {
                const ok = await runRpc(
                  createClient().rpc("admin_set_state_admin", {
                    p_state: stateId,
                    p_user: person,
                    ...(oldAdmin !== "none"
                      ? {
                          p_old_admin: oldAdmin,
                          p_old_action: action,
                          ...(action === "demote" ? { p_demote_role: "district_officer" as const, p_demote_district: districtId } : {}),
                        }
                      : {}),
                  }),
                  "State admin assigned.",
                )
                if (ok) {
                  setOpen(false)
                  router.refresh()
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
