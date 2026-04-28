#!/usr/bin/env node
// Copy heic2any + @imgly/background-removal bundles into public/vendor/
// and download imgly's model assets so background removal works offline.
//
// Idempotent and best-effort: if a file already exists it's skipped, and
// if the imgly CDN can't be reached we still succeed (the runtime will
// fall back to the public CDN until you re-run this with internet).

import { mkdir, copyFile, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "public", "vendor");

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function copyIfMissing(src, dest, label) {
  if (existsSync(dest)) return false;
  if (!existsSync(src)) {
    console.warn(`! ${label}: source missing at ${src}`);
    return false;
  }
  await ensureDir(path.dirname(dest));
  await copyFile(src, dest);
  const sz = (await stat(dest)).size;
  console.log(`✓ ${label} (${(sz / 1024).toFixed(0)} KB)`);
  return true;
}

async function downloadIfMissing(url, dest, label) {
  if (existsSync(dest)) return 0;
  await ensureDir(path.dirname(dest));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  ↓ ${label} (${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
  return buf.length;
}

function collectAssetUrls(resources) {
  const urls = new Set();
  const visit = (v) => {
    if (!v) return;
    if (typeof v === "string") return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (typeof v === "object") {
      if (typeof v.url === "string") urls.add(v.url);
      for (const k of Object.keys(v)) visit(v[k]);
    }
  };
  visit(resources);
  return [...urls];
}

async function main() {
  await ensureDir(VENDOR);

  // 1. heic2any (UMD bundle, loaded via <script> at runtime).
  const heic2anySrc = path.join(ROOT, "node_modules", "heic2any", "dist", "heic2any.min.js");
  const heic2anyDest = path.join(VENDOR, "heic2any", "heic2any.min.js");
  await copyIfMissing(heic2anySrc, heic2anyDest, "heic2any.min.js");

  // 2. @imgly/background-removal ESM bundle (loaded via webpackIgnore'd dynamic import).
  const imglyDistDir = path.join(ROOT, "node_modules", "@imgly", "background-removal", "dist");
  const imglyVendorDir = path.join(VENDOR, "imgly");
  await copyIfMissing(
    path.join(imglyDistDir, "index.mjs"),
    path.join(imglyVendorDir, "index.mjs"),
    "imgly index.mjs",
  );

  // 3. imgly model + WASM assets, fetched from the public CDN once.
  let imglyVersion = "1.6.0";
  try {
    const pkg = JSON.parse(
      await readFile(
        path.join(ROOT, "node_modules", "@imgly", "background-removal", "package.json"),
        "utf8",
      ),
    );
    imglyVersion = pkg.version;
  } catch {
    /* keep default */
  }

  const baseUrl = `https://staticimgly.com/@imgly/background-removal-data/${imglyVersion}/dist/`;
  const resourcesDest = path.join(imglyVendorDir, "resources.json");

  try {
    if (!existsSync(resourcesDest)) {
      console.log(`Fetching ${baseUrl}resources.json …`);
      const res = await fetch(`${baseUrl}resources.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      await ensureDir(imglyVendorDir);
      await writeFile(resourcesDest, text);
    }
    const resources = JSON.parse(await readFile(resourcesDest, "utf8"));
    const assetUrls = collectAssetUrls(resources);
    if (assetUrls.length === 0) {
      console.warn("! imgly resources.json had no asset urls — skipping model download");
    } else {
      console.log(`Downloading ${assetUrls.length} imgly asset(s) (~50 MB on first run)…`);
      let total = 0;
      for (const u of assetUrls) {
        const abs = new URL(u, baseUrl).toString();
        const filename = u.startsWith("http") ? new URL(u).pathname.split("/").pop() : u;
        const dest = path.join(imglyVendorDir, filename);
        try {
          total += await downloadIfMissing(abs, dest, filename);
        } catch (err) {
          console.warn(`  ! ${filename}: ${err.message}`);
        }
      }
      if (total > 0) console.log(`✓ imgly assets fetched (${(total / 1024 / 1024).toFixed(1)} MB)`);
    }
  } catch (err) {
    console.warn(`! imgly assets not fetched: ${err.message}`);
    console.warn(`  Background removal will use the public CDN until you re-run "npm run fetch-vendor" with internet.`);
  }

  console.log("Vendor assets up to date.");
}

main().catch((err) => {
  console.error("fetch-vendor failed:", err);
  // Don't fail the install — runtime will fall back to the CDN.
  process.exit(0);
});
