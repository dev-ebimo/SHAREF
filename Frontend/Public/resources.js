document.addEventListener("DOMContentLoaded", function () {
  // ==========================================================================
  // 0. MOCK DATA
  //    Stands in for a real API response. Swap this for a fetch() call once
  //    there's a backend — the rendering logic below doesn't care where the
  //    array comes from.
  // ==========================================================================
  var RESOURCES = [
    { id: 1, title: "CSC 201 Data Structures Lecture Notes", courseCode: "CSC 201", courseName: "Data Structures", department: "Computer Science", semester: "First", type: "Lecture Notes", fileType: "PDF", uploadedDaysAgo: 3, rating: 4.6, downloads: 1245, pages: 42, fileSizeMB: 3.1, uploader: "Ebimotimi Shadrack", description: "Comprehensive notes covering arrays, linked lists, stacks, queues, and trees, with worked examples for each." },
    { id: 2, title: "CSC 202 Past Questions (2021-2024)", courseCode: "CSC 202", courseName: "Computer Architecture", department: "Computer Science", semester: "Second", type: "Past Questions", fileType: "PDF", uploadedDaysAgo: 1, rating: 4.8, downloads: 980, pages: 18, fileSizeMB: 1.4, uploader: "Chidera Okafor", description: "Four years of past exam questions compiled and organized by topic, with an answer key at the back." },
    { id: 3, title: "Operating Systems Summary Sheet", courseCode: "CSC 301", courseName: "Operating Systems", department: "Computer Science", semester: "First", type: "Summary", fileType: "DOCX", uploadedDaysAgo: 6, rating: 4.2, downloads: 612, pages: 9, fileSizeMB: 0.8, uploader: "Tamuno Wilcox", description: "A condensed revision sheet covering processes, scheduling algorithms, and memory management." },
    { id: 4, title: "Database Systems Lab Manual", courseCode: "CSC 301", courseName: "Database Systems", department: "Computer Science", semester: "Second", type: "Lab Manual", fileType: "PDF", uploadedDaysAgo: 10, rating: 4.0, downloads: 344, pages: 26, fileSizeMB: 2.2, uploader: "Ebimotimi Shadrack", description: "Step-by-step SQL lab exercises with sample databases, from basic queries to joins and subqueries." },
    { id: 5, title: "CSC 201 Assignment 3 - Sorting Algorithms", courseCode: "CSC 201", courseName: "Data Structures", department: "Computer Science", semester: "First", type: "Assignment", fileType: "DOCX", uploadedDaysAgo: 2, rating: 3.9, downloads: 201, pages: 4, fileSizeMB: 0.3, uploader: "Preye Amachree", description: "Assignment brief and starter code for implementing and comparing five sorting algorithms." },
    { id: 6, title: "MTH 202 Differential Equations Notes", courseCode: "MTH 202", courseName: "Differential Equations", department: "Mathematics", semester: "Second", type: "Lecture Notes", fileType: "PDF", uploadedDaysAgo: 4, rating: 4.7, downloads: 890, pages: 55, fileSizeMB: 4.6, uploader: "Zainab Bello", description: "Full-semester notes on first and second order ODEs, with solved examples and practice sets." },
    { id: 7, title: "MTH 202 Past Questions", courseCode: "MTH 202", courseName: "Differential Equations", department: "Mathematics", semester: "Second", type: "Past Questions", fileType: "PDF", uploadedDaysAgo: 15, rating: 4.3, downloads: 730, pages: 12, fileSizeMB: 1.1, uploader: "Zainab Bello", description: "Past exam papers from the last three sessions, useful for exam-pattern recognition." },
    { id: 8, title: "MTH 301 Real Analysis Summary", courseCode: "MTH 301", courseName: "Real Analysis", department: "Mathematics", semester: "First", type: "Summary", fileType: "PDF", uploadedDaysAgo: 8, rating: 4.1, downloads: 265, pages: 14, fileSizeMB: 1.0, uploader: "Preye Amachree", description: "Key definitions, theorems, and proof sketches condensed for quick pre-exam review." },
    { id: 9, title: "PHY 201 Mechanics Lecture Notes", courseCode: "PHY 201", courseName: "Classical Mechanics", department: "Physics", semester: "First", type: "Lecture Notes", fileType: "PPTX", uploadedDaysAgo: 5, rating: 4.4, downloads: 512, pages: 60, fileSizeMB: 6.2, uploader: "Tamuno Wilcox", description: "Slide deck covering kinematics, Newton's laws, and rotational motion with diagrams." },
    { id: 10, title: "PHY 201 Lab Manual - Pendulum Experiment", courseCode: "PHY 201", courseName: "Classical Mechanics", department: "Physics", semester: "First", type: "Lab Manual", fileType: "PDF", uploadedDaysAgo: 20, rating: 3.8, downloads: 178, pages: 8, fileSizeMB: 0.9, uploader: "Chidera Okafor", description: "Procedure, data tables, and sample calculations for the simple pendulum experiment." },
    { id: 11, title: "CSC 202 Assignment - Logic Gates", courseCode: "CSC 202", courseName: "Computer Architecture", department: "Computer Science", semester: "Second", type: "Assignment", fileType: "DOCX", uploadedDaysAgo: 12, rating: 3.6, downloads: 143, pages: 3, fileSizeMB: 0.2, uploader: "Zainab Bello", description: "Circuit design exercises covering AND, OR, NOT, NAND, and NOR gate combinations." },
    { id: 12, title: "GST Past Questions Compilation", courseCode: "GST 101", courseName: "Use of English", department: "Computer Science", semester: "First", type: "Past Questions", fileType: "PDF", uploadedDaysAgo: 30, rating: 4.5, downloads: 1560, pages: 22, fileSizeMB: 1.8, uploader: "Ebimotimi Shadrack", description: "General studies past questions spanning multiple sessions, grouped by recurring topics." },
    { id: 13, title: "MTH 301 Assignment - Sequences & Series", courseCode: "MTH 301", courseName: "Real Analysis", department: "Mathematics", semester: "First", type: "Assignment", fileType: "PDF", uploadedDaysAgo: 18, rating: 3.7, downloads: 96, pages: 5, fileSizeMB: 0.4, uploader: "Tamuno Wilcox", description: "Problem set on convergence tests for sequences and series, with hints for the harder questions." },
    { id: 14, title: "PHY 201 Past Questions", courseCode: "PHY 201", courseName: "Classical Mechanics", department: "Physics", semester: "First", type: "Past Questions", fileType: "PDF", uploadedDaysAgo: 25, rating: 4.0, downloads: 302, pages: 16, fileSizeMB: 1.3, uploader: "Preye Amachree", description: "Compiled past questions with a focus on numerical mechanics problems." },
    { id: 15, title: "CSC 301 Summary - Concurrency & Deadlocks", courseCode: "CSC 301", courseName: "Operating Systems", department: "Computer Science", semester: "First", type: "Summary", fileType: "DOCX", uploadedDaysAgo: 7, rating: 4.3, downloads: 421, pages: 7, fileSizeMB: 0.6, uploader: "Chidera Okafor", description: "Quick-reference notes on race conditions, mutexes, semaphores, and deadlock prevention." },
    { id: 16, title: "MTH 202 Lab Manual - Numerical Methods", courseCode: "MTH 202", courseName: "Differential Equations", department: "Mathematics", semester: "Second", type: "Lab Manual", fileType: "PDF", uploadedDaysAgo: 14, rating: 3.9, downloads: 187, pages: 20, fileSizeMB: 1.7, uploader: "Zainab Bello", description: "Worked examples of Euler's method and Runge-Kutta approximations for solving ODEs numerically." },
  ];

  // Tiered pricing: 1-5 pages flat ₦200; 6-24 pages add ₦20/page; 25+
  // pages add ₦10/page. Kept in sync with the backend's utils/pricing.js —
  // the server always computes the real charge independently, this is
  // purely for accurate display before the user confirms payment.
  function calculateResourceCost(pages) {
    if (pages <= 5) return 200;
    if (pages <= 24) return 200 + (pages - 5) * 20;
    return 580 + (pages - 24) * 10;
  }
  function getResourceCost(r) {
    return calculateResourceCost(r.pages);
  }

  var PAGE_SIZE = 6;
  var state = {
    search: "",
    department: "all",
    course: "all",
    semester: "all",
    type: "all",
    sortBy: "newest",
    view: "all",
    page: 1,
  };
  var lastManualSort = "newest";

  var BOOKMARK_KEY = "sharef.bookmarks";
  var bookmarkedIds = [];
  try {
    bookmarkedIds = JSON.parse(window.localStorage.getItem(BOOKMARK_KEY) || "[]");
  } catch (err) {
    bookmarkedIds = [];
  }

  function saveBookmarks() {
    try {
      window.localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarkedIds));
    } catch (err) {
      /* storage unavailable - bookmark still works for this session */
    }
  }

  // ==========================================================================
  // 1. DOM REFERENCES
  // ==========================================================================
  var searchInput = document.getElementById("resourceSearchInput");
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
  RESOURCES.forEach(function (r) {
    if (!coursesByDepartment[r.department]) coursesByDepartment[r.department] = new Set();
    coursesByDepartment[r.department].add(r.courseCode);
  });

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

  populateCourseOptions("all");

  // ==========================================================================
  // 3. FILTER + SORT + RENDER PIPELINE
  // ==========================================================================
  function starString(rating) {
    var full = Math.round(rating);
    return "\u2605".repeat(full) + "\u2606".repeat(5 - full);
  }

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
          return b.downloads - a.downloads;
        case "rating":
          return b.rating - a.rating;
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
        '<span class="stars" aria-label="Rating ' + r.rating + ' out of 5">' + starString(r.rating) + "</span>" +
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
    previewFileSize.textContent = resource.fileSizeMB + " MB";
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
    return RESOURCES.filter(function (r) { return r.id === id; })[0];
  }

  previewDownloadBtn.addEventListener("click", function () {
    if (currentPreviewId === null) return;
    var resource = findResourceById(currentPreviewId);
    if (!resource) return;
    var cost = getResourceCost(resource);
    // SharefWallet.charge() opens the Insufficient Balance modal itself and
    // returns false when the wallet can't cover it — nothing else to do here.
    var charged = window.SharefWallet.charge(cost, resource.courseCode + " \u2014 " + resource.title);
    if (!charged) return;
    resource.downloads += 1;
    showToast(window.SharefWallet.formatNaira(cost) + " deducted \u00b7 \"" + resource.title + "\" download started.");
    closePreview();
    render();
  });

  resourceGrid.addEventListener("click", function (e) {
    var previewBtn = e.target.closest(".preview-btn");
    var downloadBtn = e.target.closest(".download-btn");
    var bookmarkBtn = e.target.closest(".bookmark-btn");

    if (previewBtn) {
      var id = Number(previewBtn.getAttribute("data-id"));
      var resource = findResourceById(id);
      if (resource) openPreview(resource);
      return;
    }

    if (downloadBtn) {
      var did = Number(downloadBtn.getAttribute("data-id"));
      var dResource = findResourceById(did);
      if (dResource) {
        var dCost = getResourceCost(dResource);
        // SharefWallet.charge() opens the Insufficient Balance modal itself
        // and returns false when the wallet can't cover it.
        var dCharged = window.SharefWallet.charge(dCost, dResource.courseCode + " \u2014 " + dResource.title);
        if (!dCharged) return;
        dResource.downloads += 1;
        showToast(window.SharefWallet.formatNaira(dCost) + " deducted \u00b7 \"" + dResource.title + "\" download started.");
        render();
      }
      return;
    }

    if (bookmarkBtn) {
      var bid = Number(bookmarkBtn.getAttribute("data-id"));
      var idx = bookmarkedIds.indexOf(bid);
      if (idx === -1) {
        bookmarkedIds.push(bid);
      } else {
        bookmarkedIds.splice(idx, 1);
      }
      saveBookmarks();
      render();
    }
  });

  // ==========================================================================
  // 6. INITIAL RENDER
  // ==========================================================================
  render();
});
