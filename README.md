# Wardrobe

A self-hosted virtual wardrobe — snap photos of clothing, tag them, build
outfits on a personalized mannequin, and let AI handle the boring bits.
Single SQLite file, single Node process, runs on a Proxmox LXC or any
small box.

## Quick start

```bash
npm install
cp .env.example .env       # then edit values
npx prisma migrate deploy  # creates the SQLite DB
npm run seed               # creates the two user accounts
npm run build && npm run start    # http://localhost:3000
```

For development with hot reload, use `npm run dev` instead of build+start.

For Proxmox/LXC + systemd hosting see
[`docs/DEPLOY_PROXMOX.md`](docs/DEPLOY_PROXMOX.md).

To deploy a code update on a host that's already running:

```bash
cd /opt/wardrobe && npm run deploy:update
```

## What's inside

### Closet
- **Dense 4-column gallery** on mobile (5/6/7 on larger screens), tight
  spacing, item heart only on favorites until hover.
- **Filters** — natural-language AI search ("white blouses I haven't
  worn"), category, color, season, activity, favorites, dormant
  ("haven't worn lately"), with removable filter chips.
- **Closet quality** screen for finding items missing details and
  duplicate brands.
- **Needs Review inbox** for items that came in via bulk upload and
  haven't been confirmed yet.

### Item detail page (`/wardrobe/[id]`)
- Read-first layout: hero photo, title pills (subType / category /
  status / color), favorite heart, quick stats (wear count, last
  worn), 👕 **Wore today** button.
- Details card with brand, size, color, per-category fit fields
  (waist / inseam / sleeve / etc.), fit notes.
- Tag chips for seasons + activities.
- Notes (`[Worn: …]` stamps stripped from the visible text).
- **In outfits** — each row shows up to 4 thumbnails and links into
  the Style canvas.
- **Recent wears** — comma-separated date list.
- **✎ Edit** button toggles into the full edit form (`?edit=1`); save
  drops back to detail.
- **Prev / next chevrons** + horizontal swipe gestures jump between
  items in closet order without going back to the gallery.
- Tucked-away **Delete this item** at the bottom.

### Adding items
- **Add item** — single piece, take a photo or pick from library.
  HEIC supported. Background removal runs in the browser via
  `@imgly/background-removal`.
- **Quick add** (`/wardrobe/new?batch=1`) — snap, save, camera
  reopens for the next piece.
- **Import from library** (`/wardrobe/bulk`) — pick a stack of photos;
  one upload round-trip; AI auto-tag fires server-side in the
  background; a notification lands when done. Default category is
  **✨ Let AI decide**.

### Outfits
- **Outfit Builder** with slot-based pickers (top, bottom, dress,
  outerwear, shoes, accessory, bag). Multi-select on tops, bottoms,
  outerwear, shoes, accessories, bags so you can layer (e.g.,
  underwear + pants).
- **Surprise me** for a random outfit, **AI Build me an outfit** for a
  free-text occasion ("Sunday brunch").
- **Wearing today** checkbox at save — bumps the wear stamp on every
  picked piece.
- **Style canvas** (`/outfits/[id]/style`) — drag, resize, rotate
  each piece on your mannequin. Auto-saves the layout. **✨ Auto-fit**
  button asks AI for per-item placement against the mannequin's
  landmarks.
- **Saved outfits** gallery shows each outfit on the mannequin with
  the saved layout; tap any card to open the Style canvas.

### Mannequin
- Upload a photo of yourself in **Settings → Your mannequin**.
- Gemini's image-generation model turns it into a soft watercolor
  fashion-illustration croquis.
- A second vision call extracts **anatomical landmarks**
  (shoulders, waist, hips, knees, ankles) — these drive every slot's
  default position so clothes sit on *your* body proportions.
- **Regenerate** for a different illustration without re-uploading.
- **📐 Recalibrate fit** to re-extract landmarks without touching
  the mannequin pixels (useful when items look misaligned).
- **Reset to default** wipes the source photo, generated illustration,
  and landmarks; falls back to the SVG silhouette.

### Today's outfit (dashboard)
- AI picks a daily outfit from your closet, weather-aware when a
  home city is set.
- Per-item AI fit places each piece on the mannequin's landmarks.
- Pick + layout are persisted to disk; reloads, app restarts, and
  navigation between tabs all show the same look until either
  midnight rolls over or you tap **Try another**.
- **Open in Builder** to refine, **👕 Wearing it** to mark all worn.

### Collections (`/capsules` URL, "Collections" in UI)
- Group pieces around a trip, season, vibe, or theme.
- Same item can belong to many collections.
- Filter the picker by category, season, activity, favorites,
  free-text.

### Wishlist
- Add wishes with priority (low / medium / high), occasion, link,
  price, photo, notes, "fills a gap" / "gift idea" flags.
- Mark purchased; purchased items move to a separate dimmed list.

### Wear tracking
- 👕 **Wore today** anywhere it appears appends `[Worn: YYYY-MM-DD]`
  to the item's notes (no schema migration). Once-a-day idempotent.
- Detail page shows total wears, last-worn date, recent wear list.
- The closet **dormant** filter surfaces items not worn in 60+ days.
- A daily idempotent **dormancy nudge** writes a single in-app
  notification per week for the longest-untouched item, capped at
  one notification at a time.

### AI features
- **Combined Auto-tag** — single tap fires `/api/ai/tag` and
  `/api/ai/notes` in parallel. Fills empty fields and writes notes
  from one photo. Resilient: retries transient errors with a
  friendlier message ("Couldn't reach the server" instead of
  Safari's opaque "Load failed").
- **AI build me an outfit** — free-text occasion → AI picks items
  from your closet, lands you in the Builder pre-filled.
- **Today's outfit** — daily AI pick + fit, persisted, weather-aware.
- **Natural-language closet search** — "summer dresses I haven't
  worn" → parsed into structured filters.
- **AI bulk-tag on import** — auto-fires after a bulk upload,
  promotes high-confidence items to active and leaves the rest in
  Needs Review with a notification.
- **AI item fit** — Gemini vision returns per-item placement
  coordinates against the mannequin's landmarks. Mannequin pixels
  are never touched; only the overlay positions change.

All AI features **degrade gracefully** when AI is disabled — the
search falls back to LIKE, the auto-tag button shows a clear
disabled message, layout falls back to slot defaults from the
landmarks (or the SVG silhouette defaults when no landmarks exist
yet).

### Settings
- **Your mannequin** — upload, regenerate, recalibrate fit, reset.
- **Home city** — cookie-based; used for the weather card and the
  AI outfit prompt. Open-Meteo, no API key required.
- **Backup** — one-click JSON export of items, outfits, wishlist,
  brands, collections.
- Quick links to Needs Review, Closet quality, Quick add, Import
  from library, Collections, and Admin.

### Admin / Maintenance (`/admin`)
- **Counts** — items, outfits, wishlist, brands, collections,
  drafts, needs-review.
- **Photo storage** — total files, total bytes, orphan cleanup
  (delete photos no item references).
- **Clean up photos** — walks every item that's still using its raw
  photo and replaces it with a bg-removed cutout, in-browser, in
  bulk.
- **Background removal diagnostics** — end-to-end probe of the
  imgly model load path with a generated test image.
- **AI provider status** — shows the configured AI provider and
  whether it's ready.

### Polish & accessibility
- Custom blush / cream / sage palette; serif display font; rounded
  corners.
- Mobile bottom navigation highlights the active tab; 44px touch
  targets.
- `ConfirmDialog` replaces native `confirm()` everywhere
  (delete item / outfit / wish / collection, mannequin reset,
  orphan cleanup, etc.).
- Toast notifications on every save and delete.
- `focus-visible` rings on buttons, inputs, chips for keyboard
  navigation.
- Haptic feedback (Android; iOS Safari currently ignores
  `navigator.vibrate`, no-op).
- Mother's Day banner is **date-gated**: dismiss × is hidden until
  the day after Mother's Day so the recipient can't lose the note.

## Stack

- **Next.js 14** (App Router, TypeScript, server components)
- **Tailwind CSS** with a custom blush/cream/sage theme
- **Prisma + SQLite** (single file at `data/wardrobe.db`)
- **Auth.js v5** (credentials provider, JWT sessions, bcrypt)
- **`@imgly/background-removal`** loaded on demand from `public/vendor/`,
  runs in the browser
- **`heic2any`** for HEIC → JPEG conversion in the browser
- **Open-Meteo** for free, key-less weather + geocoding
- **Gemini** (Google AI) for tagging, notes, outfit picks, search
  parsing, image generation (mannequin), per-item fit
- File storage under `data/uploads/<userId>/`

## AI configuration

All AI features are optional. Set `AI_PROVIDER=gemini` and a
`GEMINI_API_KEY` in `.env` to enable them.

```
AI_PROVIDER="gemini"
GEMINI_API_KEY="..."
GEMINI_MODEL="gemini-2.5-flash"               # optional, text/vision
GEMINI_IMAGE_MODEL="..."                       # optional, pins the
                                                # image-output model
                                                # for the mannequin
                                                # generator (defaults
                                                # to a fallback chain)
```

The mannequin generator and per-item fit caller both walk a fallback
chain of model names and self-discover via Google's `ListModels`
endpoint when nothing matches — survives Google's preview-model
renames without code changes.

## Scripts

- `npm run dev` — Next dev server on `0.0.0.0:3000`
- `npm run build` / `npm run start` — production build + serve
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next ESLint
- `npm run db:migrate` — apply migrations (use `prisma migrate deploy` in prod)
- `npm run db:studio` — open Prisma Studio
- `npm run seed` — upsert users from env
- `npm run fetch-vendor` — re-download imgly model + heic2any bundle
- `npm run deploy:update` — `git pull && install && migrate && build && systemctl restart wardrobe`

## Environment

```
DATABASE_URL="file:../data/wardrobe.db"      # required
AUTH_SECRET="..."                            # required, 32+ random bytes
HER_NAME / HER_EMAIL / HER_PASSWORD          # required for seed
HIS_NAME / HIS_EMAIL / HIS_PASSWORD          # required for seed

# Optional AI
AI_PROVIDER="gemini"
GEMINI_API_KEY="..."
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_IMAGE_MODEL="..."

# Optional behind-HTTPS toggle
USE_SECURE_COOKIES="true"
```

## Notes

- Background removal (`@imgly/background-removal`) and HEIC conversion
  (`heic2any`) are self-hosted out of `public/vendor/`. `npm install` runs
  `scripts/fetch-vendor.mjs` which copies the JS bundles in from
  `node_modules` and downloads imgly's ~50 MB model from `staticimgly.com`.
  After that one-time download, both work fully offline. To retry the
  fetch later: `npm run fetch-vendor`.
- Both seeded accounts share the same closet and outfits.
- Photos and the SQLite DB live under `data/` and are gitignored.
- Per-user files under `data/uploads/<userId>/`:
  - `mannequin.png` + `mannequin-source.<ext>` + `mannequin-landmarks.json`
  - `todays-outfit.json` (auto-expires by date)
  - `<itemId>-orig.<ext>` / `<itemId>-bg-<tag>.png` / `<itemId>-label-<tag>.<ext>` — item photos
- The notification subsystem persists in the DB but the bell UI is
  hidden in the header — easy to re-enable by re-mounting
  `<NotificationBell />` in `app/(app)/layout.tsx`.
