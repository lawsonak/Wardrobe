# Wardrobe

A self-hosted virtual wardrobe — snap photos of clothing items from your phone,
tag them, mark favorites, and mix and match outfits by activity and season.

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- Prisma + SQLite (single file at `data/wardrobe.db`)
- Auth.js v5 (credentials, JWT sessions, bcrypt)
- `@imgly/background-removal` (runs entirely in the browser)
- Photos saved to `data/uploads/{userId}/`

## Setup

```bash
npm install
cp .env.example .env       # then edit the values
npx prisma migrate dev     # creates the SQLite DB
npm run seed               # creates the two user accounts
npm run dev                # http://localhost:3000
```

The dev server binds to `0.0.0.0`, so on the same Wi-Fi you can open
`http://<your-laptop-ip>:3000` from a phone. On the phone, "Add to Home
Screen" to get an app-like experience.

## Scripts

- `npm run dev` — Next dev server on `0.0.0.0:3000`
- `npm run build` / `npm run start` — production build + serve
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next ESLint
- `npm run db:migrate` — apply migrations
- `npm run db:studio` — open Prisma Studio
- `npm run seed` — upsert users from env

## Notes

- Both seeded accounts share the same closet and outfits.
- Photos and the SQLite DB live under `data/` and are gitignored.
- The first time you remove a background, the model weights download
  (~50MB) — subsequent removals are fast and entirely offline.
