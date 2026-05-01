# CLAUDE.md

Living context for AI coding assistants working on this repo. Update this file in the same PR as the change it documents.

## What this app is

Personal wardrobe-management web app. Users photograph clothes, AI tags them, and the app helps build outfits, plan trip packing lists, and track wishes.

**Stack:**
- **Next.js 14** (App Router) + **React 18** + **Tailwind**
- **Prisma 5.22** on **SQLite** (single DB file at `data/wardrobe.db`)
- **next-auth 5.0.0-beta.25** (credentials provider, bcrypt password hash)
- **Google Gemini** for AI (provider-abstraction; OpenAI is a stub)
- Deployed to a Proxmox container at `/opt/wardrobe`, fronted by `wardrobe.service` (systemd)

**Repo:** `lawsonak/wardrobe`. The MCP integration is restricted to this repo only — don't try to read or write other repos.

## Deploy

One-liner the user runs on the server after each merge:

```
cd /opt/wardrobe && npm run deploy:update
```

That runs `scripts/update.sh`: `git pull --ff-only` → `npm install` → `prisma migrate deploy` → `npm run build` → `systemctl restart wardrobe`. It exits at the first failure so a broken build doesn't restart the service.

## Workflow conventions

- Branch naming: `claude/<kebab-case-feature>`.
- Commit style: Conventional Commits — `feat:`, `fix(scope):`, etc.
- PRs go through the GitHub MCP tools (`mcp__github__create_pull_request`, `mcp__github__merge_pull_request`); merge method `squash`.
- Don't skip hooks or force-push to `main`.
- Always verify before claiming success: `npm run typecheck && npm run build`.
- For UI changes, run `PORT=3001 npm run dev` and HTTP-smoke-test the relevant routes (auth via `/api/auth/csrf` + `/api/auth/callback/credentials`).
- `.env` and `data/` are gitignored; don't commit them.
- Use `Edit` / `Write` tools, not `cat`/`sed`/`echo` redirects.

## Core data model (`prisma/schema.prisma`)

| Model | Purpose | Key fields |
|---|---|---|
| `Item` | A clothing piece | category, subType, color, brand (free-form + canonical `Brand` ref), size, sizeSystem, fitDetails (JSON), seasons (CSV), activities (CSV), notes, isFavorite, status (`active\|needs_review\|draft`), imagePath, imageBgRemovedPath, labelImagePath, optional `setId` |
| `ItemPhoto` | Extra angles per item | itemId, label, position |
| `ItemSet` | Soft link of pieces sold/worn together | swimsuit top+bottom, pajamas — items stay independent |
| `Outfit` | Bundle of items with slot map | name, activity, season, layoutJson (style canvas), optional `collectionId` back-link |
| `OutfitItem` | Join row | outfitId, itemId, slot |
| `Collection` | Trip or themed packing set | `kind` (`trip\|general`), name, description, destination, startDate, endDate, notes, occasion, season, activities (CSV) |
| `CollectionItem` | Join row | collectionId, itemId |
| `Brand` + `BrandAlias` | Canonical brand with normalized `nameKey` | dedupes "J.Crew" / "JCREW" / "J Crew" |
| `WishlistItem` | Standalone wishlist | priority, giftIdea, purchased flags |
| `Notification` | In-app bell-icon notifications | for batch uploads, items waiting on review, etc. |

