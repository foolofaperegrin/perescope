/**
 * Scans media/gallery (including subfolders) for image files, writes JPEG
 * thumbnails (when `sharp` is installed), and writes media/gallery/images.json.
 *
 *   npm install          # once, installs sharp (used for thumbnails)
 *   npm run build:gallery
 *
 * Without Node:  powershell … -File scripts/build-gallery.ps1
 *
 * On GitHub, .github/workflows/update-gallery-manifest.yml runs this on push.
 *
 * A plain-text log is always written to: scripts/build-gallery.log
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ensureJpegThumb,
  loadThumbCache,
  pruneOrphanThumbs,
  pruneThumbCache,
  saveThumbCache,
  thumbFileName,
} from "./thumbnail-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.join(__dirname, "build-gallery.log");
const lines = [];

function ts() {
  return new Date().toISOString();
}

function log(level, message) {
  lines.push(`[${ts()}] [${level}] ${message}`);
  if (level === "ERROR") console.error(message);
  else if (level === "WARN") console.warn(message);
  else console.log(message);
}

function flushLog(outcome) {
  const header = `=== build-gallery.mjs ${outcome} ${ts()} ===\n`;
  fs.writeFileSync(logPath, `${header}${lines.join("\n")}\n`, "utf8");
  console.log(`Log saved to: ${logPath}`);
}

let exitCode = 0;
try {
  log("INFO", "Starting gallery build");

  const root = path.join(__dirname, "..");
  const galleryDir = path.join(root, "media", "gallery");
  const outFile = path.join(galleryDir, "images.json");
  const THUMB_MAX_WIDTH = 420;

  const IMAGE_EXT = new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".svg",
  ]);

  const SKIP_DIR_NAMES = new Set(["thumbs", ".git"]);

  function toPosix(rel) {
    return rel.split(path.sep).join("/");
  }

  function humanizeAlt(filename) {
    const base = path.basename(filename, path.extname(filename));
    const words = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    return words || filename;
  }

  function humanizeFolderTitle(folderPath) {
    if (!folderPath) return "";
    return folderPath
      .split("/")
      .map((segment) => humanizeAlt(segment))
      .join(" / ");
  }

  function loadProjectSourceMap(rootDir) {
    const configPath = path.join(rootDir, "media", "gallery", "project-sources.json");
    if (!fs.existsSync(configPath)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return data.groups && typeof data.groups === "object" ? data.groups : {};
    } catch (e) {
      log("WARN", `Invalid project-sources.json: ${e.message}`);
      return {};
    }
  }

  function projectEntriesFromSlug(rootDir, slug) {
    const dir = path.join(rootDir, "projects", slug);
    const manifestPath = path.join(dir, "images.json");
    if (!fs.existsSync(manifestPath)) {
      log("WARN", `Gallery: no images.json for project ${slug}`);
      return [];
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (e) {
      log("WARN", `Gallery: skip invalid images.json in ${slug}: ${e.message}`);
      return [];
    }
    const entries = Array.isArray(data.images) ? data.images : [];
    const label = humanizeAlt(slug);
    const seen = new Set();
    /** @type {{ file: string, alt: string, thumb?: string }[]} */
    const out = [];

    for (const entry of entries) {
      const file =
        typeof entry === "string" ? entry : entry && entry.file ? String(entry.file) : "";
      if (!file) continue;
      const key = file.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const item = {
        file: `projects/${slug}/${file}`,
        alt: `${label} — ${
          typeof entry === "object" && entry.alt
            ? String(entry.alt)
            : humanizeAlt(path.basename(file))
        }`,
      };
      if (typeof entry === "object" && entry.thumb) {
        item.thumb = `projects/${slug}/${String(entry.thumb)}`;
      }
      if (typeof entry === "object" && entry.type) {
        item.type = String(entry.type);
      }
      if (typeof entry === "object" && entry.poster) {
        const poster = String(entry.poster);
        item.poster = poster.includes("/")
          ? poster
          : `projects/${slug}/${poster}`;
      }
      out.push(item);
    }

    log("INFO", `Gallery: ${out.length} image(s) from project ${slug}`);
    return out;
  }

  function mergeProjectSourcesIntoGroups(groups, rootDir) {
    const sources = loadProjectSourceMap(rootDir);
    const byFolder = new Map(groups.map((g) => [g.folder, g]));

    for (const [folder, slugs] of Object.entries(sources)) {
      const list = Array.isArray(slugs) ? slugs : [];
      if (!list.length) continue;

      let group = byFolder.get(folder);
      if (!group) {
        group = {
          folder,
          title: humanizeFolderTitle(folder),
          images: [],
        };
        groups.push(group);
        byFolder.set(folder, group);
      }

      for (const slug of list) {
        group.images.push(...projectEntriesFromSlug(rootDir, String(slug)));
      }
    }

    groups.sort((a, b) => {
      if (a.folder === "") return -1;
      if (b.folder === "") return 1;
      return a.folder.localeCompare(b.folder, undefined, { sensitivity: "base" });
    });
  }

  function collectImageRels(dir, relPrefix = "") {
    /** @type {string[]} */
    const found = [];

    if (!fs.existsSync(dir)) return found;

    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      );

    for (const entry of entries) {
      if (entry.name === "images.json" || entry.name === ".gitkeep") continue;

      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        found.push(...collectImageRels(full, rel));
        continue;
      }

      if (!entry.isFile()) continue;
      if (!IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
      found.push(toPosix(rel));
    }

    return found;
  }

  if (!fs.existsSync(galleryDir)) {
    fs.mkdirSync(galleryDir, { recursive: true });
    log("INFO", `Created gallery dir: ${path.relative(root, galleryDir)}`);
  }

  const relFiles = collectImageRels(galleryDir);
  log("INFO", `Found ${relFiles.length} source image(s) under media/gallery`);

  let sharp;
  try {
    sharp = (await import("sharp")).default;
    log("INFO", "Loaded sharp for thumbnail generation");
  } catch (e) {
    sharp = null;
    log(
      "WARN",
      "`sharp` not installed — skipping JPEG thumbnails. Run: npm install (" +
        (e && e.message ? e.message : String(e)) +
        ")"
    );
  }

  /** @type {Map<string, string>} */
  const thumbRelByFile = new Map();
  let thumbCreated = 0;
  let thumbSkipped = 0;

  const thumbsDir = path.join(galleryDir, "thumbs");
  fs.mkdirSync(thumbsDir, { recursive: true });
  const cacheEntries = loadThumbCache(thumbsDir);
  const keepDestNames = new Set();

  for (const relFile of relFiles) {
    const ext = path.extname(relFile).toLowerCase();
    if (ext === ".svg") continue;

    const cacheKey = toPosix(relFile);
    const srcPath = path.join(galleryDir, ...cacheKey.split("/"));
    const result = await ensureJpegThumb({
      thumbsDir,
      cacheKey,
      srcPath,
      sharp,
      cacheEntries,
      maxWidth: THUMB_MAX_WIDTH,
    });

    if (result.thumbRel) {
      thumbRelByFile.set(relFile, result.thumbRel);
      keepDestNames.add(thumbFileName(cacheKey));
    }
    if (result.skipped) thumbSkipped += 1;
    else if (result.created) thumbCreated += 1;
    else if (result.error) {
      log("WARN", `Gallery: skip thumb for ${relFile}: ${result.error.message}`);
    }
  }

  pruneThumbCache(cacheEntries, relFiles.map((rel) => toPosix(rel)));
  pruneOrphanThumbs(thumbsDir, keepDestNames);
  saveThumbCache(thumbsDir, cacheEntries);

  /** @type {Map<string, { file: string, alt: string, thumb?: string }[]>} */
  const imagesByFolder = new Map();

  for (const relFile of relFiles) {
    const folder =
      path.dirname(relFile) === "." ? "" : toPosix(path.dirname(relFile));
    if (!imagesByFolder.has(folder)) imagesByFolder.set(folder, []);
    const entry = { file: relFile, alt: humanizeAlt(path.basename(relFile)) };
    const thumb = thumbRelByFile.get(relFile);
    if (thumb) entry.thumb = thumb;
    imagesByFolder.get(folder).push(entry);
  }

  const folderKeys = [...imagesByFolder.keys()].sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });

  const groups = folderKeys.map((folder) => ({
    folder,
    title: humanizeFolderTitle(folder),
    images: imagesByFolder.get(folder),
  }));

  mergeProjectSourcesIntoGroups(groups, root);

  const version = Date.now();
  fs.writeFileSync(
    outFile,
    `${JSON.stringify({ version, groups }, null, 2)}\n`,
    "utf8"
  );
  log("INFO", `Manifest version (cache bust): ${version}`);

  const summary =
    `Gallery: wrote ${relFiles.length} image(s) in ${groups.length} group(s) → ${path.relative(root, outFile)}` +
    (sharp
      ? ` (${thumbCreated} thumbnails built, ${thumbSkipped} unchanged)`
      : thumbSkipped > 0
        ? ` (${thumbSkipped} existing thumbnails reused)`
        : "");
  log("INFO", summary);
  flushLog("OK");
} catch (e) {
  exitCode = 1;
  log("ERROR", (e && e.stack) || String(e));
  flushLog("FAILED");
}

process.exit(exitCode);
