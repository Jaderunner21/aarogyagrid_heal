"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { BedDouble, FileUp, Loader2, Pencil, Plus, Power, PowerOff, Warehouse } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminTable, type Column } from "@/components/heal/admin/admin-table"
import { ConfirmDialog } from "@/components/heal/admin/confirm-dialog"
import { createClient } from "@/lib/supabase/client"
import { runRpc } from "@/lib/client-actions"
import { formatDate } from "@/lib/format"
import type { BedType, Enums, Json } from "@/lib/database.types"
import { BED_TYPE_LABEL, FACILITY_TYPE_SHORT, TIER_BED_TYPES, TIER_LABEL, tierOf } from "@/lib/facility-types"

export type AdminFacility = {
  id: string
  name: string
  code: string
  type: Enums<"facility_type">
  districtId: string
  districtName: string
  stateName: string
  lat: number
  lng: number
  address: string | null
  totalBeds: number
  resupplyDays: number
  supplyingWarehouse: string | null
  supplyingWarehouseName: string | null
  isActive: boolean
  openedOn: string | null
  phc24x7: boolean
  hfrId: string | null
  hfrExtensions: Json
  beds: Partial<Record<BedType, number>>
}

const hasLaqshya = (ext: Json) => Boolean(ext && typeof ext === "object" && !Array.isArray(ext) && "laqshya" in ext)

type District = { id: string; name: string; code: string; stateId: string; stateName: string }
type Props = {
  isNational: boolean
  states: { id: string; name: string }[]
  districts: District[]
  facilities: AdminFacility[]
  pendingBeds: { facility_id: string; total_beds: number; effective_from: string }[]
}

const TYPE_LABEL: Record<string, string> = FACILITY_TYPE_SHORT

