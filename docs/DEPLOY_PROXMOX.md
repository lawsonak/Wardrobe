# Hosting Wardrobe on Proxmox — Step by Step

This is the long, hand-holding version. It assumes you've never set up a
Proxmox container before. If a step takes longer than the time estimate, jump
to **Troubleshooting** at the bottom.

**You should already have:**

- A working Proxmox VE server you can log in to (a web page at something
  like `https://192.168.1.10:8006`).
- The Proxmox host plugged into your home network on Ethernet.
- Your phone and laptop on the same Wi-Fi as the Proxmox host.

**You'll need, but I'll tell you when:**

- A password for the new container's `root` account (write it down).
- Two passwords for the app's two user accounts (her login and yours).
- About 30 minutes start to finish, mostly waiting on `npm install` and
  `npm run build`.

**You'll end up with:**

- A small Linux container (LXC) on your Proxmox node, ~1 GB RAM, ~3 GB disk.
- The Wardrobe app running as a `systemd` service that auto-restarts on reboot.
- Reachable on your LAN at `http://<container-ip>:3000` from any device.
- All data (SQLite DB + photo files) inside the container at `/opt/wardrobe/data/`.

---

## Step 0 — Make sure you have a container template (5 min)

Before you can create a container, Proxmox needs the OS image (a "template").

1. In the Proxmox web UI, in the left sidebar, click your **storage** named
   `local` (under your node). NOT `local-lvm`/`local-zfs` — those are for VM
   disks, not templates.
2. Click **CT Templates** in the middle pane.
3. Click the **Templates** button at the top. A dialog opens listing
   downloadable templates.
4. In the **Section** dropdown choose `system`. Find `debian-12-standard`
   (any current point release is fine, e.g. `debian-12-standard_12.7-1_amd64`).
5. Click **Download**. Wait for "TASK OK" in the log window, then close it.

You should now see `debian-12-standard...` in the CT Templates list. ✓

> If your `local` storage doesn't show "CT Templates" as a tab, click
> **Datacenter → Storage → local** in the sidebar, edit it, and check the
> **Container template** box under "Content".

---

## Step 1 — Create the LXC container (5 min)

In the top-right of the Proxmox UI click the blue **Create CT** button. A
wizard opens with several tabs.

### General tab

