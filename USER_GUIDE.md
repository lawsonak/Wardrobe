# User Guide

A complete walkthrough of every feature in your Wardrobe app, what it does, and how to get the most out of it. Built for two users sharing one box; everything you do is private to your profile, including activity history, photos, and AI prompts.

---

## Table of contents

1. [The basics](#the-basics)
2. [Closet — your main wardrobe](#closet--your-main-wardrobe)
3. [Adding items](#adding-items)
4. [Item detail + editing](#item-detail--editing)
5. [Photos: hero, labels, angles, cutouts](#photos-hero-labels-angles-cutouts)
6. [Merging items](#merging-items)
7. [🌶 Spicy — the separate private closet](#-spicy--the-separate-private-closet)
8. [💄 Beauty + Looks](#-beauty--looks)
9. [Outfits + AI try-on](#outfits--ai-try-on)
10. [Collections — trips and themed sets](#collections--trips-and-themed-sets)
11. [Wishlist](#wishlist)
12. [Brands](#brands)
13. [Dashboard cards](#dashboard-cards)
14. [AI features at a glance](#ai-features-at-a-glance)
15. [Settings](#settings)
16. [Maintenance: Optimize Photos](#maintenance-optimize-photos)
17. [Activity log + clearing it](#activity-log--clearing-it)
18. [Notifications](#notifications)
19. [Mobile bottom nav + desktop nav](#mobile-bottom-nav--desktop-nav)
20. [Keyboard, gestures, accessibility](#keyboard-gestures-accessibility)
21. [Troubleshooting](#troubleshooting)

---

## The basics

The app has two users sharing one server. Everything you create — items, outfits, collections, wishlist, activity log — is **strictly private to your profile**. Your partner cannot see, search, AI-pick from, or accidentally surface any of your stuff. A separate audit confirmed the `/api/uploads` endpoint blocks cross-user image fetches and every database read is owner-scoped.

The dashboard (the home tab) gives you:

- **Today's outfit** — an AI-picked daily look from your closet, weather-aware if you've set a home city.
- **Today's suggestion** — an AI-picked product to consider buying. Optional category + free-text constraint to narrow it.
- **Recent items** — eight newest pieces.
- **On this day** — items added on the same calendar day in past years.
- **Onboarding checklist** — quick wins to get the closet bootstrapped.

The five top-level sections, all reachable from the bottom nav (mobile) or top nav (desktop):

| Tab | What it is |
|---|---|
| **Home** | Dashboard — daily outfit, suggestion, recents |
| **Closet** | Your full clothing library |
| **Add** | Quick add a single item |
| **Outfits** | Saved outfit looks |
| **Collections** | Trips and themed sets |

---

## Closet — your main wardrobe

`/wardrobe`

The closet is a tile gallery sorted by **date added, newest first**. Tap a tile to open the item's detail page.

### Layout

- **3 cols** on phones (4 / 5 / 6 on bigger screens).
- Each tile shows the bg-removed cutout when present; otherwise the original photo.
- A small ★ stays visible on every favorite tile.
- The 🌶 icon at the top opens the [Spicy](#-spicy--the-separate-private-closet) closet. The main closet has zero references to spicy items — they don't appear here at all.

### Search

The search bar at the top is **AI-driven**. Type natural language ("white linen blazers I haven't worn", "summer dresses in pink"). The AI parses your query into structured filters (category, color, season, etc.) and applies them. If AI is off the page falls back to plain text matching across `subType`, `brand`, `color`, and `notes`.

### Quick-filter chips

Sit right under the search bar:

- **★ Favorites** — only items you've starred.
- **✨ Pending AI** — items with AI tag suggestions staged from a bulk re-tag run that you haven't reviewed yet. Hidden when there are none.
- **Sort** — Newest first (default), Oldest first, Category, Color, Brand, or Favorites first. Picking anything other than Newest keeps the choice in the URL so it survives navigation.

### "More filters" expander

Tucked-away dropdown form for keyboard-only users. Pick a category from the dropdown or check **Favorites**, then **Apply**. The closet has no spicy toggle here — that's by design.

### Active-filter strip

When any filter is on, a row of chips appears showing what's filtered, each with × to remove.

### Loose-match fallback

When your filter combo returns zero matches, the closet automatically retries with one filter dropped (drop order: color → activity → season → q), then shows a banner like "No exact matches for pink — showing close-enough results without the color filter." Stops you from staring at an empty closet.

### Select Multiple — bulk actions

Tap **Select multiple** in the chip row. The whole gallery turns into a multi-pick grid; tap tiles to toggle. A sticky action bar appears at the bottom with:

- **✨ Re-run AI tagging** — rewrites empty fields and stages suggestions for fields you've set; you review them per-item later via the **✨ Pending AI** chip.
- **✂️ Remove backgrounds** — re-runs server-side bg cutout on the selected items in the background. You'll get a notification when it's done; safe to close the tab.
- **⤵ Merge** — appears when 2+ items are selected. Opens a small "Pick the keeper" sheet — tap one tile and the rest fold into it. See [Merging items](#merging-items).

You can also **Select all** or **Clear** from the chip row while in select mode.

---

## Adding items

There are three intake paths.

### Single-item add

`/wardrobe/new` — the **+ Add** button on the closet header.

- Take a photo or pick one from the library. **HEIC supported** (iPhone format auto-converts to JPEG).
- The browser runs background removal during upload — typically 5–15s. You'll see a progress bar. If it fails, the original still saves.
- Optional: drop in a **label/tag photo** (the inside care/brand tag) — the AI tagger uses this as ground truth for fields like material and care instructions.
- Pick a category, sub-type, color, brand, size, seasons, activities. All optional except category.
- ✨ Sparkle buttons:
  - **Auto-tag** — AI reads the photo (and label if present) and fills in everything it can confidently determine.
  - **Look up online** — AI searches for the product based on brand/sub-type/color and pulls material, care, description, and retail price.
  - **Use link** — paste a product URL; the server fetches metadata (Open Graph, JSON-LD), then AI maps it to your closet's category/color vocabulary.
- Mark as favorite or 🌶 **Spicy** (sends it to the Spicy page, hidden from the main closet).

### Quick add — burst capture

`/wardrobe/new?batch=1` — same form, but after each save the camera reopens for the next piece. Good for working through a stack.

### Bulk import

`/wardrobe/bulk` — for importing a library of photos in one go. Three-step wizard:

**Step 1: Choose**
- Pick photos (multiple).
- Default category — pick one, or leave at **✨ Auto** to let AI assign per-photo.
- Items always land as **Active** — no review queue.
- Toggles: **AI auto-tag** (with a confidence threshold), **Remove backgrounds** (server-side, runs after upload), **🌶 Mark all as Spicy**, **💄 Mark all as Beauty**.

**Step 2: Process**
- Uploads run sequentially (one POST per file) so a single bad photo doesn't break the batch.
- Each photo shows a tile with state: queued → processing-heic → uploading → uploaded / error.
- AI tagging fires server-side as a background job; bg removal then runs on the uploaded items.
- A sticky **Cancel — finish with what's saved** button bails out. Already-uploaded photos are durable on the server — closing the tab does nothing harmful.
- **Retry failed** appears once any photo has errored and the queue is settled.

**Step 3: Done**
- Headline: "✓ N items saved" (or "Nothing saved this round").
- If any failed, a **What failed** card lists each failure with thumbnail + filename + a friendly description. Common patterns get an actionable hint:
  - HEIC conversion → "iPhone Settings → Camera → Formats → Most Compatible saves photos as JPEG."
  - 413 / payload too large → "Photo is too large for the server, try shrinking."
  - Missing category → "Pick a real category instead of ✨ Auto, or turn on AI tagging."
  - Sharp / VipsJpeg → "Image data is corrupt or in an unsupported format."
  - 500 / network → "Server hiccup — tap retry."
- **↻ Retry N failed** button re-runs the upload phase only on the failed rows. Successful uploads stay on the server. Click as many times as you need.
- **Open Closet** / **Upload another batch** buttons round it out.

### ✂ Split a multi-item photo

`/wardrobe/new/split` (reached via the **✂ Split a multi-item photo** option on the Add page, alongside Quick add and Bulk import)

For when one photo has multiple items in it — a stack of clothing on a bed, a shopping-bag dump, a makeup-drawer shot, or a vanity shelf. AI detects each piece and lets you save them all in one pass.

**Flow:**

1. Tap **📷 Take photo** or **🖼️ Choose from library**. One photo, multiple items in frame.
2. AI runs detection (~5-15 seconds depending on photo size). You'll see a per-item card for each detection with a cropped thumbnail.
3. Each card shows category, subtype, color, brand, plus 💄 Beauty / 🌶 Spicy toggles. Beauty cards also expose the shade name, swatch hex, and finish. Confidence percentage shows in the corner — low-confidence detections are usually false positives you'll want to deselect.
4. Untick any false positives. Edit any field that came back wrong.
5. **Save N items to closet** crops the original per box, creates each Item, and kicks off background bg-removal cutouts.

**Works best on:**
- Flat-lays — pieces laid out side-by-side on a bed or table
- Cosmetic shelf / drawer photos
- Shopping-bag dumps after returning home

**Works poorly on:**
- Outfit-on-body shots — the model is explicitly told to skip these because per-garment crops on a body end up mostly skin. Use the regular **+ Add** page for individual on-body shots.

---

## Item detail + editing

`/wardrobe/[id]`

Opens read-only by default. Top of the page shows a swipeable photo carousel (hero + extra angles), title pills (subType, category, status, color), favorite heart, and a **✨ Try on with AI** button.

### Try on with AI

One tap. The server asks Gemini to build a complete outfit anchored on this item, force-includes the anchor if the AI didn't pick it, saves the outfit, and navigates you to `/outfits/{id}/style`. The mannequin try-on renders automatically on that page. End-to-end one click → see your item worn as part of a full look.

### Navigation

- **← Back** to the closet you came from. If you opened a Spicy item, this returns you to the Spicy closet, not the main one.
- **Prev / Next** chevrons + horizontal swipe gestures jump between items in closet order, scoped to the same bucket (Spicy items navigate among Spicy items, normal among normal).
- **✎ Edit** in the header opens edit mode (`?edit=1`).

### Body of the page

- **Details card** — brand, size, color, fit fields (per-category: bust, waist, inseam, sleeve, etc.), fit notes.
- **Tag chips** — seasons + activities.
- **Notes**.
- **In outfits** — every outfit this item appears in, with thumbnails of the whole outfit.
- **Recent wears** — date list of when you've worn it.
- **Tucked-away Delete** at the bottom.

### Edit mode

Toggle by tapping **✎ Edit** or appending `?edit=1`.

You get the full edit form: category, sub-type (with a chip picker), color (with the 34-color swatches), brand (autocomplete from your existing brands), size, fit details, seasons, activities, notes, plus the **Favorite** / **🌶 Spicy** / **💄 Beauty** chip toggles and a status dropdown (Active / Draft).

✨ AI assists in edit mode:
- **Auto-tag** — re-runs the tagger on the existing photos.
- **Look up online** — same as on the add form.
- **Use link** — paste a URL.

### Hero photo controls

In edit mode, under the hero:

- **📸 Replace photo** — swap the main photo entirely.
- **✂️ Re-run bg removal** — re-run the cutout on the existing photo without re-uploading.
- **Use original** — drop the cutout, keep the original.
- **↻ Adjust cutout aggressiveness** — see [Photos](#photos-hero-labels-angles-cutouts).

---

## Photos: hero, labels, angles, cutouts

Each item has up to four image columns and any number of supplementary photos.

### The four image-path columns

| Column | Purpose |
|---|---|
| `imagePath` | Display variant (≤ 1024 px, JPEG) |
| `imageOriginalPath` | Full-resolution original (with EXIF baked in) — used by lightbox tap-to-zoom |
| `imageBgRemovedPath` | Display-tier cutout (≤ 1024 px PNG with alpha) |
| `imageBgRemovedOriginalPath` | High-resolution cutout for lightbox zoom |

Same shape on `ItemPhoto` (extra angles + label close-ups), minus `imageBgRemovedOriginalPath`.

### Labels / tags strip

Below the hero in edit mode. Tap **+ Add label photo** to upload one or more close-ups of the inside care/brand tag. The AI tagger's auto-fill workflow reads the oldest label first when you click ✨ Auto-tag.

### Other angles strip

Same shape, for additional full-body shots from different angles (front / back / detail of the buttons / etc.). Renders in the read-only carousel at the top of the detail page so you can swipe through them.

### Re-role a photo (in edit mode)

Tap any label, angle, or pending thumbnail in edit mode and a sheet opens with:

- **★ Make this the main photo** — swaps roles with the current hero. A follow-up asks whether the old main should become a label or an angle (so you can use this to "demote main → label" if a tag photo got uploaded as the hero by accident).
- **🏷 Mark as label** — moves the photo into the labels strip (hidden when it's already a label).
- **📸 Mark as angle** — moves it into the angles strip (hidden when it's already an angle).
- **Delete photo** — destructive; the image file is removed from disk.

The promoted photo keeps its bg-removed cutout. The demoted (old main) loses its hi-res lightbox cutout — that was paired with the hero, not the photo itself — but everyday viewing falls back to the display cutout cleanly.

### Adjust cutout aggressiveness (↻ slider)

The bg-removal model produces decent cutouts but sometimes trims too much off the edges or leaves background bleed. Every photo with a cutout has an **↻ Adjust cutout** control. Open it and slide along five levels:

| Level | Effect |
|---|---|
| **0 Most loose** | Alpha boosted; fuzzy edges remain (background may bleed in) |
| **1 Loose** | Slight boost |
| **2 Normal** | Default model output (no post-process) |
| **3 Tight** | Slight shrink |
| **4 Most tight** | Alpha shrunk hard; sharp clipped edges (garment may lose detail) |

Tap **Apply** — the server re-runs the model and applies the chosen alpha curve. The new cutout replaces the old one. The hi-res cutout (used for lightbox zoom) is left alone.

The slider lives:
- **Inline** under the hero photo editor in edit mode.
- **As a chip** ("↻ Adjust cutout") on every label and angle thumbnail in edit mode, opening a small sheet.

### Pending photos (after a merge)

When you [merge items](#merging-items), photos folded onto the keeper land as `kind="pending"`. The item edit page renders a **Review N merged photos** panel above the labels/angles strips with three buttons per row:

- **🏷 Tag / label** — promote to a label/tag photo.
- **📸 Angle** — promote to an extra angle photo.
- **Delete** — remove the photo.

Each tap moves the photo into the right strip and removes it from the review panel.

---

## Merging items

Bulk-uploading a stack of clothing-tag photos sometimes lands each one as its own standalone item. Merging consolidates them onto the actual garments.

### From the closet (multi-select)

1. Closet → **Select multiple** chip.
2. Tap two or more items to select them.
3. Tap **⤵ Merge** in the action bar (only appears with ≥ 2 selected).
4. A "Pick the keeper" sheet appears with thumbnails of all selected items.
5. Tap one — that item becomes the keeper. The rest fold into it: their photos become pending photos on the keeper, and the source items are deleted.

### From the item edit page

The **Merge in other items** section on the item edit page lets you fold *other* items into *this* one (single-target picker). Same end result.

### What gets folded

- Each source's main photo → becomes a new `ItemPhoto` on the keeper with `kind="pending"`. You triage from the [pending review](#pending-photos-after-a-merge) panel.
- Each source's existing extra angles / labels → moved across, keeping their `kind`.
- Each source's full-resolution cutout file → unlinked (no home on the new row).
- Source items are deleted; their outfit/collection memberships are removed.

---

## 🌶 Spicy — the separate private closet

`/wardrobe/backroom` (reached via the 🌶 icon in the closet header)

Spicy is a fully separate closet for items you want kept off the main view: lingerie, costumes, intimates, etc. The main closet has **zero references** to spicy items — no toggle, no filter, no chip. Server-side, every user-visible read of `Item` hard-excludes `isBackroom = true`.

### What surfaces hide Spicy items

- The main closet (`/wardrobe`).
- The dashboard's recent items + "On this day".
- The outfit builder's picker (toggle to opt-in).
- The collection picker (toggle to opt-in).
- Today's outfit AI pick.
- Today's product suggestion.
- The bulk auto-tag legacy queue.
- Wishlist "you might already own this" warnings.
- Quality page.

### Where you can opt-in to see Spicy items

- **Outfits list / builder / edit** — small 🌶 chip toggle. With the toggle on, spicy items appear in the picker and the AI Surprise call considers them.
- **Collections list / wizard / detail** — same chip pattern.
- **AI Build-Outfit** form — request body accepts `includeBackroom: true`.
- **AI Packing-List** form — same.

The toggle is sticky to the URL (`?backroom=1`), so the chip state survives navigation.

### The Spicy page itself

Reached only via the 🌶 icon in the main closet header. Has its own:

- **Search bar** — text search across subType / brand / color / notes.
- **Filter chips** — ★ Favorites + 10 spicy categories (see below).
- **Bookmarkable URL state** — `?q=...&category=...&fav=1`.

### The 10 spicy categories

These are a separate vocabulary that only spicy items use; the main closet never references them.

`Lingerie` · `Lingerie Set` · `Bodysuit` · `Teddy` · `Robe` · `Sleepwear` · `Costume` · `Stockings` · `Toys` · `Other`

When you mark an item as Spicy on the new-item or edit form, the category dropdown swaps to this list. (Existing spicy items that were tagged with a main-vocab category before SPICY_CATEGORIES existed get a "(legacy)" option in the dropdown so the value stays selectable.)

### Adding a Spicy item

- From the Spicy page → **+ Add** preselects the Spicy flag.
- From the new-item form → check 🌶 Spicy.
- From bulk upload → check **🌶 Mark all** to send every item in the batch.

### Browsing inside Spicy

Tapping a tile takes you to the item detail page. The "← Back" link returns you to the Spicy closet (not the main closet). The prev/next swipe nav stays inside the Spicy bucket.

---

## 💄 Beauty + Looks

`/wardrobe/beauty` (reached via the 💄 icon in the closet header)

Beauty is a parallel mini-closet for cosmetics, skincare, tools, and fragrance. Mirrors the Spicy pattern: hidden from the main `/wardrobe` view, hard-excluded from the closet-summary AI helpers, and only reachable via the 💄 icon. The main closet shows zero beauty items.

### What surfaces hide Beauty items

- The main closet (`/wardrobe`).
- The dashboard's recent items + "On this day".
- The outfit builder's piece picker (beauty isn't a "piece" — see below).
- The collection picker.
- Today's outfit AI pick (composes clothing only).
- Today's product suggestion.
- The bulk auto-tag legacy queue.
- The wishlist "you might already own this" warning, **except** when the wish itself is in a beauty category — then it flips and searches your beauty stash.

### Categories

A separate vocabulary, grouped on the Beauty page:

- **Lips** — Lipstick, Lip Liner, Lip Gloss, Lip Balm
- **Eyes** — Mascara, Eyeliner, Eyeshadow, Eyebrow
- **Face** — Foundation, Concealer, Powder, Blush, Bronzer, Highlighter
- **Skin** — Cleanser, Moisturizer, Serum, Mask, Sunscreen, Toner
- **Tools** — Brushes, Sponges, Curlers, Tweezers
- **Fragrance** — Perfume, Body Spray, Body Oil
- **Other**

### Per-product fields

Beauty items reuse the regular Item table, but the form swaps a few fields:

- **Shade name** — free text, e.g. "Ruby Woo", "311 Adobe". Optional.
- **Shade swatch (hex)** — `#rrggbb` color approximating the visible product, NOT the packaging tube. Drives the small color dot on each tile.
- **Finish** — datalist of matte / satin / gloss / cream / shimmer / metallic / sheer / dewy / natural — but accepts free text.
- **No size, no fit notes, no seasons/activities** — those don't apply.

### Adding a beauty item

- From the Beauty page → **+ Add** preselects the 💄 flag.
- From the new-item form → check 💄 Beauty (swaps the category dropdown and reveals the shade row).
- From bulk upload → check **💄 Mark all** to send every item in the batch to Beauty.
- **Barcode scan** — only surfaced in beauty mode. Camera-based scanner (with manual UPC fallback if the BarcodeDetector API is unavailable). Pipeline: Open Beauty Facts → Gemini grounded search fallback. Pre-fills name, brand, shade name/hex when available.

### ✨ AI for beauty items

The same Auto-tag button you already know works on cosmetic photos. The tagger now:

- Picks a beauty category instead of forcing a clothing one when the photo is clearly a cosmetic.
- Sets the 💄 flag.
- Extracts the **shade name** from the packaging (numbers count: "311 Adobe").
- Estimates the **shade swatch** as a hex from the visible product, not the tube.
- Reads the **finish** from packaging text ("matte" / "satin" / "gloss" / etc.).
- Leaves clothing-only fields (seasons, activities, material) blank.

Same review-and-accept UI on the edit page: empty fields are pre-checked, conflicts default to unchecked, you opt-in per row.

The "Look up online" panel (brand search + paste-a-URL) also flips to a beauty-aware prompt when the current item is in beauty mode, asking for shadeName / shadeHex / finish / description / price instead of material / care.

### Looks

`/looks`

Saved makeup combinations, e.g. "Sunday brunch face" — a Look bundles 1–15 beauty items into named slots (Foundation, Concealer, Blush, Eyeshadow, Liner, Mascara, Lip, etc.). Looks are reachable only from the 💄 Beauty page header.

- **Builder** — `/looks/new` and `/looks/[id]`. 15-slot grid with a picker sheet per slot. Tap a slot → pick from your beauty inventory → save.
- **List page** — 2×2 collage card per Look, showing up to 4 of its items. Each card has a shade dot for at-a-glance color sense.
- **Pairing a Look to an outfit** — in the Outfit Builder, a 💄 chip lets you attach a saved Look to an outfit. The card on the Outfits page shows the 💄 chip on outfits that carry a paired routine. The pairing is a soft link; deleting the Look unlinks the outfits without deleting them.

### Looks vs. Outfits — interaction rules

- An outfit can be paired with at most one Look.
- A Look can be paired with many outfits (one-to-many).
- An outfit paired with a Look is **not** itself "beauty content" — it still surfaces in the main closet AI flows. Only the items table's `isBeauty` flag decides hiding.
- Deleting a beauty item silently removes it from any Look slots that reference it.

---

## Outfits + AI try-on

`/outfits`

Saved outfit looks. Each card shows the mannequin try-on render when one exists, otherwise a thumbnail collage of the items.

### Filters

- Activity dropdown (8 enum values).
- Season dropdown (4 values).
- ★ Favorites checkbox.
- 🌶 Spicy chip toggle (mixes in outfits that contain spicy items).

### Outfit Builder

`/outfits/builder`

Slot-based picker for the 7 outfit slots: **top, bottom, dress, outerwear, shoes, accessory, bag**.

- Pick an item per slot.
- Multi-select on tops, bottoms, outerwear, shoes, accessories, bags so you can layer (underwear + pants, etc.).
- Activity + season dropdowns at the top inform the AI prompt.
- ★ **Favorites only** filter.
- 🌶 Spicy chip toggles spicy-item visibility in the picker.

✨ AI buttons:
- **Surprise me** — picks at random from the full pool (respects filters).
- **AI Build me an outfit** — POSTs a free-text occasion ("Sunday brunch", "rooftop wedding") to Gemini, which picks items from your closet that fit. The result lands in the slot map; you can edit before saving.
- **Wearing today** checkbox — at save, bumps the wear stamp on every picked piece.

### Edit an existing outfit

`/outfits/[id]/edit` — same builder, pre-populated. The Spicy chip toggle is in the header; items already in the outfit always render in the picker even when the toggle is off (so you can de-select them).

### Style canvas + try-on

`/outfits/[id]/style`

The outfit's "wearing it" view. Two modes:

1. **AI try-on (default)** — Gemini Flash Image composites the items onto your personal mannequin. The render is cached against a hash of mannequin id + item ids + file mtimes + prompt version, so it doesn't re-render unless something changed.
2. **Manual layout** — drag, resize, rotate each piece on top of the mannequin SVG. Auto-saves.

Auto-fires the try-on render on first visit when the outfit doesn't have a fresh one. Subsequent visits reuse the cached PNG.

### One-click try-on from item view

From any item's detail page, tap **✨ Try on with AI**. The app builds an outfit anchored on that item via Gemini, saves it, and lands you on the style canvas where the mannequin composite renders automatically.

---

## Collections — trips and themed sets

`/collections`

Group pieces around a trip ("Tokyo May 2026") or a theme ("Winter date nights"). Same item can belong to many collections.

### Two kinds

- **Trip** — destination, start date, end date, activities. Drives the AI **Packing List** + **Shop for this trip** features.
- **General** — occasion, season, free-form notes.

### Wizard (`/collections/new`)

Four steps:

1. **Basics** — name, kind, destination + dates (trip) or occasion + season (general), activities (free-form chips).
2. **Quantities** — per-category target counts, computed by `lib/packingTargets.ts`.
3. **Pick items** — filtered grid of your closet. Same picker as the outfit builder (ItemPicker).
4. **Review** — sticky bottom bar to save, or jump back to any step.

🌶 Spicy chip toggles spicy items in the picker (handy for romantic getaway packing lists).

### Editor (`/collections/[id]`)

After save, the editor lets you tweak everything in place. Three AI features sit here:

- **✨ Re-build packing list** — Gemini reads the trip metadata + your closet snapshot + weather forecast + per-category targets, returns an optimized packing list. Honors the Spicy chip if it's on.
- **✨ Suggest activities** — propose 4–8 activities based on destination + dates. Useful for a quick "what should I plan?" pass.
- **✨ Shop for this trip** — Two-stage AI pipeline:
  1. Gemini reads the collection metadata + closet summary + forecast + targets and returns 3–12 product **specs** (search query, category, color, brand hint, price tier, reasoning), tuned by a 0–100 closet-awareness slider.
  2. For each spec, the app picks the best-fit retailers from a hardcoded curated list, then emits a `ShopIdea` card with retailer search-page links.

  Each link is a Google site-search (`google.com/search?q=site:madewell.com+linen+blazer`) — robust against retailers redesigning their native search URLs.

---

## Wishlist

`/wishlist`

Items you'd like to add to your closet someday.

### Add a wish

- **Name, brand, link, price, size, color, category, occasion, notes.**
- **Priority** — low / medium / high.
- **Photo** — uploaded photo gets EXIF-rotated + compressed to ≤ 1024 px before save (so iPhone landscape doesn't come out sideways).
- **Fills a gap** + **Gift idea** flags.

### ✨ AI lookup

Paste a product URL, or type a description ("white linen blazer Madewell"), and the wishlist form pre-fills:

- For a URL, the server fetches the page first (no AI), parses Open Graph + JSON-LD `Product` schema. Most retailers (Madewell, J.Crew, Nordstrom, Zara) return reliable data this way without grounded-search hallucinations.
- Gemini is only called afterward to classify the extracted text into your closet's category + color vocabulary.
- If the direct fetch fails (Amazon's robot check, Cloudflare challenge), it falls back to Gemini grounded search with the Amazon URL canonicalizer + cross-domain mismatch guard.

### "You might already own this"

When you save a wish with a category + color (or subType / brand), the app surfaces existing closet items that overlap. Soft warning, never blocks the save. Spicy items don't surface here.

### Mark purchased

Purchased wishes move to a separate dimmed list at the bottom.

---

## Brands

`/brands` (or via the brand chip on any item)

Every brand you've ever entered is canonicalized via a normalized `nameKey` (e.g., "J.Crew", "JCREW", "J Crew" all dedupe to one). The brand page shows every item from that brand, plus aggregate stats.

The **Brand quality** widget on the closet's `/wardrobe/quality` page surfaces likely duplicates (e.g. "Madewell" + "Madewell.com") for one-tap merge.

---

## Dashboard cards

The home page (`/`) lays out:

### Today's outfit

Auto-generates once per day (weather-aware when home city is set). The card shows the picked items as a compact strip + the mannequin try-on if rendered. Buttons:

- **✨ Try another** — asks AI for a different pick. Excludes the previous day's items as a hard constraint so you don't get the same look back.
- **👕 Wearing it** — bumps the wear stamp on every picked piece.
- **Open in Builder** — refine the AI's pick manually.

Spicy items are hard-excluded — Today's Outfit never picks intimates.

### Today's suggestion

A single AI-picked product the user might like, hyperlinked to the vendor's product page.

- Renders idle until you tap **✨ Suggest a piece**.
- **Optional inputs** above the button:
  - **Category dropdown** — pick from the 14 main categories or leave at "Any category".
  - **Free-text input** — "white sneakers", "linen blazer", anything specific.
- Tapping the button without filling either input gives an open-ended pick from the AI based on closet patterns (top brands, colors, gaps).
- Tapping with constraints filled gets a product that matches them, while still using the closet snapshot to inform style / color / price tier.
- Saved for the day; reloading the dashboard paints the card instantly.
- **✨ Try another** in the header asks for a different option.

### Recent items

Eight newest pieces, tappable to open detail.

### On this day

Items added on the same calendar day in past years. Surfaces dormant pieces.

### Onboarding checklist

Hidden once you've completed all four:
- Add an item
- Star a favorite
- Build an outfit
- Add a wish

---

## AI features at a glance

Every AI feature has a ✨ sparkle in the UI. When AI is disabled, the feature returns `{ enabled: false }` and surfaces a clear message — nothing crashes.

| Feature | Where | What |
|---|---|---|
| Auto-tag a single item | Item add / edit | Fills empty fields from photo + label. Beauty-aware: extracts shade name, swatch hex, and finish when the photo is a cosmetic. |
| Auto-tag in bulk | Bulk upload, closet Select Multiple | Background batch over many items. Beauty fields ride the same review flow as the clothing ones. |
| ✂ Split multi-item photo | Closet / Beauty / Spicy headers → ✂ Split | One flat-lay photo → AI detects each item, crops, tags, creates N closet entries in one pass. Beauty-aware (shelves, drawers, lipstick lineups). |
| Build outfit from prompt | Outfit Builder | "Sunday brunch" → AI picks items |
| Today's outfit | Dashboard | Daily AI pick + try-on |
| Today's suggestion | Dashboard | Daily product to consider, optionally constrained |
| Try-on from item | Item detail | One-tap AI outfit + try-on render |
| Surprise me | Outfit Builder | Random pick from your closet |
| Re-build packing list | Collection editor | AI packing for a trip |
| Suggest trip activities | Collection editor | 4–8 things to do at the destination |
| Shop for this trip | Collection editor | Two-stage AI → curated retailer searches |
| Natural-language search | Closet search bar | "summer dresses I haven't worn" → filters |
| Look up product online | Item edit, Wishlist | Pull material / care / price / image. On a beauty item, swaps to shade name / hex / finish / price. Wishlist categories cover both vocabularies. |
| Barcode lookup | Beauty add-item | Camera scan or manual UPC → Open Beauty Facts → Gemini fallback. Pre-fills name, brand, shade. |
| Use product link | Item edit, Wishlist | Paste a URL → metadata extraction |
| Style canvas auto-fit | Style canvas | AI places each piece on your mannequin landmarks |
| Mannequin generation | Settings | Photo of you → stylized fashion-illustration |
| Per-photo bg removal | Hero / labels / angles | ONNX model, with 5-step aggressiveness retry |

### Inflight locks

To keep AI cost in check, four endpoints prevent double-tap from spawning two parallel batches: bg-remove-batch, optimize-photos, ai/tag-bulk, mannequin generation. The second tap returns 409 with a "already running" message.

### includeBackroom flag

`AI Build-Outfit` and `AI Packing-List` accept `includeBackroom: true` on the request body. Outfit Builder, Collection Editor, and Collection Wizard all forward the URL chip's state through. Today's Outfit, Today's Suggestion, and the closet summary helper all hard-exclude spicy items unconditionally.

---

## Settings

`/settings`

### Your profile

Sign-out, plus a "Last active" stamp.

### Your mannequin

Upload a photo of yourself; Gemini's image-generation model turns it into a soft watercolor fashion-illustration croquis used as the base for every outfit try-on. **Faceless by design** — we tried both stylized heads and AI-composed cartoon heads; neither held identity well enough to ship.

- **Regenerate** for a different illustration without re-uploading.
- **Reset to default** wipes the source photo + generated illustration; falls back to the global default mannequin in `/public/mannequin/`.

When you regenerate or reset, the mannequin id changes and every outfit's cached try-on is invalidated.

### Home city

Cookie-based; used for the weather card, Today's Outfit prompt, and trip Shop suggestions. Open-Meteo, no API key required.

### Style preferences

Free-text notes ("I prefer minimalist palettes, dislike bright prints"). Threaded into AI build-outfit + style suggestion prompts so the model picks in your taste.

### Activity

Last 50 entries from your activity log (sign-ins, AI calls, writes). Older events drop off automatically after ~90 days.

- **Clear history** — wipes the entire log. After confirming, writes one final "Cleared activity history (N entries)" entry so the action itself is auditable.

### Maintenance

Quick links to:
- **Closet quality** — items missing details, duplicate brands.
- **Quick add** — burst-capture mode.
- **Import from library** — bulk upload.
- **About this app** — this guide.
- **Optimize photos** — see below.
- **Admin** — counts, photo storage, orphan cleanup.

### Backup

One-click JSON export of items, outfits, wishlist, brands, collections.

---

## Maintenance: Optimize Photos

Settings → Maintenance → **Optimize photos**

A background pass that walks your photo storage and fixes three categories of legacy issues:

### Pass 1: Two-tier recovery

Items + extra-angle photos that shipped before the two-tier storage upgrade have `imageOriginalPath = null` and a full-resolution display variant. Optimize re-saves them through the regular two-tier pipeline so display + original both line up: the display variant gets shrunk to ≤ 1024 px / quality 85, the original is preserved at full resolution with EXIF rotation baked in.

### Pass 2: Bg-removed shrink

Background-removed cutouts saved at full source resolution can be the heaviest files in your data dir. Optimize re-encodes oversized PNGs in place to ≤ 1024 px / max compression / alpha preserved. The hi-res cutout (`imageBgRemovedOriginalPath`) is intentionally left alone — that's the lightbox tap-to-zoom variant.

### Pass 3: Label cutout generation

Label / care-tag photos that were uploaded before the per-photo bg-removal pipeline shipped have `imageBgRemovedPath = null`. Optimize runs the bg-removal model on them and writes a fresh cutout. Catches the gap so labels look clean in the carousel.

### How it runs

- Tap **Optimize photos** in Settings → Maintenance.
- The job runs in the background; you can close the tab.
- A notification fires when done with a count breakdown ("Optimized 42 photos, generated 8 label cutouts").
- Inflight-locked per user, so a double-tap returns 409 instead of running twice.

### When to run it

- Once after a major server upgrade.
- Periodically if your data dir feels large (admin Storage page reports total bytes).
- After bulk-uploading a stack of pre-cutout-pipeline photos.

---

## Activity log + clearing it

Every meaningful action you take in the app — sign-ins, AI calls, writes (item/outfit/collection/wishlist create/update/delete), bulk imports, mannequin regenerations, photo optimization — gets logged with a timestamp, kind, and a short summary.

The log is **strictly per-user** — your partner can't see any of it, ever. Older events drop off automatically after about 90 days.

Find it at Settings → **Activity**.

To wipe: **Clear history** button under the entry list. Confirms first (the action can't be undone). After confirming, the route writes one final "Cleared activity history (N entries)" entry so the act itself stays in the log.

---

## Notifications

The bell icon in the header (when mounted) shows the latest 30 in-app notifications. Notifications get written by:

- **Bulk upload** — "N items saved" when an import finishes.
- **Auto-tag in background** — "Auto-tag finished — N items tagged."
- **Bg removal in background** — "Cut out N items."
- **Optimize Photos** — count + label-cutout breakdown.
- **Mannequin generation** — when re-generation completes.
- **Dormancy nudge** — once a week at most, "Haven't worn X in N days."

POSTing to the notifications endpoint validates the `href` field — only same-origin paths and `https://` URLs are stored. `javascript:`, `data:`, `http:`, and protocol-relative (`//foo`) values are dropped silently. The bell can't be turned into a one-tap XSS by anyone writing notifications.

---

## Mobile bottom nav + desktop nav

Mobile bottom nav has 5 tabs: Home / Closet / Add / Outfits / Collections. The active tab gets a blush highlight; touch targets are ≥ 44 px.

Desktop puts the same 5 in a top nav with text labels.

The 🌶 icon for Spicy is intentionally **not** in either nav — it lives only in the closet's header, so it's one tap inside the closet but invisible to a casual glance from the dashboard or another tab.

---

## Keyboard, gestures, accessibility

- **focus-visible rings** on every button, input, chip — keyboard navigation is fully supported.
- **Native confirm dialogs** are replaced by `ConfirmDialog` everywhere (delete item / outfit / wish / collection, mannequin reset, orphan cleanup, etc.) — better mobile UX, more readable copy.
- **Toast notifications** on every save and delete.
- **Haptic feedback** on Android for key actions. iOS Safari ignores `navigator.vibrate` (no-op).
- **Horizontal swipe gestures** on the item detail page to navigate between items in closet order.
- **Sticky bottom action bars** on long forms (Collection wizard, Bulk upload Step 2) so the primary action is always one tap away.
- **HEIC** auto-converts to JPEG in the browser; iPhone screenshots and photos always work.
- **EXIF orientation** is baked into pixels at upload so iPhone landscape shots don't come out sideways.

---

## Troubleshooting

### "Auto-tag is already running for your account"
The inflight lock detected a second tap while a previous batch was still processing. Wait for the notification, then try again.

### Bulk upload says "HTTP 413" / "Payload too large"
The server limits uploads to ~10 MB per photo. iPhone full-resolution JPEGs can exceed this. Either:
- Shrink the photos first (Photos app → share sheet → choose a smaller size).
- Reduce the camera resolution in iOS settings.

### Cutout looks weird after Optimize
Try the **↻ Adjust cutout** slider on that photo to dial it loose or tight.

### Today's outfit picked something I'd never wear
- Tap **✨ Try another** — uses a higher temperature and excludes the previous pick.
- Add **style preferences** in Settings ("avoid neon, prefer monochrome") — they thread into the AI prompt.
- Mark the bad picks as "needs review" or update their tags so the model has cleaner ground truth.

### "Cleared activity history" entry shows up after I clear
That's intentional. The clear action is itself an audit event so you (or a future you) can see when the wipe happened.

### Spicy item showed up in the main closet
This shouldn't happen — every user-visible read hard-excludes `isBackroom = true`. If you see one, it's a bug; check the item's edit page to confirm the 🌶 toggle is on and reach out.

### Login fails after seeding new users
Email lookup is case-sensitive. The seed lowercases env values automatically as of recent updates. If you're on an older deployment, ensure your `HER_EMAIL` / `HIS_EMAIL` env values are lowercase.

### Mannequin try-on looks off
- Open Settings → Your mannequin → **Regenerate** to get a different fashion-illustration.
- Or reset to default and try again.
- Mannequin id changes invalidate every cached try-on automatically.

### Background removal aggressive crop ate my garment
Use the **↻ Adjust cutout** slider on that photo and pick level 0 or 1 (Loose / Most loose).

---

That's everything. If a feature isn't documented here, it's either internal plumbing (see CLAUDE.md for developer-facing detail) or genuinely doesn't exist yet — in which case, ask.
