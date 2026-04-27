# Wardrobe

A self-hosted virtual wardrobe — snap photos of clothing items from your
phone, tag them, mark favorites, and mix and match outfits by activity and
season. Two seeded accounts share a single closet.

## Stack

- Next.js 14 (App Router, TypeScript)
- Tailwind CSS
- Prisma + SQLite (single file at `data/wardrobe.db`)
- Auth.js v5 (credentials, JWT sessions, bcrypt)
- `@imgly/background-removal` loaded on demand from a CDN, runs in the browser
- Photos saved to `data/uploads/<userId>/`

## Local quick start

```bash
npm install
cp .env.example .env       # then edit values
npx prisma migrate deploy  # creates the SQLite DB
npm run seed               # creates the two user accounts
npm run build && npm run start    # http://localhost:3000
```

For development with hot reload, use `npm run dev` instead of build+start.

## Hosting on Proxmox

See [`docs/DEPLOY_PROXMOX.md`](docs/DEPLOY_PROXMOX.md) for a step-by-step
walkthrough — Debian LXC, Node 20, systemd service, and bookmarking on her
phone.

## Scripts

- `npm run dev` — Next dev server on `0.0.0.0:3000`
- `npm run build` / `npm run start` — production build + serve
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next ESLint
- `npm run db:migrate` — apply migrations (use `prisma migrate deploy` in prod)
- `npm run db:studio` — open Prisma Studio
- `npm run seed` — upsert users from env

## Notes

- Background removal loads on first use (~50 MB) and caches in the browser.
  Subsequent uploads work offline. If it fails (e.g. no internet), the form
  falls back to the original photo.
- Both seeded accounts share the same closet and outfits.
- Photos and the SQLite DB live under `data/` and are gitignored.

## Environment

```
DATABASE_URL="file:../data/wardrobe.db"      # required
AUTH_SECRET="..."                            # required, 32+ random bytes
HER_NAME / HER_EMAIL / HER_PASSWORD          # required for seed
HIS_NAME / HIS_EMAIL / HIS_PASSWORD          # required for seed
USE_SECURE_COOKIES="true"                    # optional, only when behind HTTPS
```
