"use client"

import "leaflet/dist/leaflet.css"
import { Fragment, useEffect, useState } from "react"
import L from "leaflet"
import { CircleMarker, GeoJSON, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet"
import type { Feature, FeatureCollection, Geometry } from "geojson"
import type { MapFacility, MapTransfer } from "@/lib/map"
import { createClient } from "@/lib/supabase/client"
import { FACILITY_TYPE_LABEL } from "@/lib/facility-types"
import { STATUS_META } from "@/lib/status"
import { formatNumber } from "@/lib/format"

const TRANSFER_COLOR: Record<string, string> = {
  proposed: "#D97706",
  approved: "#0F766E",
  dispatched: "#2563EB",
  received: "#16A34A",
}

function warehouseIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:18px;height:18px;border-radius:4px;background:#fff;border:3px solid ${color};box-shadow:0 1px 3px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center"><div style="width:6px;height:6px;background:${color}"></div></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

/** Hospitals (CHC, district hospital): a white disc with a coloured cross, bigger for the district hospital. */
function hospitalIcon(color: string, big: boolean) {
  const s = big ? 26 : 20
  return L.divIcon({
    className: "",
    html: `<div style="width:${s}px;height:${s}px;border-radius:50%;background:#fff;border:3px solid ${color};box-shadow:0 1px 3px rgba(15,23,42,.35);display:flex;align-items:center;justify-content:center"><svg width="${s - 10}" height="${s - 10}" viewBox="0 0 10 10"><path d="M4 1h2v3h3v2H6v3H4V6H1V4h3z" fill="${color}"/></svg></div>`,
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
  })
}

const kendraIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;transform:rotate(45deg);background:#fff;border:2px solid #7C3AED;box-shadow:0 1px 2px rgba(15,23,42,.3)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

type Kendra = { id: string; name: string; address: string | null; lat: number; lng: number; district_id: string }

/** Jan Aushadhi Kendras in the districts on the map (where patients can buy generic medicines). */
function useKendras(show: boolean, districtIds: string[]) {
  const [rows, setRows] = useState<Kendra[]>([])
  const key = districtIds.join(",")
  useEffect(() => {
    if (!show || !districtIds.length) return
    let live = true
    createClient()
      .from("jan_aushadhi_kendras")
      .select("id, name, address, lat, lng, district_id")
      .in("district_id", districtIds)
      .then(({ data }) => live && setRows(data ?? []))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, key])
  return show ? rows : []
}

function arrowIcon(color: string, angle: number) {
  return L.divIcon({
    className: "",
    html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${angle}deg)"><path d="M2 3 L14 8 L2 13 L5 8 Z" fill="${color}"/></svg>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

// ---- district / state outlines (public/geo/boundaries.json, from OpenStreetMap)
type BoundaryProps = { kind: "district" | "state"; code: string; name: string }
type Boundary = Feature<Geometry, BoundaryProps>
let boundaryCache: Promise<Boundary[]> | null = null
function loadBoundaries(): Promise<Boundary[]> {
  boundaryCache ??= fetch("/geo/boundaries.json")
    .then((r) => (r.ok ? (r.json() as Promise<FeatureCollection<Geometry, BoundaryProps>>) : null))
    .then((fc) => (fc?.features ?? []) as Boundary[])
    .catch(() => [])
  return boundaryCache
}

/** Outlines for the districts on this map, plus state outlines when it spans more than one state. */
function useBoundaries(districtNames: string[]) {
  const [all, setAll] = useState<Boundary[]>([])
  useEffect(() => {
    let live = true
    loadBoundaries().then((b) => live && setAll(b))
    return () => {
      live = false
    }
  }, [])
  const wanted = new Set(districtNames.map((n) => n.toLowerCase()))
  const districts = all.filter((f) => f.properties.kind === "district" && wanted.has(f.properties.name.toLowerCase()))
  const stateCodes = new Set(districts.map((d) => d.properties.code.split("-")[0]))
  const states = stateCodes.size > 1 ? all.filter((f) => f.properties.kind === "state" && stateCodes.has(f.properties.code)) : []
  return { districts, states }
}

function FitBounds({ points, shapes }: { points: [number, number][]; shapes: Boundary[] }) {
  const map = useMap()
  const key = points.map((p) => p.join(",")).join("|") + "#" + shapes.map((s) => s.properties.code).join(",")
  useEffect(() => {
    if (points.length === 0 && shapes.length === 0) return
    // The container gets its final size after the dynamic import; measure again before fitting.
    const t = setTimeout(() => {
      map.invalidateSize()
      const bounds = L.latLngBounds(points)
      for (const s of shapes) bounds.extend(L.geoJSON(s).getBounds())
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 11 })
    }, 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

export default function FacilityMapInner({
  facilities,
  transfers = [],
  linkTo,
  height,
  showKendras = false,
}: {
  facilities: MapFacility[]
  transfers?: MapTransfer[]
  linkTo?: "facility" | "district"
  height: number
  showKendras?: boolean
}) {
  const points = facilities.map((f) => [f.lat, f.lng] as [number, number])
  const { districts, states } = useBoundaries([...new Set(facilities.map((f) => f.districtName))])
  const kendras = useKendras(showKendras, [...new Set(facilities.map((f) => f.districtId))])
  return (
    <MapContainer
      center={[24.6, 73.8]}
      zoom={8}
      scrollWheelZoom={false}
      zoomSnap={0.25}
      style={{ height, width: "100%", borderRadius: 12, zIndex: 0 }}
      attributionControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} shapes={districts} />

      {states.map((f) => (
        <GeoJSON
          key={`state-${f.properties.code}`}
          data={f}
          interactive={false}
          style={{ color: "#475569", weight: 2, opacity: 0.8, fill: false }}
        />
      ))}
      {districts.map((f) => (
        <GeoJSON
          key={`district-${f.properties.code}`}
          data={f}
          style={{ color: "#DC2626", weight: 2, opacity: 0.85, dashArray: "2 5", lineCap: "round", fillColor: "#0F766E", fillOpacity: 0.05 }}
        >
          <Tooltip permanent direction="center" className="district-label">
            {f.properties.name}
          </Tooltip>
        </GeoJSON>
      ))}

      {transfers.map((t) => {
        const color = TRANSFER_COLOR[t.status] ?? "#64748B"
        const mid: [number, number] = [(t.fromLat + t.toLat) / 2, (t.fromLng + t.toLng) / 2]
        // screen-ish bearing: lng grows east (x), lat grows north (-y)
        const angle = (Math.atan2(-(t.toLat - t.fromLat), t.toLng - t.fromLng) * 180) / Math.PI
        return (
          <Fragment key={t.id}>
            <Polyline
              positions={[
                [t.fromLat, t.fromLng],
                [t.toLat, t.toLng],
              ]}
              pathOptions={{ color, weight: 2.5, dashArray: "6 6", opacity: 0.9 }}
            >
              <Tooltip sticky>
                {t.label} · {t.status}
              </Tooltip>
            </Polyline>
            <Marker position={mid} icon={arrowIcon(color, angle)} interactive={false} />
          </Fragment>
        )
      })}

      {/* surge rings under the markers */}
      {facilities
        .filter((f) => (f.openSurges ?? 0) > 0)
        .map((f) => (
          <CircleMarker
            key={`surge-${f.id}`}
            center={[f.lat, f.lng]}
            radius={17}
            interactive={false}
            pathOptions={{ color: "#DC2626", weight: 2.5, fillColor: "#DC2626", fillOpacity: 0.12, className: "surge-ring" }}
          />
        ))}

      {facilities.map((f) => {
        const color = STATUS_META[f.status].color
        const href =
          linkTo === "facility" ? `/district/facilities/${f.id}` : linkTo === "district" ? `/state/districts/${f.districtId}` : null
        const popup = (
          <Popup>
            <div style={{ minWidth: 180, fontFamily: "inherit" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{f.name}</div>
              <div style={{ color: "#64748B", fontSize: 11, marginBottom: 6 }}>
                {FACILITY_TYPE_LABEL[f.type]}
                {f.type === "phc" ? (f.phc24x7 ? " (24×7)" : " (day)") : ""} · {f.districtName}
                {f.laqshya ? " · LaQshya" : ""}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                <span style={{ color: "#DC2626", fontWeight: 600 }}>{formatNumber(f.critical)} critical</span> ·{" "}
                <span style={{ color: "#D97706", fontWeight: 600 }}>{formatNumber(f.low)} low</span>
                <br />
                {formatNumber(f.openAlerts)} open alerts
                {f.criticalBedsTotal ? (
                  <>
                    <br />
                    <span style={f.criticalBedsOccupied! >= f.criticalBedsTotal ? { color: "#DC2626", fontWeight: 700 } : undefined}>
                      ICU/HDU/NICU {f.criticalBedsOccupied}/{f.criticalBedsTotal} occupied
                    </span>
                  </>
                ) : null}
                {(f.openSurges ?? 0) > 0 ? (
                  <>
                    <br />
                    <span style={{ color: "#DC2626", fontWeight: 700 }}>⚠ Demand surge ({f.openSurges})</span>
                  </>
                ) : null}
              </div>
              {href ? (
                <a href={href} style={{ display: "inline-block", marginTop: 6, color: "#0F766E", fontWeight: 600, fontSize: 12 }}>
                  Open →
                </a>
              ) : null}
            </div>
          </Popup>
        )
        if (f.type === "warehouse" || f.type === "chc" || f.type === "dh") {
          return (
            <Marker
              key={f.id}
              position={[f.lat, f.lng]}
              icon={f.type === "warehouse" ? warehouseIcon(color) : hospitalIcon(color, f.type === "dh")}
              title={f.name}
              zIndexOffset={f.type === "dh" ? 500 : 0}
            >
              {popup}
            </Marker>
          )
        }
        return (
          <CircleMarker
            key={f.id}
            center={[f.lat, f.lng]}
            // sub-centres are small dots; PHCs bigger, critical ones biggest
            radius={f.type === "shc" ? 4.5 : f.status === "critical" ? 9 : 7}
            pathOptions={{ color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {f.name}
            </Tooltip>
            {popup}
          </CircleMarker>
        )
      })}
      {kendras.map((k) => (
        <Marker key={k.id} position={[k.lat, k.lng]} icon={kendraIcon} title={k.name}>
          <Popup>
            <div style={{ minWidth: 160, fontFamily: "inherit" }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{k.name}</div>
              <div style={{ color: "#64748B", fontSize: 11 }}>Pradhan Mantri Bhartiya Janaushadhi Kendra</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Patients can buy generic medicines here. Not part of the government stock chain.</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
