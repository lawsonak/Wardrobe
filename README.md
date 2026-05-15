# Wardrobe

A self-hosted virtual wardrobe — snap photos of clothing and cosmetics,
let AI tag them, build outfits and makeup Looks, plan trip packing
lists, and try outfits on a personalized mannequin. Single SQLite file,
single Node process, runs on a Proxmox LXC or any small box.

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

### Closet (`/wardrobe`)
- **Dense gallery**, tight spacing, heart only on favorites until hover.
- **Filters** — natural-language AI search ("white blouses I haven't
  worn"), category, color, season, activity, favorites, plus a
  **✨ Pending AI** chip for items with bulk re-tag suggestions
  awaiting review. Active filters show as removable chips.
- **Sort** — Newest first (default), Oldest first, Category, Color,
  Brand, or Favorites first. The choice rides in `?sort=` so it
  survives navigation.
- **Closet quality** screen for finding items missing details and
  duplicate brands.
- The main closet hard-excludes **🌶 Spicy** and **💄 Beauty** items;
  each has its own page reached via the 🌶 / 💄 icons in the header.

### Item detail page (`/wardrobe/[id]`)
- Read-first layout: swipeable hero + angle photo carousel, title
  pills (sub-type, category, draft status if any, 💄 Beauty / 🌶 Spicy
  flags, color, and for cosmetics the shade swatch + finish), favorite
  heart, one-tap **✨ Try on with AI**.
- **Details card** with every field the edit form exposes: category,
  type, brand, size, color, beauty shade (name + swatch + hex) +
  finish, per-category fit fields (waist / inseam / sleeve / etc.),
  fit notes, and Added / Updated dates.
- Tag chips for seasons + activities; notes pane.
- **In outfits** — each row shows up to 4 thumbnails and links into
  the Style canvas.
- **✎ Edit** toggles the full edit form (`?edit=1`). In edit mode,
  tap any label / angle / pending photo to open a sheet that can
  promote it to the main photo (with a follow-up choice of where the
  old main lands), re-role it between label / angle, or delete it.
  Add multiple label and angle photos at once.
- **Prev / next chevrons** + horizontal swipe jump between items in
  closet order, scoped to the bucket you're browsing.
- Tucked-away **Delete this item** at the bottom.

### Adding items
- **Add item** (`/wardrobe/new`) — single piece; take a photo or pick
  from library. HEIC supported, browser-side background removal,
  multiple label + angle photos in one go. Forwards `?beauty=1` /
  `?backroom=1` so adds from those pages land in the right bucket.
- **Quick add** (`/wardrobe/new?batch=1`) — snap, save, camera
  reopens for the next piece.
- **Import from library / bulk** (`/wardrobe/bulk`) — pick a stack
  of photos; uploads run a few at a time, AI auto-tag + server-side
  background removal fire in the background, a notification lands
  when done. Failed photos can be retried (the grid narrows to just
  the retried ones). Default category is **✨ Let AI decide**.
- **✂ Split a multi-item photo** (`/wardrobe/new/split`) — one photo
  of several items laid out together; AI detects each one, you
  review/deselect the detections, and they're cropped and saved as
  separate items in one pass. Works for clothing **and** cosmetics
  (a shelf / drawer / lipstick lineup). Best on flat-lays; not
  outfit-on-body shots.

### 💄 Beauty (`/wardrobe/beauty`)
- A parallel mini-closet for cosmetics, skincare, tools, and
  fragrance — hidden from the main closet and AI outfit prompts.
- Beauty-specific vocabulary grouped Lips / Eyes / Face / Skincare /
  Tools / Fragrance, plus shade name, shade swatch (hex → a color
  dot on the tile), and finish.
- **Barcode scan** when adding a beauty item — camera scanner with a
  manual UPC fallback; looks the product up via Open Beauty Facts,
  falling back to Gemini.
- Beauty-aware AI: Auto-tag, notes, and "Look up online" all swap to
  cosmetic fields (shade / finish) when the item is beauty.

### Looks (`/looks`)
- The makeup equivalent of an outfit: bundle beauty products into
  named slots (Foundation, Concealer, Blush, Eyeshadow, Liner,
  Mascara, Lip, …). Reached from the 💄 Beauty page.
- An outfit can be **paired with a Look** in the Outfit Builder; the
  outfit card shows a 💄 chip and the Style page renders the paired
  routine alongside the try-on.

### 🌶 Spicy (`/wardrobe/backroom`)
- A fully separate closet for intimate / costume / private pieces,
  with its own category vocabulary. Hard-excluded from the main
  closet, outfit builder, collection picker, and every AI prompt.
- Outfit / Collection editors expose a 🌶 toggle so a piece that's
  already in a saved outfit can still be seen there.

### Outfits
- **Outfit Builder** with slot-based pickers (top, bottom, dress,
  outerwear, shoes, accessory, bag); multi-select where layering
  makes sense.
- **Surprise me** for a random outfit, **AI Build me an outfit** for
  a free-text occasion ("Sunday brunch").
- Optional **Look pairing** (💄) attaches a saved makeup routine.
- **AI try-on** (`/outfits/[id]/style`) composites the outfit onto
  your personal mannequin via Gemini's image model and caches the
  render. A manual **Style canvas** (drag / resize / rotate each
  piece) is the fallback and is always available.
- **Saved outfits** gallery shows each outfit's try-on render (or an
  item collage until one exists).

