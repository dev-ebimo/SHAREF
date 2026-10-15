// Shared helpers that keep hand-typed academic data (department, course) consistent on the student pages.
// Load this BEFORE the page's own script.  Depends on nothing; uses authFetch/API_BASE only when you call loadOptions.
//
// Why: department and course are free text, so "computer science", "Computer  Science" and "Computer Science Dept."
// used to show up as three different departments, and a student whose profile spelling differed from the uploader's
// saw an empty list. The API now sends a normalised `departmentKey` / `courseKey` with every resource and with the
// profile; these helpers use them so every spelling of the same department or course behaves as ONE.
(function (global) {
  "use strict";

  // "CSC 305", "csc-305", "Csc305" -> "csc305": comparison-only, for search boxes.
  function compact(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  // Search match that is forgiving about spacing/punctuation: "csc305" finds "CSC 305".
  // `parts` is an array of strings to look in.
  function matchesSearch(parts, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    var haystack = parts.join(" ").toLowerCase();
    if (haystack.indexOf(q) !== -1) return true;
    var cq = compact(q);
    return cq !== "" && compact(haystack).indexOf(cq) !== -1;
  }

  // Is this spelling "tidy"? Mixed case, not SHOUTING and not all lower-case.
  function looksTidy(text) {
    return text !== text.toUpperCase() && text !== text.toLowerCase();
  }

  // Give every record that shares a key ONE spelling, so dropdowns list each department/course once and plain
  // equality filters just work. Which spelling: a tidy one first, then the most common, then alphabetical.
  // (Not "alphabetically first": in ASCII "COMPUTER SCIENCE" sorts before "Computer Science".)
  // Returns { key: displayText }.
  function canonicalizeByKey(records, textProp, keyProp) {
    var stats = {}; // key -> { text: count }
    records.forEach(function (r) {
      var k = r[keyProp];
      var t = r[textProp];
      if (!k || !t) return;
      stats[k] = stats[k] || {};
      stats[k][t] = (stats[k][t] || 0) + 1;
    });
    var byKey = {};
    Object.keys(stats).forEach(function (k) {
      var best = null;
      Object.keys(stats[k]).forEach(function (t) {
        var cand = { t: t, tidy: looksTidy(t) ? 1 : 0, n: stats[k][t] };
        if (!best || cand.tidy > best.tidy || (cand.tidy === best.tidy && (cand.n > best.n || (cand.n === best.n && cand.t < best.t)))) best = cand;
      });
      byKey[k] = best.t;
    });
    records.forEach(function (r) {
      var k = r[keyProp];
      if (k && byKey[k]) r[textProp] = byKey[k];
    });
    return byKey;
  }

  // The spelling to show/select for a profile department: the one used by the loaded resources if there is one,
  // otherwise whatever the profile itself says.
  function displayForProfile(profile, deptByKey) {
    if (!profile || !profile.department) return null;
    return (profile.departmentKey && deptByKey && deptByKey[profile.departmentKey]) || profile.department;
  }

  // Suggestions for the free-text department / course boxes.
  function loadOptions(department) {
    var url = API_BASE + "/meta/options" + (department ? "?department=" + encodeURIComponent(department) : "");
    return authFetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) { return data && data.success ? data : { departments: [], courses: [] }; })
      .catch(function () { return { departments: [], courses: [] }; });
  }

  function fillDatalist(listEl, values) {
    if (!listEl) return;
    listEl.innerHTML = "";
    (values || []).forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      listEl.appendChild(opt);
    });
  }

  // Admin wording <-> upload wording for "wanted" requests (bounties): 'Past Questions' <-> 'Past Question',
  // '300 Level' <-> '300'. Mirrors src/services/incentiveConfig.js.
  var BOUNTY_TYPE = { "Past Questions": "Past Question", "Lecture Notes": "Lecture Note", "Revision Sheet": "Revision Sheet" };
  function bountyTypeToResourceType(t) { return BOUNTY_TYPE[t] || ""; }
  function bountyLevelToResourceLevel(l) {
    var m = /^(\d{3})(?:\s*level)?$/i.exec(String(l || "").trim());
    return m ? m[1] : "";
  }

  global.SharefAcademic = {
    compact: compact,
    matchesSearch: matchesSearch,
    canonicalizeByKey: canonicalizeByKey,
    displayForProfile: displayForProfile,
    loadOptions: loadOptions,
    fillDatalist: fillDatalist,
    bountyTypeToResourceType: bountyTypeToResourceType,
    bountyLevelToResourceLevel: bountyLevelToResourceLevel,
  };
})(window);
