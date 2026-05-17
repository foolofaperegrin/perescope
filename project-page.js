(function () {
  const SG = SiteGallery;
  const hero = document.querySelector("[data-project-hero]");
  const mount = document.querySelector(".gallery-mount");

  function readMountConfig(el) {
    if (!el) return null;
    return {
      heading: el.dataset.galleryHeading || "Gallery",
      ariaLabel: el.dataset.galleryAriaLabel || "Project images",
      siteFolder: el.dataset.galleryFolder || "",
      siteManifest: el.dataset.galleryManifest || "",
      siteBase: el.dataset.galleryBase || "../../media/gallery/",
    };
  }

  function showGallerySection(section, grid, images, bust, fileBase, lightbox) {
    if (!images.length) return;
    section.hidden = false;
    SG.renderTiles(grid, images, {
      fileBase: fileBase,
      bust: bust,
      lightbox: lightbox,
      preferFullSize: true,
    });
  }

  if (!mount) return;

  const config = readMountConfig(mount);
  const lightbox = SG.createLightbox();
  const built = SG.buildSection({
    heading: config.heading,
    ariaLabel: config.ariaLabel,
    gridAriaLabel: config.ariaLabel,
  });

  mount.replaceWith(built.section);

  const siteFolder = config.siteFolder;
  const siteManifest = config.siteManifest;

  const localManifestPromise = SG.fetchManifest("images.json").catch(function () {
    return null;
  });

  const siteManifestPromise =
    siteFolder && siteManifest
      ? SG.fetchManifest(siteManifest)
      : Promise.resolve(null);

  Promise.all([localManifestPromise, siteManifestPromise])
    .then(function (results) {
      const localData = results[0];
      const siteData = results[1];

      if (hero && localData) {
        const heroFile =
          localData.hero || localData.cover || null;
        if (heroFile) {
          const bust =
            localData.version != null && localData.version !== ""
              ? String(localData.version)
              : String(Date.now());
          hero.src = SG.withCacheBust(
            SG.encodePathSegments(heroFile),
            bust
          );
        }
      }

      if (siteFolder && siteData) {
        const bust =
          siteData.version != null && siteData.version !== ""
            ? String(siteData.version)
            : String(Date.now());
        const images = SG.mergeCoverFirst(
          SG.pickGroup(siteData, siteFolder),
          localData
        );
        showGallerySection(
          built.section,
          built.grid,
          images,
          bust,
          SG.normalizeFileBase(config.siteBase),
          lightbox
        );
        return;
      }

      if (
        localData &&
        Array.isArray(localData.images) &&
        localData.images.length
      ) {
        const bust =
          localData.version != null && localData.version !== ""
            ? String(localData.version)
            : String(Date.now());
        showGallerySection(
          built.section,
          built.grid,
          SG.mergeCoverFirst(localData.images, localData),
          bust,
          "",
          lightbox
        );
      }
    })
    .catch(function (err) {
      if (typeof console !== "undefined" && console.error) {
        console.error("Project page:", err);
      }
    });
})();