| Field | Value |
| --- | --- |
| Node | (your node, already selected) |
| CT ID | use the suggested number, e.g. `100` (write it down — this is the **VMID**) |
| Hostname | `wardrobe` |
| Password | a strong password for the container's `root` user (write it down) |
| Confirm password | same |
| Unprivileged container | ✅ leave checked |
| Nesting | (we'll enable this on the Features tab) |

Click **Next**.

### Template tab

- Storage: `local`
- Template: pick the `debian-12-standard...` you just downloaded.

Click **Next**.

### Disks tab

- Disk size: `8` GiB.

Click **Next**.

### CPU tab

- Cores: `2`.

Click **Next**.

### Memory tab

- Memory: `1024` MiB
- Swap: `512` MiB

(After the build is done, you can drop memory to 512 MiB and it'll still run.)

Click **Next**.

### Network tab

- Bridge: `vmbr0` (the default; this is your LAN bridge).
- IPv4: choose **DHCP** for now — your router will hand out an IP.
- IPv6: `DHCP` or `Static` doesn't matter; you can leave it as `Static`/none.

Click **Next**.

### DNS tab

Leave everything blank — it'll inherit from your Proxmox host. Click **Next**.

### Confirm tab

Check **Start after created**. Click **Finish**. A task window opens; wait
for "TASK OK". Close it.

### One more thing — enable Nesting

`npm` sometimes needs nesting to run scripts. Easier to flip it on now:

1. In the left sidebar click your new CT (e.g. `100 (wardrobe)`).
2. **Options** → **Features** → **Edit** → check **Nesting** → OK.
3. **Right-click the CT → Reboot**. (The container restarts in a few seconds.)

---

## Step 2 — Find the container's IP and open its console (2 min)

1. In the sidebar click `100 (wardrobe)`.
2. Click **Summary**. Look at the **IPs** field. You'll see something like
   `192.168.1.42`. **Write this down — your wife will type this into her phone.**
3. Click the **>_ Console** button (top-right). A black terminal window opens
   inside your browser.
4. At the `wardrobe login:` prompt, type `root`, press Enter, then type the
   password you set in Step 1 and press Enter.

You should now see a prompt like:

```
root@wardrobe:~#
```

That's a shell **inside the container**. From here on, every command goes
into this window unless I say otherwise.

> **Copy-paste tip**: the Proxmox in-browser console doesn't always accept
> Ctrl+V. Paste with right-click, or open an SSH session instead:
>
> ```
> ssh root@<container-ip>
> ```
>
> from your laptop's terminal.

---

## Step 3 — Reserve the container's IP on your router (3 min)

DHCP can hand out a different IP after a long power cut. Lock it down so the
URL on her phone keeps working forever.

In your home router's admin page (usually `http://192.168.1.1` or similar),
look for **DHCP Reservations** or **Static Leases** and reserve the IP from
Step 2 to the container's MAC address.

To find the MAC: in Proxmox, sidebar → CT → **Network** → look at `eth0`'s
HWADDR (something like `BC:24:11:AB:CD:EF`).

If you can't find that setting, skip this step — it'll usually keep the same
IP for months anyway. Come back to it later if it ever changes.

---

## Step 4 — Install system packages and Node.js (3 min)

In the container console:

```bash
apt update && apt upgrade -y
```

You'll see lots of "Get:..." and "Setting up..." lines, then return to the
prompt. If it asks any yes/no question, hit Enter to accept the default.

```bash
apt install -y curl ca-certificates git build-essential
```

Now Node.js 20 (the LTS version):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Verify it worked:

```bash
node --version
npm --version
```

Expected: `v20.x.x` and `10.x.x` (or higher). If you get "command not found",
re-run the two install commands above.

---

## Step 5 — Clone the app (1 min)

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/lawsonak/Wardrobe.git wardrobe
cd wardrobe
```

Verify you're on the right branch:

```bash
git branch
```

Should show `* main`. If you see `* claude/...` instead, run:

```bash
git checkout main
```

---

## Step 6 — Configure environment variables (5 min)

```bash
cp .env.example .env
```

Generate a real `AUTH_SECRET` (a long random string Auth.js uses to sign
session cookies):

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
```

You'll get a 44-character string ending in `=`. **Copy it** — you'll paste it
in a moment. Right-click → Copy in the Proxmox console works.

Now open the `.env` file in the `nano` editor:

```bash
nano .env
```

You'll see the file. Use arrow keys to move. **Replace each placeholder**
with a real value:

```
DATABASE_URL="file:../data/wardrobe.db"

AUTH_SECRET="<paste the long random string here>"

HER_NAME="Sarah"                       # her real first name (or nickname)
HER_EMAIL="sarah@home.local"           # any email-shaped string; just a login handle
HER_PASSWORD="something-she-can-remember"

HIS_NAME="Adam"
HIS_EMAIL="adam@home.local"
HIS_PASSWORD="something-you-can-remember"
```

> The emails don't need to be real — nothing is sent. They're just login
> handles. The names show up in the app's greeting.

Save and exit nano:

- **Ctrl+O**, then **Enter** to write the file.
- **Ctrl+X** to quit.

Confirm it saved:

```bash
cat .env
```

Should print what you typed. **Don't share this file** — it has your secret
and the passwords.

---

## Step 7 — Install dependencies (2–3 min)

```bash
npm install
```

This downloads ~400 packages and then runs a postinstall step that copies
`heic2any` + `@imgly/background-removal` into `public/vendor/` and pulls
imgly's ~50 MB background-removal model from `staticimgly.com`. So the
first install needs internet — once it's done, both HEIC conversion and
background removal work fully offline.

You should see lines like:

```
✓ heic2any.min.js (1320 KB)
✓ imgly index.mjs (167 KB)
Fetching https://staticimgly.com/...resources.json …
  ↓ <model files>
✓ imgly assets fetched (52.0 MB)
Vendor assets up to date.
```

If the imgly download fails (no internet, firewall, etc.) the install still
succeeds and the app falls back to fetching the model from the CDN at
runtime. To retry the offline fetch later:

```bash
npm run fetch-vendor
```

Errors about deprecated subdependencies are normal — ignore them. Real
errors are not. If it fails, see Troubleshooting below.

---

## Step 8 — Create the database and seed the user accounts (30 sec)

```bash
npx prisma migrate deploy
```

Expected output ends with:

```
All migrations have been successfully applied.
```

This creates `data/wardrobe.db` (an empty SQLite database).

```bash
npm run seed
```

Expected output:

```
Seeded user: <her name> <her email>
Seeded user: <his name> <his email>
```

If you ever forget the passwords, edit `.env` and re-run `npm run seed` —
it'll update existing accounts in place.

---

## Step 9 — Build the production bundle (1–2 min)

```bash
npm run build
```

You'll see "Creating an optimized production build...", a route table, and
finally:

```
✓ Compiled successfully
```

If it fails with an out-of-memory error, bump container RAM to 1.5–2 GB
(sidebar → CT → **Resources** → **Memory** → Edit), reboot the CT, and
re-run.

---

## Step 10 — Test it manually before installing the service (3 min)

```bash
PORT=3000 npm run start
```

You should see:

```
▲ Next.js 14.x.x
- Local:    http://localhost:3000
- Network:  http://0.0.0.0:3000
✓ Ready in NNNms
```

Now from your **laptop** (not the container), open a browser and go to:

```
http://<container-ip>:3000
```

(Use the IP from Step 2.) You should land on the login page. Sign in with
one of the accounts you set in `.env`.

**Quick smoke test:**

1. From the dashboard, click "Add an item".
2. Pick any photo file (drag from your laptop, or use a phone if you've got
   one handy on the same Wi-Fi).
3. Wait for the background-removal preview (first time downloads ~50 MB —
   takes 10–60 seconds depending on internet speed).
4. Tag the item, hit Save.
5. Go to **Build** → pick the item → save outfit.

If all of that works, you're golden. Hit **Ctrl+C** in the container console
to stop the server, and continue to Step 11.

---

## Step 11 — Install as a systemd service so it auto-starts (2 min)

In the container console, paste this whole block at once and press Enter:

```bash
cat >/etc/systemd/system/wardrobe.service <<'EOF'
[Unit]
Description=Wardrobe (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/wardrobe
EnvironmentFile=/opt/wardrobe/.env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=5

NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/wardrobe/data

[Install]
WantedBy=multi-user.target
EOF
```

Then enable and start it:

```bash
systemctl daemon-reload
systemctl enable --now wardrobe
```

Check it's running:

```bash
systemctl status wardrobe
```

Look for:

```
● wardrobe.service - Wardrobe (Next.js)
     Loaded: loaded (...)
     Active: active (running) since ...
```

Press **q** to exit the status view.

Tail the live logs (Ctrl+C exits):

```bash
journalctl -u wardrobe -f
```

Now reboot the container to verify it auto-starts:

```bash
reboot
```

The console will disconnect. Wait ~20 seconds, click **>_ Console** again,
log back in, and run:

```bash
systemctl status wardrobe
```

It should be `active (running)` again. Open `http://<container-ip>:3000` from
your laptop one more time to confirm.

---

## Step 12 — Bookmark on her phone (2 min)

On her phone (on the same Wi-Fi as the Proxmox host), open the browser and
type the IP in:

```
http://192.168.1.42:3000
```

(Replace with your actual container IP.)

Sign in once with her account. Then:

- **iPhone (Safari)**: tap the **Share** button (square with arrow), scroll
  down, tap **Add to Home Screen**, tap **Add**. A "Wardrobe" icon appears on
  her home screen and opens the app full-screen.
- **Android (Chrome)**: tap the ⋮ menu, tap **Install app** or **Add to Home
  Screen**, tap **Install**.

That's it. She taps the icon and it feels like a regular app.

---

## Optional polish

### Friendly URL with mDNS (`http://wardrobe.local:3000`)

```bash
apt install -y avahi-daemon
systemctl enable --now avahi-daemon
```

That's it — most laptops and recent Android phones will resolve
`wardrobe.local`. iPhones already do.

### HTTPS / accessing it away from home

Anything beyond your LAN (e.g. via Tailscale, Cloudflare Tunnel, or a real
domain), put HTTPS in front and flip secure cookies on. Edit `/opt/wardrobe/.env`
and add:

```
USE_SECURE_COOKIES="true"
```

Then `systemctl restart wardrobe`.

A minimal Caddy reverse proxy:

```caddy
wardrobe.example.com {
    reverse_proxy 192.168.1.42:3000
}
```

Caddy gets a Let's Encrypt cert automatically.

### Backups

Everything that matters is in `/opt/wardrobe/data/`:

- `wardrobe.db` — the SQLite database.
- `uploads/<userId>/*.png` — the photos.

Easiest: in Proxmox, **Datacenter → Backup → Add** a weekly schedule of the
container to your `local` storage. That snapshots the whole thing.

Or rsync just the data folder to a NAS:

```bash
rsync -av /opt/wardrobe/data/ user@nas:/path/to/backups/wardrobe/
```

### Updating later

```bash
cd /opt/wardrobe
git pull
npm install              # also re-runs fetch-vendor automatically
npx prisma migrate deploy
npm run build
systemctl restart wardrobe
```

---

## Troubleshooting

### `npm install` fails with "node-gyp" / Python errors

You skipped Step 4's `apt install -y ... build-essential`. Run it now and
retry.

### `npm install` fails with EACCES / permission errors

You're not `root`. Run `whoami` — it should print `root`. If it prints
something else, type `su -` to switch.

### `npm run build` killed / out of memory

Bump the container RAM:

1. Sidebar → CT → **Resources** → **Memory** → Edit → `2048` → OK.
2. Reboot the CT.
3. Try `npm run build` again.

After it's running you can drop memory back to 512 MiB.

### "the URL must start with the protocol `prisma://`"

The Prisma client thinks it's in Data Proxy mode. Fix:

```bash
cd /opt/wardrobe
npx prisma generate
npm run build
systemctl restart wardrobe
```

### Sign-in just bounces back to the login page

You set `USE_SECURE_COOKIES=true` but you're on plain HTTP. Edit `.env`,
remove the line (or set it to `false`), then `systemctl restart wardrobe`.

### `systemctl status wardrobe` shows "active (running)" but the page won't load

Check the firewall on the container:

```bash
ss -tlnp | grep 3000
```

You should see `0.0.0.0:3000` LISTEN. If not, the service crashed — check
logs with `journalctl -u wardrobe -n 100`.

If the port IS listening but your laptop can't reach it, Proxmox's host
firewall might be blocking. **Datacenter → Firewall** — make sure the
container's bridge isn't filtered, or just turn the host firewall off if
you're behind a home router.

### Phone camera opens but shows the wrong (front-facing) camera

The `capture="environment"` hint is best-effort — some browsers ignore it on
HTTP. Easiest fix: long-press the camera icon in the file picker and choose
"Back camera", or put HTTPS in front (see the Caddy section above —
camera/mic APIs are restricted to HTTPS by default).

### Background removal never finishes / spinner sticks

The local model files are missing or didn't download. Check:

```bash
ls -la /opt/wardrobe/public/vendor/imgly/
```

You should see `index.mjs`, `resources.json`, and a handful of `.onnx` /
`.wasm` / `.bin` files totaling ~50 MB. If they're missing, your container
couldn't reach `staticimgly.com` during install. Re-run with internet:

```bash
cd /opt/wardrobe
npm run fetch-vendor
systemctl restart wardrobe
```

If you can't get internet on the container at all, copy the
`public/vendor/` folder from any other machine that ran `npm run
fetch-vendor` successfully — those files are static and version-locked.

In the meantime, the **Use original** checkbox on the add-item form lets you
save photos without bg removal.

### HEIC photos won't load

Same root cause — `public/vendor/heic2any/heic2any.min.js` is missing. Run
`npm run fetch-vendor` to copy it in from `node_modules`.

### I forgot a password

```bash
cd /opt/wardrobe
nano .env          # change HER_PASSWORD or HIS_PASSWORD
npm run seed       # updates the existing account in place
```

### I want to wipe everything and start fresh

```bash
systemctl stop wardrobe
cd /opt/wardrobe
rm -f data/wardrobe.db data/wardrobe.db-journal
rm -rf data/uploads/*
npx prisma migrate deploy
npm run seed
systemctl start wardrobe
```

### The container's IP changed and her bookmark broke

Set up the DHCP reservation in Step 3, or assign a static IP:

1. Sidebar → CT → **Network** → `eth0` → Edit.
2. Switch IPv4 from DHCP to Static, e.g. `192.168.1.42/24`, gateway
   `192.168.1.1` (your router).
3. OK, then `reboot` the CT.

Update the bookmark on her phone to the new IP (or just always use
`wardrobe.local:3000` if you set up mDNS).
