// Searchable Select — progressively enhances a native <select> into a
// type-to-filter combobox, without changing how the rest of the page's JS
// talks to it.
//
// Why this shape: department/course/session lists are expected to grow a
// lot as real users sign up, and a plain <select> gets unusable once
// there are dozens (or hundreds) of options to scroll through. Rather than
// rewrite every page's filter logic, this keeps the original <select> in
// the DOM (hidden) as the actual source of truth — existing code that
// reads `select.value` or listens for `select.addEventListener('change')`
// keeps working exactly as before. This only replaces how the option is
// *chosen*.
//
// Usage:
//   const enhanced = new SearchableSelect(document.getElementById('filterDepartment'));
//   // later, if the page repopulates the <select>'s <option> children
//   // (e.g. a course list that depends on the chosen department):
//   courseSelect.innerHTML = '<option value="all">All Courses</option>...';
//   enhanced.refresh();
//
// Selecting an option sets the underlying select's value and dispatches a
// real 'change' event on it (bubbling), so existing listeners fire
// unchanged.

class SearchableSelect {
  constructor(selectEl, opts = {}) {
    this.select = selectEl;
    this.placeholder = opts.placeholder || "Search…";
    this.options = [];
    this.highlightedIndex = -1;

    this._build();
    this.refresh();

    // If some other script sets select.value directly (bypassing the
    // widget), keep the visible input text in sync.
    this.select.addEventListener("change", () => {
      if (this._settingFromWidget) return; // avoid feedback loop with our own dispatch below
      this._syncInputFromSelect();
    });
  }

  // Re-reads the <option> children currently on the underlying <select>
  // and rebuilds the searchable list. Call this any time the page repopulates
  // the select's options (e.g. course options changing with department).
  refresh() {
    this.options = Array.from(this.select.options).map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    this._syncInputFromSelect();
    this._renderList(this.options);
  }

  _build() {
    this.select.classList.add("searchable-select-native");

    this.wrapper = document.createElement("div");
    this.wrapper.className = "searchable-select";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "searchable-select-input";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-autocomplete", "list");
    if (this.select.id) this.input.setAttribute("aria-controls", `${this.select.id}-listbox`);
    this.input.placeholder = this.placeholder;

    this.listEl = document.createElement("ul");
    this.listEl.className = "searchable-select-list hidden";
    this.listEl.setAttribute("role", "listbox");
    if (this.select.id) this.listEl.id = `${this.select.id}-listbox`;

    this.wrapper.appendChild(this.input);
    this.wrapper.appendChild(this.listEl);
    this.select.insertAdjacentElement("afterend", this.wrapper);

    this.input.addEventListener("focus", () => {
      this.input.select(); // first keystroke replaces the current label instead of appending to it
      this._filter(this.input.value);
      this._open();
    });
    this.input.addEventListener("input", () => this._filter(this.input.value));
    this.input.addEventListener("keydown", (e) => this._handleKeydown(e));
    this.input.addEventListener("blur", () => {
      // Delay so a click on a list item (which also blurs the input) has a
      // chance to register before the list disappears.
      setTimeout(() => {
        if (!this.wrapper.contains(document.activeElement)) {
          this._close();
          this._syncInputFromSelect(); // revert to the actual selection if they typed without picking one
        }
      }, 120);
    });
  }

  _filter(query) {
    const q = query.trim().toLowerCase();
    const filtered = !q ? this.options : this.options.filter((o) => o.label.toLowerCase().includes(q));
    this._renderList(filtered);
    this._open();
  }

  _renderList(options) {
    this.listEl.innerHTML = "";
    this.highlightedIndex = -1;

    if (options.length === 0) {
      const empty = document.createElement("li");
      empty.className = "searchable-select-empty";
      empty.textContent = "No matches";
      this.listEl.appendChild(empty);
      return;
    }

    options.forEach((opt) => {
      const item = document.createElement("li");
      item.className = "searchable-select-option";
      item.setAttribute("role", "option");
      item.textContent = opt.label;
      if (opt.value === this.select.value) item.classList.add("is-selected");
      // mousedown (not click) fires before the input's blur handler closes the list
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this._selectOption(opt);
      });
      this.listEl.appendChild(item);
    });
  }

  _handleKeydown(e) {
    const items = Array.from(this.listEl.querySelectorAll(".searchable-select-option"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!this._isOpen()) { this._filter(this.input.value); this._open(); return; }
      this.highlightedIndex = Math.min(this.highlightedIndex + 1, items.length - 1);
      this._applyHighlight(items);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.highlightedIndex = Math.max(this.highlightedIndex - 1, 0);
      this._applyHighlight(items);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this.highlightedIndex >= 0 && items[this.highlightedIndex]) {
        items[this.highlightedIndex].dispatchEvent(new Event("mousedown"));
      }
    } else if (e.key === "Escape") {
      this._close();
      this._syncInputFromSelect();
      this.input.blur();
    }
  }

  _applyHighlight(items) {
    items.forEach((el, i) => el.classList.toggle("is-highlighted", i === this.highlightedIndex));
    const highlighted = items[this.highlightedIndex];
    if (highlighted) highlighted.scrollIntoView({ block: "nearest" });
  }

  _selectOption(opt) {
    this.select.value = opt.value;
    this._settingFromWidget = true;
    // Native <select> elements fire both events on an interactive change,
    // and this codebase has pages listening for either one depending on
    // which file it was written in — dispatch both so the widget is a safe
    // drop-in no matter which event a given page's listener expects.
    this.select.dispatchEvent(new Event("input", { bubbles: true }));
    this.select.dispatchEvent(new Event("change", { bubbles: true }));
    this._settingFromWidget = false;

    this.input.value = opt.label;
    this._close();
  }

  _syncInputFromSelect() {
    const selected = this.select.options[this.select.selectedIndex];
    this.input.value = selected ? selected.textContent : "";
  }

  _open() {
    this.listEl.classList.remove("hidden");
    this.input.setAttribute("aria-expanded", "true");
    this.wrapper.classList.add("is-open");
  }

  _close() {
    this.listEl.classList.add("hidden");
    this.input.setAttribute("aria-expanded", "false");
    this.wrapper.classList.remove("is-open");
    this.highlightedIndex = -1;
  }

  _isOpen() {
    return !this.listEl.classList.contains("hidden");
  }
}

window.SearchableSelect = SearchableSelect;
