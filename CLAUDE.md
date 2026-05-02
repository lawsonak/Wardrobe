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

**Always anchor on `main` before planning or implementing.** This rule exists because we've already burned a PR's worth of work on an out-of-date branch:

1. Run `git fetch origin main && git log --oneline origin/main..HEAD` and `git log --oneline HEAD..origin/main` to see how far the working branch has drifted from `main`.
2. If `main` is ahead by more than a handful of commits, **read the relevant commit subjects** (`git log --oneline origin/main -30`) and skim the files in those commits that touch the area you're about to change. Parallel work that overlaps your task is the #1 hidden gotcha.
3. If a pre-assigned branch (e.g. `claude/<feature-id>`) was created against an older `main`, treat its prior commits as inspiration, not a foundation — start a fresh branch off current `main` and re-apply only the parts that still make sense.
4. Never plan or design against a stale tree. The Phase 1 explore step in plan mode must read the current `main` state, not whatever happened to be checked out.

Other conventions:

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
| `Outfit` | Bundle of items with slot map | name, activity, season, layoutJson (manual style canvas), `tryOnImagePath` / `tryOnHash` / `tryOnGeneratedAt` (cached AI try-on render), optional `collectionId` back-link |
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
- **34-color palette** (33 named + a `multi` gradient sentinel) with hex codes, grouped by visual family. Edit in `lib/constants.ts` — `COLOR_NAMES` is derived from it and feeds the AI tagger's enum, so the two never drift.
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
- `/api/ai/rotate-label` — auto-rotates label photos on upload
- `/api/ai/outfit/today` — daily outfit pick (weather-aware) + dressed-mannequin compose. Saves under `data/uploads/<userId>/todays-outfit.json` and `…/todays-outfit-tryon-<YYYY-MM-DD>.png`.
- `/api/ai/lookup-product` — manual product lookup for the item edit page. Two paths: `{ url }` runs `lookupProductFromUrl` (server-side `fetchProductMeta` + a narrow text-mode Gemini call to extract material/care from the cleaned page text); `{ brand, subType?, color?, category? }` runs `lookupProductOnline` (Gemini grounded search). Both return material/care/description/retail-price. See `lib/ai/productLookup.ts`.
- `/api/ai/wishlist-lookup` — paste a product URL or type "white linen blazer Madewell" and the wishlist form pre-fills. URL inputs first try a direct server-side fetch via `lib/productMeta.ts`, which parses Open Graph tags + JSON-LD `Product` schema out of the HTML — no AI in the fetch step, so most retailers (Madewell, J.Crew, Nordstrom, Zara, …) return reliable data without grounded-search hallucinations. Gemini is only called afterward to classify the extracted text into category + color. If the direct fetch fails (Amazon's robot check, Cloudflare challenge, no embedded metadata, …), it falls back to Gemini grounded search with the Amazon URL canonicalizer + cross-domain mismatch guard. Paired with `/api/wishlist/similar` (no AI) which surfaces existing closet items that may already cover the wish — soft warning, never blocks save.
- `/api/ai/style-suggestion` — daily "Today's suggestion" card. Reads a closet summary (top brands, colors, categories, favorites, style notes) and asks Gemini's grounded search to surface ONE real product the user might like, hyperlinked to the vendor. Saves under `data/uploads/<userId>/todays-suggestion.json`. See `lib/ai/styleSuggestion.ts`.
- `/api/outfits/[id]/tryon` — composites the outfit onto the user's mannequin via Gemini 2.5 Flash Image. Hashes (mannequin id + sorted item ids + file mtimes + prompt version) and short-circuits when nothing has changed; otherwise persists the PNG and updates `Outfit.tryOnImagePath` / `tryOnHash` / `tryOnGeneratedAt`. See `lib/ai/tryon.ts`.
- `/api/mannequin` — per-user "personal mannequin": upload a photo (multipart `source` File) and Gemini 2.5 Flash Image generates a stylized fashion-illustration of a neutral, faceless dress-form matching that body type. JSON `{ mode: "regenerate" }` re-runs on the saved source. `DELETE` wipes back to the global default. See `lib/ai/mannequin.ts` (`generateMannequinFromPhoto`) + `lib/mannequin.ts`.

**On faces:** the mannequin is intentionally faceless. We tried both CSS-stacking a stylized head and AI-composing a cartoon head onto the body — neither held identity well enough to ship (drift was too high). The figure stays a neutral fashion-illustration dress-form.

**Mannequin selection:** the try-on route prefers the user's personal mannequin (`data/uploads/<userId>/mannequin.png` + `mannequin.json`) when present and falls back to the global default at `public/mannequin/base.png` (with `base.json`). The global default is generated via `npm run generate:mannequin` (script: `scripts/generate-mannequin.mjs`); regenerating either the user's or the global mannequin bumps the id and invalidates cached try-ons.

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
| AI try-on (Gemini Flash Image) | `lib/ai/tryon.ts`, `app/api/outfits/[id]/tryon/route.ts` |
| AI try-on shared compose helpers | `lib/ai/composeTryOn.ts` |
| Try-on UI shell | `components/TryOnView.tsx` |
| Today's suggestion (daily product pick) | `lib/ai/styleSuggestion.ts`, `lib/todaysSuggestion.ts`, `app/api/ai/style-suggestion/route.ts`, `components/TodaysSuggestionCard.tsx` |
| Web product lookup (manual on item edit) | `lib/ai/productLookup.ts`, `app/api/ai/lookup-product/route.ts` |
| Personal mannequin (per-user) | `lib/mannequin.ts`, `lib/ai/mannequin.ts`, `app/api/mannequin/route.ts`, `components/MannequinUpload.tsx` |
| Global mannequin asset | `public/mannequin/base.png` + `base.json` |
| Mannequin generator (global default) | `scripts/generate-mannequin.mjs` |
| Upload helpers (saveUpload, saveBuffer, unlinkUpload) | `lib/uploads.ts` |
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
| Style canvas (manual layout fallback) | `components/StyleCanvas.tsx` |
| Today's outfit card | `components/TodaysOutfitCard.tsx` |
| Deploy script | `scripts/update.sh` |

## Quick start for a new chat

1. `git fetch origin main && git checkout main && git pull origin main --ff-only` — **always start here**, even if a feature branch was pre-assigned. If you're handed a pre-existing branch, run `git log --oneline origin/main..HEAD` and `git log --oneline HEAD..origin/main` first to confirm it isn't behind. If `main` has moved on, branch fresh off current `main` rather than building on stale history (see "Workflow conventions").
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
