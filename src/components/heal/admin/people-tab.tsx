"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Check, Copy, Loader2, Pencil, Power, PowerOff, UserPlus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminTable, type Column } from "@/components/heal/admin/admin-table"
import { ConfirmDialog } from "@/components/heal/admin/confirm-dialog"
import type { AdminFacility } from "@/components/heal/admin/facilities-tab"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import type { Enums } from "@/lib/database.types"

export type AdminPerson = {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  role: Enums<"user_role">
  facilityId: string | null
  districtId: string | null
  stateId: string | null
  scopeName: string
  isActive: boolean
  inScope: boolean
  phcPosition: "staff" | "medical_officer"
  hprId: string | null
}

type Position = AdminPerson["phcPosition"]
const roleText = (p: Pick<AdminPerson, "role" | "phcPosition">) =>
  p.role === "phc_staff" && p.phcPosition === "medical_officer" ? "PHC doctor (medical officer)" : ROLE_LABEL[p.role]

/** PHC logins are either the medical officer (signs off requests) or staff. */
function PositionField({ value, onChange }: { value: Position; onChange: (v: Position) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="phc-position">At the PHC they are</Label>
      <Select value={value} onValueChange={(v) => onChange(v as Position)}>
        <SelectTrigger id="phc-position" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="staff">Staff (daily entry, requests)</SelectItem>
          <SelectItem value="medical_officer">Doctor / medical officer (also signs off staff requests)</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

type District = { id: string; name: string; code: string; stateId: string; stateName: string }
export type ScopeOptions = {
  isNational: boolean
  states: { id: string; name: string }[]
  districts: District[]
  facilities: AdminFacility[]
}

export const ROLE_LABEL: Record<string, string> = {
  phc_staff: "PHC staff",
  warehouse_manager: "Warehouse manager",
  district_officer: "District officer",
  state_admin: "State admin",
  national_admin: "National admin",
}

export function PeopleTab({ people, meId, ...scope }: ScopeOptions & { people: AdminPerson[]; meId: string }) {
  const columns: Column<AdminPerson>[] = [
    {
      key: "name",
      header: "Name",
      text: (p) => `${p.fullName} ${p.email ?? ""}`,
      cell: (p) => (
        <div>
          <p className="font-medium">
            {p.fullName}
            {p.id === meId ? <span className="text-muted-foreground ml-1 text-xs">(you)</span> : null}
          </p>
          <p className="text-muted-foreground text-xs">
            {p.email ?? "—"}
            {p.hprId ? ` · HPR ${p.hprId}` : ""}
          </p>
        </div>
      ),
    },
    { key: "role", header: "Role", text: (p) => roleText(p), cell: (p) => roleText(p) },
    { key: "scope", header: "Works at", text: (p) => p.scopeName, cell: (p) => p.scopeName },
    { key: "phone", header: "Phone", text: (p) => p.phone ?? "", cell: (p) => p.phone ?? <span className="text-muted-foreground">—</span> },
    {
      key: "status",
      header: "Status",
      text: (p) => (p.isActive ? "Active" : "Deactivated"),
      cell: (p) =>
        p.isActive ? (
          <Badge variant="outline" className="border-green-200 bg-green-50 text-ok">Active</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Deactivated</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (p) =>
        p.role === "state_admin" || p.role === "national_admin" ? (
          <span className="text-muted-foreground text-xs">via Admins tab</span>
        ) : (
          <div className="flex justify-end gap-1">
            <EditPersonDialog person={p} {...scope} />
            <PersonActiveToggle person={p} />
          </div>
        ),
    },
  ]

  return (
    <AdminTable
      rows={people}
      columns={columns}
      rowKey={(p) => p.id}
      csvName="people"
      searchPlaceholder="Search name, email or facility"
      rowClassName={(p) => (p.isActive ? undefined : "opacity-60")}
      filters={[
        {
          key: "role",
          label: "Roles",
          options: [
            { value: "phc_doctor", label: "PHC doctor" },
            ...Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })),
          ],
          match: (p, v) =>
            v === "phc_doctor"
              ? p.role === "phc_staff" && p.phcPosition === "medical_officer"
              : v === "phc_staff"
                ? p.role === "phc_staff" && p.phcPosition !== "medical_officer"
                : p.role === v,
        },
        {
          key: "active",
          label: "Statuses",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Deactivated" },
          ],
          match: (p, v) => (v === "active" ? p.isActive : !p.isActive),
        },
      ]}
      actions={<InviteDialog {...scope} />}
    />
  )
}

