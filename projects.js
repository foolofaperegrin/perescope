(function () {
  const grid = document.getElementById("project-tiles");
  const empty = document.getElementById("project-tiles-empty");
  if (!grid) return;

  const manifestUrl = "projects/manifest.json";

  function withCacheBust(url, token) {
    const sep = url.indexOf("?") >= 0 ? "&" : "?";
    return url + sep + "v=" + encodeURIComponent(String(token));
  }

  function appendTile(project, bust) {
    const li = document.createElement("li");
    li.className = "project-tile";

    const a = document.createElement("a");
    a.className = "project-tile__link";
    a.href = project.href;

    const media = document.createElement("span");
    media.className = "project-tile__media";

    if (project.cover) {
      const img = document.createElement("img");
      img.className = "project-tile__img";
      img.src = withCacheBust(project.cover, bust);
      img.alt = project.title || "";
      img.width = 800;
      img.height = 600;
      img.loading = "lazy";
      img.decoding = "async";
      media.appendChild(img);
    } else {
      media.classList.add("project-tile__media--placeholder");
      media.setAttribute("aria-hidden", "true");
    }

    const title = document.createElement("span");
    title.className = "project-tile__title";
    title.textContent = project.title || project.slug || "";

    a.appendChild(media);
    a.appendChild(title);
    li.appendChild(a);
    grid.appendChild(li);
  }

  if (typeof location !== "undefined" && location.protocol === "file:") {
    if (empty) {
      empty.hidden = false;
      empty.textContent =
        "Open this site over HTTP (not file://) to load project tiles, or run the projects build script after adding project folders.";
    }
    return;
  }

  fetch(withCacheBust(manifestUrl, Date.now()), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return res.json();
    })
    .then(function (data) {
      const list = Array.isArray(data.featured)
        ? data.featured
        : Array.isArray(data.projects)
          ? data.projects.filter(function (p) {
              return p.featured !== false;
            })
          : [];

      const bust =
        data.version != null && data.version !== ""
          ? String(data.version)
          : String(Date.now());

      grid.innerHTML = "";

      if (list.length === 0) {
        if (empty) {
          empty.hidden = false;
          empty.innerHTML =
            'No featured projects yet. Add <code>projects/&lt;slug&gt;/index.html</code> and an image (<code>cover.jpg</code> or any jpg/png), list the slug in <code>projects/featured-order.txt</code>, then run <kbd>scripts\\build-projects.ps1</kbd>.';
        }
        return;
      }

      if (empty) empty.hidden = true;
      list.forEach(function (project) {
        appendTile(project, bust);
      });
    })
    .catch(function (err) {
      if (typeof console !== "undefined" && console.error) {
        console.error("Projects:", err);
      }
      if (empty) {
        empty.hidden = false;
        empty.innerHTML =
          'Could not load <code>projects/manifest.json</code>. Run <kbd>scripts\\build-projects.ps1</kbd> from the project root, then refresh.';
      }
    });
})();
