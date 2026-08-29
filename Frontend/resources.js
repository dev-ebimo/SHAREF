document.addEventListener("DOMContentLoaded", function () {
  // ==========================================================================
  // 0. REAL DATA — fetched from GET /api/resources
  //    The backend has no rating system, so the "rating"/stars feature that
  //    used to live here has been removed rather than faked. fileSizeMB has
  //    likewise been dropped in favor of the backend's already-formatted
  //    `size` string (e.g. "3.1 MB").
  // ==========================================================================
  var RESOURCES = [];

  function daysAgoFromDate(iso) {
    var diffMs = Date.now() - new Date(iso).getTime();
    return Math.max(0, Math.floor(diffMs / 86400000));
  }

  // Backend only stores a single `course` field (e.g. "CSC 201"), not a
  // separate code/name pair, so both map to the same value here.
  function transformResource(r) {
    return {
      id: r.id,
      title: r.title,
      courseCode: r.course,
      courseName: r.course,
      department: r.department,
      semester: r.semester,
      type: r.type,
      fileType: (r.fileExtension || "").toUpperCase(),
      uploadedDaysAgo: daysAgoFromDate(r.createdAt),
      downloads: r.downloads,
      pages: r.pages,
      size: r.size,
      uploader: r.uploader || "Unknown",
      description: r.description || "",
    };
  }

  // GET /api/resources is paginated (max 50/page) — page through it so the
  // client-side filter/sort/paginate pipeline below still has the full set
  // to work with, same as it did with the in-memory mock array.
  async function fetchAllResources() {
    var all = [];
    var page = 1;
    var totalPages = 1;
    do {
      var res = await authFetch(API_BASE + "/resources?page=" + page + "&limit=50");
      var data = await res.json();
      if (!data.success) break;
      all = all.concat(data.resources.map(transformResource));
      totalPages = data.totalPages || 1;
      page += 1;
    } while (page <= totalPages && page <= 10); // sane cap to avoid runaway pagination
    return all;
  }

  // Pricing follows the ₦10/page model used across the app — cost is
  // derived from `pages` rather than hardcoded.
  var PRICE_PER_PAGE = 10;
  function getResourceCost(r) {
    return r.pages * PRICE_PER_PAGE;
  }

  var PAGE_SIZE = 6;
  var urlParams = new URLSearchParams(window.location.search);
  var initialSearch = urlParams.get("search") || "";
  var state = {
    search: initialSearch,
    department: "all",
    course: "all",
    semester: "all",
    type: "all",
    sortBy: "newest",
    view: "all",
    page: 1,
  };
  var lastManualSort = "newest";

  var bookmarkedIds = [];

  async function fetchBookmarkedIds() {
    var res = await authFetch(API_BASE + "/bookmarks");
    var data = await res.json();
    if (!data.success) return [];
    return data.resources.map(function (r) { return r.id; });
  }

  // ==========================================================================
  // 1. DOM REFERENCES
  // ==========================================================================
  var searchInput = document.getElementById("resourceSearchInput");
  if (initialSearch) searchInput.value = initialSearch;
  var departmentSelect = document.getElementById("filterDepartment");
  var courseSelect = document.getElementById("filterCourse");
  var semesterSelect = document.getElementById("filterSemester");
  var typeSelect = document.getElementById("filterType");
  var sortSelect = document.getElementById("sortBySelect");
  var viewToggleBtns = document.querySelectorAll(".view-toggle-btn");
  var resultsCountText = document.getElementById("resultsCountText");
  var clearFiltersInline = document.getElementById("clearFiltersInline");
  var resourceGrid = document.getElementById("resourceGrid");
  var emptyState = document.getElementById("emptyState");
  var clearFiltersBtn = document.getElementById("clearFiltersBtn");
  var paginationBar = document.getElementById("paginationBar");
  var paginationPages = document.getElementById("paginationPages");
  var prevPageBtn = document.getElementById("prevPageBtn");
  var nextPageBtn = document.getElementById("nextPageBtn");

  var toast = document.getElementById("resourcesToast");
  var toastTimer = null;
  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 2600);
  }

  // ==========================================================================
  // 2. DEPARTMENT -> COURSE MAP (keeps the Course filter relevant)
  // ==========================================================================
  var coursesByDepartment = {};
  function buildCourseMap() {
    coursesByDepartment = {};
    RESOURCES.forEach(function (r) {
      if (!coursesByDepartment[r.department]) coursesByDepartment[r.department] = new Set();
      coursesByDepartment[r.department].add(r.courseCode);
    });
  }

  function populateCourseOptions(department) {
    var courses;
    if (department === "all") {
      courses = new Set(RESOURCES.map(function (r) { return r.courseCode; }));
    } else {
      courses = coursesByDepartment[department] || new Set();
    }
    var sorted = Array.from(courses).sort();

    courseSelect.innerHTML = '<option value="all">All Courses</option>';
    sorted.forEach(function (code) {
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      courseSelect.appendChild(opt);
    });
    courseSelect.value = "all";
  }

  // ==========================================================================
  // 3. FILTER + SORT + RENDER PIPELINE
  // ==========================================================================
  function daysAgoLabel(days) {
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    return days + " days ago";
  }

  function getFilteredSorted() {
    var query = state.search.trim().toLowerCase();

    var list = RESOURCES.filter(function (r) {
      if (state.department !== "all" && r.department !== state.department) return false;
      if (state.course !== "all" && r.courseCode !== state.course) return false;
      if (state.semester !== "all" && r.semester !== state.semester) return false;
      if (state.type !== "all" && r.type !== state.type) return false;
      if (state.view === "recent" && r.uploadedDaysAgo > 7) return false;

      if (query) {
        var haystack = (r.title + " " + r.courseCode + " " + r.courseName + " " + r.type).toLowerCase();
        if (haystack.indexOf(query) === -1) return false;
      }
      return true;
    });

    var sortBy = state.view === "recent" ? "newest" : state.sortBy;
    list.sort(function (a, b) {
      switch (sortBy) {
        case "downloads":
        case "rating": // no backend rating field — falls back to most-downloaded
          return b.downloads - a.downloads;
        case "az":
          return a.title.localeCompare(b.title);
        case "newest":
        default:
          return a.uploadedDaysAgo - b.uploadedDaysAgo;
      }
    });

    return list;
  }

  function buildCard(r) {
    var isBookmarked = bookmarkedIds.indexOf(r.id) !== -1;
    var typeTagClass = r.fileType.toLowerCase();
    var cost = getResourceCost(r);
    var costLabel = window.SharefWallet.formatNaira(cost);

    var card = document.createElement("article");
    card.className = "browse-resource-card";
    card.setAttribute("data-id", r.id);

    card.innerHTML =
      '<div class="browse-card-top">' +
        '<span class="type-tag ' + typeTagClass + '">' + r.fileType + "</span>" +
        '<span class="resource-type-label">' + r.type + "</span>" +
      "</div>" +
      '<h3 class="browse-card-title">' + r.title + "</h3>" +
      '<p class="browse-card-sub">' + r.courseCode + " \u2022 " + r.semester + " Semester</p>" +
      '<p class="browse-card-uploaded">Uploaded ' + daysAgoLabel(r.uploadedDaysAgo) + "</p>" +
      '<div class="browse-card-stats">' +
        '<span class="download-count">' + r.downloads.toLocaleString() + " Downloads</span>" +
      "</div>" +
      '<div class="browse-card-actions">' +
        '<button type="button" class="card-action-btn preview-btn" data-id="' + r.id + '">Preview</button>' +
        '<button type="button" class="card-action-btn download-btn" data-id="' + r.id + '">Download \u00b7 ' + costLabel + "</button>" +
        '<button type="button" class="card-action-btn bookmark-btn' + (isBookmarked ? " is-bookmarked" : "") + '" data-id="' + r.id + '" aria-pressed="' + isBookmarked + '" aria-label="Bookmark this resource">' +
          '<svg fill="' + (isBookmarked ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L7 21V5z"/></svg>' +
        "</button>" +
      "</div>";

    return card;
  }

  function render() {
    var filtered = getFilteredSorted();
    var total = filtered.length;
    var totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    var start = (state.page - 1) * PAGE_SIZE;
    var pageItems = filtered.slice(start, start + PAGE_SIZE);

    // Results count
    if (total === 0) {
      resultsCountText.textContent = "0 resources found";
    } else {
      var rangeStart = start + 1;
      var rangeEnd = Math.min(start + PAGE_SIZE, total);
      resultsCountText.textContent = "Showing " + rangeStart + "\u2013" + rangeEnd + " of " + total + " resources";
    }

    var filtersActive =
      state.search.trim() !== "" ||
      state.department !== "all" ||
      state.course !== "all" ||
      state.semester !== "all" ||
      state.type !== "all" ||
      state.view === "recent";
    clearFiltersInline.classList.toggle("hidden", !filtersActive);

    // Grid / empty state
    resourceGrid.innerHTML = "";
    if (total === 0) {
      resourceGrid.classList.add("hidden");
      emptyState.classList.remove("hidden");
      paginationBar.classList.add("hidden");
      return;
    }
    resourceGrid.classList.remove("hidden");
    emptyState.classList.add("hidden");

    pageItems.forEach(function (r) {
      resourceGrid.appendChild(buildCard(r));
    });

    // Pagination
    if (totalPages <= 1) {
      paginationBar.classList.add("hidden");
    } else {
      paginationBar.classList.remove("hidden");
      paginationPages.innerHTML = "";
      for (var i = 1; i <= totalPages; i++) {
        (function (pageNum) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pagination-page-btn" + (pageNum === state.page ? " is-active" : "");
          btn.textContent = String(pageNum);
          btn.addEventListener("click", function () {
            state.page = pageNum;
            render();
            resourceGrid.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          paginationPages.appendChild(btn);
        })(i);
      }
      prevPageBtn.disabled = state.page <= 1;
      nextPageBtn.disabled = state.page >= totalPages;
    }
  }

  // ==========================================================================
  // 4. EVENT WIRING - filters, search, sort, view toggle
  // ==========================================================================
  function onFilterChange() {
    state.page = 1;
    render();
  }

  searchInput.addEventListener("input", function () {
    state.search = searchInput.value;
    onFilterChange();
  });

  departmentSelect.addEventListener("change", function () {
    state.department = departmentSelect.value;
    populateCourseOptions(state.department);
    state.course = "all";
    onFilterChange();
  });

  courseSelect.addEventListener("change", function () {
    state.course = courseSelect.value;
    onFilterChange();
  });

  semesterSelect.addEventListener("change", function () {
    state.semester = semesterSelect.value;
    onFilterChange();
  });

  typeSelect.addEventListener("change", function () {
    state.type = typeSelect.value;
    onFilterChange();
  });

  sortSelect.addEventListener("change", function () {
    state.sortBy = sortSelect.value;
    lastManualSort = state.sortBy;
    onFilterChange();
  });

  viewToggleBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      viewToggleBtns.forEach(function (b) {
        b.classList.remove("is-active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("is-active");
      btn.setAttribute("aria-selected", "true");

      state.view = btn.getAttribute("data-view");
      if (state.view === "recent") {
        sortSelect.value = "newest";
        sortSelect.disabled = true;
      } else {
        sortSelect.disabled = false;
        sortSelect.value = lastManualSort;
        state.sortBy = lastManualSort;
      }
      onFilterChange();
    });
  });

  function resetAllFilters() {
    state.search = "";
    state.department = "all";
    state.course = "all";
    state.semester = "all";
    state.type = "all";
    state.sortBy = "newest";
    state.view = "all";
    state.page = 1;
    lastManualSort = "newest";

    searchInput.value = "";
    departmentSelect.value = "all";
    populateCourseOptions("all");
    semesterSelect.value = "all";
    typeSelect.value = "all";
    sortSelect.value = "newest";
    sortSelect.disabled = false;
    viewToggleBtns.forEach(function (b) {
      var isAll = b.getAttribute("data-view") === "all";
      b.classList.toggle("is-active", isAll);
      b.setAttribute("aria-selected", String(isAll));
    });

    render();
  }

  clearFiltersBtn.addEventListener("click", resetAllFilters);
  clearFiltersInline.addEventListener("click", resetAllFilters);

  prevPageBtn.addEventListener("click", function () {
    if (state.page > 1) {
      state.page -= 1;
      render();
    }
  });
  nextPageBtn.addEventListener("click", function () {
    state.page += 1;
    render();
  });

  // ==========================================================================
  // 5. CARD ACTIONS - Preview, Download, Bookmark (event delegation)
  // ==========================================================================
  var previewModal = document.getElementById("previewModal");
  var previewScrim = document.getElementById("previewScrim");
  var previewCloseBtn = document.getElementById("previewCloseBtn");
  var previewCloseFooterBtn = document.getElementById("previewCloseFooterBtn");
  var previewDownloadBtn = document.getElementById("previewDownloadBtn");

  var previewModalTitle = document.getElementById("previewModalTitle");
  var previewThumb = document.getElementById("previewThumb");
  var previewDescription = document.getElementById("previewDescription");
  var previewUploader = document.getElementById("previewUploader");
  var previewCourse = document.getElementById("previewCourse");
  var previewDepartment = document.getElementById("previewDepartment");
  var previewPages = document.getElementById("previewPages");
  var previewFileSize = document.getElementById("previewFileSize");
  var previewUploadDate = document.getElementById("previewUploadDate");
  var previewPrice = document.getElementById("previewPrice");

  var currentPreviewId = null;

  function openPreview(resource) {
    currentPreviewId = resource.id;
    var cost = getResourceCost(resource);

    previewModalTitle.textContent = resource.title;
    previewThumb.textContent = resource.fileType;
    previewDescription.textContent = resource.description;
    previewUploader.textContent = resource.uploader;
    previewCourse.textContent = resource.courseCode + " - " + resource.courseName;
    previewDepartment.textContent = resource.department;
    previewPages.textContent = resource.pages + " pages";
    previewFileSize.textContent = resource.size;
    previewUploadDate.textContent = daysAgoLabel(resource.uploadedDaysAgo);
    if (previewPrice) previewPrice.textContent = window.SharefWallet.formatNaira(cost);
    previewDownloadBtn.textContent = "Download \u00b7 " + window.SharefWallet.formatNaira(cost);

    previewModal.classList.add("is-visible");
    previewScrim.classList.add("is-visible");
    previewModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    previewCloseBtn.focus();
  }

  function closePreview() {
    previewModal.classList.remove("is-visible");
    previewScrim.classList.remove("is-visible");
    previewModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    currentPreviewId = null;
  }

  previewCloseBtn.addEventListener("click", closePreview);
  previewCloseFooterBtn.addEventListener("click", closePreview);
  previewScrim.addEventListener("click", closePreview);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && previewModal.classList.contains("is-visible")) {
      closePreview();
    }
  });

  function findResourceById(id) {
    return RESOURCES.filter(function (r) { return String(r.id) === String(id); })[0];
  }

  previewDownloadBtn.addEventListener("click", function () {
    if (currentPreviewId === null) return;
    var resource = findResourceById(currentPreviewId);
    if (!resource) return;
    var cost = getResourceCost(resource);
    window.SharefWallet.charge(resource.id, resource.courseCode + " \u2014 " + resource.title).then(function (data) {
      if (!data.success) return;
      if (data.fileUrl) window.open(data.fileUrl, "_blank");
      resource.downloads += 1;
      showToast(window.SharefWallet.formatNaira(data.amountCharged || cost) + " deducted \u00b7 \"" + resource.title + "\" download started.");
      closePreview();
      render();
    });
  });

  resourceGrid.addEventListener("click", function (e) {
    var previewBtn = e.target.closest(".preview-btn");
    var downloadBtn = e.target.closest(".download-btn");
    var bookmarkBtn = e.target.closest(".bookmark-btn");

    if (previewBtn) {
      var id = previewBtn.getAttribute("data-id");
      var resource = findResourceById(id);
      if (resource) openPreview(resource);
      return;
    }

    if (downloadBtn) {
      var did = downloadBtn.getAttribute("data-id");
      var dResource = findResourceById(did);
      if (dResource) {
        var dCost = getResourceCost(dResource);
        window.SharefWallet.charge(dResource.id, dResource.courseCode + " \u2014 " + dResource.title).then(function (data) {
          if (!data.success) return;
          if (data.fileUrl) window.open(data.fileUrl, "_blank");
          dResource.downloads += 1;
          showToast(window.SharefWallet.formatNaira(data.amountCharged || dCost) + " deducted \u00b7 \"" + dResource.title + "\" download started.");
          render();
        });
      }
      return;
    }

    if (bookmarkBtn) {
      var bid = bookmarkBtn.getAttribute("data-id");
      bookmarkBtn.disabled = true;
      authFetch(API_BASE + "/bookmarks/" + bid, { method: "POST" })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          bookmarkBtn.disabled = false;
          if (!data.success) return;
          var idx = bookmarkedIds.indexOf(bid);
          if (data.bookmarked && idx === -1) {
            bookmarkedIds.push(bid);
          } else if (!data.bookmarked && idx !== -1) {
            bookmarkedIds.splice(idx, 1);
          }
          render();
        })
        .catch(function (err) {
          bookmarkBtn.disabled = false;
          console.error(err);
        });
    }
  });

  // Pre-fills the department filter from the user's completed profile (if
  // they have one) — the payoff for completing the "Add your department"
  // banner. Adds a matching <option> on the fly if the department isn't one
  // of the page's fixed preset options, since department is free-text at
  // signup/profile-edit time, not a controlled enum.
  async function fetchProfileDepartment() {
    try {
      var res = await authFetch(API_BASE + "/users/me");
      var data = await res.json();
      return (data.success && data.user.department) ? data.user.department : null;
    } catch (err) {
      return null;
    }
  }

  function applyDepartmentPrefill(department) {
    if (!department) return;
    var hasOption = Array.prototype.some.call(departmentSelect.options, function (opt) {
      return opt.value === department;
    });
    if (!hasOption) {
      var newOption = document.createElement("option");
      newOption.value = department;
      newOption.textContent = department;
      departmentSelect.appendChild(newOption);
    }
    departmentSelect.value = department;
    state.department = department;
    populateCourseOptions(department);
  }

  // ==========================================================================
  // 6. INITIAL LOAD
  // ==========================================================================
  resourceGrid.innerHTML = '<p class="browse-loading-text">Loading resources\u2026</p>';
  Promise.all([fetchAllResources(), fetchBookmarkedIds(), fetchProfileDepartment()])
    .then(function (results) {
      RESOURCES = results[0];
      bookmarkedIds = results[1];
      var profileDepartment = results[2];
      buildCourseMap();
      populateCourseOptions("all");
      applyDepartmentPrefill(profileDepartment);
      render();
    })
    .catch(function (err) {
      console.error(err);
      resourceGrid.innerHTML = "";
      resultsCountText.textContent = "Could not load resources";
      emptyState.classList.remove("hidden");
      resourceGrid.classList.add("hidden");
    });
});
