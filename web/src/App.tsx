import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { RiAddLine, RiHeartLine, RiSearchLine } from "@remixicon/react"

import { api, ApiError, shelfQuery, type Cuisine, type Me, type Recipe, type Shelf, type Stats } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { AppSidebar } from "@/components/app-sidebar"
import { AuthPage } from "@/components/auth-page"
import { RecipeCard } from "@/components/recipe-card"
import { RecipeDetail } from "@/components/recipe-detail"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Toggle } from "@/components/ui/toggle"

type AuthState = "loading" | "out" | "in"

export function App() {
  const [authState, setAuthState] = useState<AuthState>("loading")
  const [me, setMe] = useState<Me | null>(null)

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/me"))
      setAuthState("in")
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setAuthState("out")
      else toast.add({ type: "error", title: "Could not reach the kitchen", description: (e as Error).message })
    }
  }, [])
  useEffect(() => void refreshMe(), [refreshMe])

  if (authState === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (authState === "out" || !me) return <AuthPage onSignedIn={refreshMe} />
  return (
    <Kitchen
      me={me}
      onSignOut={async () => {
        await authClient.signOut()
        setMe(null)
        setAuthState("out")
      }}
    />
  )
}

function Kitchen({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [shelf, setShelf] = useState<Shelf>({ kind: "all" })
  const [q, setQ] = useState("")
  const [items, setItems] = useState<Recipe[] | null>(null)
  const [cuisines, setCuisines] = useState<Cuisine[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [asRequest, setAsRequest] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const [list, cs, st] = await Promise.all([
      api<Recipe[]>(`/recipes${shelfQuery(shelf, q)}`),
      api<Cuisine[]>("/cuisines"),
      api<Stats>("/stats"),
    ])
    setItems(list)
    setCuisines(cs)
    setStats(st)
  }, [shelf, q])

  useEffect(() => {
    load().catch(() => {})
    const busy = items?.some((i) => i.status === "pending" || i.status === "transcribing")
    const t = setInterval(() => load().catch(() => {}), busy ? 3000 : 10000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, items?.some((i) => i.status === "pending" || i.status === "transcribing")])

  const selected = useMemo(() => items?.find((i) => i.id === selectedId) ?? null, [items, selectedId])

  async function save(e: FormEvent) {
    e.preventDefault()
    const url = urlRef.current?.value.trim()
    if (!url) return
    setSaving(true)
    try {
      const res = await api<Recipe>("/recipes", { method: "POST", body: JSON.stringify({ url, request: asRequest }) })
      if (urlRef.current) urlRef.current.value = ""
      setAsRequest(false)
      toast.add({
        type: res.duplicate ? "info" : "success",
        title: res.duplicate ? "Already in the box" : "Saved. Reading the caption…",
        description: res.duplicate ? undefined : "The audio transcript follows when the runner picks it up.",
      })
      setShelf({ kind: "all" })
      setQ("")
      await load()
      setSelectedId(res.id)
    } catch (err) {
      toast.add({ type: "error", title: "Could not save that link", description: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  // Share-sheet / Shortcut deep link: /?add=<url>
  useEffect(() => {
    const add = new URLSearchParams(location.search).get("add")
    if (add && urlRef.current) {
      urlRef.current.value = add
      history.replaceState({}, "", "/")
      urlRef.current.form?.requestSubmit()
    }
  }, [])

  const title =
    shelf.kind === "all"
      ? "Everything"
      : shelf.kind === "cuisine"
        ? shelf.cuisine
        : { requests: "Cook this for me", mine: "My saves", favorite: "Favourites", cooked: "Cooked", needs_transcript: "Needs a listen" }[shelf.filter]

  return (
    <SidebarProvider>
      <AppSidebar me={me} stats={stats} cuisines={cuisines} shelf={shelf} onShelf={(s) => { setShelf(s); setSelectedId(null) }} onSignOut={onSignOut} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background/95 p-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <h1 className="font-heading text-base font-semibold">{title}</h1>
          </div>
          <form onSubmit={save} className="flex flex-1 gap-2">
            <InputGroup className="flex-1">
              <InputGroupAddon>
                <RiAddLine />
              </InputGroupAddon>
              <InputGroupInput ref={urlRef} placeholder="Paste a TikTok, Reel, Short or Facebook link…" inputMode="url" autoComplete="off" />
              <InputGroupAddon align="inline-end">
                <Toggle pressed={asRequest} onPressedChange={setAsRequest} size="sm" aria-label="Ask someone to cook this for me" title="Please cook this for me">
                  <RiHeartLine />
                </Toggle>
                <InputGroupButton type="submit" variant="default" disabled={saving}>
                  {saving && <Spinner data-icon="inline-start" />}
                  Save
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
          <InputGroup className="md:w-72">
            <InputGroupAddon>
              <RiSearchLine />
            </InputGroupAddon>
            <InputGroupInput placeholder="Search dishes, ingredients, creators…" value={q} onChange={(e) => setQ(e.target.value)} />
          </InputGroup>
        </header>

        <main className="flex-1 p-4">
          {items === null ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <Empty className="min-h-[50vh]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiAddLine />
                </EmptyMedia>
                <EmptyTitle>{q ? "Nothing matches that" : "Nothing on this shelf yet"}</EmptyTitle>
                <EmptyDescription>
                  {shelf.kind === "filter" && shelf.filter === "requests"
                    ? "When someone presses the heart on a recipe, it lands here for the other person to cook."
                    : "Paste a cooking video link above. Recipebox reads the caption, listens to the audio, and files the recipe under its cuisine."}
                </EmptyDescription>
              </EmptyHeader>
              {(q || shelf.kind !== "all") && (
                <Button variant="outline" onClick={() => { setQ(""); setShelf({ kind: "all" }) }}>
                  Show everything
                </Button>
              )}
            </Empty>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((r) => (
                <RecipeCard key={r.id} recipe={r} meId={me.user.id} selected={r.id === selectedId} onClick={() => setSelectedId(r.id)} />
              ))}
            </div>
          )}
        </main>
      </SidebarInset>

      <RecipeDetail
        recipe={selected}
        meId={me.user.id}
        onClose={() => setSelectedId(null)}
        onChange={(r) => { setItems((prev) => prev?.map((p) => (p.id === r.id ? r : p)) ?? prev); load().catch(() => {}) }}
        onDeleted={(id) => { setItems((prev) => prev?.filter((p) => p.id !== id) ?? prev); setSelectedId(null); load().catch(() => {}) }}
      />
    </SidebarProvider>
  )
}

export default App
