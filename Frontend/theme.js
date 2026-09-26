/**
 * Sharef Unified Theme Controller
 * Supports instant pre-paint theme execution, navbar toggle button injection,
 * and persistent localStorage synchronization.
 */
(function () {
  var STORAGE_KEY = "sharef_theme";
  var SUN_ICON_SVG = '<svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
  var MOON_ICON_SVG = '<svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

  function getStoredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (e) {
      console.warn("Could not read theme from localStorage", e);
    }
    // Default to dark mode for Sharef brand aesthetic
    return "dark";
  }

  function applyTheme(theme) {
    var isLight = theme === "light";
    document.documentElement.setAttribute("data-theme", theme);
    
    if (document.body) {
      if (isLight) {
        document.body.classList.add("light-theme");
        document.body.classList.remove("dark-theme");
      } else {
        document.body.classList.remove("light-theme");
        document.body.classList.add("dark-theme");
      }
    }

    // Update all toggle buttons in DOM
    var buttons = document.querySelectorAll(".theme-toggle-btn, #themeToggleBtn");
    buttons.forEach(function (btn) {
      btn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
      btn.setAttribute("title", isLight ? "Switch to dark mode" : "Switch to light mode");
    });

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      console.warn("Could not save theme to localStorage", e);
    }

    window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  // Pre-paint application (runs immediately as script loads in <head>)
  var currentTheme = getStoredTheme();
  document.documentElement.setAttribute("data-theme", currentTheme);

  function toggleTheme() {
    var active = document.documentElement.getAttribute("data-theme") || "dark";
    var next = active === "light" ? "dark" : "light";
    applyTheme(next);
  }

  function createToggleButton() {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle-btn";
    btn.id = "themeToggleBtn";
    var isLight = (document.documentElement.getAttribute("data-theme") || getStoredTheme()) === "light";
    btn.setAttribute("aria-label", isLight ? "Switch to dark mode" : "Switch to light mode");
    btn.setAttribute("title", isLight ? "Switch to dark mode" : "Switch to light mode");
    btn.innerHTML = SUN_ICON_SVG + MOON_ICON_SVG;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      toggleTheme();
    });
    return btn;
  }

  function injectThemeToggle() {
    // If a theme toggle already exists in document, just ensure it has handler
    var existingButtons = document.querySelectorAll(".theme-toggle-btn, #themeToggleBtn");
    if (existingButtons.length > 0) {
      existingButtons.forEach(function (btn) {
        if (!btn.hasAttribute("data-theme-bound")) {
          btn.setAttribute("data-theme-bound", "true");
          if (!btn.innerHTML.includes("theme-icon-sun")) {
            btn.innerHTML = SUN_ICON_SVG + MOON_ICON_SVG;
          }
          btn.addEventListener("click", function (e) {
            e.preventDefault();
            toggleTheme();
          });
        }
      });
      return;
    }

    // Auto-inject into target nav container
    var targetNav = document.querySelector(".nav-actions") ||
                    document.querySelector(".top-nav") ||
                    document.querySelector("header.container nav") ||
                    document.querySelector("header nav") ||
                    document.querySelector("nav") ||
                    document.querySelector(".auth-header");

    if (targetNav) {
      var btn = createToggleButton();
      btn.setAttribute("data-theme-bound", "true");
      
      // In top-nav / nav-actions, insert before the account menu or notifications
      var accountWrapper = targetNav.querySelector(".account-menu-wrapper") ||
                           targetNav.querySelector(".icon-btn-badge") ||
                           targetNav.querySelector(".nav-btn");
      if (accountWrapper && accountWrapper.parentNode === targetNav) {
        targetNav.insertBefore(btn, accountWrapper);
      } else {
        targetNav.appendChild(btn);
      }
    }
  }

  // Setup listeners on DOM Ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyTheme(getStoredTheme());
      injectThemeToggle();
    });
  } else {
    applyTheme(getStoredTheme());
    injectThemeToggle();
  }

  // Re-check after full window load for any dynamically hydrated navbars
  window.addEventListener("load", function () {
    injectThemeToggle();
  });

  // Cross-tab synchronization
  window.addEventListener("storage", function (e) {
    if (e.key === STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
      applyTheme(e.newValue);
    }
  });

  // Public API
  window.SharefTheme = {
    getTheme: function () {
      return document.documentElement.getAttribute("data-theme") || getStoredTheme();
    },
    setTheme: applyTheme,
    toggleTheme: toggleTheme,
    injectThemeToggle: injectThemeToggle
  };
})();
