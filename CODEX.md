# GroundworX — Codex Session Brief
## NeuroGlitch · neuroglitch.ai · April 2026
### Paste this file at the start of every Codex session

---

## What this codebase is
GroundworX is a commercial construction intelligence platform for GC project managers.
Built on Next.js 15 App Router + TypeScript + Tailwind v4 + Prisma + Anthropic API.
The AI assistant inside the product is named **Glint** — never "AI" or "assistant".

---

## Hard rules — read these first, never violate them

1. `EstimateUpload.pricingData` — **never** returned to the client, **never** in any AI prompt. Use `parsedTotal` (the aggregated scalar) instead.
2. Subcontractor name, company, or `isPreferred` — **never** in any AI prompt or sub-facing export.
3. `/bids/[id]/leveling` is a redirect — never recreate as a standalone page. Always `?tab=leveling`.
4. Never run `npx prisma migrate dev` or `migrate deploy` — flag it and stop.
5. Never push to `main` — flag it and stop.
6. Never change `middleware.ts`, `lib/auth.ts`, or any `.env` file.
7. Never delete existing files.

---

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 — App Router only. No pages/ directory. |
| Language | TypeScript 5 — strict mode |
| Styling | Tailwind CSS v4 — no tailwind.config.js |
| Database | Prisma 7 / SQLite (local) → PostgreSQL (production) |
| Auth | Auth.js v5 (next-auth) — credentials, JWT |
| AI | Anthropic API via Python FastAPI sidecar at :8001 |
| Runtime | Node 20 + Python 3.11 |

---

## Import rules

```typescript
import { prisma } from "@/lib/prisma"    // always — NOT @/lib/db
import { auth }   from "@/lib/auth"      // session checks
```

---

## Next.js 15 syntax — required

```typescript
// Page component — params and searchParams are Promises
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;           // must await
  const { tab = "overview" } = await searchParams;
}

// API route handler
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;           // must await
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });
}
```

---

## Design tokens — use CSS variables, never hardcode colors

```css
--bg            #050608        page background
--panel         #101319        card/panel surface
--line          rgba(255,255,255,0.08)   border
--line-strong   rgba(255,255,255,0.14)   border hover
--text          #f5f7fa        primary text
--text-soft     rgba(245,247,250,0.68)   secondary
--text-dim      rgba(245,247,250,0.34)   labels / meta
--signal        #00ff64        primary accent (green)
--signal-soft   #6bff9f        accent on dark
--signal-dim    rgba(0,255,100,0.09)     accent bg tint
--amber         #f5a623        warning
--red           #e8453c        danger
--blue          #7ea7ff
--radius        8px
```

Emerald Tailwind classes (`emerald-400`, `emerald-500`) are remapped to signal green in globals.css — use them freely.

---

## Component rules

- **Server components by default.** Add `"use client"` only when you need `useState`, `useEffect`, or browser APIs.
- `export const dynamic = "force-dynamic"` on any server page that queries the database.
- **`useSearchParams()` in a client component requires a `<Suspense>` boundary** in its parent or default export — without it the build fails.

```tsx
// Correct Suspense pattern
export default function Page() {
  return (
    <Suspense fallback={<div>Loading…</div>}>
      <InnerComponent />   {/* InnerComponent uses useSearchParams */}
    </Suspense>
  );
}
```

---

## Typography patterns

```tsx
// Page heading
<h1 className="text-[34px] font-[800] tracking-[-0.05em]" style={{ color: "var(--text)" }}>

// Section label (mono)
<p className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: "var(--text-dim)" }}>

// Table header
<th className="font-mono text-[10px] uppercase tracking-[0.09em]" style={{ color: "var(--text-dim)" }}>

// Body text
<p className="text-[13px]" style={{ color: "var(--text-soft)" }}>
```

---

## Tab navigation (project detail)

All project tabs use `?tab=<key>` search params. Keys are:
```
overview | documents | trades | subs | scope | ai-review | questions | leveling | activity
handoff | submittals | schedule | meetings | briefing | procore
warranties | training | inspections | closeout
```

To add a tab:
1. Add key to `app/bids/[id]/tabConfig.ts`
2. Add `<TabBtn>` in `app/bids/[id]/ProjectContextBar.tsx`
3. Add `{tab === "key" && <YourComponent bidId={bid.id} />}` in `app/bids/[id]/page.tsx`

---

## Key files you'll touch most

| File | What it is |
|------|-----------|
| `app/bids/[id]/page.tsx` | Project detail — all tab routing |
| `app/bids/[id]/tabConfig.ts` | Tab key definitions |
| `app/bids/[id]/ProjectContextBar.tsx` | Tab strip UI |
| `app/bids/page.tsx` | Projects list |
| `app/layout.tsx` | Root shell — topbar + sidebar |
| `app/components/AppSidebar.tsx` | Left nav |
| `lib/services/buyout/buyoutService.ts` | BuyoutItem logic |
| `lib/services/ai/aiUsageLog.ts` | AI cost tracking |
| `prisma/schema.prisma` | Data model (read only — never migrate) |

---

## What Codex should own vs what Claude should own

| Codex | Claude |
|-------|--------|
| New UI components (isolated) | Multi-file architecture changes |
| Styling / layout iterations | Schema + API design |
| Repetitive pattern fill | Cross-file consistency checks |
| Boilerplate (form, table, card) | Prisma query design |
| Test scaffolding | Business logic |

**Always:** Claude reviews and integrates Codex output before it commits.

---

## Commit authorship — always append

```
Co-Authored-By: NeuroGlitch AI Engine <ai@neuroglitch.dev>
```

---

## Codex session starter

When beginning a Codex session, paste:
1. This file (CODEX.md)
2. The specific file(s) you're working on
3. The task in one sentence: "Add X to Y — do not touch Z"

---

*NeuroGlitch · GroundworX · neuroglitch.ai · April 2026*
