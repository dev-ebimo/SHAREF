// ==========================================================================
// resource-editor.js — admin "Edit resource details" dialog
//
// One shared dialog used by the Pending (admin-moderation), Approved and
// Rejected pages, so a typo a student made at upload time can be corrected
// without rejecting and re-uploading.
//
//   ResourceEditor.open(resourceId, { onSaved(resource, result) { ... } })
//
// What it does:
//   1. GET  /api/admin/resources/:id   -> pre-fills the form with current values
//   2. PATCH /api/admin/resources/:id  -> sends ONLY the fields that changed
//   3. Fires a `resource:edited` event on document (detail: { id, resource,
//      changedFields }) and calls opts.onSaved, so each page can refresh itself.
//
// Needs the globals the admin pages already load: API_BASE (api-config.js) and
// authFetch (auth-guard.js). All server text is written with .textContent /
// .value, never innerHTML, so edited titles can't inject markup.
// ==========================================================================
(function () {
  "use strict";

  var TYPES = ["Lecture Note", "Past Question", "Assignment Material", "Textbook", "Revision Sheet", "Other"];
  var LEVELS = ["100", "200", "300", "400", "500", "600"];
  var MAX_PAGES = 1000;

  var STATUS_LABEL = { pending: "Pending review", approved: "Approved", rejected: "Rejected" };

  // key = API field name. `approvedOnly` fields are hidden for pending/rejected items
  // (the server rejects them there too).
  var FIELDS = [
    { key: "title", label: "Title", kind: "text", full: true, required: true, max: 300 },
    { key: "type", label: "Resource type", kind: "select", required: true,
      options: TYPES.map(function (t) { return [t, t]; }) },
    { key: "course", label: "Course code", kind: "text", required: true, max: 60, placeholder: "e.g. CSC 201" },
    { key: "department", label: "Department", kind: "text", full: true, required: true, max: 150, list: true },
    { key: "level", label: "Level", kind: "select", required: true,
      options: LEVELS.map(function (l) { return [l, l + " Level"]; }) },
    { key: "semester", label: "Semester", kind: "select", required: true,
      options: [["First", "First Semester"], ["Second", "Second Semester"]] },
    { key: "session", label: "Session", kind: "text", required: true, max: 30, placeholder: "e.g. 2024/2025" },
    { key: "pages", label: "Page count", kind: "number", approvedOnly: true, min: 1, max: MAX_PAGES,
      hint: "The count confirmed at review." },
    { key: "description", label: "Description", kind: "textarea", full: true, max: 5000 }
  ];

  var els = null;            // cached DOM, built on first open
  var current = null;        // { id, original, status, opts, trigger }
  var openToken = 0;         // ignores late responses from an earlier open()
  var saving = false;
  var departmentsLoaded = false;

  // ---------- small helpers ----------
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") node.className = attrs[k];
      else if (k === "text") node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function xIcon() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
    var p = document.createElementNS(ns, "path"); p.setAttribute("d", "M6 18L18 6M6 6l12 12");
    svg.appendChild(p); return svg;
  }

  function str(v) { return v === null || v === undefined ? "" : String(v); }

  // ---------- build the dialog once ----------
  function build() {
    var form = h("form", { id: "reForm", novalidate: "", hidden: "", autocomplete: "off" });
    var banner = h("div", { class: "re-banner", role: "alert", hidden: "" });
    var grid = h("div", { class: "re-grid" });
    var fieldEls = {};

    FIELDS.forEach(function (f) {
      var id = "re_" + f.key;
      var input;
      if (f.kind === "select") {
        input = h("select", { id: id, class: "re-input", name: f.key });
        f.options.forEach(function (o) { input.appendChild(h("option", { value: o[0], text: o[1] })); });
      } else if (f.kind === "textarea") {
        input = h("textarea", { id: id, class: "re-input", name: f.key, rows: "4", maxlength: String(f.max) });
      } else {
        input = h("input", { id: id, class: "re-input", name: f.key, type: f.kind === "number" ? "number" : "text" });
        if (f.max && f.kind === "text") input.setAttribute("maxlength", String(f.max));
        if (f.kind === "number") { input.setAttribute("min", String(f.min)); input.setAttribute("max", String(f.max)); input.setAttribute("step", "1"); input.setAttribute("inputmode", "numeric"); }
        if (f.placeholder) input.setAttribute("placeholder", f.placeholder);
        if (f.list) input.setAttribute("list", "reDeptList");
      }
      var err = h("div", { class: "re-error", id: id + "_err", hidden: "" });
      input.setAttribute("aria-describedby", id + "_err");
      var wrap = h("div", { class: "re-field" + (f.full ? " is-full" : "") }, [
        h("label", { class: "re-label", for: id, text: f.label + (f.required ? " *" : "") }),
        input, err, f.hint ? h("div", { class: "re-hint", text: f.hint }) : null
      ]);
      if (f.approvedOnly) wrap.hidden = true;
      grid.appendChild(wrap);
      fieldEls[f.key] = { wrap: wrap, input: input, err: err, def: f };
    });

    form.appendChild(banner);
    form.appendChild(grid);
    form.appendChild(h("datalist", { id: "reDeptList" }));

    var state = h("div", { class: "re-state", id: "reState", role: "status" });
    var title = h("h2", { id: "reTitle", text: "Edit resource details" });
    var sub = h("p", { class: "re-sub", id: "reSub" });
    var closeBtn = h("button", { type: "button", class: "re-x", "aria-label": "Close" }, [xIcon()]);
    var cancel = h("button", { type: "button", class: "re-btn re-btn-ghost", text: "Cancel" });
    var save = h("button", { type: "submit", class: "re-btn re-btn-primary", form: "reForm", text: "Save changes", disabled: "" });
    var dirty = h("span", { class: "re-dirty", "aria-live": "polite" });

    var dialog = h("div", { class: "re-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "reTitle" }, [
      h("div", { class: "re-head" }, [h("div", null, [title, sub]), closeBtn]),
      h("div", { class: "re-body" }, [state, form]),
      h("div", { class: "re-foot" }, [dirty, cancel, save])
    ]);
    var overlay = h("div", { class: "re-overlay", hidden: "" }, [dialog]);
    document.body.appendChild(overlay);

    els = { overlay: overlay, dialog: dialog, form: form, banner: banner, state: state, sub: sub,
            save: save, cancel: cancel, closeBtn: closeBtn, dirty: dirty, fields: fieldEls,
            deptList: form.querySelector("#reDeptList") };

    closeBtn.addEventListener("click", requestClose);
    cancel.addEventListener("click", requestClose);
    form.addEventListener("submit", onSubmit);
    form.addEventListener("input", refreshDirty);
    form.addEventListener("change", refreshDirty);

    // Clicking the dark backdrop closes (with the unsaved-changes check).
    overlay.addEventListener("mousedown", function (e) { if (e.target === overlay) requestClose(); });

    // The admin pages have document-level keyboard shortcuts (e.g. A = approve, R = reject
    // in the moderation preview). Typing into this dialog must never reach them, so every
    // key event stops here. Escape and the Tab focus-trap are handled below.
    overlay.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
      if (e.key === "Tab") trapFocus(e);
    });
    ["keyup", "keypress"].forEach(function (t) { overlay.addEventListener(t, function (e) { e.stopPropagation(); }); });
  }

  function focusables() {
    var list = els.dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    return Array.prototype.filter.call(list, function (n) { return n.offsetParent !== null; });
  }
  function trapFocus(e) {
    var list = focusables();
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // ---------- values / dirty tracking ----------
  function readValue(def, input) {
    if (def.kind === "number") {
      var raw = input.value.trim();
      return raw === "" ? NaN : Number(raw);
    }
    return def.kind === "select" ? input.value : input.value.trim();
  }

  function changedMap() {
    var out = {};
    if (!current) return out;
    FIELDS.forEach(function (f) {
      var fe = els.fields[f.key];
      if (fe.wrap.hidden) return;
      var now = readValue(f, fe.input);
      var was = f.kind === "number" ? Number(current.original[f.key]) : str(current.original[f.key]).trim();
      var same = f.kind === "number" ? (now === was) : (now === was);
      if (!same) out[f.key] = now;
    });
    return out;
  }

  function refreshDirty() {
    if (!current || !current.ready) return;
    var changes = changedMap();
    var keys = Object.keys(changes);
    FIELDS.forEach(function (f) {
      els.fields[f.key].wrap.classList.toggle("is-changed", Object.prototype.hasOwnProperty.call(changes, f.key));
    });
    els.save.disabled = saving || keys.length === 0;
    els.dirty.textContent = keys.length === 0 ? "No changes yet."
      : keys.length + (keys.length === 1 ? " field" : " fields") + " changed";
  }

  function isDirty() { return !!(current && current.ready && Object.keys(changedMap()).length); }

  // ---------- errors ----------
  function clearErrors() {
    els.banner.hidden = true; els.banner.textContent = "";
    FIELDS.forEach(function (f) {
      var fe = els.fields[f.key];
      fe.wrap.classList.remove("has-error"); fe.err.hidden = true; fe.err.textContent = "";
      fe.input.removeAttribute("aria-invalid");
    });
  }
  function fieldError(key, message) {
    var fe = els.fields[key];
    if (!fe || fe.wrap.hidden) return false;
    fe.wrap.classList.add("has-error"); fe.err.hidden = false; fe.err.textContent = message;
    fe.input.setAttribute("aria-invalid", "true");
    return true;
  }
  function showBanner(message) { els.banner.hidden = false; els.banner.textContent = message; }
  function focusFirstError() {
    var bad = els.form.querySelector(".has-error .re-input");
    if (bad) { bad.focus(); if (bad.scrollIntoView) bad.scrollIntoView({ block: "center", behavior: "smooth" }); }
    else if (!els.banner.hidden) els.banner.scrollIntoView({ block: "nearest" });
  }

  // Mirrors the server's rules so obvious mistakes are caught before a round trip.
  // The server still validates everything again; this is only for speed and clarity.
  function validateClient(changes) {
    var ok = true;
    FIELDS.forEach(function (f) {
      var fe = els.fields[f.key];
      if (fe.wrap.hidden) return;
      var v = readValue(f, fe.input);
      if (f.kind === "number") {
        if (typeof v !== "number" || isNaN(v) || Math.floor(v) !== v || v < f.min || v > f.max) {
          ok = !fieldError(f.key, "Enter a whole number from " + f.min + " to " + f.max + ".") && ok;
        }
      } else if (f.required && v === "") {
        ok = !fieldError(f.key, f.label + " can't be empty.") && ok;
      } else if (f.max && typeof v === "string" && v.length > f.max) {
        ok = !fieldError(f.key, f.label + " is too long (" + f.max + " characters max).") && ok;
      }
    });
    return ok;
  }

  // ---------- open / close ----------
  function setBusy(isBusy) {
    saving = isBusy;
    els.save.textContent = isBusy ? "Saving…" : "Save changes";
    els.cancel.disabled = isBusy;
    els.closeBtn.disabled = isBusy;
    FIELDS.forEach(function (f) { els.fields[f.key].input.disabled = isBusy; });
    if (!isBusy) refreshDirty(); else els.save.disabled = true;
  }

  function showState(message, withRetry) {
    els.form.hidden = true;
    els.state.hidden = false;
    els.state.textContent = message;
    if (withRetry) {
      var retry = h("button", { type: "button", class: "re-btn re-btn-ghost", text: "Try again" });
      retry.addEventListener("click", function () { open(current.id, current.opts, true); });
      els.state.appendChild(document.createElement("br"));
      els.state.appendChild(retry);
    }
    els.save.disabled = true;
    els.dirty.textContent = "";
  }

  function loadDepartments() {
    if (departmentsLoaded) return;
    departmentsLoaded = true; // best effort: a failure just means no suggestions
    authFetch(API_BASE + "/admin/resources/filter-options")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.success || !Array.isArray(d.departments)) return;
        d.departments.forEach(function (name) {
          var o = document.createElement("option"); o.value = name; els.deptList.appendChild(o);
        });
      })
      .catch(function () { departmentsLoaded = false; });
  }

  function fill(resource) {
    current.original = resource;
    current.status = resource.status;
    current.ready = true;
    FIELDS.forEach(function (f) {
      var fe = els.fields[f.key];
      if (f.approvedOnly) fe.wrap.hidden = resource.status !== "approved";
      fe.input.value = str(resource[f.key]);
    });
    var bits = [STATUS_LABEL[resource.status] || resource.status];
    if (resource.uploader) bits.push("Uploaded by " + resource.uploader);
    if (resource.uploadedDate) bits.push(resource.uploadedDate);
    els.sub.textContent = bits.join(" • ");
    els.state.hidden = true; els.state.textContent = "";
    els.form.hidden = false;
    clearErrors();
    setBusy(false);
    refreshDirty();
  }

  function open(resourceId, opts, isRetry) {
    if (!resourceId) return;
    if (typeof authFetch !== "function" || typeof API_BASE === "undefined") {
      alert("The editor could not start (page scripts missing). Please reload the page.");
      return;
    }
    if (!els) build();
    var token = ++openToken;
    current = { id: resourceId, opts: opts || {}, ready: false, original: null,
                trigger: isRetry && current ? current.trigger : document.activeElement };
    saving = false;
    els.sub.textContent = "";
    els.overlay.hidden = false;
    showState("Loading details…", false);
    loadDepartments();
    if (!isRetry) els.closeBtn.focus();

    authFetch(API_BASE + "/admin/resources/" + encodeURIComponent(resourceId))
      .then(function (res) { return res.json().then(function (data) { return { res: res, data: data }; }); })
      .then(function (out) {
        if (token !== openToken) return; // a newer open() superseded this one
        if (!out.data || !out.data.success || !out.data.resource) {
          showState((out.data && out.data.message) || "Could not load this resource.", true);
          return;
        }
        fill(out.data.resource);
        // On a phone, focusing the title would pop the keyboard up before the admin has
        // even seen the form, so only auto-focus with a mouse/keyboard.
        if (!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches)) els.fields.title.input.focus();
      })
      .catch(function (err) {
        if (token !== openToken) return;
        console.error("ResourceEditor load failed:", err);
        showState("Network error — could not load this resource.", true);
      });
  }

  function close() {
    if (!els) return;
    els.overlay.hidden = true;
    openToken++; // invalidate any in-flight load
    var trigger = current && current.trigger;
    current = null; saving = false;
    if (trigger && typeof trigger.focus === "function" && document.contains(trigger)) trigger.focus();
  }

  function requestClose() {
    if (saving) return;
    if (isDirty() && !window.confirm("You have unsaved changes. Discard them?")) return;
    close();
  }

  // ---------- save ----------
  function toast(message, info) {
    var t = h("div", { class: "re-toast" + (info ? " is-info" : ""), role: "status", text: message });
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3600);
  }

  function onSubmit(e) {
    e.preventDefault();
    if (saving || !current || !current.ready) return;
    clearErrors();
    var changes = changedMap();
    if (Object.keys(changes).length === 0) { toast("No changes to save.", true); return; }
    if (!validateClient(changes)) { focusFirstError(); return; }

    var id = current.id, opts = current.opts;
    setBusy(true);
    authFetch(API_BASE + "/admin/resources/" + encodeURIComponent(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes)
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { res: res, data: data }; }); })
      .then(function (out) {
        if (!current || current.id !== id) return;
        var data = out.data || {};
        if (!out.res.ok || !data.success) {
          setBusy(false);
          var unmatched = [];
          if (Array.isArray(data.errors)) {
            data.errors.forEach(function (er) { if (!fieldError(er.field, er.message)) unmatched.push(er.message); });
          }
          if (unmatched.length) showBanner(unmatched.join(" "));
          else if (!Array.isArray(data.errors) || !data.errors.length) showBanner(data.message || "Could not save your changes. Please try again.");
          else showBanner(data.message || "Please fix the highlighted fields.");
          focusFirstError();
          return;
        }
        var resource = data.resource;
        var changedFields = data.changedFields || Object.keys(changes);
        close();
        toast(data.changed === false ? "No changes were needed." : "Resource details updated.", data.changed === false);
        try { document.dispatchEvent(new CustomEvent("resource:edited", { detail: { id: id, resource: resource, changedFields: changedFields } })); } catch (_) {}
        if (opts && typeof opts.onSaved === "function") {
          try { opts.onSaved(resource, data); } catch (err) { console.error("ResourceEditor onSaved failed:", err); }
        }
      })
      .catch(function (err) {
        console.error("ResourceEditor save failed:", err);
        if (!current) return;
        setBusy(false);
        showBanner("Network error — your changes were not saved. Check your connection and try again.");
      });
  }

  window.ResourceEditor = { open: open, close: requestClose };
})();
