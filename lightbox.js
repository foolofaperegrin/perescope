/**
 * Shared full-size image/video viewer with prev/next when multiple slides.
 * Usage: const lb = createGalleryLightbox();
 *        lb.open([{ src, alt, type?: "video" }, ...], startIndex);
 */
(function (global) {
  const VIDEO_EXT = /\.(mp4|webm|mkv|mov|m4v|ogv)$/i;

  function mildProtectImage(el) {
    el.draggable = false;
    el.addEventListener("contextmenu", function (e) {
      e.preventDefault();
    });
  }

  function isVideoSlide(slide) {
    if (!slide) return false;
    if (slide.type === "video") return true;
    return slide.src && VIDEO_EXT.test(slide.src.split("?")[0]);
  }

  function pauseVideo(video) {
    if (!video) return;
    try {
      video.pause();
    } catch (e) {
      /* ignore */
    }
    video.removeAttribute("src");
    video.load();
  }

  function createGalleryLightbox() {
    const lbRoot = document.createElement("div");
    lbRoot.id = "gallery-lightbox";
    lbRoot.className = "lightbox";
    lbRoot.setAttribute("role", "dialog");
    lbRoot.setAttribute("aria-modal", "true");
    lbRoot.setAttribute("aria-label", "Media viewer");
    lbRoot.hidden = true;

    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "lightbox__scrim";
    scrim.setAttribute("aria-label", "Close viewer");

    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "lightbox__nav lightbox__nav--prev";
    prevBtn.setAttribute("aria-label", "Previous");
    prevBtn.innerHTML = "&#10094;";

    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "lightbox__nav lightbox__nav--next";
    nextBtn.setAttribute("aria-label", "Next");
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

    const video = document.createElement("video");
    video.className = "lightbox__video";
    video.controls = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = "auto";
    video.hidden = true;

    frame.appendChild(closeBtn);
    frame.appendChild(img);
    frame.appendChild(video);
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
          "Media " + (index + 1) + " of " + slides.length
        );
      } else {
        counter.hidden = true;
        lbRoot.setAttribute("aria-label", "Media viewer");
      }
    }

    function showAt(i) {
      if (!slides.length) return;
      index = ((i % slides.length) + slides.length) % slides.length;
      const slide = slides[index];
      const videoMode = isVideoSlide(slide);

      pauseVideo(video);

      if (videoMode) {
        img.hidden = true;
        img.removeAttribute("src");
        img.alt = "";
        video.hidden = false;
        video.loop = true;
        video.src = slide.src;
        if (slide.poster) video.poster = slide.poster;
        else video.removeAttribute("poster");
        const playAttempt = video.play();
        if (playAttempt && typeof playAttempt.catch === "function") {
          playAttempt.catch(function () {
            /* autoplay blocked until user interacts */
          });
        }
        lbRoot.setAttribute("aria-label", (slide.alt || "Video") + " — media viewer");
      } else {
        video.hidden = true;
        img.hidden = false;
        img.src = slide.src;
        img.alt = slide.alt || "";
      }

      updateNav();
    }

    function step(delta) {
      if (slides.length < 2) return;
      showAt(index + delta);
    }

    function close() {
      lbRoot.hidden = true;
      img.hidden = false;
      img.removeAttribute("src");
      img.alt = "";
      pauseVideo(video);
      video.hidden = true;
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

    function openOne(src, alt, type) {
      open([{ src: src, alt: alt || "", type: type }], 0);
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
