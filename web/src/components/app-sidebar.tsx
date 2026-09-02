import {
  RiBowlLine,
  RiCheckDoubleLine,
  RiHashtag,
  RiHeadphoneLine,
  RiHeartLine,
  RiInboxLine,
  RiLogoutBoxRLine,
  RiStarLine,
  RiUserLine,
} from "@remixicon/react"

import type { Cuisine, Me, Shelf, Stats } from "@/lib/api"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

const same = (a: Shelf, b: Shelf) =>
  a.kind === b.kind &&
  (a.kind !== "filter" || a.filter === (b as { filter: string }).filter) &&
  (a.kind !== "cuisine" || a.cuisine === (b as { cuisine: string }).cuisine)

export function AppSidebar({
  me,
  stats,
  cuisines,
  shelf,
  onShelf,
  onSignOut,
}: {
  me: Me | null
  stats: Stats | null
  cuisines: Cuisine[]
  shelf: Shelf
  onShelf: (s: Shelf) => void
  onSignOut: () => void
}) {
  const shelves: { shelf: Shelf; label: string; icon: React.ComponentType<{ className?: string }>; count?: number; hot?: boolean }[] = [
    { shelf: { kind: "all" }, label: "Everything", icon: RiInboxLine, count: stats?.total },
    {
      shelf: { kind: "filter", filter: "requests" },
      label: "Cook this for me",
      icon: RiHeartLine,
      count: stats?.requests,
      hot: (stats?.requests_for_me ?? 0) > 0,
    },
    { shelf: { kind: "filter", filter: "mine" }, label: "My saves", icon: RiUserLine, count: stats?.mine },
    { shelf: { kind: "filter", filter: "favorite" }, label: "Favourites", icon: RiStarLine, count: stats?.favorite },
    { shelf: { kind: "filter", filter: "cooked" }, label: "Cooked", icon: RiCheckDoubleLine, count: stats?.cooked },
    {
      shelf: { kind: "filter", filter: "needs_transcript" },
      label: "Needs a listen",
      icon: RiHeadphoneLine,
      count: stats?.needs_transcript,
    },
  ]

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <RiBowlLine className="size-4" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="font-heading truncate text-sm font-semibold">Recipebox</span>
            <span className="truncate text-xs text-muted-foreground">TikTok · Reels · Shorts</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Shelves</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {shelves.map((s) => (
                <SidebarMenuItem key={s.label}>
                  <SidebarMenuButton isActive={same(shelf, s.shelf)} onClick={() => onShelf(s.shelf)}>
                    <s.icon />
                    <span>{s.label}</span>
                  </SidebarMenuButton>
                  {!!s.count && (
                    <SidebarMenuBadge>
                      {s.hot ? <Badge variant="destructive">{s.count}</Badge> : s.count}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Cuisines</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {cuisines.length === 0 && <p className="px-2 text-xs text-muted-foreground">Cuisines appear as recipes are filed.</p>}
              {cuisines.map((c) => (
                <SidebarMenuItem key={c.cuisine}>
                  <SidebarMenuButton
                    isActive={shelf.kind === "cuisine" && shelf.cuisine === c.cuisine}
                    onClick={() => onShelf({ kind: "cuisine", cuisine: c.cuisine })}
                  >
                    <RiHashtag />
                    <span>{c.cuisine.toLowerCase()}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{c.n}</SidebarMenuBadge>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        {stats && (
          <p className="px-2 text-xs text-muted-foreground">
            {stats.ready} ready · {stats.from_transcript} from audio{stats.pending ? ` · ${stats.pending} extracting` : ""}
          </p>
        )}
        <div className="flex items-center gap-2 px-2">
          <Avatar className="size-7">
            <AvatarFallback>{initials(me?.user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{me?.user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {me?.members.length === 1 ? "only you so far" : `${me?.members.length ?? 0} in the kitchen`}
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onSignOut} aria-label="Sign out" />}>
              <RiLogoutBoxRLine />
            </TooltipTrigger>
            <TooltipContent>Sign out</TooltipContent>
          </Tooltip>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

function initials(name?: string | null) {
  return (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
