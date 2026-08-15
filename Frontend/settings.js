document.addEventListener("DOMContentLoaded", function () {
  if (!currentUser) return; // dashboard.js already ran requireAuth() at the top of the file

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
  // 0b. LOAD REAL SETTINGS DATA
  // ==========================================================================
  var fullNameInput = document.getElementById("settingsFullName");
  var emailInput0 = document.getElementById("settingsEmail");
  var departmentInput = document.getElementById("settingsDepartment");
  var levelSelect = document.getElementById("settingsLevel");
  var landingPageSelect = document.getElementById("settingsLandingPage");
  var privacyPublicToggle = document.getElementById("privacyPublicProfileToggle");
  var privacyStatsToggle = document.getElementById("privacyStatsToggle");

  function setSwitchState(el, isOn) {
    if (!el) return;
    el.classList.toggle("is-on", !!isOn);
    el.setAttribute("aria-checked", isOn ? "true" : "false");
  }

  function loadSettings() {
    authFetch(API_BASE + "/users/me")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) return;
        var user = data.user;

        if (fullNameInput) fullNameInput.value = user.fullName;
        if (emailInput0) emailInput0.value = user.email;
        window.__settingsOriginalEmail = user.email;
        if (departmentInput) departmentInput.value = user.department;
        if (levelSelect) levelSelect.value = user.level;

        var prefs = user.preferences || {};
        if (landingPageSelect && prefs.landingPage) landingPageSelect.value = prefs.landingPage;

        document.querySelectorAll(".switch[data-pref-category]").forEach(function (btn) {
          var category = btn.getAttribute("data-pref-category");
          var channel = btn.getAttribute("data-pref-channel");
          var section = prefs.notifications && prefs.notifications[category];
          if (section && typeof section[channel] === "boolean") {
            setSwitchState(btn, section[channel]);
          }
        });

        if (prefs.privacy) {
          if (typeof prefs.privacy.publicProfile === "boolean") setSwitchState(privacyPublicToggle, prefs.privacy.publicProfile);
          if (typeof prefs.privacy.showStats === "boolean") setSwitchState(privacyStatsToggle, prefs.privacy.showStats);
        }
      })
      .catch(function (err) { console.error("Could not load settings:", err); });
  }

  loadSettings();

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
  // 2. SAVE CHANGES (Account + Preferences) — real backend calls
  // ==========================================================================
  function wireSaveButton(buttonId, confirmId, onSave) {
    var btn = document.getElementById(buttonId);
    var confirmEl = document.getElementById(confirmId);
    if (!btn) return;

    var hideTimer = null;
    btn.addEventListener("click", function () {
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Saving...";

      onSave()
        .then(function (ok) {
          btn.disabled = false;
          btn.textContent = originalText;
          if (!ok) return;

          if (confirmEl) {
            confirmEl.classList.remove("hidden");
            clearTimeout(hideTimer);
            hideTimer = setTimeout(function () {
              confirmEl.classList.add("hidden");
            }, 2500);
          }
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = originalText;
        });
    });
  }

  wireSaveButton("saveAccountBtn", "accountSaveConfirm", function () {
    var payload = {
      fullName: fullNameInput ? fullNameInput.value.trim() : undefined,
      email: emailInput0 ? emailInput0.value.trim() : undefined,
      department: departmentInput ? departmentInput.value.trim() : undefined,
      level: levelSelect ? levelSelect.value : undefined,
    };

    return authFetch(API_BASE + "/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) {
          showToast(data.message || "Could not save account changes.");
          return false;
        }
        showToast(data.message || "Account updated successfully.");

        // Reflect the server's verdict on whether the email actually
        // changed (and therefore needs re-verification), not just our own
        // client-side guess.
        window.__settingsOriginalEmail = payload.email;
        if (emailStatus && emailStatusText) {
          emailStatus.classList.toggle("is-unverified", !!data.emailChanged);
          emailStatusText.textContent = data.emailChanged ? "Unverified — check your inbox" : "Verified";
        }

        return true;
      })
      .catch(function (err) {
        console.error(err);
        showToast("Network error — could not save changes.");
        return false;
      });
  });

  wireSaveButton("savePreferencesBtn", "preferencesSaveConfirm", function () {
    var notifications = {};
    document.querySelectorAll(".switch[data-pref-category]").forEach(function (btn) {
      var category = btn.getAttribute("data-pref-category");
      var channel = btn.getAttribute("data-pref-channel");
      notifications[category] = notifications[category] || {};
      notifications[category][channel] = btn.classList.contains("is-on");
    });

    var preferences = {
      landingPage: landingPageSelect ? landingPageSelect.value : undefined,
      notifications: notifications,
      privacy: {
        publicProfile: privacyPublicToggle ? privacyPublicToggle.classList.contains("is-on") : undefined,
        showStats: privacyStatsToggle ? privacyStatsToggle.classList.contains("is-on") : undefined,
      },
    };

    return authFetch(API_BASE + "/users/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: preferences }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success) {
          showToast(data.message || "Could not save preferences.");
          return false;
        }
        showToast(data.message || "Preferences saved.");
        return true;
      })
      .catch(function (err) {
        console.error(err);
        showToast("Network error — could not save preferences.");
        return false;
      });
  });

  // ==========================================================================
  // 3. EMAIL VERIFIED/UNVERIFIED STATUS
  // ==========================================================================
  var emailInput = document.getElementById("settingsEmail");
  var emailStatus = document.getElementById("emailStatus");
  var emailStatusText = document.getElementById("emailStatusText");

  if (emailInput && emailStatus && emailStatusText) {
    // Updated by loadSettings() once the real email comes back from the
    // server — starts from the placeholder value so this still works even
    // if that fetch is slow/fails.
    window.__settingsOriginalEmail = emailInput.value.trim();

    emailInput.addEventListener("input", function () {
      var changed = emailInput.value.trim() !== window.__settingsOriginalEmail;
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
      btn.setAttribute("aria-label", isCurrentlyHidden ? "Hide password" : "Show password");
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

  if (changePasswordBtn && passwordModal && passwordModalScrim && passwordForm) {
    function closePasswordModal() {
      closeModal(passwordModal, passwordModalScrim, changePasswordBtn);
      passwordForm.reset();
      passwordError.classList.add("hidden");

      // Reset every password field back to hidden + closed-eye icon
      document.querySelectorAll(".password-toggle-btn").forEach(function (btn) {
        var targetInput = document.getElementById(btn.getAttribute("data-target"));
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

      var currentVal = currentPasswordInput.value;
      var newVal = newPasswordInput.value;
      var confirmVal = confirmPasswordInput.value;

      if (newVal.length < 8) {
        passwordError.textContent = "New password must be at least 8 characters.";
        passwordError.classList.remove("hidden");
        return;
      }
      if (newVal !== confirmVal) {
        passwordError.textContent = "Passwords don't match — try again.";
        passwordError.classList.remove("hidden");
        return;
      }

      passwordError.classList.add("hidden");
      var submitBtn = passwordForm.querySelector("button[type='submit']");
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Updating..."; }

      authFetch(API_BASE + "/users/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentVal, newPassword: newVal }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Update Password"; }

          if (!data.success) {
            passwordError.textContent = data.message || "Could not update password.";
            passwordError.classList.remove("hidden");
            return;
          }

          closePasswordModal();
          showToast(data.message || "Password updated successfully.");
        })
        .catch(function (err) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Update Password"; }
          passwordError.textContent = "Network error — could not reach the server. Please try again.";
          passwordError.classList.remove("hidden");
          console.error(err);
        });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && passwordModal.classList.contains("is-visible")) {
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

  if (deleteAccountBtn && deleteModal && deleteModalScrim && deleteConfirmInput) {
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
    if (deleteCancelBtn) deleteCancelBtn.addEventListener("click", closeDeleteModal);
    deleteModalScrim.addEventListener("click", closeDeleteModal);

    deleteConfirmInput.addEventListener("input", function () {
      deleteConfirmBtn.disabled = deleteConfirmInput.value.trim() !== "DELETE";
    });

    deleteConfirmBtn.addEventListener("click", function () {
      if (deleteConfirmInput.value.trim() !== "DELETE") return;

      deleteConfirmBtn.disabled = true;
      var originalText = deleteConfirmBtn.textContent;
      deleteConfirmBtn.textContent = "Deleting...";

      authFetch(API_BASE + "/users/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.success) {
            deleteConfirmBtn.disabled = false;
            deleteConfirmBtn.textContent = originalText;
            showToast(data.message || "Could not delete account.");
            return;
          }

          // Account and all uploads are gone server-side — clear the local
          // session and send them off, same as a normal logout.
          logout();
        })
        .catch(function (err) {
          deleteConfirmBtn.disabled = false;
          deleteConfirmBtn.textContent = originalText;
          showToast("Network error — could not delete account.");
          console.error(err);
        });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && deleteModal.classList.contains("is-visible")) {
        closeDeleteModal();
      }
    });
  }
});
