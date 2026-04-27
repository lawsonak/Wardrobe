# Hosting Wardrobe on Proxmox

This walks you from a fresh Proxmox host to a running Wardrobe app that
your wife can hit from her phone over your home Wi-Fi.

## What you'll end up with

- A small Linux container (LXC) on your Proxmox node, ~512 MB RAM, ~2 GB disk.
- The app running as a `systemd` service, restarting automatically on reboot.
- Reachable on your LAN at `http://<container-ip>:3000` from any device.
- A SQLite DB and the photo files living inside the container at `/opt/wardrobe/data/`.

## Step 1 — Create the LXC

In the Proxmox UI: **Create CT**

- **Template**: Debian 12 (or Ubuntu 24.04). The instructions below assume Debian.
- **Disk**: 8 GB is plenty.
- **CPU**: 2 cores.
- **RAM**: 1024 MB (you can drop to 512 MB after the build step).
- **Network**: DHCP from your home router is fine. Note the IP it gets — that's
  what your wife will type into her phone.
- **Unprivileged**: yes (the default).
- **Features**: enable `nesting=1`. This is required for some npm builds.

Start the container and open its console (or SSH in as `root`).

> If you'd rather use a full VM, the steps are identical from Step 2 onward.

## Step 2 — System packages

```bash
apt update && apt upgrade -y
apt install -y curl ca-certificates git build-essential
```

Install Node.js 20 (the LTS):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version   # should print v20.x
```

## Step 3 — Clone the app

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/lawsonak/wardrobe.git
cd wardrobe
git checkout claude/virtual-wardrobe-app-cdEOk    # or main, once merged
```

## Step 4 — Configure

```bash
cp .env.example .env
# Generate a real secret:
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
# Paste that into AUTH_SECRET in .env, then fill in the names/passwords:
nano .env
```

Minimum `.env`:

```
DATABASE_URL="file:../data/wardrobe.db"
AUTH_SECRET="<paste the random string from above>"

HER_NAME="<her name>"
HER_EMAIL="her@example.com"
HER_PASSWORD="<a real password>"

HIS_NAME="<your name>"
HIS_EMAIL="you@example.com"
HIS_PASSWORD="<a real password>"
```

> The emails don't have to be real — they're just login handles.

## Step 5 — Install, migrate, seed, build

```bash
npm install            # ~2 minutes
npx prisma migrate deploy   # creates data/wardrobe.db
npm run seed                # creates the two user accounts
npm run build               # production build, ~1 minute
```

A successful build ends with `✓ Compiled successfully` and a route table.

## Step 6 — Try it once before installing as a service

```bash
PORT=3000 npm run start
```

From your laptop (same Wi-Fi) open `http://<container-ip>:3000/login` and sign
in with one of the accounts you set in `.env`. Add a photo, build an outfit,
make sure it sticks. Then `Ctrl+C` to stop.

> The container's IP is visible from `pct config <vmid>` on the Proxmox host,
> or run `ip -4 addr` inside the container.

## Step 7 — Run as a systemd service

```bash
cat >/etc/systemd/system/wardrobe.service <<'EOF'
[Unit]
Description=Wardrobe (Next.js)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/wardrobe
EnvironmentFile=/opt/wardrobe/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

# Lock things down a little
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/wardrobe/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now wardrobe
systemctl status wardrobe   # should show "active (running)"
journalctl -u wardrobe -f   # tail logs (Ctrl+C to exit)
```

Reboot the container (`reboot`) and the app comes back up automatically.

## Step 8 — Bookmark on her phone

On her phone, go to `http://<container-ip>:3000`, sign in, then:

- **iOS**: Share → "Add to Home Screen".
- **Android**: ⋮ menu → "Install app" / "Add to Home Screen".

The app's manifest gives it a name, icon, and a standalone window — feels
native.

> A static IP is friendlier than DHCP for a bookmarked URL. In your home
> router, reserve an IP for the container's MAC address, or set the
> container to a static IP in Proxmox. A `.local` mDNS name like
> `wardrobe.local` is even nicer; install `avahi-daemon` in the container
> and set its hostname to `wardrobe`.

## Optional — HTTPS via a reverse proxy

If you ever expose this beyond your LAN (Tailscale, Cloudflare Tunnel, your
own domain), put it behind HTTPS and flip secure cookies on:

```
# in /opt/wardrobe/.env
USE_SECURE_COOKIES=true
```

Then `systemctl restart wardrobe`.

A minimal Caddy reverse proxy in front of the container:

```caddy
wardrobe.example.com {
    reverse_proxy <container-ip>:3000
}
```

Caddy issues a real Let's Encrypt cert automatically.

## Backups

Everything that matters lives in `/opt/wardrobe/data/`:

- `wardrobe.db` — the SQLite database.
- `uploads/<userId>/*.png` — the photos.

A weekly snapshot of `/opt/wardrobe/data` (rsync to a NAS, Proxmox backup of
the container, anything) is plenty.

## Updating

```bash
cd /opt/wardrobe
git pull
npm install
npx prisma migrate deploy
npm run build
systemctl restart wardrobe
```

## Troubleshooting

- **"the URL must start with the protocol `prisma://`"** — Prisma client got
  generated for Data Proxy. Re-run `npx prisma generate` (no flags) and
  rebuild. The shipped `package.json` does this automatically on `npm install`.
- **"Host must be trusted"** — make sure you're on the latest commit; the app
  sets `trustHost: true`.
- **Sign-in returns to the login page** — over HTTP, leave
  `USE_SECURE_COOKIES` unset. Only set it to `true` when you actually have
  HTTPS in front.
- **Phone camera doesn't open the rear camera** — that's a browser quirk
  on HTTP. Either add the camera permission manually in the browser, or
  put HTTPS in front (a self-signed Caddy cert is enough on a LAN).
- **High RAM during `npm run build`** — give the container 1 GB during the
  build. After it's running, drop it back to 512 MB.
