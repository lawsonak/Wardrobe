import { promises as fs } from "node:fs";
import path from "node:path";

export const UPLOAD_ROOT = path.join(process.cwd(), "data", "uploads");

function safeExtFromMime(mime: string | undefined, fallback: string): string {
  const raw = (mime?.split("/")[1] || fallback).replace(/[^a-z0-9]/gi, "");
  return raw || fallback;
}

export async function saveUpload(
  userId: string,
  idPrefix: string,
  file: File,
  suffix: string,
  options?: { bust?: boolean },
): Promise<string> {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });
  const ext = safeExtFromMime(file.type, "png");
  const tag = options?.bust ? `-${Math.random().toString(36).slice(2, 8)}` : "";
  const filename = `${idPrefix}-${suffix}${tag}.${ext}`;
  const fullPath = path.join(userDir, filename);
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

export async function saveBuffer(
  userId: string,
  idPrefix: string,
  buf: Buffer,
  suffix: string,
  ext: string,
): Promise<string> {
  const userDir = path.join(UPLOAD_ROOT, userId);
  await fs.mkdir(userDir, { recursive: true });
  const safeExt = ext.replace(/[^a-z0-9]/gi, "") || "png";
  const filename = `${idPrefix}-${suffix}.${safeExt}`;
  const fullPath = path.join(userDir, filename);
  await fs.writeFile(fullPath, buf);
  return path.posix.join(userId, filename);
}

export async function unlinkUpload(relPath: string | null | undefined): Promise<void> {
  if (!relPath) return;
  try {
    await fs.unlink(path.join(UPLOAD_ROOT, relPath));
  } catch {
    /* ignore */
  }
}
