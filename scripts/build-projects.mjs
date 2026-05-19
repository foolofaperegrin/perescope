/**
 * Scans projects/<slug>/ for index.html + images, writes:
 *   - projects/manifest.json (tiles use cover.*, else hero.*, else first image)
 *   - projects/<slug>/images.json (hero for page top, cover for gallery lead)
 *
 *   npm run build:projects
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ensureJpegThumb,
  ensureVideoFrameThumb,
  loadThumbCache,
  pruneOrphanThumbs,
  pruneThumbCache,
  resolveFfmpeg,
  saveThumbCache,
  thumbFileName,
} from "./thumbnail-utils.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const projectsDir = path.join(root, "projects");
const manifestFile = path.join(projectsDir, "manifest.json");
const orderFile = path.join(projectsDir, "featured-order.txt");
const THUMB_MAX_WIDTH = 420;

const COVER_PRIORITY = [
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "cover.webp",
];

const HERO_PRIORITY = [
  "hero.jpg",
  "hero.jpeg",
  "hero.png",
  "hero.webp",
];

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv"]);
const SKIP_FILES = new Set(["images.json", "project.json", "index.html"]);

const HERO_VIDEO_PRIORITY = [
  "hero.mp4",
  "hero.webm",
  "hero.mov",
  "hero.mkv",
  "hero.m4v",
];

function humanizeAlt(filename) {
  const base = path.basename(filename, path.extname(filename));
  const words = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words || filename;
}

function humanizeSlug(slug) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isImageFile(name) {
  return IMAGE_EXT.has(path.extname(name).toLowerCase());
}

function isVideoFile(name) {
  return VIDEO_EXT.has(path.extname(name).toLowerCase());
}

function isCoverFile(name) {
  return /^cover\./i.test(name);
}

function isHeroFile(name) {
  return /^hero\./i.test(name);
}

function findByPriority(files, priority) {
  const byLower = new Map(files.map((name) => [name.toLowerCase(), name]));
  for (const name of priority) {
    const hit = byLower.get(name);
    if (hit) return hit;
  }
  return null;
}

function firstSortedImage(files) {
  return (
    files.sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    )[0] || null
  );
}

function listImageFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => !SKIP_FILES.has(name) && isImageFile(name));
}

function listVideoFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((name) => !SKIP_FILES.has(name) && isVideoFile(name));
}

function findVideoPoster(dir, videoFile) {
  const base = path.basename(videoFile, path.extname(videoFile));
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => d.name);
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const candidates = [
    `${base}.jpg`,
    `${base}.jpeg`,
    `${base}.png`,
    `${base}.webp`,
    "poster.jpg",
    "poster.jpeg",
    "poster.png",
  ];
  for (const cand of candidates) {
    const hit = byLower.get(cand.toLowerCase());
    if (hit && isImageFile(hit)) return hit;
  }
  return null;
}

function buildGalleryEntry(file, thumbRelByFile, dir) {
  const entry = { file, alt: humanizeAlt(file) };
  if (isVideoFile(file)) {
    entry.type = "video";
    const poster = findVideoPoster(dir, file);
    if (poster) entry.poster = poster;
    const thumb = thumbRelByFile.get(file);
    if (thumb) entry.thumb = thumb;
  } else {
    const thumb = thumbRelByFile.get(file);
    if (thumb) entry.thumb = thumb;
  }
  return entry;
}

/** Tile image on projects.html: cover.* → hero.* → any image. */
function findCoverFile(dir) {
  const files = listImageFiles(dir);
  let hit = findByPriority(files, COVER_PRIORITY);
  if (hit) return hit;
  hit = files.find((n) => isCoverFile(n));
  if (hit) return hit;
  hit = findByPriority(files, HERO_PRIORITY);
  if (hit) return hit;
  hit = files.find((n) => isHeroFile(n));
  if (hit) return hit;
  return firstSortedImage(files.slice());
}

