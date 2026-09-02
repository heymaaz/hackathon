import { RiHeadphoneLine, RiHeartFill, RiPlayFill, RiStarFill, RiTimeLine } from "@remixicon/react"

import { statusLabel, type Recipe } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

export function RecipeCard({ recipe: r, meId, selected, onClick }: { recipe: Recipe; meId: string; selected: boolean; onClick: () => void }) {
  const busy = r.status === "pending" || r.status === "transcribing"
  const askedOfMe = !!r.requested_by && r.requested_by !== meId && !r.cooked
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      className={cn("group cursor-pointer overflow-hidden p-0 transition-shadow hover:shadow-md", selected && "ring-2 ring-ring")}
    >
      <div
        className="relative aspect-[16/10] bg-muted bg-cover bg-center"
        style={r.thumbnail ? { backgroundImage: `url("${r.thumbnail}")` } : undefined}
      >
        <div className="absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <Badge variant="secondary" className="capitalize">
            {r.platform}
          </Badge>
          <div className="flex gap-1">
            {r.favorite && (
              <Badge variant="secondary" aria-label="Favourite">
                <RiStarFill />
              </Badge>
            )}
            {r.requested_by && !r.cooked && (
              <Badge variant={askedOfMe ? "destructive" : "secondary"} aria-label="Requested">
                <RiHeartFill />
                {askedOfMe ? "for you" : r.requested_by_name?.split(" ")[0]}
              </Badge>
            )}
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex size-10 items-center justify-center rounded-full bg-background/80 text-foreground">
            <RiPlayFill />
          </span>
        </div>
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <h3 className="font-heading line-clamp-2 text-base leading-snug font-semibold">
          {r.title ?? r.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {r.cuisine && <Badge variant="outline">{r.cuisine}</Badge>}
          {r.status !== "ready" && (
            <Badge variant={r.status === "failed" ? "destructive" : "secondary"}>
              {busy ? <Spinner /> : r.status === "needs_transcript" ? <RiHeadphoneLine /> : null}
              {statusLabel[r.status]}
            </Badge>
          )}
          {r.total_minutes ? (
            <span className="inline-flex items-center gap-1">
              <RiTimeLine className="size-3.5" /> {r.total_minutes} min
            </span>
          ) : null}
          {r.ingredients.length > 0 && <span>{r.ingredients.length} ingredients</span>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {r.creator ? `by ${r.creator}` : ""}
          {r.saved_by_name ? `${r.creator ? " · " : ""}saved by ${r.saved_by === meId ? "you" : r.saved_by_name}` : ""}
        </p>
      </CardContent>
    </Card>
  )
}