// ---------------------------------------------------------------- role + scope picker
export function ScopeFields({
  role,
  setRole,
  facilityId,
  setFacilityId,
  districtId,
  setDistrictId,
  stateId,
  setStateId,
  roles,
  isNational,
  states,
  districts,
  facilities,
}: ScopeOptions & {
  role: Enums<"user_role">
  setRole: (r: Enums<"user_role">) => void
  facilityId: string
  setFacilityId: (v: string) => void
  districtId: string
  setDistrictId: (v: string) => void
  stateId: string
  setStateId: (v: string) => void
  roles: Enums<"user_role">[]
}) {
  const facilityOptions = facilities.filter((f) => f.isActive && (role === "warehouse_manager" ? f.type === "warehouse" : f.type !== "warehouse"))
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="p-role">Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as Enums<"user_role">)}>
          <SelectTrigger id="p-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {ROLE_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {role === "phc_staff" || role === "warehouse_manager" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="p-facility">{role === "warehouse_manager" ? "Warehouse" : "Facility"}</Label>
          <Select value={facilityId} onValueChange={setFacilityId}>
            <SelectTrigger id="p-facility" className="w-full">
              <SelectValue placeholder="Choose facility" />
            </SelectTrigger>
            <SelectContent>
              {facilityOptions.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name} · {f.districtName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : role === "district_officer" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="p-district">District</Label>
          <Select value={districtId} onValueChange={setDistrictId}>
            <SelectTrigger id="p-district" className="w-full">
              <SelectValue placeholder="Choose district" />
            </SelectTrigger>
            <SelectContent>
              {districts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name} · {d.stateName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : role === "state_admin" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="p-state">State</Label>
          <Select value={stateId} onValueChange={setStateId} disabled={!isNational && states.length === 1}>
            <SelectTrigger id="p-state" className="w-full">
              <SelectValue placeholder="Choose state" />
            </SelectTrigger>
            <SelectContent>
              {states.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </>
  )
}

export function scopeComplete(role: string, facilityId: string, districtId: string, stateId: string) {
  if (role === "phc_staff" || role === "warehouse_manager") return Boolean(facilityId)
  if (role === "district_officer") return Boolean(districtId)
  if (role === "state_admin") return Boolean(stateId)
  return true
}

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="grid gap-1.5 rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="text-sm font-medium text-green-900">Invitation created. Share this one-time sign-in link:</p>
      <div className="flex gap-2">
        <Input readOnly value={link} className="h-9 bg-white text-xs" aria-label="Invite link" onFocus={(e) => e.target.select()} />
        <Button
          size="sm"
          className="h-9"
          onClick={async () => {
            await navigator.clipboard.writeText(link)
            setCopied(true)
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-green-900/80">They set a password on first sign-in. The link works once.</p>
    </div>
  )
}

function InviteDialog(scope: ScopeOptions) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState<Enums<"user_role">>("phc_staff")
  const [position, setPosition] = useState<Position>("staff")
  const [facilityId, setFacilityId] = useState("")
  const [districtId, setDistrictId] = useState("")
  const [stateId, setStateId] = useState(scope.states.length === 1 ? scope.states[0].id : "")
  const [link, setLink] = useState<string | null>(null)

  function reset() {
    setEmail("")
    setName("")
    setFacilityId("")
    setDistrictId("")
    setLink(null)
  }

  function invite() {
    startTransition(async () => {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "person",
          email,
          full_name: name,
          role,
          facility_id: facilityId || null,
          district_id: districtId || null,
          state_id: stateId || null,
          phc_position: role === "phc_staff" ? position : undefined,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { link?: string; error?: string }
      if (!res.ok || !body.link) {
        toast.error(body.error ?? "Could not invite")
        return
      }
      toast.success(`${name} invited as ${ROLE_LABEL[role]}.`)
      setLink(body.link)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="h-9">
          <UserPlus aria-hidden="true" /> Invite person
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a person</DialogTitle>
          <DialogDescription>They get a sign-in link and land on their own home page with only their scope.</DialogDescription>
        </DialogHeader>
        {link ? (
          <CopyLink link={link} />
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-email">Email</Label>
              <Input id="p-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-name">Full name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <ScopeFields
              {...scope}
              roles={["phc_staff", "warehouse_manager", "district_officer", "state_admin"]}
              role={role}
              setRole={setRole}
              facilityId={facilityId}
              setFacilityId={setFacilityId}
              districtId={districtId}
              setDistrictId={setDistrictId}
              stateId={stateId}
              setStateId={setStateId}
            />
            {role === "phc_staff" ? <PositionField value={position} onChange={setPosition} /> : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {link ? "Done" : "Cancel"}
          </Button>
          {!link ? (
            <Button onClick={invite} disabled={pending || !/\S+@\S+\.\S+/.test(email) || !name.trim() || !scopeComplete(role, facilityId, districtId, stateId)}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
              Invite
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditPersonDialog({ person, ...scope }: ScopeOptions & { person: AdminPerson }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState(person.fullName)
  const [phone, setPhone] = useState(person.phone ?? "")
  const [role, setRole] = useState<Enums<"user_role">>(person.role)
  const [facilityId, setFacilityId] = useState(person.facilityId ?? "")
  const [districtId, setDistrictId] = useState(person.districtId ?? "")
  const [stateId, setStateId] = useState(person.stateId ?? "")
  const [position, setPosition] = useState<Position>(person.phcPosition)
  const [hprId, setHprId] = useState(person.hprId ?? "")

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit or reassign ${person.fullName}`}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit or reassign · {person.fullName}</DialogTitle>
          <DialogDescription>Transferred to another facility or district? Change it here; their history stays.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="e-name">Full name</Label>
            <Input id="e-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="e-phone">Phone</Label>
            <Input id="e-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="e-hpr">HPR ID (Healthcare Professionals Registry, optional)</Label>
            <Input id="e-hpr" value={hprId} onChange={(e) => setHprId(e.target.value)} placeholder="71-1234-5678-9012" />
          </div>
          <ScopeFields
            {...scope}
            roles={["phc_staff", "warehouse_manager", "district_officer"]}
            role={role}
            setRole={setRole}
            facilityId={facilityId}
            setFacilityId={setFacilityId}
            districtId={districtId}
            setDistrictId={setDistrictId}
            stateId={stateId}
            setStateId={setStateId}
          />
          {role === "phc_staff" ? <PositionField value={position} onChange={setPosition} /> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !scopeComplete(role, facilityId, districtId, stateId)}
            onClick={() =>
              startTransition(async () => {
                const ok = await runRpc(
                  createClient().rpc("admin_update_person", {
                    p_id: person.id,
                    p_full_name: name,
                    p_phone: phone || null,
                    p_role: role,
                    p_facility: facilityId || undefined,
                    p_district: districtId || undefined,
                  }),
                  "Saved.",
                )
                const posOk =
                  ok && role === "phc_staff" && position !== person.phcPosition
                    ? await runRpc(createClient().rpc("admin_set_phc_position", { p_id: person.id, p_position: position }), "Position updated.")
                    : ok
                const hprOk =
                  ok && posOk && hprId.trim() !== (person.hprId ?? "")
                    ? await runRpc(createClient().rpc("admin_set_registry_ids", { p_person: person.id, p_hpr_id: hprId.trim() }), "HPR ID saved.")
                    : ok && posOk
                if (ok && posOk && hprOk) {
                  setOpen(false)
                  router.refresh()
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PersonActiveToggle({ person }: { person: AdminPerson }) {
  const router = useRouter()
  const deactivate = person.isActive
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`${deactivate ? "Deactivate" : "Reactivate"} ${person.fullName}`}>
          {deactivate ? <PowerOff className="text-critical" /> : <Power className="text-ok" />}
        </Button>
      }
      title={`${deactivate ? "Deactivate" : "Reactivate"} ${person.fullName}?`}
      description={
        deactivate
          ? "They can no longer sign in or see any data. Their entries and approvals stay in the records."
          : "They can sign in again with their previous role."
      }
      confirmLabel={deactivate ? "Deactivate" : "Reactivate"}
      destructive={deactivate}
      reasonLabel={deactivate ? "Reason" : undefined}
      onConfirm={async (reason) => {
        const res = await fetch("/api/admin/person-active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: person.id, active: !deactivate, reason }),
        })
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          toast.error(body.error ?? "Could not change this person")
          return false
        }
        toast.success(deactivate ? "Deactivated." : "Reactivated.")
        router.refresh()
        return true
      }}
    />
  )
}
