document.addEventListener("DOMContentLoaded", function () {
  // ==========================================================================
  // 1. EDIT PROFILE MODAL
  // ==========================================================================
  var editBtn = document.getElementById("editProfileBtn");
  var editModal = document.getElementById("editProfileModal");
  var editScrim = document.getElementById("editProfileScrim");
  var editCloseBtn = document.getElementById("editProfileCloseBtn");
  var editCancelBtn = document.getElementById("editProfileCancelBtn");
  var editForm = document.getElementById("editProfileForm");

  var nameInput = document.getElementById("editName");
  var deptInput = document.getElementById("editDept");
  var levelInput = document.getElementById("editLevel");
  var universityInput = document.getElementById("editUniversity");
  var bioInput = document.getElementById("editBio");

  var nameHeading = document.getElementById("profileNameHeading");
  var deptLevelText = document.getElementById("profileDeptLevel");
  var universityText = document.getElementById("profileUniversityText");
  var bioText = document.getElementById("profileBio");

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
      var level = levelInput.value.trim();
      var university = universityInput.value.trim();
      var bio = bioInput.value.trim();

      if (nameHeading && name) nameHeading.textContent = name;
      if (deptLevelText) {
        deptLevelText.textContent = [dept, level].filter(Boolean).join(" • ");
      }
      if (universityText && university) universityText.textContent = university;
      if (bioText) bioText.textContent = bio;

      closeEditModal();
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

  // ==========================================================================
  // 4. PROFILE AVATAR UPLOAD
  //    Lets the user replace the "EB" initials with an uploaded photo.
  //    The same image is mirrored onto the top-nav avatar and the account
  //    dropdown avatar, since they all share the ".avatar-visual" pattern.
  //    Saved to localStorage so it survives a page refresh; if storage isn't
  //    available (private browsing, etc.) it still works for the session.
  // ==========================================================================
  var avatarUploadBtn = document.getElementById("avatarUploadBtn");
  var avatarFileInput = document.getElementById("avatarFileInput");
  var avatarRemoveBtn = document.getElementById("avatarRemoveBtn");
  var avatarVisuals = document.querySelectorAll(".avatar-visual");
  var AVATAR_STORAGE_KEY = "sharef.profileAvatar";

  function applyAvatarImage(dataUrl) {
    avatarVisuals.forEach(function (el) {
      var img = el.querySelector(".avatar-image-el");
      if (img) img.src = dataUrl;
      el.classList.add("has-avatar-image");
    });
    if (avatarRemoveBtn) avatarRemoveBtn.classList.remove("hidden");
  }

  function clearAvatarImage() {
    avatarVisuals.forEach(function (el) {
      var img = el.querySelector(".avatar-image-el");
      if (img) img.removeAttribute("src");
      el.classList.remove("has-avatar-image");
    });
    if (avatarRemoveBtn) avatarRemoveBtn.classList.add("hidden");
  }

  if (avatarUploadBtn && avatarFileInput && avatarVisuals.length) {
    // Restore a previously saved photo, if storage is available
    try {
      var savedAvatar = window.localStorage.getItem(AVATAR_STORAGE_KEY);
      if (savedAvatar) applyAvatarImage(savedAvatar);
    } catch (err) {
      // Private browsing / storage disabled — falls back to initials, no harm done
    }

    avatarUploadBtn.addEventListener("click", function () {
      avatarFileInput.click();
    });

    avatarFileInput.addEventListener("change", function () {
      var file = avatarFileInput.files && avatarFileInput.files[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        alert("Please choose an image smaller than 5MB.");
        return;
      }

      var reader = new FileReader();
      reader.onload = function (e) {
        var dataUrl = e.target.result;
        applyAvatarImage(dataUrl);
        try {
          window.localStorage.setItem(AVATAR_STORAGE_KEY, dataUrl);
        } catch (err) {
          // Storage full/unavailable — photo still shows for this session
        }
      };
      reader.readAsDataURL(file);
    });

    if (avatarRemoveBtn) {
      avatarRemoveBtn.addEventListener("click", function () {
        clearAvatarImage();
        avatarFileInput.value = "";
        try {
          window.localStorage.removeItem(AVATAR_STORAGE_KEY);
        } catch (err) {
          /* no-op */
        }
      });
    }
  }
});
