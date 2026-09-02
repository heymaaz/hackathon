export type Ingredient = { item: string; quantity: string | null; note: string | null }
export type Status = "pending" | "needs_transcript" | "transcribing" | "ready" | "failed"

export interface Recipe {
  id: string
  url: string
  platform: string
  title: string | null
  creator: string | null
  thumbnail: string | null
  caption: string | null
  transcript: string | null
  cuisine: string | null
  category: string | null
  summary: string | null
  ingredients: Ingredient[]
  steps: string[]
  tags: string[]
  servings: string | null
  total_minutes: number | null
  status: Status
  source: "caption" | "transcript" | "frames" | null
  confidence: number | null
  saved_by: string | null
  saved_by_name: string | null
  requested_by: string | null
  requested_by_name: string | null
  requested_at: string | null
  favorite: boolean
  cooked: boolean
  cooked_by: string | null
  cooked_by_name: string | null
  note: string | null
  error: string | null
  created_at: string
  updated_at: string
  duplicate?: boolean
}

export interface Stats {
  total: number
  ready: number
  needs_transcript: number
  pending: number
  failed: number
  favorite: number
  cooked: number
  requests: number
  requests_for_me: number
  mine: number
  from_transcript: number
}

export interface Member {
  id: string
  name: string
  image: string | null
}
export interface Me {
  user: Member & { email: string }
  members: Member[]
  inviteRequired: boolean
}
export type Cuisine = { cuisine: string; n: number }

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(r.status, body.error ?? r.statusText)
  }
  return (await r.json()) as T
}

export type Shelf =
  | { kind: "all" }
  | { kind: "filter"; filter: "requests" | "mine" | "favorite" | "cooked" | "needs_transcript" }
  | { kind: "cuisine"; cuisine: string }

export function shelfQuery(shelf: Shelf, q: string): string {
  const p = new URLSearchParams()
  if (q) p.set("q", q)
  if (shelf.kind === "filter") p.set("filter", shelf.filter)
  if (shelf.kind === "cuisine") p.set("cuisine", shelf.cuisine)
  const s = p.toString()
  return s ? `?${s}` : ""
}

export const sourceLabel = { caption: "from caption", transcript: "from audio", frames: "from video frames" } as const

export const statusLabel: Record<Status, string> = {
  pending: "extracting…",
  needs_transcript: "needs a listen",
  transcribing: "listening…",
  ready: "ready",
  failed: "failed",
}
