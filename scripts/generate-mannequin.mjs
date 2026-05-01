#!/usr/bin/env node
// Generate the canonical photoreal mannequin used by the AI virtual
// try-on feature. Calls Gemini 2.5 Flash Image with a fixed prompt and
// writes the result to public/mannequin/base.png. Bumping the `id` in
// base.json invalidates every cached try-on (the route includes it in
// the cache hash), so when you re-run this script and want the change
// to propagate immediately, also bump the id.
//
// Usage:
//   GEMINI_API_KEY=... npm run generate:mannequin
//   GEMINI_API_KEY=... npm run generate:mannequin -- --id mq-v2

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "mannequin");
const OUT_PNG = path.join(OUT_DIR, "base.png");
const OUT_META = path.join(OUT_DIR, "base.json");

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const KEY = process.env.GEMINI_API_KEY;

const PROMPT = [
  "A neutral photorealistic dress-form mannequin, full body, front-facing,",
  "arms slightly away from torso, legs together standing straight,",
  "soft even studio lighting, plain off-white seamless background,",
  "matte beige fabric mannequin with no facial features,",
  "clean, minimal, no shadows on background. Portrait 9:16 framing,",
  "head fully visible at the top and feet fully visible at the bottom.",
].join(" ");

const idArg = process.argv.indexOf("--id");
const idValue = idArg >= 0 ? process.argv[idArg + 1] : null;
const id = idValue || `mq-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

if (!KEY) {
  console.error("GEMINI_API_KEY is not set. Export it before running this script.");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(KEY)}`;
const body = {
  contents: [{ role: "user", parts: [{ text: PROMPT }] }],
  generationConfig: {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: "9:16" },
    temperature: 0.4,
  },
};

console.log(`→ Generating mannequin via ${MODEL}…`);
const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Gemini error HTTP ${res.status}:`, text.slice(0, 500));
  process.exit(1);
}
const data = JSON.parse(text);
const parts = data.candidates?.[0]?.content?.parts ?? [];
const imagePart = parts.find((p) => p.inlineData?.data);
if (!imagePart) {
  console.error("No image in response. Raw:", text.slice(0, 500));
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
const buf = Buffer.from(imagePart.inlineData.data, "base64");
await writeFile(OUT_PNG, buf);
await writeFile(
  OUT_META,
  JSON.stringify({ id, createdAt: new Date().toISOString(), prompt: PROMPT, model: MODEL }, null, 2) + "\n",
);

console.log(`✓ Wrote ${OUT_PNG} (${(buf.length / 1024).toFixed(0)} KB)`);
console.log(`✓ Wrote ${OUT_META} (id=${id})`);
console.log("Tip: run a few times and pick the best output before committing.");