### Mannequin
- Upload a photo of yourself in **Settings → Your mannequin**;
  Gemini's image model turns it into a neutral, faceless
  fashion-illustration dress-form matching your body type.
- **Regenerate** for a different illustration on the saved source;
  **Reset to default** wipes back to the global default figure.
- Try-on renders prefer your personal mannequin and fall back to the
  global default.

### Dashboard (`/`)
- **Today's outfit** — daily AI pick from your closet, weather-aware
  when a home city is set, persisted until midnight or **Try another**.
- **Today's suggestion** — a daily real product to consider, with an
  optional category filter (clothing **or** any beauty group) and a
  free-text constraint.
- **Recent items**, **On this day**, and an onboarding checklist.
- Upcoming-trip and wishlist alert cards.

### Collections (`/collections`)
- Group pieces around a trip, season, or theme. A trip collection
  carries destination + dates and drives AI packing.
- Same item can belong to many collections.
- **✨ Re-build packing list**, **✨ Suggest activities**, and
  **✨ Shop for this trip** (two-stage AI → curated retailer
  search links).
- Picker filters by category, season, activity, favorites, free-text.

### Wishlist (`/wishlist`)
- Add wishes with priority, occasion, link, price, photo, notes,
  "fills a gap" / "gift idea" flags.
- **✨ Auto-fill** — paste a product URL or type "MAC Ruby Woo" /
  "white linen blazer Madewell" and the form pre-fills (clothing or
  beauty). A soft "you might already own this" check surfaces close
  matches from the matching closet without blocking save.
- Mark purchased; purchased items move to a dimmed list.

### AI features
- **Combined Auto-tag** — one tap fills empty fields and writes
  notes from a photo (+ optional label close-up). Beauty-aware:
  extracts shade name, swatch hex, and finish for cosmetics.
- **AI Build me an outfit** — free-text occasion → AI picks items,
  lands you in the Builder pre-filled.
- **AI try-on** — outfit composited onto your mannequin, cached.
- **Today's outfit** / **Today's suggestion** — daily, persisted.
- **Natural-language closet search** — parsed into structured filters.
- **AI bulk-tag on import** — fires after a bulk upload, notifies
  when done.
- **✂ Split** — detect and separate multiple items from one photo.
- **Barcode + product lookup** — Open Beauty Facts / Gemini for
  beauty; grounded product search for clothing.
- **Packing list / activities / shop** for trip collections.

All AI features **degrade gracefully** when AI is disabled — search
falls back to LIKE, AI buttons show a clear disabled message, try-on
falls back to the manual Style canvas.

### Settings
- **Your mannequin** — upload, regenerate, reset.
- **Home city** — cookie-based; weather card + AI outfit prompt.
  Open-Meteo, no API key.
- **Activity log** — per-profile audit feed; clearable.
- **About** — the full in-app user guide.
- **Backup** — one-click JSON export of items, outfits, wishlist,
  brands, and collections.
- Quick links to Closet quality and Admin.

### Admin / Maintenance (`/admin`)
- **Counts** — items, outfits, wishlist, brands, collections, drafts.
- **Photo storage** — total files / bytes, orphan cleanup.
- **Optimize Photos** — server-side pass: two-tier original recovery,
  bg-removed re-encode, and label cutout generation.
- **Background removal diagnostics** and **AI provider status**.

