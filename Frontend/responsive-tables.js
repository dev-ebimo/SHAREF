// ==========================================================================
// responsive-tables.js
//   Admin tables have 6-9 columns and cannot fit a phone. On screens <= 700px
//   responsive.css turns each row into a card ("LABEL   value" lines). A card
//   needs to know each cell's column name, but the rows are built by page
//   scripts (users.js, approved-resources.js ...) via innerHTML, so the labels
//   can't live in the HTML. This script copies each column header into a
//   data-label attribute on every cell, and keeps doing it whenever a page
//   script re-renders the rows (pagination, filtering, search).
//
//   It only reads/sets attributes - it never changes your row markup, so no
//   page script needs to be modified. Safe to include on any page with tables.
// ==========================================================================
(function () {
  "use strict";

  function headings(table) {
    var out = [];
    var ths = table.querySelectorAll("thead th");
    for (var i = 0; i < ths.length; i++) {
      var span = parseInt(ths[i].getAttribute("colspan") || "1", 10) || 1;
      var text = (ths[i].textContent || "").replace(/\s+/g, " ").trim();
      for (var s = 0; s < span; s++) out.push(text);
    }
    return out;
  }

  function labelRows(table) {
    var heads = headings(table);
    if (!heads.length) return;
    // The "lead" column (User / Name / Title...) becomes the card's heading.
    var primary = -1;
    for (var h = 0; h < heads.length; h++) {
      if (/^(user|name|title)/i.test(heads[h])) { primary = h; break; }
    }
    var rows = table.querySelectorAll("tbody tr");
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].children;
      for (var c = 0; c < cells.length; c++) {
        var td = cells[c];
        if (td.tagName !== "TD" || td.hasAttribute("colspan")) continue;
        if (!td.hasAttribute("data-label")) td.setAttribute("data-label", heads[c] || "");
        if (c === primary && !td.hasAttribute("data-primary")) td.setAttribute("data-primary", "");
      }
    }
  }

  function enhance(table) {
    if (table.__stacked) return;
    table.__stacked = true;
    table.classList.add("is-stacked");
    labelRows(table);

    var tbodies = table.tBodies;
    var pending = false;
    var observer = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; labelRows(table); });
    });
    for (var i = 0; i < tbodies.length; i++) observer.observe(tbodies[i], { childList: true });
  }

  function init() {
    var tables = document.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) enhance(tables[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
