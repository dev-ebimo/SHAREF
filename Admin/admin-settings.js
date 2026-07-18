document.addEventListener("DOMContentLoaded", function () {
  // ==========================================================================
  // 0. ROLE-BASED RENDER CONTROLLER
  // ==========================================================================
  // Temporarily hardcoded for frontend UI development.
  // Change to "student" to test the standard user view.
  const currentUser = {
    role: "admin",
  };

  if (currentUser.role === "admin") {
    document.querySelectorAll(".admin-only").forEach(function (el) {
      // Sections use block display, rows use flex layout
      if (el.tagName.toLowerCase() === "section") {
        el.style.display = "block";
      } else {
        el.style.display = "flex";
      }
    });
  }
  // ==========================================================================
  // 0. TOAST HELPER
  // ==========================================================================
  var toast = document.getElementById("settingsToast");
  var toastTimer = null;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove("is-visible");
    }, 3200);
  }

  // ==========================================================================
  // 1. GENERIC SWITCH TOGGLES (notifications + privacy)
  // ==========================================================================
  document.querySelectorAll(".switch").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var isOn = btn.classList.toggle("is-on");
      btn.setAttribute("aria-checked", isOn ? "true" : "false");
    });
  });

  // ==========================================================================
  // 2. SAVE CHANGES CONFIRMATIONS (Account + Preferences)
  // ==========================================================================
  function wireSaveButton(buttonId, confirmId) {
    var btn = document.getElementById(buttonId);
    var confirmEl = document.getElementById(confirmId);
    if (!btn || !confirmEl) return;

    var hideTimer = null;
    btn.addEventListener("click", function () {
      confirmEl.classList.remove("hidden");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        confirmEl.classList.add("hidden");
      }, 2500);
    });
  }

  wireSaveButton("saveAccountBtn", "accountSaveConfirm");
  wireSaveButton("savePreferencesBtn", "preferencesSaveConfirm");

  // ==========================================================================
  // 3. EMAIL VERIFIED/UNVERIFIED STATUS
  // ==========================================================================
  var emailInput = document.getElementById("settingsEmail");
  var emailStatus = document.getElementById("emailStatus");
  var emailStatusText = document.getElementById("emailStatusText");

  if (emailInput && emailStatus && emailStatusText) {
    var originalEmail = emailInput.value.trim();

    emailInput.addEventListener("input", function () {
      var changed = emailInput.value.trim() !== originalEmail;
      emailStatus.classList.toggle("is-unverified", changed);
      emailStatusText.textContent = changed
        ? "Unverified — check your inbox after saving"
        : "Verified";
    });
  }

  // ==========================================================================
  // 4. MODAL HELPERS (shared by Change Password + Delete Account)
  // ==========================================================================
  function openModal(modal, scrim, focusEl) {
    modal.classList.add("is-visible");
    scrim.classList.add("is-visible");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (focusEl) focusEl.focus();
  }

  function closeModal(modal, scrim, returnFocusEl) {
    modal.classList.remove("is-visible");
    scrim.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (returnFocusEl) returnFocusEl.focus();
  }

  // ==========================================================================
  // 4b. PASSWORD SHOW/HIDE TOGGLES
  // ==========================================================================
  document.querySelectorAll(".password-toggle-btn").forEach(function (btn) {
    var targetInput = document.getElementById(btn.getAttribute("data-target"));
    var eyeOpen = btn.querySelector(".eye-open");
    var eyeClosed = btn.querySelector(".eye-closed");
    if (!targetInput) return;

    btn.addEventListener("click", function () {
      var isCurrentlyHidden = targetInput.type === "password";
      targetInput.type = isCurrentlyHidden ? "text" : "password";
      btn.setAttribute("aria-pressed", isCurrentlyHidden ? "true" : "false");
      btn.setAttribute(
        "aria-label",
        isCurrentlyHidden ? "Hide password" : "Show password",
      );
      if (eyeOpen) eyeOpen.classList.toggle("hidden", isCurrentlyHidden);
      if (eyeClosed) eyeClosed.classList.toggle("hidden", !isCurrentlyHidden);
    });
  });

  // ==========================================================================
  // 5. CHANGE PASSWORD MODAL
  // ==========================================================================
  var changePasswordBtn = document.getElementById("changePasswordBtn");
  var passwordModal = document.getElementById("passwordModal");
  var passwordModalScrim = document.getElementById("passwordModalScrim");
  var passwordModalCloseBtn = document.getElementById("passwordModalCloseBtn");
  var passwordCancelBtn = document.getElementById("passwordCancelBtn");
  var passwordForm = document.getElementById("passwordForm");
  var currentPasswordInput = document.getElementById("currentPassword");
  var newPasswordInput = document.getElementById("newPassword");
  var confirmPasswordInput = document.getElementById("confirmPassword");
  var passwordError = document.getElementById("passwordError");

  if (
    changePasswordBtn &&
    passwordModal &&
    passwordModalScrim &&
    passwordForm
  ) {
    function closePasswordModal() {
      closeModal(passwordModal, passwordModalScrim, changePasswordBtn);
      passwordForm.reset();
      passwordError.classList.add("hidden");

      // Reset every password field back to hidden + closed-eye icon
      document.querySelectorAll(".password-toggle-btn").forEach(function (btn) {
        var targetInput = document.getElementById(
          btn.getAttribute("data-target"),
        );
        var eyeOpen = btn.querySelector(".eye-open");
        var eyeClosed = btn.querySelector(".eye-closed");
        if (targetInput) targetInput.type = "password";
        btn.setAttribute("aria-pressed", "false");
        btn.setAttribute("aria-label", "Show password");
        if (eyeOpen) eyeOpen.classList.remove("hidden");
        if (eyeClosed) eyeClosed.classList.add("hidden");
      });
    }

    changePasswordBtn.addEventListener("click", function () {
      openModal(passwordModal, passwordModalScrim, currentPasswordInput);
    });
    if (passwordModalCloseBtn)
      passwordModalCloseBtn.addEventListener("click", closePasswordModal);
    if (passwordCancelBtn)
      passwordCancelBtn.addEventListener("click", closePasswordModal);
    passwordModalScrim.addEventListener("click", closePasswordModal);

    passwordForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var newVal = newPasswordInput.value;
      var confirmVal = confirmPasswordInput.value;

      if (newVal.length < 8) {
        passwordError.textContent =
          "New password must be at least 8 characters.";
        passwordError.classList.remove("hidden");
        return;
      }
      if (newVal !== confirmVal) {
        passwordError.textContent = "Passwords don't match — try again.";
        passwordError.classList.remove("hidden");
        return;
      }

      passwordError.classList.add("hidden");
      closePasswordModal();
      showToast("Password updated successfully.");
    });

    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        passwordModal.classList.contains("is-visible")
      ) {
        closePasswordModal();
      }
    });
  }

  // ==========================================================================
  // 6. DELETE ACCOUNT MODAL
  // ==========================================================================
  var deleteAccountBtn = document.getElementById("deleteAccountBtn");
  var deleteModal = document.getElementById("deleteModal");
  var deleteModalScrim = document.getElementById("deleteModalScrim");
  var deleteModalCloseBtn = document.getElementById("deleteModalCloseBtn");
  var deleteCancelBtn = document.getElementById("deleteCancelBtn");
  var deleteConfirmInput = document.getElementById("deleteConfirmInput");
  var deleteConfirmBtn = document.getElementById("deleteConfirmBtn");

  if (
    deleteAccountBtn &&
    deleteModal &&
    deleteModalScrim &&
    deleteConfirmInput
  ) {
    function closeDeleteModal() {
      closeModal(deleteModal, deleteModalScrim, deleteAccountBtn);
      deleteConfirmInput.value = "";
      deleteConfirmBtn.disabled = true;
    }

    deleteAccountBtn.addEventListener("click", function () {
      openModal(deleteModal, deleteModalScrim, deleteConfirmInput);
    });
    if (deleteModalCloseBtn)
      deleteModalCloseBtn.addEventListener("click", closeDeleteModal);
    if (deleteCancelBtn)
      deleteCancelBtn.addEventListener("click", closeDeleteModal);
    deleteModalScrim.addEventListener("click", closeDeleteModal);

    deleteConfirmInput.addEventListener("input", function () {
      deleteConfirmBtn.disabled = deleteConfirmInput.value.trim() !== "DELETE";
    });

    deleteConfirmBtn.addEventListener("click", function () {
      if (deleteConfirmInput.value.trim() !== "DELETE") return;
      closeDeleteModal();
      showToast(
        "Account deletion requested — this is a prototype, so nothing was actually deleted.",
      );
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && deleteModal.classList.contains("is-visible")) {
        closeDeleteModal();
      }
    });
  }

  // MOBILE NAVIGATION (HAMBURGER MENU) LOGIC
  var hamburgerBtn = document.getElementById("hamburgerBtn");
  var sidebar = document.getElementById("sidebar");
  var sidebarCloseBtn = document.getElementById("sidebarCloseBtn");
  var scrim = document.getElementById("scrim");

  function openSidebar() {
    if (sidebar && scrim && hamburgerBtn) {
      sidebar.classList.add("is-open");
      scrim.classList.add("is-visible");
      hamburgerBtn.setAttribute("aria-expanded", "true");
    }
  }

  function closeSidebar() {
    if (sidebar && scrim && hamburgerBtn) {
      sidebar.classList.remove("is-open");
      scrim.classList.remove("is-visible");
      hamburgerBtn.setAttribute("aria-expanded", "false");
    }
  }

  if (hamburgerBtn) hamburgerBtn.addEventListener("click", openSidebar);
  if (sidebarCloseBtn) sidebarCloseBtn.addEventListener("click", closeSidebar);
  if (scrim) scrim.addEventListener("click", closeSidebar);

  // 7. ACCOUNT MENU (PROFILE ICON) DROPDOWN LOGIC
  var accountWrapper = document.getElementById("accountMenuWrapper");
  var accountMenuTrigger = document.getElementById("accountMenuTrigger");
  var accountMenuPanel = document.getElementById("accountMenuPanel");

  if (accountWrapper && accountMenuTrigger && accountMenuPanel) {
    accountMenuTrigger.addEventListener("click", function (e) {
      e.stopPropagation(); // Prevents immediate closing from the document click listener below
      var isOpen = accountWrapper.classList.toggle("is-open");
      accountMenuTrigger.setAttribute("aria-expanded", String(isOpen));
      accountMenuPanel.setAttribute("aria-hidden", String(!isOpen));
    });

    // Close the menu if a user clicks anywhere outside of it
    document.addEventListener("click", function (e) {
      if (!accountWrapper.contains(e.target)) {
        accountWrapper.classList.remove("is-open");
        accountMenuTrigger.setAttribute("aria-expanded", "false");
        accountMenuPanel.setAttribute("aria-hidden", "true");
      }
    });
  }
});