/** Top media on project page: hero video → hero image → cover.* → any image. */
function findHeroFile(dir, coverFile) {
  const videos = listVideoFiles(dir);
  let hit = findByPriority(videos, HERO_VIDEO_PRIORITY);
  if (hit) return hit;
  hit = videos.find((n) => isHeroFile(n));
  if (hit) return hit;

  const files = listImageFiles(dir);
  hit = findByPriority(files, HERO_PRIORITY);
  if (hit) return hit;
  hit = files.find((n) => isHeroFile(n));
  if (hit) return hit;
  if (coverFile) return coverFile;
  hit = findByPriority(files, COVER_PRIORITY);
  if (hit) return hit;
  hit = files.find((n) => isCoverFile(n));
  if (hit) return hit;
  return firstSortedImage(files.slice());
}

function listGalleryFileNames(dir, coverFile, heroFile, exclude = []) {
  const excludeLower = new Set(exclude.map((n) => n.toLowerCase()));
  const coverLower = coverFile ? coverFile.toLowerCase() : null;
  const heroLower = heroFile ? heroFile.toLowerCase() : null;

  const galleryVideos = listVideoFiles(dir).filter((name) => {
    const lower = name.toLowerCase();
    if (heroLower && lower === heroLower) return false;
    if (isHeroFile(name)) return false;
    if (excludeLower.has(lower)) return false;
    return true;
  });

  const rest = listImageFiles(dir)
    .filter((name) => {
      const lower = name.toLowerCase();
      if (coverLower && lower === coverLower) return false;
      if (heroLower && lower === heroLower) return false;
      if (isCoverFile(name)) return false;
      if (isHeroFile(name)) return false;
      if (excludeLower.has(lower)) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  const merged = [...galleryVideos, ...rest].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  if (coverFile && !excludeLower.has(coverLower)) {
    const withoutCover = merged.filter(
      (n) => n.toLowerCase() !== coverLower
    );
    return [coverFile, ...withoutCover];
  }
  return merged;
}

async function buildThumbs(dir, files, sharp) {
  /** @type {Map<string, string>} */
  const thumbRelByFile = new Map();
  const stats = { created: 0, skipped: 0 };
  if (!files.length) return { thumbRelByFile, stats };

  const thumbsDir = path.join(dir, "thumbs");
  fs.mkdirSync(thumbsDir, { recursive: true });
  const cacheEntries = loadThumbCache(thumbsDir);
  const keepDestNames = new Set();

  for (const file of files) {
    if (path.extname(file).toLowerCase() === ".svg") continue;

    const srcPath = path.join(dir, file);
    const thumbOpts = {
      thumbsDir,
      cacheKey: file,
      srcPath,
      sharp,
      cacheEntries,
      maxWidth: THUMB_MAX_WIDTH,
    };
    const result = isVideoFile(file)
      ? await ensureVideoFrameThumb(thumbOpts)
      : await ensureJpegThumb(thumbOpts);

    if (result.thumbRel) {
      thumbRelByFile.set(file, result.thumbRel);
      keepDestNames.add(thumbFileName(file));
    }
    if (result.skipped) stats.skipped += 1;
    else if (result.created) stats.created += 1;
    else if (result.error) {
      console.warn(
        `Projects: skip thumb for ${file}: ${result.error.message}`
      );
    }
  }

  pruneThumbCache(cacheEntries, files);
  pruneOrphanThumbs(thumbsDir, keepDestNames);
  saveThumbCache(thumbsDir, cacheEntries);

  return { thumbRelByFile, stats };
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/gi, "'");
}

function readTitleFromHtml(htmlPath) {
  try {
    const html = fs.readFileSync(htmlPath, "utf8");
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) return "";
    return decodeHtmlEntities(m[1])
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function loadFeaturedOrder() {
  if (!fs.existsSync(orderFile)) return [];
  return fs
    .readFileSync(orderFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

function loadMeta(dir) {
  const metaPath = path.join(dir, "project.json");
  if (!fs.existsSync(metaPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (e) {
    console.warn(
      `projects: skip invalid project.json in ${path.basename(dir)}: ${e.message}`
    );
    return {};
  }
}

/** YouTube video ID from project.json URL or 11-char id. */
function parseYoutubeId(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    if (u.hostname === "youtu.be" || u.hostname.endsWith(".youtu.be")) {
      const id = u.pathname.replace(/^\//, "").split("/")[0];
      return id || null;
    }
    if (u.hostname.includes("youtube.com")) {
      return u.searchParams.get("v") || null;
    }
  } catch {
    return null;
  }
  return null;
}

function youtubeIdFromMeta(meta) {
  if (!meta || typeof meta !== "object") return null;
  for (const key of ["coverYoutube", "heroYoutube", "youtube"]) {
    const id = parseYoutubeId(meta[key]);
    if (id) return id;
  }
  return null;
}

/** Save cover.jpg from YouTube poster (maxres, else hq). */
async function ensureYoutubeCover(dir, meta, slug) {
  const id = youtubeIdFromMeta(meta);
  if (!id) return;

  const dest = path.join(dir, "cover.jpg");
  const qualities = ["maxresdefault", "hqdefault"];

  for (const quality of qualities) {
    const url = `https://img.youtube.com/vi/${id}/${quality}.jpg`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // maxresdefault 404s or returns a tiny placeholder when unavailable
      if (buf.length < 8000) continue;
      fs.writeFileSync(dest, buf);
      console.log(
        `Projects: ${slug} cover.jpg from YouTube ${quality} (${id})`
      );
      return;
    } catch (e) {
      console.warn(`Projects: ${slug} YouTube cover (${quality}): ${e.message}`);
    }
  }
  console.warn(
    `Projects: ${slug} could not download YouTube cover for ${id}`
  );
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
  console.warn(
    "Projects: `sharp` not installed — gallery thumbs will use full images. Run: npm install"
  );
}

if (!(await resolveFfmpeg())) {
  console.warn(
    "Projects: ffmpeg not on PATH — video tiles will lack frame thumbnails until ffmpeg is installed."
  );
}

if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir, { recursive: true });
}

const featuredOrder = loadFeaturedOrder();
const orderRank = new Map(featuredOrder.map((slug, i) => [slug, i]));
const version = Date.now();
let thumbCreated = 0;
let thumbSkipped = 0;

const entries = [];

for (const dirent of fs
  .readdirSync(projectsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("."))) {
  const slug = dirent.name;
  const dir = path.join(projectsDir, slug);
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) continue;

  const meta = loadMeta(dir);
  await ensureYoutubeCover(dir, meta, slug);
  const coverFile = findCoverFile(dir);
  const heroFile = findHeroFile(dir, coverFile);
  const exclude = Array.isArray(meta.excludeFromGallery)
    ? meta.excludeFromGallery.map(String)
    : [];

  const galleryFiles = listGalleryFileNames(dir, coverFile, heroFile, exclude);
  const thumbResult = await buildThumbs(dir, galleryFiles, sharp);
  const thumbRelByFile = thumbResult.thumbRelByFile;
  thumbCreated += thumbResult.stats.created;
  thumbSkipped += thumbResult.stats.skipped;

  const galleryImages = galleryFiles.map((file) =>
    buildGalleryEntry(file, thumbRelByFile, dir)
  );

  fs.writeFileSync(
    path.join(dir, "images.json"),
    `${JSON.stringify(
      {
        version,
        cover: coverFile || null,
        hero: heroFile || null,
        images: galleryImages,
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const title =
    (typeof meta.title === "string" && meta.title.trim()) ||
    readTitleFromHtml(indexPath) ||
    humanizeSlug(slug);

  let featured = false;
  if (meta.featured === false) featured = false;
  else if (meta.featured === true) featured = true;
  else if (orderRank.has(slug)) featured = true;

  const order =
    typeof meta.order === "number"
      ? meta.order
      : orderRank.has(slug)
        ? orderRank.get(slug)
        : 9999;

  entries.push({
    slug,
    title,
    href: `projects/${slug}/`,
    cover: coverFile ? `projects/${slug}/${coverFile}` : null,
    featured,
    order,
  });
}

entries.sort((a, b) => {
  if (a.featured !== b.featured) return a.featured ? -1 : 1;
  if (a.order !== b.order) return a.order - b.order;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
});

const featuredOnly = entries.filter((p) => p.featured);

fs.writeFileSync(
  manifestFile,
  `${JSON.stringify({ version, featured: featuredOnly, projects: entries }, null, 2)}\n`,
  "utf8"
);

console.log(
  `Projects: ${entries.length} project(s), ${featuredOnly.length} featured, ${thumbCreated} thumbnail(s) built (${thumbSkipped} unchanged) → ${path.relative(root, manifestFile)}`
);
