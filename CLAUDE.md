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
| `Item` | A clothing piece | category, subType, color, brand (free-form + canonical `Brand` ref), size, sizeSystem, fitDetails (JSON), fitNotes, seasons (CSV), activities (CSV), notes, isFavorite, **isBackroom** (the 🌶 flag), status (`active\|draft` — the `needs_review` queue was removed; every upload lands as active), four image-path columns (display + `imageOriginalPath`, `imageBgRemovedPath` + `imageBgRemovedOriginalPath`), `phash` (perceptual dHash for duplicate-detection on upload), optional `setId`, `pendingAiSuggestions` (JSON blob of staged AI suggestions awaiting per-row review) |
| `ItemPhoto` | Extra angles + label / care-tag close-ups per item | itemId, **`kind`** (`angle` \| `label` \| `pending`), three image-path columns (`imagePath`, `imageOriginalPath`, `imageBgRemovedPath`), label, position. `kind="pending"` means the row was created by `/api/items/[id]/merge` folding a source's main photo onto the target — the user resolves it from the edit page's PendingPhotoReview panel by promoting to `label` or `angle` (or deleting). |
| `ItemSet` | Soft link of pieces sold/worn together | swimsuit top+bottom, pajamas — items stay independent |
| `Outfit` | Bundle of items with slot map | name, activity, season, layoutJson (manual style canvas), `tryOnImagePath` / `tryOnHash` / `tryOnGeneratedAt` (cached AI try-on render), optional `collectionId` back-link |
| `OutfitItem` | Join row | outfitId, itemId, slot |
| `Collection` | Trip or themed packing set | `kind` (`trip\|general`), name, description, destination, startDate, endDate, notes, occasion, season, activities (CSV) |
| `CollectionItem` | Join row | collectionId, itemId |
| `Brand` + `BrandAlias` | Canonical brand with normalized `nameKey` | dedupes "J.Crew" / "JCREW" / "J Crew" |
| `WishlistItem` | Standalone wishlist | priority, giftIdea, purchased flags. Photos saved under `<userId>/wishlist/` — files are EXIF-rotated + resized via sharp on upload (`/api/wishlist/route.ts`). |
| `Notification` | In-app bell-icon notifications | title, body, href, read. POST validates `href` to same-origin paths or `https://` only — `javascript:` / `data:` / `http:` / `//foo` are dropped. |
| `ActivityLog` | Strictly per-user audit log | userId, kind (`item.create`, `auth.signin`, `ai.outfit`, `activity.cleared`, …), summary, optional targetType+targetId+meta. Surfaces on the Settings → Activity card; user can wipe via DELETE `/api/activity` (which writes one final `activity.cleared` entry). Older events drop off automatically after ~90 days. |
| `User.measurements` | Body measurements, free-form JSON blob (extend-without-migration, same pattern as `Item.fitDetails`) | `{ unit, updatedAt, core{height,bust,waist,hips,shoulder,sleeve,inseam,shoeUS}, bra?{underbust,bustStanding/Leaning/Lying,size}, extra?{neck,thigh,weight,ringSize,notes} }`. Lengths stored as-entered in `unit` (no normalization on disk); `lib/measurements.ts` converts to inches for the ABraThatFits-style bra calc + the (future) AI-prompt summary. Owner-scoped + private by the per-profile design. Read/written via owner-scoped `GET`/`PUT /api/measurements`; captured on `/settings/measurements`. **Phase A (foundation) only — nothing consumes it yet; Phases B (garment fit badge), C (shopping-AI size injection), D (try-on/mannequin proportions), E (AI photo estimate w/ reference object) are the planned follow-ups.** |