**Conventions:**
- SQLite has no array type; we use comma-separated strings for `seasons` and `activities`. Helpers in `lib/constants.ts`: `csvToList`, `listToCsv`.
- IDs are CUIDs (Prisma `@default(cuid())`).
- Migrations are sequential; never edit a merged migration. Write a new one.
- Renaming a table on SQLite requires a copy-then-drop migration (Prisma can't do it in place). See `20260501030000_rename_capsule_to_collection` for the pattern.

## Vocabulary (`lib/constants.ts`)

- **14 categories**: Tops, Bottoms, Dresses, Outerwear, Shoes, Accessories, Activewear, Loungewear, Bags, Jewelry, Bras, Underwear, Swimwear, Socks & Hosiery
- **8 activities (enum)**: casual, work, date, workout, beach, formal, travel, lounge
- **4 seasons**: spring, summer, fall, winter
- **22-color palette** with hex codes (white through multi-gradient)
- **7 outfit slots**: top, bottom, dress, outerwear, shoes, accessory, bag (with `CATEGORY_TO_SLOT` mapping)

The closet's tagged `activities` field is restricted to the enum, but Collections accept free-form custom activities ("hiking", "wine tasting"). Prompts mix the two — be aware.

## AI architecture

**`lib/ai/provider.ts`** is a provider abstraction. Driven by `AI_PROVIDER` + `GEMINI_API_KEY` env vars; defaults to `DisabledProvider` so the app runs without keys. Every AI route returns `{ enabled: false, message }` when AI is off so the UI falls back gracefully.

**Provider methods → API routes:**

| Provider method | Route | Purpose |
|---|---|---|
| `tagImage` | `/api/ai/tag`, `/api/ai/tag-bulk` | Auto-tag from photo + optional label close-up |
| `describeItem` | `/api/ai/notes` | Generate the item's notes field |
| `buildOutfit` | `/api/ai/outfit` | Pick items for a free-text occasion (honors user's `preferences`) |
| `buildPackingList` | `/api/ai/packing-list` | Curate a trip packing list, **honors `targets: Record<Category, number>`** |
| `suggestActivities` | `/api/ai/suggest-activities` | Propose 4–8 trip activities from destination + dates |
| `parseSearch` | `/api/ai/search` | Parse natural-language closet search into structured filters |

**Other AI-adjacent routes** (not on the provider interface):
- `/api/ai/render-items` — image-gen
- `/api/ai/rotate-label` — auto-rotates label photos on upload
- `/api/ai/outfit/today` — daily outfit pick (weather-aware)
- `/api/outfits/[id]/fit` — AI auto-fit on the style canvas
- `/api/outfits/[id]/render` — full-outfit image render
- `/api/mannequin` — Gemini-generated mannequin from a user photo + landmark extraction (`lib/ai/mannequinLandmarks.ts`)

**Prompt conventions:**
- All structured-response calls use Gemini's `responseMimeType: "application/json"` + `responseSchema` to force valid JSON.
- Catalog calls cap at 250 items.
- Owned-id filtering on every response — the model can't invent items.
- Debug payload (`status`, `rawText`, `promptTokens`, `responseTokens`, `error`) is always returned.
- Hard rules in the outfit / packing prompts: never include Underwear / Bras as outfit pieces (but **do** include them in packing lists), never pair Swimwear with formalwear, swim one-piece replaces top + bottom, etc.

## UI conventions

- **Sparkle (✨) is reserved for AI-driven buttons.** Every ✨ in the UI must trigger an AI feature; every AI feature must have a ✨. Other emojis (📸 for upload, ✓ for approve, +/− for steppers) are fine — they describe the action without claiming AI.
- Tailwind utility classes; design tokens in `app/globals.css` (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input`, `.label`, `.card`, `.tile-bg`, `.chip`).
- Color tokens: blush (primary), cream (background), sage (accent), stone (neutral). Defined in `tailwind.config.ts`.
- Mobile bottom nav (`components/MobileNav.tsx`) and desktop top nav (in `app/(app)/layout.tsx`) must stay in sync — adding a new top-level route means updating both.
- Sticky bottom action bars on long forms (see `CollectionWizard` step 4) — primary action one tap away from anywhere on the screen.

## Key file map

| Concern | Path |
|---|---|
| Schema | `prisma/schema.prisma` |
| Migrations | `prisma/migrations/` |
| AI provider | `lib/ai/provider.ts`, `lib/ai/types.ts` |
| Mannequin landmarks (Gemini) | `lib/ai/mannequinLandmarks.ts` |
| Packing-target formula | `lib/packingTargets.ts` |
| Constants | `lib/constants.ts` |
| User prefs / weather | `lib/userPrefs.ts`, `lib/weather.ts` |
| Auth | `auth.ts`, `auth.config.ts` |
| Dashboard | `app/(app)/page.tsx` |
| App shell / desktop nav | `app/(app)/layout.tsx` |
| Mobile bottom nav | `components/MobileNav.tsx` |
| Collections wizard (create) | `app/(app)/collections/CollectionWizard.tsx` |
| Collections editor (edit) | `app/(app)/collections/CollectionEditor.tsx` |
| Reusable filtered item grid | `app/(app)/collections/ItemPicker.tsx` |
| Outfit builder | `app/(app)/outfits/builder/OutfitBuilder.tsx` |
| Style canvas | `components/StyleCanvas.tsx` |
| Today's outfit card | `components/TodaysOutfitCard.tsx` |
| Mannequin upload | `components/MannequinUpload.tsx` |
| Deploy script | `scripts/update.sh` |

## Quick start for a new chat

1. `git checkout main && git pull origin main --ff-only`
2. `git checkout -b claude/<your-branch>`
3. `npm install` if needed → `npx prisma generate`
4. Make changes; run `npm run typecheck && npm run build`
5. For UI changes: `PORT=3001 npm run dev`, log in via curl, smoke-test routes
6. `git push -u origin <branch>` → `mcp__github__create_pull_request` → `mcp__github__merge_pull_request` (squash)
7. Tell the user to run `cd /opt/wardrobe && npm run deploy:update`

## Known follow-ups

Things that are good ideas but haven't been done. Pick one of these if the user asks "what's next" without a specific request:

- **Trip countdown card on the dashboard** — surface upcoming Collections (where `kind="trip"` and `startDate >= today`) as a hero card. Ties the Collections feature into the home screen.
- **`components/AiOutfitPicker.tsx` is orphaned** after the dashboard cleanup — safe to delete or repurpose.
- **No tests in the repo.** Typecheck + `next build` are the only gate. At minimum, add smoke tests for AI-disabled fallbacks on each `/api/ai/*` route.
- **Image-storage cleanup is manual** (admin → BgCleanup). Orphans accumulate.
- **AI-enhanced packing targets** — `lib/packingTargets.ts` is a deterministic formula. An "✨ Re-estimate with AI" button on the Quantities step could refine counts using destination knowledge (Iceland → more outerwear; Hawaii → more swimwear).

## Editing this file

If you make a change that affects any of these sections — schema, AI methods, conventions, file paths — update CLAUDE.md in the same PR. Stale handoff docs are worse than none.
