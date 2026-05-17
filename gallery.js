(function () {
  const SG = SiteGallery;
  const root = document.getElementById("gallery-root");
  const empty = document.getElementById("gallery-empty");
  if (!root || !empty) return;

  const manifestUrl = "media/gallery/images.json";
  const fileBase = "media/gallery/";
  const lightbox = SG.createLightbox();

  function showEmpty(message) {
    empty.hidden = false;
    empty.innerHTML = message;
    root.innerHTML = "";
  }

  if (typeof location !== "undefined" && location.protocol === "file:") {
    showEmpty(
      '<strong>Opened as a local file (file://)</strong> — many browsers block loading <code>images.json</code> from disk, so the gallery stays empty or frozen. Serve the folder over HTTP instead (e.g. <kbd>npx serve</kbd> in this directory, or Cursor / VS Code “Simple Browser” / Live Preview on <code>http://localhost:…</code>), then open <code>gallery.html</code> from that URL. After adding images, run the gallery build script and hard-refresh (<kbd>Ctrl+Shift+R</kbd>) if tiles look old.'
    );
    return;
  }

  SG.fetchManifest(manifestUrl)
    .then(function (data) {
      const groups = SG.normalizeGroups(data);
      const totalImages = groups.reduce(function (n, g) {
        return n + g.images.length;
      }, 0);
      const bust =
        data.version != null && data.version !== ""
          ? String(data.version)
          : String(Date.now());

      if (totalImages === 0) {
        showEmpty(
          'No images yet. Add files under <code>media/gallery/</code> (use subfolders to group them), then run <kbd>powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\build-gallery.ps1</kbd> (or <kbd>npm run build:gallery</kbd> if Node is installed), or push to GitHub if Actions are enabled.'
        );
        return;
      }

      empty.hidden = true;
      SG.renderGroups(root, groups, {
        fileBase: fileBase,
        bust: bust,
        lightbox: lightbox,
      });
    })
    .catch(function (err) {
      if (typeof console !== "undefined" && console.error) {
        console.error("Gallery:", err);
      }
      showEmpty(
        'Could not load <code>media/gallery/images.json</code>. Check the browser console (F12). From the project root run the gallery build script, commit <code>images.json</code>, then try a <strong>hard refresh</strong> (<kbd>Ctrl+Shift+R</kbd>). If you use GitHub Pages, confirm <code>media/gallery/</code> is deployed with the site.'
      );
    });
})();
