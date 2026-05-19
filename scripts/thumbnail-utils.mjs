/**
 * Incremental thumbnail helpers — skip sharp when source bytes unchanged.
 * Cache: <thumbsDir>/.thumb-cache.json maps source key → sha256 hex.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

export const THUMB_CACHE_FILENAME = ".thumb-cache.json";

export function thumbFileName(fileKey) {
  return (
    crypto.createHash("md5").update(fileKey, "utf8").digest("hex").slice(0, 14) +
    ".jpg"
  );
}

export function hashFileSync(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function loadThumbCache(thumbsDir) {
  const cachePath = path.join(thumbsDir, THUMB_CACHE_FILENAME);
  if (!fs.existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    return parsed.entries && typeof parsed.entries === "object"
      ? parsed.entries
      : {};
  } catch {
    return {};
  }
}

export function saveThumbCache(thumbsDir, entries) {
  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.writeFileSync(
    path.join(thumbsDir, THUMB_CACHE_FILENAME),
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
    "utf8"
  );
}

export function thumbIsFresh(srcPath, destPath, cacheKey, cacheEntries) {
  const expected = cacheEntries[cacheKey];
  if (!expected || !fs.existsSync(destPath)) return false;
  try {
    return hashFileSync(srcPath) === expected;
  } catch {
    return false;
  }
}

export function pruneThumbCache(cacheEntries, activeKeys) {
  const active = new Set(activeKeys);
  for (const key of Object.keys(cacheEntries)) {
    if (!active.has(key)) delete cacheEntries[key];
  }
}

export function pruneOrphanThumbs(thumbsDir, keepDestNames) {
  if (!fs.existsSync(thumbsDir)) return;
  for (const name of fs.readdirSync(thumbsDir)) {
    if (name === THUMB_CACHE_FILENAME) continue;
    if (!keepDestNames.has(name)) {
      fs.unlinkSync(path.join(thumbsDir, name));
    }
  }
}

/**
 * @param {object} opts
 * @param {string} opts.thumbsDir
 * @param {string} opts.cacheKey — stable id (file name or gallery rel path)
 * @param {string} opts.srcPath
 * @param {import('sharp').default | null} opts.sharp
 * @param {Record<string, string>} opts.cacheEntries — mutated in place
 * @param {number} opts.maxWidth
 * @returns {Promise<{ thumbRel: string | null, created: boolean, skipped: boolean }>}
 */
export async function ensureJpegThumb(opts) {
  const destName = thumbFileName(opts.cacheKey);
  const destPath = path.join(opts.thumbsDir, destName);
  const thumbRel = `thumbs/${destName}`;

  if (
    opts.sharp &&
    thumbIsFresh(opts.srcPath, destPath, opts.cacheKey, opts.cacheEntries)
  ) {
    return { thumbRel, created: false, skipped: true };
  }

  if (!opts.sharp) {
    if (fs.existsSync(destPath)) {
      try {
        opts.cacheEntries[opts.cacheKey] = hashFileSync(opts.srcPath);
      } catch {
        /* keep existing cache entry if any */
      }
      return { thumbRel, created: false, skipped: true };
    }
    return { thumbRel: null, created: false, skipped: false };
  }

  try {
    await opts.sharp(opts.srcPath)
      .rotate()
      .resize({
        width: opts.maxWidth,
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(destPath);
    opts.cacheEntries[opts.cacheKey] = hashFileSync(opts.srcPath);
    return { thumbRel, created: true, skipped: false };
  } catch (e) {
    return { thumbRel: null, created: false, skipped: false, error: e };
  }
}
