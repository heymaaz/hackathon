import { useEffect, useState } from "react"
import {
  RiCheckDoubleLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiHeadphoneLine,
  RiHeartFill,
  RiHeartLine,
  RiPlayFill,
  RiRefreshLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react"

import { api, statusLabel, type Recipe } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"

export function RecipeDetail({
  recipe: r,
  meId,
  onClose,
  onChange,
  onDeleted,
}: {
  recipe: Recipe | null
  meId: string
  onClose: () => void
  onChange: (r: Recipe) => void
  onDeleted: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [note, setNote] = useState(r?.note ?? "")
  useEffect(() => setNote(r?.note ?? ""), [r?.id, r?.note])

  async function patch(body: Record<string, unknown>) {
    if (!r) return
    try {
      onChange(await api<Recipe>(`/recipes/${r.id}`, { method: "PATCH", body: JSON.stringify(body) }))
    } catch (e) {
      toast.add({ type: "error", title: "Could not save", description: String((e as Error).message) })
    }
  }
  async function retry() {
    if (!r) return
    await api(`/recipes/${r.id}/retry`, { method: "POST" })
    toast.add({ type: "loading", title: "Re-reading the recipe…", timeout: 3000 })
  }
  async function del() {
    if (!r) return
    await api(`/recipes/${r.id}`, { method: "DELETE" })
    setConfirmDelete(false)
    onDeleted(r.id)
  }

  const iRequested = r?.requested_by === meId
  const askedOfMe = !!r?.requested_by && r.requested_by !== meId && !r.cooked

  return (
    <Sheet open={!!r} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {r && (
          <div className="flex flex-col gap-4 p-4 pt-10">
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block aspect-video overflow-hidden rounded-xl bg-muted bg-cover bg-center"
              style={r.thumbnail ? { backgroundImage: `url("${r.thumbnail}")` } : undefined}
              aria-label={`Watch on ${r.platform}`}
            >
              <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25">
                <span className="flex size-14 items-center justify-center rounded-full bg-background/90 text-foreground shadow">
                  <RiPlayFill className="size-7" />
                </span>
              </span>
            </a>

            <SheetHeader className="p-0">
              <div className="flex flex-wrap gap-1.5">
                {r.cuisine && <Badge variant="outline">{r.cuisine}</Badge>}
                {r.category && <Badge variant="outline">{r.category}</Badge>}
                <Badge variant={r.status === "ready" ? "secondary" : r.status === "failed" ? "destructive" : "secondary"}>{statusLabel[r.status]}</Badge>
                {r.source && (
                  <Badge variant="secondary">
                    {r.source === "transcript" ? <RiHeadphoneLine /> : <RiFileTextLine />}
                    {r.source === "transcript" ? "from audio" : "from caption"}
                  </Badge>
                )}
                {r.confidence != null && <Badge variant="outline">{Math.round(r.confidence * 100)}% confident</Badge>}
              </div>
              <SheetTitle className="font-heading text-2xl leading-tight">{r.title ?? "Untitled"}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-x-2">
                {r.creator && <span>by {r.creator}</span>}
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
                  watch on {r.platform} <RiExternalLinkLine className="size-3.5" />
                </a>
                {r.servings && <span>· {r.servings}</span>}
                {r.total_minutes ? <span>· {r.total_minutes} min</span> : null}
              </SheetDescription>
            </SheetHeader>

            {r.summary && <p className="text-sm leading-relaxed text-muted-foreground">{r.summary}</p>}

            {askedOfMe && (
              <Alert>
                <RiHeartFill />
                <AlertTitle>{r.requested_by_name} asked you to cook this</AlertTitle>
                <AlertDescription>Mark it cooked when you have. That is the whole point of the app.</AlertDescription>
              </Alert>
            )}
            {r.error && r.status !== "ready" && (
              <Alert variant={r.status === "failed" ? "destructive" : "default"}>
                <AlertTitle>{r.status === "failed" ? "Extraction failed" : "Waiting on audio"}</AlertTitle>
                <AlertDescription>{r.error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant={iRequested ? "default" : "outline"} size="sm" onClick={() => patch({ request: !iRequested })}>
                {iRequested ? <RiHeartFill data-icon="inline-start" /> : <RiHeartLine data-icon="inline-start" />}
                {iRequested ? "Requested" : "Please cook this for me"}
              </Button>
              <Button variant={r.favorite ? "default" : "outline"} size="sm" onClick={() => patch({ favorite: !r.favorite })}>
                {r.favorite ? <RiStarFill data-icon="inline-start" /> : <RiStarLine data-icon="inline-start" />}
                Favourite
              </Button>
              <Button variant={r.cooked ? "default" : "outline"} size="sm" onClick={() => patch({ cooked: !r.cooked })}>
                <RiCheckDoubleLine data-icon="inline-start" />
                {r.cooked ? `Cooked by ${r.cooked_by === meId ? "you" : r.cooked_by_name}` : "Mark cooked"}
              </Button>
              {r.status !== "ready" && (
                <Button variant="ghost" size="sm" onClick={retry}>
                  <RiRefreshLine data-icon="inline-start" />
                  Retry
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <RiDeleteBinLine data-icon="inline-start" />
                Delete
              </Button>
            </div>

            {r.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {r.tags.map((t) => (
                  <Badge key={t} variant="secondary">
                    #{t}
                  </Badge>
                ))}
              </div>
            )}

            {r.ingredients.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="font-heading text-sm font-semibold">Ingredients</h3>
                <ul className="flex flex-col divide-y">
                  {r.ingredients.map((i, idx) => (
                    <li key={idx} className="grid grid-cols-[6rem_1fr] gap-3 py-1.5 text-sm">
                      <span className="font-medium tabular-nums">{i.quantity ?? ""}</span>
                      <span>
                        {i.item}
                        {i.note && <span className="text-muted-foreground"> — {i.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {r.steps.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="font-heading text-sm font-semibold">Method</h3>
                <ol className="flex flex-col gap-3">
                  {r.steps.map((s, idx) => (
                    <li key={idx} className="grid grid-cols-[1.75rem_1fr] gap-2 text-sm leading-relaxed">
                      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{idx + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <Separator />
            <section className="flex flex-col gap-2">
              <h3 className="font-heading text-sm font-semibold">Kitchen notes</h3>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => note !== (r.note ?? "") && patch({ note })}
                placeholder="e.g. she loved this one — less chilli next time"
              />
            </section>

            {(r.caption || r.transcript) && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Source text</summary>
                {r.caption && (
                  <>
                    <p className="mt-2 font-medium">Caption</p>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap">{r.caption}</pre>
                  </>
                )}
                {r.transcript && (
                  <>
                    <p className="mt-2 font-medium">Audio transcript (Whisper)</p>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap">{r.transcript}</pre>
                  </>
                )}
              </details>
            )}
            <p className="text-xs text-muted-foreground">
              Saved by {r.saved_by === meId ? "you" : r.saved_by_name ?? "someone"} · {new Date(r.created_at + "Z").toLocaleString()}
            </p>
          </div>
        )}
      </SheetContent>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this recipe?</DialogTitle>
            <DialogDescription>It disappears for everyone in the kitchen. The video stays where it is.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
            <Button variant="destructive" onClick={del}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sheet>
  )
}
