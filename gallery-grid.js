/**
 * Shared gallery grid + lightbox wiring. Used by gallery.js and project-page.js.
 *
 * Markup is built in JS so pages only need:
 *   <div class="gallery-mount" data-gallery-heading="…" …></div>
 */
(function (global) {
  const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i;

  const CLASSES = {
    mount: "gallery-mount",
    section: "project-gallery-section",
    sectionHeading: "project-page__subheading",
    group: "gallery-group",
    groupHeading: "gallery-group__heading",
    grid: "gallery-grid",
    item: "gallery-item",
    figure: "gallery-figure",
    link: "gallery-link",
    thumb: "gallery-thumb",
  };

  function isVideoEntry(entry, file) {
    if (typeof entry === "object" && entry && entry.type === "video") return true;
    return file && VIDEO_EXT.test(String(file));
  }

  function posterRelFromEntry(entry) {
    if (typeof entry === "object" && entry && entry.poster) {
      return String(entry.poster);
    }
    return "";
  }

  function withCacheBust(url, token) {
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    return url + sep + "v=" + encodeURIComponent(String(token));
  }

  function encodePathSegments(relPath) {
    return relPath
      .split("/")
      .map(function (seg) {
        return encodeURIComponent(seg);
      })
      .join("/");
  }

  function mildProtectImage(el) {
    el.draggable = false;
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
  }

  function fileFromEntry(entry) {
    return typeof entry === "string" ? entry : entry.file;
  }

  function altFromEntry(entry, file) {
    return (typeof entry === "object" && entry && entry.alt) || file || "";
  }

  function thumbRelFromEntry(entry) {
    return typeof entry === "object" && entry && entry.thumb
      ? String(entry.thumb)
      : "";
  }

  function normalizeFileBase(fileBase) {
    if (!fileBase) return "";
    return fileBase.endsWith("/") ? fileBase : fileBase + "/";
  }

  /** Project paths (projects/slug/…) are site-root relative; gallery paths use media/gallery/. */
  function fileBaseForEntry(entry, defaultBase) {
    const file = fileFromEntry(entry);
    if (file && String(file).replace(/\\/g, "/").indexOf("projects/") === 0) {
      return "";
    }
    return normalizeFileBase(defaultBase);
  }

  function entryToSlide(entry, fileBase, bust) {
    const file = fileFromEntry(entry);
    const base = normalizeFileBase(fileBase);
    const slide = {
      src: withCacheBust(base + encodePathSegments(file), bust),
      alt: altFromEntry(entry, file),
      file: file,
      thumbRel: thumbRelFromEntry(entry),
    };
    if (isVideoEntry(entry, file)) {
      slide.type = "video";
      const posterRel = posterRelFromEntry(entry) || thumbRelFromEntry(entry);
      if (posterRel) {
        slide.poster = withCacheBust(base + encodePathSegments(posterRel), bust);
      }
    }
    return slide;
  }

  function slidesFromEntries(entries, defaultBase, bust) {
    return entries.map(function (entry) {
      return entryToSlide(entry, fileBaseForEntry(entry, defaultBase), bust);
    });
  }

  function createGrid(ariaLabel) {
    const grid = document.createElement("ul");
    grid.className = CLASSES.grid;
    grid.setAttribute("role", "list");
    if (ariaLabel) grid.setAttribute("aria-label", ariaLabel);
    return grid;
  }

  function appendTile(grid, entry, options) {
    const entryBase = fileBaseForEntry(entry, options.fileBase);
    const bust = options.bust;
    const slides = options.slides;
    const slideIndex = options.slideIndex;
    const lightbox = options.lightbox;

    const file = fileFromEntry(entry);
    const alt = altFromEntry(entry, file);
    const thumbRel = thumbRelFromEntry(entry);
    const slide = slides[slideIndex];
    const isVideo = isVideoEntry(entry, file);
    const displaySrcRaw = options.preferFullSize
      ? entryBase + encodePathSegments(file)
      : thumbRel
        ? entryBase + encodePathSegments(thumbRel)
        : entryBase + encodePathSegments(file);

    const li = document.createElement("li");
    li.className = isVideo ? CLASSES.item + " gallery-item--video" : CLASSES.item;

    const figure = document.createElement("figure");
    figure.className = CLASSES.figure;

    const a = document.createElement("a");
    a.className = CLASSES.link;
    a.href = slide.src;
    if (isVideo) {
      a.setAttribute("aria-label", (alt || file) + " — play video");
    }

    if (isVideo && !thumbRel) {
      const placeholder = document.createElement("span");
      placeholder.className = CLASSES.thumb + " gallery-thumb--video";
      a.appendChild(placeholder);
    } else {
      const img = document.createElement("img");
      img.className = CLASSES.thumb;
      img.src = withCacheBust(displaySrcRaw, bust);
      img.alt = alt;
      img.loading = "lazy";
      img.decoding = "async";
      img.fetchPriority = "low";
      mildProtectImage(img);
      a.appendChild(img);
    }

    a.addEventListener("click", function (e) {
      if (e.button !== 0) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      lightbox.open(
        slides.map(function (s) {
          const item = { src: s.src, alt: s.alt };
          if (s.type === "video") {
            item.type = "video";
            if (s.poster) item.poster = s.poster;
          }
          return item;
        }),
        slideIndex
      );
    });

    figure.appendChild(a);
    li.appendChild(figure);
    grid.appendChild(li);
  }

  function renderTiles(grid, entries, options) {
    const defaultBase = options.fileBase;
    const bust = options.bust;
    const lightbox = options.lightbox;
    const slides = slidesFromEntries(entries, defaultBase, bust);
    entries.forEach(function (entry, slideIndex) {
      appendTile(grid, entry, {
        fileBase: defaultBase,
        bust: bust,
        slides: slides,
        slideIndex: slideIndex,
        lightbox: lightbox,
        preferFullSize: options.preferFullSize,
      });
    });
    return slides;
  }

  /** Single group block (project page or one category). */
  function buildSection(config) {
    const section = document.createElement("section");
    section.className = config.sectionClass || CLASSES.section;
    section.hidden = true;
    if (config.ariaLabel) section.setAttribute("aria-label", config.ariaLabel);

    if (config.heading) {
      const heading = document.createElement("h2");
      heading.className = config.headingClass || CLASSES.sectionHeading;
      heading.textContent = config.heading;
      section.appendChild(heading);
    }

    const gridLabel =
      config.gridAriaLabel ||
      (config.heading ? config.heading + " gallery" : "Gallery thumbnails");
    const grid = createGrid(gridLabel);
    section.appendChild(grid);

    return { section: section, grid: grid };
  }

  /** Multi-group layout (main gallery page). */
  function buildGroupBlock(group, options) {
    const section = document.createElement("section");
    section.className = CLASSES.group;

    if (group.title) {
      const heading = document.createElement("h2");
      heading.className = CLASSES.groupHeading;
      heading.textContent = group.title;
      section.appendChild(heading);
    }

    const gridLabel = group.title
      ? group.title + " gallery"
      : "Gallery thumbnails";
    const grid = createGrid(gridLabel);
    renderTiles(grid, group.images, options);
    section.appendChild(grid);
    return section;
  }

  function renderGroups(container, groups, options) {
    container.innerHTML = "";
    groups.forEach(function (group) {
      if (!group.images || !group.images.length) return;
      container.appendChild(buildGroupBlock(group, options));
    });
  }

  function normalizeGroups(data) {
    if (Array.isArray(data.groups) && data.groups.length > 0) {
      return data.groups.map(function (group) {
        return {
          folder: group.folder != null ? String(group.folder) : "",
          title: group.title != null ? String(group.title) : "",
          images: Array.isArray(group.images) ? group.images : [],
        };
      });
    }
    const flat = Array.isArray(data.images) ? data.images : [];
    return [{ folder: "", title: "", images: flat }];
  }

  function pickGroup(data, folderName) {
    if (!Array.isArray(data.groups) || !folderName) return [];
    const key = folderName.trim().toLowerCase();
    const group = data.groups.find(function (g) {
      const folder = (g.folder != null ? String(g.folder) : "").toLowerCase();
      const title = (g.title != null ? String(g.title) : "").toLowerCase();
      return folder === key || title === key;
    });
    return group && Array.isArray(group.images) ? group.images : [];
  }

  /** Ensure project cover is first in a gallery list (idempotent). */
  function mergeCoverFirst(images, localData) {
    const list = Array.isArray(images) ? images.slice() : [];
    if (!localData || !localData.cover) return list;

    const cover = String(localData.cover);
    const coverLower = cover.toLowerCase();
    const idx = list.findIndex(function (entry) {
      const f = fileFromEntry(entry);
      return f && String(f).toLowerCase() === coverLower;
    });

    if (idx > 0) {
      const entry = list.splice(idx, 1)[0];
      list.unshift(entry);
      return list;
    }
    if (idx === 0) return list;

    let coverEntry = null;
    if (Array.isArray(localData.images)) {
      coverEntry = localData.images.find(function (entry) {
        const f = fileFromEntry(entry);
        return f && String(f).toLowerCase() === coverLower;
      });
    }
    if (!coverEntry) {
      coverEntry = { file: cover, alt: altFromEntry(null, cover) };
    }
    return [coverEntry].concat(list);
  }

  function fetchManifest(url) {
    return fetch(withCacheBust(url, Date.now()), { cache: "no-store" }).then(
      function (res) {
        if (!res.ok) throw new Error(res.status + " " + res.statusText);
        return res.json();
      }
    );
  }

  function createLightbox() {
    return global.createGalleryLightbox();
  }

  global.SiteGallery = {
    CLASSES: CLASSES,
    withCacheBust: withCacheBust,
    encodePathSegments: encodePathSegments,
    normalizeFileBase: normalizeFileBase,
    entryToSlide: entryToSlide,
    slidesFromEntries: slidesFromEntries,
    createGrid: createGrid,
    appendTile: appendTile,
    renderTiles: renderTiles,
    buildSection: buildSection,
    buildGroupBlock: buildGroupBlock,
    renderGroups: renderGroups,
    normalizeGroups: normalizeGroups,
    pickGroup: pickGroup,
    mergeCoverFirst: mergeCoverFirst,
    fileFromEntry: fileFromEntry,
    fetchManifest: fetchManifest,
    createLightbox: createLightbox,
  };
})(typeof window !== "undefined" ? window : globalThis);