export function FacilitiesTab({ isNational, districts, facilities, pendingBeds }: Props) {
  // possible suppliers: warehouses (for everyone) and PHCs / CHCs (for sub-centres)
  const suppliers = facilities.filter((f) => (f.type === "warehouse" || f.type === "phc" || f.type === "chc") && f.isActive)
  const pending = new Map(pendingBeds.map((p) => [p.facility_id, p]))

  const columns: Column<AdminFacility>[] = [
    {
      key: "name",
      header: "Facility",
      text: (f) => `${f.name} ${f.code}`,
      cell: (f) => (
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            {f.type === "warehouse" ? <Warehouse className="text-muted-foreground size-4" aria-hidden="true" /> : null}
            {f.name}
          </p>
          <p className="text-muted-foreground text-xs">
            {f.code}
            {f.hfrId ? ` · HFR ${f.hfrId}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Tier",
      text: (f) => TIER_LABEL[tierOf(f.type, f.phc24x7)],
      cell: (f) => (
        <span>
          {TIER_LABEL[tierOf(f.type, f.phc24x7)]}
          {hasLaqshya(f.hfrExtensions) ? <span className="block text-[11px] text-pink-700">LaQshya</span> : null}
        </span>
      ),
    },
    {
      key: "district",
      header: isNational ? "District · State" : "District",
      text: (f) => (isNational ? `${f.districtName}, ${f.stateName}` : f.districtName),
      cell: (f) => (isNational ? `${f.districtName} · ${f.stateName}` : f.districtName),
    },
    {
      key: "beds",
      header: "Beds",
      text: (f) => f.totalBeds,
      className: "text-right",
      cell: (f) => (
        <span>
          {f.type === "warehouse" || f.type === "shc" ? "—" : f.totalBeds}
          {Object.keys(f.beds).length ? (
            <span className="text-muted-foreground block text-[11px]">
              {Object.entries(f.beds)
                .map(([t, n]) => `${BED_TYPE_LABEL[t as BedType]} ${n}`)
                .join(" · ")}
            </span>
          ) : null}
          {pending.get(f.id) ? (
            <span className="text-muted-foreground block text-[11px]">
              → {pending.get(f.id)!.total_beds} from {formatDate(pending.get(f.id)!.effective_from)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "warehouse",
      header: "Supplied by",
      text: (f) => f.supplyingWarehouseName ?? "",
      cell: (f) => f.supplyingWarehouseName ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: "status",
      header: "Status",
      text: (f) => (f.isActive ? "Active" : "Deactivated"),
      cell: (f) =>
        f.isActive ? (
          <Badge variant="outline" className="border-green-200 bg-green-50 text-ok">Active</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Deactivated</Badge>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      cell: (f) => (
        <div className="flex justify-end gap-1">
          <FacilityDialog districts={districts} suppliers={suppliers} facility={f} />
          {f.type !== "warehouse" && f.type !== "shc" && f.isActive ? <BedsDialog facility={f} /> : null}
          <ActiveToggle facility={f} />
        </div>
      ),
    },
  ]

  return (
    <AdminTable
      rows={facilities}
      columns={columns}
      rowKey={(f) => f.id}
      csvName="facilities"
      searchPlaceholder="Search name or code"
      rowClassName={(f) => (f.isActive ? undefined : "opacity-60")}
      filters={[
        { key: "type", label: "Types", options: Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })), match: (f, v) => f.type === v },
        { key: "district", label: "Districts", options: districts.map((d) => ({ value: d.id, label: d.name })), match: (f, v) => f.districtId === v },
        {
          key: "active",
          label: "Statuses",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Deactivated" },
          ],
          match: (f, v) => (v === "active" ? f.isActive : !f.isActive),
        },
      ]}
      actions={
        <>
          <ImportDialog />
          <FacilityDialog districts={districts} suppliers={suppliers} />
        </>
      }
    />
  )
}

// ---------------------------------------------------------------- add / edit
function FacilityDialog({
  districts,
  suppliers,
  facility,
}: {
  districts: District[]
  suppliers: AdminFacility[]
  facility?: AdminFacility
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState(() => ({
    districtId: facility?.districtId ?? districts[0]?.id ?? "",
    type: (facility?.type ?? "phc") as Enums<"facility_type">,
    name: facility?.name ?? "",
    code: facility?.code ?? "",
    lat: facility ? String(facility.lat) : "",
    lng: facility ? String(facility.lng) : "",
    address: facility?.address ?? "",
    totalBeds: facility ? String(facility.totalBeds) : "6",
    resupplyDays: facility ? String(facility.resupplyDays) : "7",
    warehouse: facility?.supplyingWarehouse ?? "",
    hfrId: facility?.hfrId ?? "",
  }))
  const [is24x7, setIs24x7] = useState(facility?.phc24x7 ?? false)
  const [laqshya, setLaqshya] = useState(facility ? hasLaqshya(facility.hfrExtensions) : false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const stateOf = (districtId: string) => districts.find((d) => d.id === districtId)?.stateId
  // a sub-centre is supplied by a PHC or CHC in its district; everything else by a warehouse in the state
  const whOptions = useMemo(
    () =>
      suppliers.filter((w) =>
        form.type === "shc"
          ? (w.type === "phc" || w.type === "chc") && w.districtId === form.districtId && w.id !== facility?.id
          : w.type === "warehouse" && stateOf(w.districtId) === stateOf(form.districtId),
      ),
    [suppliers, form.districtId, form.type], // eslint-disable-line react-hooks/exhaustive-deps
  )

  function save() {
    startTransition(async () => {
      const ok = await runRpc(
        createClient().rpc("admin_save_facility", {
          p_id: facility?.id ?? null,
          p_district: form.districtId,
          p_type: form.type,
          p_name: form.name,
          p_code: form.code,
          p_lat: Number(form.lat),
          p_lng: Number(form.lng),
          p_address: form.address || undefined,
          p_total_beds: Number(form.totalBeds || 0),
          p_resupply_days: Number(form.resupplyDays || 7),
          p_supplying_warehouse: form.type === "warehouse" ? undefined : form.warehouse || undefined,
          p_phc_24x7: form.type === "phc" ? is24x7 : false,
          p_hfr_id: form.hfrId.trim(),
          p_hfr_extensions: (() => {
            const base = (facility?.hfrExtensions && typeof facility.hfrExtensions === "object" && !Array.isArray(facility.hfrExtensions)
              ? { ...facility.hfrExtensions }
              : {}) as Record<string, Json>
            if (laqshya && !("laqshya" in base)) base.laqshya = { labour_room: true, since: new Date().toISOString().slice(0, 10) }
            if (!laqshya) delete base.laqshya
            return base
          })(),
        }),
        facility ? "Facility updated." : "Facility added with an empty stock line for every medicine it holds.",
      )
      if (ok) {
        setOpen(false)
        router.refresh()
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {facility ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${facility.name}`}>
            <Pencil />
          </Button>
        ) : (
          <Button size="sm" className="h-9">
            <Plus aria-hidden="true" /> Add facility
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{facility ? `Edit ${facility.name}` : "Add facility"}</DialogTitle>
          <DialogDescription>
            {facility ? "Beds change separately, with an effective date." : "New facilities start with zero stock; history starts today."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="District" id="f-district">
            <Select value={form.districtId} onValueChange={(v) => set("districtId", v)}>
              <SelectTrigger id="f-district" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {districts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name} · {d.stateName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Type" id="f-type">
            <Select value={form.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger id="f-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Name" id="f-name">
            <Input id="f-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="PHC Salumber" />
          </Field>
          <Field label="Code" id="f-code">
            <Input id="f-code" value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="PHC-UDR-09" />
          </Field>
          <Field label="Latitude" id="f-lat">
            <Input id="f-lat" inputMode="decimal" value={form.lat} onChange={(e) => set("lat", e.target.value)} />
          </Field>
          <Field label="Longitude" id="f-lng">
            <Input id="f-lng" inputMode="decimal" value={form.lng} onChange={(e) => set("lng", e.target.value)} />
          </Field>
          {form.type === "phc" ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="accent-primary size-4" checked={is24x7} onChange={(e) => setIs24x7(e.target.checked)} />
              Open 24×7 (delivery point: inpatient and maternity beds, 24×7-only medicines)
            </label>
          ) : null}
          {!facility && form.type !== "warehouse" && form.type !== "shc" ? (
            <Field label="Total beds" id="f-beds">
              <Input id="f-beds" type="number" min={0} value={form.totalBeds} onChange={(e) => set("totalBeds", e.target.value)} />
            </Field>
          ) : null}
          <Field label="Resupply time (days)" id="f-resupply">
            <Input id="f-resupply" type="number" min={1} value={form.resupplyDays} onChange={(e) => set("resupplyDays", e.target.value)} />
          </Field>
          {form.type !== "warehouse" ? (
            <Field label={form.type === "shc" ? "Supplied by (PHC or CHC)" : "Supplying warehouse"} id="f-wh" wide>
              <Select value={form.warehouse} onValueChange={(v) => set("warehouse", v)}>
                <SelectTrigger id="f-wh" className="w-full">
                  <SelectValue placeholder={form.type === "shc" ? "Choose PHC or CHC" : "Choose warehouse"} />
                </SelectTrigger>
                <SelectContent>
                  {whOptions.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="HFR ID (Health Facility Registry)" id="f-hfr">
            <Input id="f-hfr" value={form.hfrId} onChange={(e) => set("hfrId", e.target.value)} placeholder="IN0810001234" />
          </Field>
          <Field label="Address (optional)" id="f-address">
            <Input id="f-address" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          {form.type !== "warehouse" && form.type !== "shc" ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="accent-primary size-4" checked={laqshya} onChange={(e) => setLaqshya(e.target.checked)} />
              LaQshya certified labour room (maternal medicines get priority here)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !form.name || !form.code || !form.lat || !form.lng}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            {facility ? "Save changes" : "Add facility"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, id, wide, children }: { label: string; id: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "grid gap-1.5 sm:col-span-2" : "grid gap-1.5"}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- beds by type (limited by the facility's tier)
function BedsDialog({ facility }: { facility: AdminFacility }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const allowed = TIER_BED_TYPES[tierOf(facility.type, facility.phc24x7)]
  const [beds, setBeds] = useState<Record<string, string>>(() =>
    Object.fromEntries(allowed.map((t) => [t, String(facility.beds[t] ?? 0)])),
  )
  const [pending, startTransition] = useTransition()
  const total = allowed.reduce((sum, t) => sum + Number(beds[t] || 0), 0)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Change beds at ${facility.name}`}>
          <BedDouble />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Beds by type · {facility.name}</DialogTitle>
          <DialogDescription>
            A {TIER_LABEL[tierOf(facility.type, facility.phc24x7)]} can have these bed types (IPHS tier). Total beds are their sum.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {allowed.map((t) => (
            <Field key={t} label={BED_TYPE_LABEL[t]} id={`b-${t}`}>
              <Input id={`b-${t}`} type="number" min={0} value={beds[t] ?? "0"} onChange={(e) => setBeds((b) => ({ ...b, [t]: e.target.value }))} />
            </Field>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">Total: {total} beds</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const ok = await runRpc(
                  createClient().rpc("admin_set_facility_beds", {
                    p_id: facility.id,
                    p_beds: Object.fromEntries(allowed.map((t) => [t, Number(beds[t] || 0)])),
                  }),
                  "Beds updated.",
                )
                if (ok) {
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

function ActiveToggle({ facility }: { facility: AdminFacility }) {
  const router = useRouter()
  const deactivate = facility.isActive
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="icon-sm" aria-label={`${deactivate ? "Deactivate" : "Reactivate"} ${facility.name}`}>
          {deactivate ? <PowerOff className="text-critical" /> : <Power className="text-ok" />}
        </Button>
      }
      title={`${deactivate ? "Deactivate" : "Reactivate"} ${facility.name}?`}
      description={
        deactivate
          ? "It disappears from maps, forecasts and recommendations. Its history and stock records are kept; nothing is deleted."
          : "It returns to maps, forecasts and recommendations."
      }
      confirmLabel={deactivate ? "Deactivate" : "Reactivate"}
      destructive={deactivate}
      reasonLabel={deactivate ? "Reason" : undefined}
      onConfirm={async (reason) => {
        const ok = await runRpc(
          createClient().rpc("admin_set_facility_active", { p_id: facility.id, p_active: !deactivate, p_reason: reason || undefined }),
          deactivate ? "Facility deactivated." : "Facility reactivated.",
        )
        if (ok) router.refresh()
        return ok
      }}
    />
  )
}

// ---------------------------------------------------------------- CSV import
const CSV_HEADERS = ["district_code", "type", "name", "code", "lat", "lng", "address", "total_beds", "resupply_days", "supplying_warehouse_code", "phc_24x7", "hfr_id"]

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(cell)
      cell = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(cell)
      if (row.some((x) => x.trim())) rows.push(row)
      row = []
      cell = ""
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim())) rows.push(row)
  const [head, ...body] = rows
  const keys = (head ?? []).map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])))
}

function ImportDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(
    CSV_HEADERS.join(",") +
      "\nRJ-UDR,phc,PHC Salumber,PHC-UDR-09,24.13,74.05,Salumber,6,7,WH-UDR,yes,\nRJ-UDR,shc,SHC Jaisamand,SHC-UDR-01,24.26,73.95,Jaisamand,0,7,PHC-UDR-09,,\n",
  )}`

  async function onFile(file: File | undefined) {
    setError(null)
    setRows([])
    if (!file) return
    const parsed = parseCsv(await file.text())
    const missing = ["district_code", "type", "name", "code", "lat", "lng"].filter((h) => !(parsed[0] && h in parsed[0]))
    if (missing.length) {
      setError(`Missing columns: ${missing.join(", ")}`)
      return
    }
    setRows(parsed)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) {
          setRows([])
          setError(null)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <FileUp aria-hidden="true" /> Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import facilities from CSV</DialogTitle>
          <DialogDescription>
            Rows with an existing code update that facility; new codes are added. All rows succeed or none do.{" "}
            <a href={template} download="facilities-template.csv" className="text-primary underline">
              Download template
            </a>
          </DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => onFile(e.target.files?.[0])} />
        {error ? <p className="text-critical text-sm">{error}</p> : null}
        {rows.length ? (
          <div className="max-h-64 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/60 sticky top-0">
                <tr>
                  {["district_code", "type", "name", "code", "lat", "lng", "total_beds", "supplying_warehouse_code"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => (
                  <tr key={i}>
                    {["district_code", "type", "name", "code", "lat", "lng", "total_beds", "supplying_warehouse_code"].map((h) => (
                      <td key={h} className="px-2 py-1">
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || rows.length === 0}
            onClick={() =>
              startTransition(async () => {
                const { data, error: err } = await createClient().rpc("admin_import_facilities", { p_rows: rows })
                if (err) {
                  setError(err.message)
                  toast.error(err.message)
                  return
                }
                toast.success(`${data} facilities imported.`)
                setOpen(false)
                router.refresh()
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Import {rows.length || ""} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
