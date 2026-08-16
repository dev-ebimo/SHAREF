document.addEventListener("DOMContentLoaded", function () {
  if (!currentUser) return; // dashboard.js already ran requireAuth() at the top of the file

  // ==========================================================================
  // 0. LOAD REAL PROFILE DATA
  // ==========================================================================
  var nameHeadingEl = document.getElementById("profileNameHeading");
  var deptLevelTextEl = document.getElementById("profileDeptLevel");
  var universityTextEl = document.getElementById("profileUniversityText");

  var editNameInput = document.getElementById("editName");
  var editDeptInput = document.getElementById("editDept");
  var editLevelInput = document.getElementById("editLevel");
  var editUniversityInput = document.getElementById("editUniversity");

  var publicToggleEl = document.getElementById("publicProfileToggle");
  var publicToggleDescEl = document.getElementById("publicToggleDesc");

  var myProfile = null; // cached, so the edit form has something to fall back on

  authFetch(API_BASE + "/users/me")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (!data.success) return;
      myProfile = data.user;

      if (nameHeadingEl) nameHeadingEl.textContent = myProfile.fullName;
      if (deptLevelTextEl) deptLevelTextEl.textContent = myProfile.department + " • " + myProfile.level + " Level";
      if (universityTextEl) universityTextEl.textContent = myProfile.university;

      if (editNameInput) editNameInput.value = myProfile.fullName;
      if (editDeptInput) editDeptInput.value = myProfile.department;
      if (editLevelInput) editLevelInput.value = myProfile.level + " Level";
      if (editUniversityInput) editUniversityInput.value = myProfile.university;

      var isPublic = !!(myProfile.preferences && myProfile.preferences.privacy && myProfile.preferences.privacy.publicProfile);
      if (publicToggleEl) {
        publicToggleEl.classList.toggle("is-on", isPublic);
        publicToggleEl.setAttribute("aria-checked", isPublic ? "true" : "false");
      }
      if (publicToggleDescEl) {
        publicToggleDescEl.textContent = isPublic
          ? "Students can view your uploaded resources."
          : "Your profile is currently private.";
      }
    })
    .catch(function (err) { console.error("Could not load profile:", err); });

  // ==========================================================================
  // 0b. MY UPLOADS PREVIEW (same endpoint as my-uploads.html, first 3 shown)
  // ==========================================================================
  var myUploadsListEl = document.getElementById("myUploadsPreviewList");
  var myUploadsCountEl = document.getElementById("myUploadsTotalCount");
  var myUploadsDownloadsEl = document.getElementById("myUploadsTotalDownloads");

  if (myUploadsListEl) {
    authFetch(API_BASE + "/resources/my-uploads")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) {
          myUploadsListEl.innerHTML = "";
          return;
        }
        var uploads = data.resources;
        if (myUploadsCountEl) myUploadsCountEl.textContent = uploads.length;
        if (myUploadsDownloadsEl) {
          var totalDownloads = uploads.reduce(function (sum, r) { return sum + (r.downloads || 0); }, 0);
          myUploadsDownloadsEl.textContent = totalDownloads.toLocaleString();
        }
        if (uploads.length === 0) {
          myUploadsListEl.innerHTML = '<p class="uploads-empty">You haven\u2019t uploaded anything yet.</p>';
          return;
        }
        myUploadsListEl.innerHTML = uploads.slice(0, 3).map(function (item) {
          return (
            '<article class="upload-card">' +
              '<div class="upload-card-main">' +
                '<span class="type-tag pdf-type">' + item.type + "</span>" +
                "<h3>" + item.title + "</h3>" +
                '<div class="upload-card-metrics">' +
                  "<span>" + (item.downloads || 0) + " Downloads</span>" +
                  '<span class="status-badge status-' + item.status + '">' + item.status + "</span>" +
                "</div>" +
              "</div>" +
            "</article>"
          );
        }).join("");
      })
      .catch(function (err) {
        console.error("Could not load uploads preview:", err);
        myUploadsListEl.innerHTML = '<p class="uploads-error">Could not load your uploads.</p>';
      });
  }

  // ==========================================================================
  // 0c. SAVED RESOURCES PREVIEW (same endpoint as bookmarks.html, first 3 shown)
  // ==========================================================================
  var savedResourcesListEl = document.getElementById("savedResourcesPreviewList");

  if (savedResourcesListEl) {
    authFetch(API_BASE + "/bookmarks")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) {
          savedResourcesListEl.innerHTML = "";
          return;
        }
        var resources = data.resources;
        if (resources.length === 0) {
          savedResourcesListEl.innerHTML = '<p class="uploads-empty">No bookmarks yet.</p>';
          return;
        }
        savedResourcesListEl.innerHTML = resources.slice(0, 3).map(function (item) {
          return (
            '<div class="feed-item">' +
              '<div class="item-info">' +
                "<h3>" + item.title + "</h3>" +
                "<p>" + item.type + "</p>" +
              "</div>" +
              '<div class="item-control-links">' +
                '<a href="resources.html" class="feed-inline-link">Open</a>' +
              "</div>" +
            "</div>"
          );
        }).join("");
      })
      .catch(function (err) {
        console.error("Could not load saved resources preview:", err);
        savedResourcesListEl.innerHTML = '<p class="uploads-error">Could not load bookmarks.</p>';
      });
  }

  // ==========================================================================
  // 1. EDIT PROFILE MODAL
  // ==========================================================================
  var editBtn = document.getElementById("editProfileBtn");
  var editModal = document.getElementById("editProfileModal");
  var editScrim = document.getElementById("editProfileScrim");
  var editCloseBtn = document.getElementById("editProfileCloseBtn");
  var editCancelBtn = document.getElementById("editProfileCancelBtn");
  var editForm = document.getElementById("editProfileForm");
  var editSubmitBtn = editForm ? editForm.querySelector("button[type='submit']") : null;
  var editErrorEl = document.getElementById("editProfileError");

  var nameInput = document.getElementById("editName");
  var deptInput = document.getElementById("editDept");
  var levelInput = document.getElementById("editLevel");
  var universityInput = document.getElementById("editUniversity");

  var nameHeading = document.getElementById("profileNameHeading");
  var deptLevelText = document.getElementById("profileDeptLevel");
  var universityText = document.getElementById("profileUniversityText");

  if (editBtn && editModal && editScrim && editForm) {
    function openEditModal() {
      editModal.classList.add("is-visible");
      editScrim.classList.add("is-visible");
      editModal.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      nameInput.focus();
    }

    function closeEditModal() {
      editModal.classList.remove("is-visible");
      editScrim.classList.remove("is-visible");
      editModal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      editBtn.focus();
    }

    editBtn.addEventListener("click", openEditModal);
    editScrim.addEventListener("click", closeEditModal);
    if (editCloseBtn) editCloseBtn.addEventListener("click", closeEditModal);
    if (editCancelBtn) editCancelBtn.addEventListener("click", closeEditModal);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && editModal.classList.contains("is-visible")) {
        closeEditModal();
      }
    });

    editForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = nameInput.value.trim();
      var dept = deptInput.value.trim();
      // The backend stores level as a bare number ("200"), the field here
      // shows "200 Level" for readability — strip everything but the digits.
      var levelDigits = (levelInput.value.match(/\d+/) || [""])[0];
      var university = universityInput.value.trim();

      if (editErrorEl) editErrorEl.style.display = "none";
      if (editSubmitBtn) { editSubmitBtn.disabled = true; editSubmitBtn.textContent = "Saving..."; }

      authFetch(API_BASE + "/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: name, department: dept, level: levelDigits, university: university }),
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (result) {
          var data = result.data;
          if (editSubmitBtn) { editSubmitBtn.disabled = false; editSubmitBtn.textContent = "Save Changes"; }

          if (!data.success) {
            if (editErrorEl) {
              editErrorEl.textContent = data.message || "Could not save changes. Please try again.";
              editErrorEl.style.display = "block";
            }
            return;
          }

          if (nameHeading && name) nameHeading.textContent = name;
          if (deptLevelText) {
            deptLevelText.textContent = [dept, levelDigits ? levelDigits + " Level" : ""].filter(Boolean).join(" • ");
          }
          if (universityText && university) universityText.textContent = university;

          closeEditModal();
        })
        .catch(function (err) {
          if (editSubmitBtn) { editSubmitBtn.disabled = false; editSubmitBtn.textContent = "Save Changes"; }
          if (editErrorEl) {
            editErrorEl.textContent = "Network error — could not reach the server. Please try again.";
            editErrorEl.style.display = "block";
          }
          console.error(err);
        });
    });
  }

  // ==========================================================================
  // 2. PUBLIC PROFILE TOGGLE
  // ==========================================================================
  var publicToggle = document.getElementById("publicProfileToggle");
  var publicToggleDesc = document.getElementById("publicToggleDesc");

  if (publicToggle && publicToggleDesc) {
    publicToggle.addEventListener("click", function () {
      var isOn = publicToggle.classList.toggle("is-on");
      publicToggle.setAttribute("aria-checked", isOn ? "true" : "false");
      publicToggleDesc.textContent = isOn
        ? "Students can view your uploaded resources."
        : "Your profile is currently private.";

      authFetch(API_BASE + "/users/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: { privacy: { publicProfile: isOn } } }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.success) {
            // Revert the visual state if the save actually failed
            publicToggle.classList.toggle("is-on", !isOn);
            publicToggle.setAttribute("aria-checked", !isOn ? "true" : "false");
            publicToggleDesc.textContent = !isOn
              ? "Students can view your uploaded resources."
              : "Your profile is currently private.";
          }
        })
        .catch(function (err) { console.error("Could not save privacy preference:", err); });
    });
  }

  // ==========================================================================
  // 3. PER-UPLOAD KEBAB MENU (Edit / View Analytics / Delete)
  // ==========================================================================
  var kebabWrappers = document.querySelectorAll(".kebab-menu-wrapper");

  kebabWrappers.forEach(function (wrapper) {
    var btn = wrapper.querySelector(".kebab-btn");
    var panel = wrapper.querySelector(".kebab-dropdown");
    if (!btn || !panel) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var isOpen = wrapper.classList.contains("is-open");

      // Close any other open kebab menus first
      kebabWrappers.forEach(function (other) {
        if (other !== wrapper) {
          other.classList.remove("is-open");
          var otherBtn = other.querySelector(".kebab-btn");
          var otherPanel = other.querySelector(".kebab-dropdown");
          if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
          if (otherPanel) otherPanel.setAttribute("aria-hidden", "true");
        }
      });

      wrapper.classList.toggle("is-open", !isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
      panel.setAttribute("aria-hidden", String(isOpen));
    });
  });

  document.addEventListener("click", function (event) {
    kebabWrappers.forEach(function (wrapper) {
      if (!wrapper.contains(event.target)) {
        wrapper.classList.remove("is-open");
        var btn = wrapper.querySelector(".kebab-btn");
        var panel = wrapper.querySelector(".kebab-dropdown");
        if (btn) btn.setAttribute("aria-expanded", "false");
        if (panel) panel.setAttribute("aria-hidden", "true");
      }
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      kebabWrappers.forEach(function (wrapper) {
        wrapper.classList.remove("is-open");
        var btn = wrapper.querySelector(".kebab-btn");
        var panel = wrapper.querySelector(".kebab-dropdown");
        if (btn) btn.setAttribute("aria-expanded", "false");
        if (panel) panel.setAttribute("aria-hidden", "true");
      });
    }
  });
});
