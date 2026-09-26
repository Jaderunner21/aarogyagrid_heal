import { Siren, Sparkles } from "lucide-react"
import type { Outbreak } from "@/lib/queries"
import { timeAgo } from "@/lib/format"

/**
 * Red banner on district / state / national overviews when demand is surging: possible outbreaks first,
 * then the number of facility-level surges. Renders nothing when all is calm.
 */
export function SurgeBanner({
  outbreaks,
  surgingFacilities,
  surgingMedicines,
  showDistrict = false,
}: {
  outbreaks: Outbreak[]
  surgingFacilities: number
  surgingMedicines: string[]
  showDistrict?: boolean
}) {
  if (outbreaks.length === 0 && surgingFacilities === 0) return null
  return (
    <section
      role="alert"
      aria-labelledby="surge-title"
      className="border-critical overflow-hidden rounded-xl border-2 bg-red-50"
    >
      <div className="bg-critical flex flex-wrap items-center gap-2 px-4 py-2 text-white">
        <Siren className="size-5 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
        <h2 id="surge-title" className="text-sm font-semibold tracking-wide uppercase">
          Surge {outbreaks.length ? `· ${outbreaks.length} possible outbreak${outbreaks.length > 1 ? "s" : ""}` : ""}
        </h2>
        <span className="ml-auto text-xs text-red-50">
          {surgingFacilities} facilit{surgingFacilities === 1 ? "y" : "ies"} surging
          {surgingMedicines.length ? ` · ${surgingMedicines.slice(0, 4).join(", ")}` : ""}
        </span>
      </div>
      {outbreaks.length ? (
        <ul className="divide-y divide-red-200">
          {outbreaks.map((o) => (
            <li key={o.id} className="px-4 py-3 text-sm">
              <p className="text-critical font-semibold">
                {showDistrict ? `${o.districtName}: ` : ""}
                {o.category}
                <span className="text-muted-foreground ml-2 text-xs font-normal">detected {timeAgo(o.detected_at)}</span>
              </p>
              <p className="mt-0.5 text-red-950">{o.message}</p>
              {o.ai_summary ? (
                <p className="mt-1.5 flex gap-1.5 rounded-md bg-white/70 px-2 py-1.5 text-xs leading-relaxed text-red-950">
                  <Sparkles className="text-primary mt-0.5 size-3.5 shrink-0" aria-label="Gemini" />
                  {o.ai_summary}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-red-950">
          Demand is well above forecast at {surgingFacilities} facilit{surgingFacilities === 1 ? "y" : "ies"}. Forecasts now weight
          recent days more and their transfers are priority 1.
        </p>
      )}
    </section>
  )
}
