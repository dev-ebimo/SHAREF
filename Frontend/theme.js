/* Sharef theme switcher: System / Light / Dark.
 *
 * Load it in <head>, as a plain (non-deferred) script BEFORE the stylesheets paint:
 *     <script src="theme.js"></script>
 * so the saved choice is applied before first paint and a dark-mode student never sees a white flash.
 *
 * How it works: the theme (sharef-theme.css) defines light tokens on :root and dark tokens under
 *   :root[data-theme="dark"]   and   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }.
 * "System" simply leaves the attribute off, so the OS decides. "Light"/"Dark" set data-theme explicitly.
 * The choice is remembered in localStorage ("sharef.theme") and shared between open tabs.
 */
(function () {
  "use strict";
  var KEY = "sharef.theme";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "light" || v === "dark" ? v : "system";
    } catch (e) {
      return "system";
    }
  }
  function isDark() {
    var forced = root.getAttribute("data-theme");
    if (forced) return forced === "dark";
    return !!(mq && mq.matches);
  }
  // The browser UI (address bar on Android, status bar on iOS) should match the page.
  function syncMeta() {
    if (!document.head) return;
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "theme-color");
      document.head.appendChild(m);
    }
    m.setAttribute("content", isDark() ? "#0a1020" : "#f3f5fa");
  }
  function apply(mode) {
    if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");
    syncMeta();
  }
  function set(mode) {
    try {
      if (mode === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch (e) { /* private mode: still applies for this page view */ }
    apply(mode);
    refresh();
  }

  apply(stored()); // before first paint

  if (mq && mq.addEventListener) mq.addEventListener("change", function () { if (stored() === "system") syncMeta(); });
  window.addEventListener("storage", function (e) { if (e.key === KEY) { apply(stored()); refresh(); } });

  // ---- UI ---------------------------------------------------------------------------------------------------
  var MODES = [
    { id: "system", label: "System" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
  ];
  var ICON_MOON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
  var ICON_SUN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4l1.4-1.4"/></svg>';

  function refresh() {
    var mode = stored();
    var buttons = document.querySelectorAll("[data-theme-mode]");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-theme-mode") === mode;
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
      buttons[i].classList.toggle("is-active", on); // the settings pages style their segmented control with .is-active
    }
    var fab = document.querySelector(".theme-fab");
    if (fab) {
      fab.innerHTML = isDark() ? ICON_SUN : ICON_MOON;
      fab.setAttribute("aria-label", isDark() ? "Switch to light mode" : "Switch to dark mode");
    }
  }

  function buildSwitch() {
    var wrap = document.createElement("div");
    wrap.className = "theme-switch";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Appearance");
    var label = document.createElement("span");
    label.className = "theme-switch-label";
    label.textContent = "Appearance";
    wrap.appendChild(label);
    var row = document.createElement("div");
    row.className = "theme-switch-row";
    MODES.forEach(function (m) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = m.label;
      b.setAttribute("data-theme-mode", m.id);
      b.addEventListener("click", function (ev) { ev.stopPropagation(); set(m.id); });
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }

  function mount() {
    syncMeta();
    // Controls that already exist in the page (the Settings > Appearance segmented control).
    var staticBtns = document.querySelectorAll(".segmented-control [data-theme-mode]");
    for (var k = 0; k < staticBtns.length; k++) {
      (function (btn) { btn.addEventListener("click", function () { set(btn.getAttribute("data-theme-mode")); }); })(staticBtns[k]);
    }
    var menus = document.querySelectorAll(".account-dropdown");
    if (menus.length) {
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].querySelector(".theme-switch")) continue;
        var logout = menus[i].querySelector(".account-logout-item");
        var anchor = logout && logout.previousElementSibling && /divider/.test(logout.previousElementSibling.className) ? logout.previousElementSibling : logout;
        var sw = buildSwitch();
        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sw, anchor);
        else menus[i].appendChild(sw);
      }
    } else if (!document.querySelector(".theme-fab")) {
      // Pages without an account menu (login, sign up, legal pages): a small floating toggle.
      var fab = document.createElement("button");
      fab.type = "button";
      fab.className = "theme-fab";
      fab.addEventListener("click", function () { set(isDark() ? "light" : "dark"); });
      document.body.appendChild(fab);
    }
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();

  window.SharefTheme = { get: stored, set: set, isDark: isDark };
})();
