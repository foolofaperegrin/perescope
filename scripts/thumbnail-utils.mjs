/**
 * Incremental thumbnail helpers — skip sharp when source bytes unchanged.
 * Cache: <thumbsDir>/.thumb-cache.json maps source key → sha256 hex.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** @type {string | false | null} */
let ffmpegCommand = null;

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
export async function resolveFfmpeg() {
  if (ffmpegCommand !== null) return ffmpegCommand;

  try {
    const mod = await import("ffmpeg-static");
    const bundled = mod.default;
    if (bundled && fs.existsSync(bundled)) {
      ffmpegCommand = bundled;
      return ffmpegCommand;
    }
  } catch {
    /* optional package not installed */
  }

  try {
    await execFileAsync("ffmpeg", ["-version"], {
      timeout: 8000,
      windowsHide: true,
    });
    ffmpegCommand = "ffmpeg";
  } catch {
    ffmpegCommand = false;
  }
  return ffmpegCommand;
}

/**
 * Extract one JPEG frame from a video (requires ffmpeg on PATH).
 * @returns {Promise<{ thumbRel: string | null, created: boolean, skipped: boolean, error?: Error }>}
 */
export async function ensureVideoFrameThumb(opts) {
  const destName = thumbFileName(opts.cacheKey);
  const destPath = path.join(opts.thumbsDir, destName);
  const thumbRel = `thumbs/${destName}`;
  const tmpPath = `${destPath}.part.jpg`;

  if (thumbIsFresh(opts.srcPath, destPath, opts.cacheKey, opts.cacheEntries)) {
    return { thumbRel, created: false, skipped: true };
  }

  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return {
      thumbRel: null,
      created: false,
      skipped: false,
      error: new Error("ffmpeg not found on PATH"),
    };
  }

  try {
    await execFileAsync(
      ffmpeg,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        "00:00:01",
        "-i",
        opts.srcPath,
        "-an",
        "-vframes",
        "1",
        "-vf",
        `scale=${opts.maxWidth}:-2:flags=lanczos`,
        tmpPath,
      ],
      { timeout: 120000, windowsHide: true }
    );

    if (!fs.existsSync(tmpPath)) {
      throw new Error("ffmpeg produced no output");
    }

    if (opts.sharp) {
      await opts
        .sharp(tmpPath)
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(destPath);
      fs.unlinkSync(tmpPath);
    } else {
      fs.renameSync(tmpPath, destPath);
    }

    opts.cacheEntries[opts.cacheKey] = hashFileSync(opts.srcPath);
    return { thumbRel, created: true, skipped: false };
  } catch (e) {
    if (fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
    return {
      thumbRel: null,
      created: false,
      skipped: false,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

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
