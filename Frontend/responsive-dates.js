// ==========================================================================
// responsive-dates.js
//   On phones the date filter shows a custom label ("Approval Date") on top of
//   the native <input type="date">. Android Chrome also draws its own
//   "dd/mm/yyyy" text inside an empty date input, which printed underneath the
//   label. This script marks the wrapper with `.is-empty` while no date is
//   chosen; responsive.css uses that to hide the native text on small screens
//   so only the label is readable. Once a date is picked, the page's own script
//   hides the label and the chosen date shows normally.
//   Read-only with respect to the page's logic: it only toggles a CSS class.
// ==========================================================================
(function () {
  "use strict";

  function sync(wrap, input) {
    if (!input.value) wrap.classList.add("is-empty");
    else wrap.classList.remove("is-empty");
  }

  function init() {
    var wraps = document.querySelectorAll(".date-filter-wrap");
    for (var i = 0; i < wraps.length; i++) {
      (function (wrap) {
        var input = wrap.querySelector('input[type="date"]');
        if (!input) return;
        var run = function () { sync(wrap, input); };
        input.addEventListener("input", run);
        input.addEventListener("change", run);
        // Page scripts may clear the value programmatically (Reset filters),
        // which fires no event, so re-check on any interaction nearby too.
        document.addEventListener("click", function () { setTimeout(run, 0); });
        run();
      })(wraps[i]);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
