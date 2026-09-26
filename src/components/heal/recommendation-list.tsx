import type { LucideIcon } from "lucide-react"
import { RecommendationCard } from "@/components/heal/recommendation-card"
import { EmptyState } from "@/components/heal/empty-state"
import type { Viewer } from "@/lib/permissions"
import type { Recommendation } from "@/lib/queries"
import type { Lang } from "@/lib/i18n"

export function RecommendationList({
  items,
  viewer,
  emptyIcon,
  emptyText,
  compact = false,
  lang = "en",
  limit,
}: {
  items: Recommendation[]
  viewer: Viewer
  emptyIcon: LucideIcon
  emptyText: string
  compact?: boolean
  lang?: Lang
  limit?: number
}) {
  const shown = limit ? items.slice(0, limit) : items
  if (shown.length === 0) return <EmptyState icon={emptyIcon} title={emptyText} />
  return (
    <div className="flex flex-col gap-2.5">
      {shown.map((i) => (
        <RecommendationCard key={i.id} item={i} viewer={viewer} compact={compact} lang={lang} />
      ))}
    </div>
  )
}
