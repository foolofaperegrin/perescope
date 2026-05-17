/**
 * Shared full-size image viewer with prev/next when multiple slides.
 * Usage: const lb = createGalleryLightbox();
 *        lb.open([{ src, alt }, ...], startIndex);
 */
(function (global) {
  function mildProtectImage(el) {
    el.draggable = false;
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
  }

  function createGalleryLightbox() {
    const lbRoot = document.createElement("div");
    lbRoot.id = "gallery-lightbox";
    lbRoot.className = "lightbox";
    lbRoot.setAttribute("role", "dialog");
    lbRoot.setAttribute("aria-modal", "true");
    lbRoot.setAttribute("aria-label", "Image viewer");
    lbRoot.hidden = true;

    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "lightbox__scrim";
    scrim.setAttribute("aria-label", "Close image viewer");

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "lightbox__nav lightbox__nav--prev";
    prevBtn.setAttribute("aria-label", "Previous image");
    prevBtn.innerHTML = "&#10094;";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "lightbox__nav lightbox__nav--next";
    nextBtn.setAttribute("aria-label", "Next image");
    nextBtn.innerHTML = "&#10095;";

    const frame = document.createElement("div");
    frame.className = "lightbox__frame";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "lightbox__close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "&times;";

    const counter = document.createElement("p");
    counter.className = "lightbox__counter muted";
    counter.hidden = true;

    const img = document.createElement("img");
    img.className = "lightbox__img";
    img.alt = "";
    mildProtectImage(img);

    frame.appendChild(closeBtn);
    frame.appendChild(img);
    frame.appendChild(counter);
    lbRoot.appendChild(scrim);
    lbRoot.appendChild(prevBtn);
    lbRoot.appendChild(nextBtn);
    lbRoot.appendChild(frame);
    document.body.appendChild(lbRoot);

    let slides = [];
    let index = 0;
    let lastFocus = null;
    let onKeyDown = null;

    function updateNav() {
      const multi = slides.length > 1;
      prevBtn.hidden = !multi;
      nextBtn.hidden = !multi;
      if (multi) {
        counter.hidden = false;
        counter.textContent = index + 1 + " / " + slides.length;
        lbRoot.setAttribute(
          "aria-label",
          "Image " + (index + 1) + " of " + slides.length
        );
      } else {
        counter.hidden = true;
        lbRoot.setAttribute("aria-label", "Image viewer");
      }
    }

    function showAt(i) {
      if (!slides.length) return;
      index = ((i % slides.length) + slides.length) % slides.length;
      const slide = slides[index];
      img.src = slide.src;
      img.alt = slide.alt || "";
      updateNav();
    }

    function step(delta) {
      if (slides.length < 2) return;
      showAt(index + delta);
    }

    function close() {
      lbRoot.hidden = true;
      img.removeAttribute("src");
      img.alt = "";
      slides = [];
      index = 0;
      counter.hidden = true;
      document.body.style.overflow = "";
      if (onKeyDown) {
        document.removeEventListener("keydown", onKeyDown);
        onKeyDown = null;
      }
      if (lastFocus && typeof lastFocus.focus === "function") {
        lastFocus.focus();
      }
      lastFocus = null;
    }

    function open(slideList, startIndex) {
      if (!slideList || !slideList.length) return;

      slides = slideList;
      lastFocus = document.activeElement;
      showAt(startIndex != null ? startIndex : 0);
      lbRoot.hidden = false;
      document.body.style.overflow = "hidden";
      closeBtn.focus();

      onKeyDown = function (e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
        }
      };
      document.addEventListener("keydown", onKeyDown);
    }

    function openOne(src, alt) {
      open([{ src: src, alt: alt || "" }], 0);
    }

    scrim.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      step(-1);
    });
    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      step(1);
    });

    return { open: open, openOne: openOne, close: close };
  }

  global.createGalleryLightbox = createGalleryLightbox;
})(typeof window !== "undefined" ? window : globalThis);