**Conventions:**
- SQLite has no array type; we use comma-separated strings for `seasons` and `activities`. Helpers in `lib/constants.ts`: `csvToList`, `listToCsv`.
- IDs are CUIDs (Prisma `@default(cuid())`).
- Migrations are sequential; never edit a merged migration. Write a new one.
- Renaming a table on SQLite requires a copy-then-drop migration (Prisma can't do it in place). See `20260501030000_rename_capsule_to_collection` for the pattern.

## Vocabulary (`lib/constants.ts`)

- **14 categories**: Tops, Bottoms, Dresses, Outerwear, Shoes, Accessories, Activewear, Loungewear, Bags, Jewelry, Bras, Underwear, Swimwear, Socks & Hosiery
- **10 spicy categories** (`isBackroom = true` only, separate vocabulary): Lingerie, Lingerie Set, Bodysuit, Teddy, Robe, Sleepwear, Costume, Stockings, Toys, Other. Live in `lib/constants.ts` as `SPICY_CATEGORIES`. POST/PATCH validators accept the union via `isKnownCategory(value)`. The `/wardrobe/backroom` page has its own search + chip filters operating on this list — the main closet page never references it.
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
| `tagImage` | `/api/ai/tag`, `/api/ai/tag-bulk` | Auto-tag from photo + optional label close-up. Runs on `GEMINI_TAG_MODEL` (default `gemini-2.5-pro`) for stronger structured-output reasoning vs. the other AI helpers which stay on `GEMINI_MODEL`. The caller is expected to run `describeItem` first and pass the result as `notesContext` — the structured tagger uses the notes as ground truth and commits to enum values it would otherwise hedge to null on. **Beauty-aware:** the schema's `category` enum is the union of `CATEGORIES + BEAUTY_CATEGORIES`, and the prompt's `beautyHint` tells the model to set `isBeauty=true` and extract `shadeName` / `shadeHex` (from the swatch, not the tube) / `finish` when the photo shows a cosmetic. Clothing path leaves those fields null. AddItemForm + EditItemForm wire the new fields through their existing apply / review flows; `lib/pendingAi.ts` and `/api/ai/tag-bulk` carry them through the bulk re-tag → pending-review path. |
| `describeItem` | `/api/ai/notes` | Generate the item's notes field |
| `buildOutfit` | `/api/ai/outfit` | Pick items for a free-text occasion (honors user's `preferences`) |
| `buildPackingList` | `/api/ai/packing-list` | Curate a trip packing list, **honors `targets: Record<Category, number>`** |
| `suggestActivities` | `/api/ai/suggest-activities` | Propose 4–8 trip activities from destination + dates |
| `parseSearch` | `/api/ai/search` | Parse natural-language closet search into structured filters |
| `detectMultipleItems` | `/api/ai/detect-items` | Take a single flat-lay photo, return one bounding-box-and-suggestion entry per detected item (clothing OR beauty — the category enum is the union). Drives the "✂ Split photo" picker on `/wardrobe/new/split`. Built on Gemini 2.5 Pro's structured-output detection — `box_2d: [ymin, xmin, ymax, xmax]` in 0–1000 normalized coords. Prompt explicitly returns `items: []` on outfit-on-body photos because per-garment crops there end up half-skin. |

**Other AI-adjacent routes** (not on the provider interface):
- `/api/ai/rotate-label` — auto-rotates label photos on upload
- `/api/ai/outfit/today` — daily outfit pick (weather-aware) + dressed-mannequin compose. Saves under `data/uploads/<userId>/todays-outfit.json` and `…/todays-outfit-tryon-<YYYY-MM-DD>.png`. Hard-excludes 🌶 items.
- `/api/items/[id]/build-and-tryon` — **one-click try-on from item detail.** Asks AI to build a full outfit anchored on the item, force-includes the anchor if the model didn't pick it, saves the `Outfit` row, and returns `{ outfitId }`. Client navigates to `/outfits/{id}/style` where TryOnView's auto-generate effect renders the mannequin composite. See `app/(app)/wardrobe/[id]/TryOnButton.tsx`.
- `/api/ai/lookup-product` — manual product lookup for the item edit page. Two paths: `{ url, isBeauty?, category? }` runs `lookupProductFromUrl` (server-side `fetchProductMeta` + a narrow text-mode Gemini call); `{ brand, subType?, color?, category?, isBeauty? }` runs `lookupProductOnline` (Gemini grounded search). When `isBeauty=true` (explicitly or inferred from `category` ∈ `BEAUTY_CATEGORIES`) the prompt + response schema swap to ask for `shadeName` / `shadeHex` / `finish` instead of `material` / `careNotes` — same flow on the edit page, just different fields. See `lib/ai/productLookup.ts`.
- `/api/ai/wishlist-lookup` — paste a product URL or type "white linen blazer Madewell" / "MAC Ruby Woo" and the wishlist form pre-fills. URL inputs first try a direct server-side fetch via `lib/productMeta.ts`, which parses Open Graph tags + JSON-LD `Product` schema out of the HTML — no AI in the fetch step, so most retailers (Madewell, J.Crew, Nordstrom, Zara, Sephora, …) return reliable data without grounded-search hallucinations. Gemini is only called afterward to classify the extracted text into category + color; the allowed-category enum is `CATEGORIES ∪ BEAUTY_CATEGORIES`, so a beauty wish lands on "Lipstick" / "Foundation" / etc. instead of being forced into a clothing bucket. If the direct fetch fails (Amazon's robot check, Cloudflare challenge, no embedded metadata, …), it falls back to Gemini grounded search with the Amazon URL canonicalizer + cross-domain mismatch guard. Paired with `/api/wishlist/similar` (no AI) which surfaces existing closet items that may already cover the wish — soft warning, never blocks save; flips between `isBeauty: true / false` based on the wish's category so a beauty wish matches against the user's beauty stash, not their tops.
- `/api/ai/style-suggestion` — daily "Today's suggestion" card. Reads a closet summary (top brands, colors, categories, favorites, style notes) and asks Gemini's grounded search to surface ONE real product the user might like, hyperlinked to the vendor. Saves under `data/uploads/<userId>/todays-suggestion.json`. See `lib/ai/styleSuggestion.ts`.
- `/api/ai/collection-shop` — "Shop for this trip / collection". **Two-stage pipeline**: (1) Gemini reads the collection metadata + `buildClosetSummary` + `getTripForecast` + `computePackingTargets` and returns 3-12 product **specs** (search query, category, color, brand hint, price tier, reasoning) tuned by a 0-100 closet-awareness slider — see `lib/ai/collectionShop.ts:specifyProductsForCollection`; (2) for each spec we pick the best-fit retailers from a hardcoded curated list in `lib/retailerSearch.ts` and emit a `ShopIdea` card with retailer search-page links. Orchestrated by `lib/ai/shopPipeline.ts`. Each retailer link is a **Google site-search** (`google.com/search?q=site:madewell.com+linen+blazer`) built by `buildRetailerSearchUrl(host, query)` — we tried per-retailer native search URLs (Madewell `?q=`, J.Crew `?Ntrm=`, Nordstrom `?keyword=`, etc.) but retailers redesign these constantly and silently break the format; site-search always works, returns real current products, and survives any number of retailer-side redesigns. We previously tried Google CSE for product-page resolution but Google closed Custom Search JSON API to new customers in 2025 — the redirect approach is free, doesn't go stale, doesn't hallucinate, and works against bot-blocking sites because the user opens them in their normal browser.
- `/api/outfits/[id]/tryon` — composites the outfit onto the user's mannequin via Gemini 2.5 Flash Image. Hashes (mannequin id + sorted item ids + file mtimes + prompt version) and short-circuits when nothing has changed; otherwise persists the PNG and updates `Outfit.tryOnImagePath` / `tryOnHash` / `tryOnGeneratedAt`. See `lib/ai/tryon.ts`.
- `/api/mannequin` — per-user "personal mannequin": upload a photo (multipart `source` File) and Gemini 2.5 Flash Image generates a stylized fashion-illustration of a neutral, faceless dress-form matching that body type. JSON `{ mode: "regenerate" }` re-runs on the saved source. `DELETE` wipes back to the global default. See `lib/ai/mannequin.ts` (`generateMannequinFromPhoto`) + `lib/mannequin.ts`.
- `/api/items/bg-remove-batch` — server-side background removal via `@imgly/background-removal-node` (same model as the browser-side `lib/bgRemoval.ts`, but ONNX runs CPU-only on Node). Bulk upload POSTs `{ itemIds, background: true }` after uploads finish; the route processes the batch with concurrency 3 in the background and fires a `Notification` when done so the user can close the tab. Single-photo edits keep using the browser-side path. See `lib/bgRemovalServer.ts` — also exports `runItemPhotoBgRemovalBatch` (mirror for ItemPhoto rows; suffix flips `label-bg` / `angle-bg` based on `kind`) and `redoItemBgRemoval` / `redoItemPhotoBgRemoval` (single-shot retry with aggressiveness). The native `.node` binary + model assets are listed in `serverComponentsExternalPackages` in `next.config.mjs` so webpack doesn't try to bundle them.
- `/api/items/[id]/redo-bg` — re-run bg removal at a different aggressiveness. Body `{ level: 0..4, photoId? }`. The model itself doesn't have a threshold; we post-process the alpha channel via a per-level `(multiplier, offset)` curve in `ALPHA_CURVES` (level 2 = no-op, 0 = preserve fuzzy edges, 4 = hard cut). Reachable from the **`BgRetryControl`** component, mounted under the hero photo editor and on every label / angle thumbnail.
- `/api/ai/estimate-measurements` — Phase E. Multipart front (required) + side (optional) photo + tape-measured `height` (the scale anchor — a photo has no inherent scale) + `unit`. One Gemini vision call (`lib/ai/estimateMeasurements.ts`, GEMINI_TAG_MODEL) returns a rough draft (bust/waist/hips/shoulder/sleeve/inseam + a free-text `shape` descriptor + confidence) which the route converts into the form's unit. **No DB write, photos never hit disk** — held in memory, sent, dropped (privacy posture for the opt-in fitted-clothing / underwear flow). Per-user inflight lock. The draft pre-fills `MeasurementsForm`; the user reviews/edits before the normal Save. Realistic accuracy ±1-3in — surfaced as an estimate, never auto-saved.

### Inflight-lock pattern

Long-running per-user endpoints share a `const inflight = new Set<string>()` at module scope. The handler `if (inflight.has(userId)) return 409` early; otherwise `inflight.add` before the work and `inflight.delete` in `finally`. Used by `/api/items/bg-remove-batch`, `/api/admin/optimize-photos`, `/api/ai/tag-bulk`, and the per-user mannequin generator. Stops a double-tap from spawning two parallel ONNX / Gemini batches over the same items.

**On faces:** the mannequin is intentionally faceless. We tried both CSS-stacking a stylized head and AI-composing a cartoon head onto the body — neither held identity well enough to ship (drift was too high). The figure stays a neutral fashion-illustration dress-form.

**Mannequin selection:** the try-on route prefers the user's personal mannequin (`data/uploads/<userId>/mannequin.png` + `mannequin.json`) when present and falls back to the global default at `public/mannequin/base.png` (with `base.json`). The global default is generated via `npm run generate:mannequin` (script: `scripts/generate-mannequin.mjs`); regenerating either the user's or the global mannequin bumps the id and invalidates cached try-ons.

**Prompt conventions:**
- All structured-response calls use Gemini's `responseMimeType: "application/json"` + `responseSchema` to force valid JSON.
- Catalog calls cap at 250 items.
- Owned-id filtering on every response — the model can't invent items.
- Debug payload (`status`, `rawText`, `promptTokens`, `responseTokens`, `error`) is always returned.
- Hard rules in the outfit / packing prompts: never include Underwear / Bras as outfit pieces (but **do** include them in packing lists), never pair Swimwear with formalwear, swim one-piece replaces top + bottom, etc.
- **API key goes in the `x-goog-api-key` header, never the URL** — keeps the key out of any URL-logging path. Every Gemini fetch also goes through `fetchWithTimeout` (60s text / grounded, 90s image gen via `IMAGE_TIMEOUT_MS`) so a hung connection can't hold a per-user inflight lock forever — `maxDuration` is serverless-only and NOT enforced on the long-running `next start` deploy.
- **Multipart item routes validate uploads via `validateUploadFile`** (`lib/uploads.ts`): 25 MB cap + JPEG/PNG/WebP/GIF whitelist (HEIC intentionally absent — clients convert before upload since server sharp can't decode it).

## Bulk upload (`/wardrobe/bulk`)

Three-step wizard in `app/(app)/wardrobe/bulk/BulkUpload.tsx`:

1. **Choose** — pick photos, set defaults: category (or ✨ Auto), status, AI tag on/off + confidence, server-side bg removal on/off, "🌶 Mark all" (sends every item in the batch to the Spicy page). When 🌶 is on the category dropdown swaps from `CATEGORIES` to `SPICY_CATEGORIES`.
2. **Process** — uploads run sequentially (one POST per file to dodge body-size limits), AI tagging fires server-side as a fire-and-forget background job after all uploads finish, bg removal then runs server-side over the uploaded items. Live queue with per-job state.
3. **Done** — "✓ N items saved" headline; if any failed, a **"What failed"** card lists the failures with thumbnail + filename + a `prettifyError(raw)` description that maps common error patterns (HEIC, 413, sharp / VipsJpeg, 500, network, etc.) to a friendly summary + actionable hint. Card has an inline **↻ Retry N failed** button that calls `startPipeline()` (which has the phase guard, mirroring the same pattern Step 2's retry now uses).

## Optimize Photos (`/api/admin/optimize-photos`)

Background pass kicked off from Settings → Maintenance. Three sub-passes:

1. **Two-tier recovery** — `Item` / `ItemPhoto` rows with `imageOriginalPath = null` (pre-PR #132) get re-saved via `saveUploadWithOriginal` so display + original line up.
2. **Bg-removed shrink** — oversized `imageBgRemovedPath` PNGs get re-encoded in place to ≤ 1024 px PNG with alpha preserved. The hi-res `imageBgRemovedOriginalPath` is intentionally left alone (lightbox tap-to-zoom).
3. **Label cutout generation** — `ItemPhoto` rows where `kind="label"` and `imageBgRemovedPath = null` get a brand-new server-side cutout via `runItemPhotoBgRemovalBatch`. Catches labels uploaded before the per-photo bg-removal pipeline shipped.

The route uses the inflight-lock pattern; pass 3 runs after the cheap shrinks so a model-load failure doesn't cost the simpler wins. Response includes `count`, `fixed`, `errors`, and `labelsBgGenerated` so the user notification breaks out the label-specific work.

## UI conventions

- **Sparkle (✨) is reserved for AI-driven buttons.** Every ✨ in the UI must trigger an AI feature; every AI feature must have a ✨. Other emojis (📸 for upload, ✓ for approve, +/− for steppers) are fine — they describe the action without claiming AI.
- Tailwind utility classes; design tokens in `app/globals.css` (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.input`, `.label`, `.card`, `.tile-bg`, `.chip`).
- Color tokens: blush (primary), cream (background), sage (accent), stone (neutral). Defined in `tailwind.config.ts`.
- Mobile bottom nav (`components/MobileNav.tsx`) and desktop top nav (in `app/(app)/layout.tsx`) must stay in sync — adding a new top-level route means updating both.
- Sticky bottom action bars on long forms (see `CollectionWizard` step 4) — primary action one tap away from anywhere on the screen.
- **Unsaved-changes guard.** `useUnsavedChanges(dirty)` (`lib/useUnsavedChanges.ts`) blocks accidental navigation away from an in-progress workflow. Pass a `dirty` boolean computed from "has the user started / changed anything not yet saved". It guards hard nav via `beforeunload` (generic browser string — platform-forced) and in-app `<Link>` clicks via a document capture-phase interceptor that shows the branded `confirmDialog`. Wired into AddItemForm, EditItemForm, SplitItemForm, BulkUpload, OutfitBuilder, LookBuilder, CollectionWizard, CollectionEditor, WishlistForm. Programmatic `router.push` (post-save) is NOT intercepted, so forms just need `dirty` accurate — it goes false on save / unmount naturally. SPA back/forward is intentionally not guarded (re-entrant history interception is bug-prone); `beforeunload` still catches back-to-outside-the-app. Escape hatch: mark a link / ancestor `data-skip-unsaved-guard`.

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
| Shop for this trip / collection | `lib/ai/collectionShop.ts` (Stage 1 specs), `lib/retailerSearch.ts` (Stage 2 retailer picker), `lib/ai/shopPipeline.ts` (orchestrator), `app/api/ai/collection-shop/route.ts`, `app/(app)/collections/CollectionShop.tsx` |
| Web product lookup (manual on item edit) | `lib/ai/productLookup.ts`, `app/api/ai/lookup-product/route.ts` |
| Merge items (fold source photos onto a target, delete sources) | `app/api/items/[id]/merge/route.ts`, `app/(app)/wardrobe/[id]/ItemMerge.tsx` (single-target picker on the item edit page) and `app/(app)/wardrobe/ClosetGallery.tsx` (multi-select **⤵ Merge** chip in the closet's bulk-action bar). Folded photos default to `kind="pending"` so the user triages each one. |
| Pending photo review (resolve `ItemPhoto.kind="pending"`) | `app/(app)/wardrobe/[id]/PendingPhotoReview.tsx`; PATCH `/api/items/[id]/photos/[photoId]` accepts `{ kind: "label" \| "angle" \| "pending" }`. |
| Re-role a photo (tap a label/angle/pending thumbnail in edit mode) | `app/(app)/wardrobe/[id]/PhotoActionsSheet.tsx` — modal with Make main / Mark as label / Mark as angle / Delete. "Make main" pops a follow-up asking whether the old main should become a label or an angle. POST `/api/items/[id]/photos/[photoId]/set-main` does the swap server-side: copies the chosen ItemPhoto's paths onto the Item, creates a new ItemPhoto for the old main with the chosen `demoteToKind`, deletes the source ItemPhoto, recomputes `Item.phash`, and unlinks the now-orphan `imageBgRemovedOriginalPath`. Outfit try-on caches invalidate naturally because the hash includes the file mtimes of the item's `imagePath`. |
| Item-detail try-on | `app/(app)/wardrobe/[id]/TryOnButton.tsx`, `app/api/items/[id]/build-and-tryon/route.ts`. |
| BG removal aggressiveness retry | `components/BgRetryControl.tsx` (5-step slider, two layouts: `inline` for the hero, `button` for label/angle thumbnails); `app/api/items/[id]/redo-bg/route.ts`; `lib/bgRemovalServer.ts` `ALPHA_CURVES` + `redoItemBgRemoval` / `redoItemPhotoBgRemoval`. |
| Spicy / "Backroom" (hidden items: lingerie, costumes, etc) | `lib/backroom.ts` (filter helpers), `app/(app)/wardrobe/backroom/page.tsx` (dedicated page rendered as **🌶 Spicy**); `Item.isBackroom` flag — schema name kept stable, user-facing label is "Spicy". The main closet has zero references to spicy items: they're hard-excluded from `/wardrobe` and `/api/items`, and the only entry point is the 🌶 icon in the closet header. Outfit / Collection pages still expose a `🌶 Spicy` toggle so a user editing an outfit that contains a spicy piece can see it. |
| Closet snapshot helper (shared by AI prompts) | `lib/ai/closetSummary.ts` |
| Personal mannequin (per-user) | `lib/mannequin.ts`, `lib/ai/mannequin.ts`, `app/api/mannequin/route.ts`, `components/MannequinUpload.tsx` |
| Global mannequin asset | `public/mannequin/base.png` + `base.json` |
| Mannequin generator (global default) | `scripts/generate-mannequin.mjs` |
| Upload helpers (saveUpload, saveUploadWithOriginal, saveBuffer, unlinkUpload, **listUserFiles** — recursive walker for storage / cleanup-orphans) | `lib/uploads.ts` |
| Bulk upload wizard (3-step: Choose / Process / Done with retry + friendly errors) | `app/(app)/wardrobe/bulk/BulkUpload.tsx`, `app/api/items/bulk/route.ts` |
| Split a multi-item photo (AI detection + per-detection crop + bulk-create) | `app/(app)/wardrobe/new/split/page.tsx`, `app/(app)/wardrobe/new/split/SplitItemForm.tsx`, `app/api/ai/detect-items/route.ts`, `app/api/items/split/route.ts`. The split route crops the source image with sharp per detected box (with a 4% padding), creates N Item rows, and fires `runHiResBgRemovalBatch` so cutouts populate in the background — same pattern as `/api/items/bulk`. |
| Optimize Photos (two-tier recovery + bg shrink + label bg generation) | `app/api/admin/optimize-photos/route.ts` |
| Activity log + clear from Settings | `lib/activity.ts`, `app/(app)/settings/ClearActivityButton.tsx`, `app/api/activity/route.ts` |
| Static file serve (owner-scoped) | `app/api/uploads/[...path]/route.ts` — first path segment must equal session userId; rejects cross-user paths with 404. |
| Packing-target formula | `lib/packingTargets.ts` |
| Constants | `lib/constants.ts` |
| User prefs / weather | `lib/userPrefs.ts`, `lib/weather.ts` |
| Body measurements (types, ABTF bra calc, unit conv, sanitize, `measurementsSummary`, `assessFit`, free-text `shape`) | `lib/measurements.ts`, `app/api/measurements/route.ts`, `app/(app)/settings/measurements/page.tsx` + `MeasurementsForm.tsx` |
| Photo measurement estimate (Phase E) | `lib/ai/estimateMeasurements.ts`, `app/api/ai/estimate-measurements/route.ts`, the estimate panel in `MeasurementsForm.tsx` |
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

- **Body-measurements feature — all five phases (A-E) shipped.** A = schema + `lib/measurements.ts` + `/api/measurements` + `/settings/measurements`; B = `assessFit` garment fit badge on the item page (no AI); C = `measurementsSummary` injected into Today's Suggestion + Shop-for-trip prompts (deliberately not product/wishlist lookup — fixed output schema, no size slot); D = `proportions` appended to the mannequin generation prompt; E = `/api/ai/estimate-measurements` photo estimate (height as scale anchor, front + optional side, no photo retention) → editable draft, plus a free-text `shape` descriptor that also rides `measurementsSummary` into the C/D prompts. **Open future idea (NOT built):** a separate, deliberately-lit color/undertone analysis flow ("you suit jewel tones") — split out from the measurement shot because uncontrolled phone white-balance wrecks undertone reliability.
- **Trip countdown card on the dashboard** — surface upcoming Collections (where `kind="trip"` and `startDate >= today`) as a hero card. Ties the Collections feature into the home screen.
- **`components/AiOutfitPicker.tsx` is orphaned** after the dashboard cleanup — safe to delete or repurpose.
- **No tests in the repo.** Typecheck + `next build` are the only gate. At minimum, add smoke tests for AI-disabled fallbacks on each `/api/ai/*` route.
- **AI-enhanced packing targets** — `lib/packingTargets.ts` is a deterministic formula. An "✨ Re-estimate with AI" button on the Quantities step could refine counts using destination knowledge (Iceland → more outerwear; Hawaii → more swimwear).
- **SSRF guard on AI lookup routes** — `/api/ai/wishlist-lookup` and `/api/ai/lookup-product` server-side fetch arbitrary URLs without rejecting `localhost` / private-network hosts. Two-user trusted personal app so low risk, but worth tightening if the deployment ever opens up.
- **`OutfitItem.item` lacks `onDelete: Cascade`** — current routes work around it by `deleteMany({ itemId })` before `prisma.item.delete`. A future delete entry point that skips the cleanup would FK-violate. One migration to add the cascade.
- **`redo-bg` double-tap orphan** — concurrent calls on the same item can briefly orphan one cutout file (the `unlinkUpload` for the previous path runs before the second call sees the new write). Negligible disk impact; could fix with a per-(item,photo) inflight key if it ever matters.
- **Spicy items in `build-and-tryon`** — when the anchor is a 🌶 item, the AI catalog still hard-excludes other spicy items, so complementary picks come from the main closet only. Pairing two intimates needs a body-param opt-in (mirroring `/api/ai/outfit`'s `includeBackroom`).

## Editing this file

If you make a change that affects any of these sections — schema, AI methods, conventions, file paths — update CLAUDE.md in the same PR. Stale handoff docs are worse than none.