### Polish & accessibility
- Custom blush / cream / sage palette; serif display font.
- Mobile bottom nav highlights the active tab; 44px touch targets;
  `focus-visible` rings throughout.
- `ConfirmDialog` replaces native `confirm()` everywhere.
- **Unsaved-changes guard** — starting a workflow (add / edit / bulk
  / split / outfit / Look / collection / wishlist) and then tapping
  away before saving pops a "you'll lose progress" confirm; closing
  the tab triggers the browser's own version.
- Favorite / 🌶 / 💄 are pill toggle chips, not bare checkboxes.
- Toast notifications on every save and delete; Android haptics
  (iOS Safari `navigator.vibrate` is a no-op).
- Mother's Day banner is **date-gated**: the dismiss × is hidden
  until the day after so the recipient can't lose the note.

## Stack

- **Next.js 14** (App Router, TypeScript, server components)
- **Tailwind CSS** with a custom blush/cream/sage theme
- **Prisma + SQLite** (single file at `data/wardrobe.db`)
- **Auth.js v5** (credentials provider, JWT sessions, bcrypt)
- **`@imgly/background-removal`** in the browser for single-item
  uploads; **`@imgly/background-removal-node`** server-side for the
  bulk / split / optimize passes
- **`heic2any`** for HEIC → JPEG conversion in the browser
- **`sharp`** server-side for crops, EXIF rotation, resizing,
  perceptual hashing
- **Open-Meteo** for free, key-less weather + geocoding
- **Open Beauty Facts** for barcode → cosmetic product lookup
- **Gemini** (Google AI) for tagging, notes, outfit / packing picks,
  search parsing, multi-item detection, mannequin + try-on image
  generation
- File storage under `data/uploads/<userId>/`

## AI configuration

All AI features are optional. Set `AI_PROVIDER=gemini` and a
`GEMINI_API_KEY` in `.env` to enable them.

```
AI_PROVIDER="gemini"
GEMINI_API_KEY="..."
GEMINI_MODEL="gemini-2.0-flash"      # optional — text/vision default
GEMINI_TAG_MODEL="gemini-2.5-pro"    # optional — stronger structured
                                     # tagger (Auto-tag + Split)
GEMINI_IMAGE_MODEL="..."             # optional — pins the image-output
                                     # model for mannequin + try-on
```

The mannequin / try-on image callers walk a fallback chain of model
names and self-discover via Google's `ListModels` endpoint when
nothing matches — survives Google's preview-model renames.

## Scripts

- `npm run dev` — Next dev server on `0.0.0.0:3000`
- `npm run build` / `npm run start` — production build + serve
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next ESLint
- `npm run db:migrate` — apply migrations (use `prisma migrate deploy` in prod)
- `npm run db:studio` — open Prisma Studio
- `npm run seed` — upsert users from env
- `npm run generate:mannequin` — regenerate the global default mannequin
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
GEMINI_MODEL="gemini-2.0-flash"
GEMINI_TAG_MODEL="gemini-2.5-pro"
GEMINI_IMAGE_MODEL="..."

# Optional behind-HTTPS toggle
USE_SECURE_COOKIES="true"
```

## Notes

- **Profiles are fully separate.** The two seeded accounts each have
  their own private closet, outfits, Looks, collections, wishlist,
  and activity log — every database read is owner-scoped and the
  `/api/uploads` endpoint blocks cross-user image fetches.
- Background removal (`@imgly/background-removal`) and HEIC
  conversion (`heic2any`) are self-hosted out of `public/vendor/`.
  `npm install` runs `scripts/fetch-vendor.mjs`, which copies the JS
  bundles from `node_modules` and downloads imgly's model. If the
  model download is blocked the app still works (it uses the public
  CDN at runtime); re-run `npm run fetch-vendor` to retry.
- Photos and the SQLite DB live under `data/` and are gitignored.
- Per-user files under `data/uploads/<userId>/` include the
  mannequin, today's-outfit / suggestion JSON, and per-item display
  / original / bg-removed photo variants plus label + angle photos.
- Barcode scanning needs a secure context — it works over HTTPS or
  `http://localhost`, but not plain HTTP on a LAN. The scanner
  detects this and explains the fix in-app; manual UPC entry always
  works.
- A camera-based barcode scan needs iOS 17+ Safari / Android Chrome
  (the `BarcodeDetector` API). The scanner falls back to manual
  entry elsewhere with a clear explanation.
