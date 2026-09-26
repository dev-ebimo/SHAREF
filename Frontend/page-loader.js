/**
 * Sharef Global Page Loader Controller
 * Manages instant startup loading screen and transitions on all pages.
 */
(function () {
  var LOADER_ID = "app-global-loader";
  var MINIMUM_DISPLAY_TIME_MS = 250; // Smooth visual transition without jarring flash
  var startTime = Date.now();

  function createLoaderElement() {
    if (document.getElementById(LOADER_ID)) return document.getElementById(LOADER_ID);

    var loader = document.createElement("div");
    loader.id = LOADER_ID;
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Loading Sharef");
    loader.innerHTML =
      '<div class="loader-brand-container">' +
        '<div class="loader-logo-ring">' +
          '<svg class="loader-spinner-svg" viewBox="0 0 50 50">' +
            '<circle cx="25" cy="25" r="21" fill="none" stroke="rgba(139, 92, 246, 0.2)" stroke-width="3"></circle>' +
            '<circle cx="25" cy="25" r="21" fill="none" stroke="url(#loader-grad)" stroke-width="3" stroke-dasharray="80 50" stroke-linecap="round"></circle>' +
            '<defs>' +
              '<linearGradient id="loader-grad" x1="0%" y1="0%" x2="100%" y2="100%">' +
                '<stop offset="0%" stop-color="#6366f1"></stop>' +
                '<stop offset="100%" stop-color="#a855f7"></stop>' +
              '</linearGradient>' +
            '</defs>' +
          '</svg>' +
          '<div class="loader-logo-badge">S</div>' +
        '</div>' +
        '<div class="loader-text-wrapper">' +
          '<div class="loader-title"><span>S</span>haref</div>' +
          '<div class="loader-progress-track">' +
            '<div class="loader-progress-bar"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    
    // Inject at the very top of body
    if (document.body) {
      document.body.insertBefore(loader, document.body.firstChild);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        if (!document.getElementById(LOADER_ID)) {
          document.body.insertBefore(loader, document.body.firstChild);
        }
      });
    }
    return loader;
  }

  // Pre-initialize
  var loaderEl = createLoaderElement();

  function hideLoader() {
    var loader = document.getElementById(LOADER_ID) || loaderEl;
    if (!loader) return;

    var elapsed = Date.now() - startTime;
    var delay = Math.max(0, MINIMUM_DISPLAY_TIME_MS - elapsed);

    setTimeout(function () {
      loader.classList.add("loader-hidden");
      setTimeout(function () {
        if (loader.parentNode && loader.classList.contains("loader-hidden")) {
          loader.parentNode.removeChild(loader);
        }
      }, 400);
    }, delay);
  }

  function showLoader() {
    var loader = document.getElementById(LOADER_ID) || createLoaderElement();
    if (loader) {
      loader.classList.remove("loader-hidden");
      startTime = Date.now();
    }
  }

  window.SharefLoader = {
    show: showLoader,
    hide: hideLoader
  };

  // Auto-hide when page completes loading
  if (document.readyState === "complete") {
    hideLoader();
  } else {
    window.addEventListener("load", hideLoader);
    // Safety fallback: if page load takes longer than 2.5s, always reveal page
    setTimeout(hideLoader, 2500);
  }
})();
