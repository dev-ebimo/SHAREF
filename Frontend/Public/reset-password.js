document.addEventListener("DOMContentLoaded", () => {
  const email = localStorage.getItem("pendingResetEmail");

  // Nothing to reset without knowing which account this is for
  if (!email) {
    window.location.href = "forgot-password.html";
    return;
  }

  const emailDisplay = document.getElementById("reset-email-display");
  if (emailDisplay) emailDisplay.textContent = email;

  const inputs = document.querySelectorAll(".otp-container input");
  const fullOtpInput = document.getElementById("full-otp-input");
  const form = document.getElementById("reset-form");
  const errorBox = document.getElementById("reset-error");
  const submitBtn = document.getElementById("reset-submit-btn");

  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const toggleBtn = document.getElementById("toggle-new-password");

  const resendBtn = document.getElementById("resend-reset-btn");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }
  function hideError() {
    errorBox.style.display = "none";
  }

  // Password visibility toggle
  toggleBtn.addEventListener("click", () => {
    const isPassword = newPasswordInput.type === "password";
    newPasswordInput.type = isPassword ? "text" : "password";
    toggleBtn.innerHTML = isPassword
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  // Same 6-box OTP UX as verify.js
  inputs[0].focus();
  inputs.forEach((input, index) => {
    input.addEventListener("input", (e) => {
      const value = e.target.value;
      if (!/^[0-9]$/.test(value)) {
        e.target.value = "";
        return;
      }
      input.classList.remove("filled");
      void input.offsetWidth;
      input.classList.add("filled");
      if (value && index < inputs.length - 1) inputs[index + 1].focus();
      updateHiddenInput();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace") {
        if (!input.value && index > 0) {
          inputs[index - 1].value = "";
          inputs[index - 1].focus();
          inputs[index - 1].classList.remove("filled");
        } else {
          input.value = "";
          input.classList.remove("filled");
        }
        updateHiddenInput();
      }
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pastedData = (e.clipboardData || window.clipboardData).getData("text").trim();
      if (/^\d{6}$/.test(pastedData)) {
        pastedData.split("").forEach((char, i) => {
          if (inputs[i]) {
            inputs[i].value = char;
            inputs[i].classList.add("filled");
          }
        });
        inputs[inputs.length - 1].focus();
        updateHiddenInput();
      }
    });
  });

  function updateHiddenInput() {
    let code = "";
    inputs.forEach((input) => (code += input.value));
    fullOtpInput.value = code;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideError();

    const otp = fullOtpInput.value;
    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (otp.length !== 6) {
      showError("Please enter the full 6-digit code.");
      return;
    }
    if (newPassword.length < 8) {
      showError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      showError("Passwords don't match — try again.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Resetting...";

    fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp, newPassword }),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ data }) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Reset Password";

        if (!data.success) {
          showError(data.message || "Could not reset password. Please try again.");
          return;
        }

        localStorage.removeItem("pendingResetEmail");
        submitBtn.textContent = "Password Reset ✓";
        setTimeout(() => {
          window.location.href = "login.html";
        }, 1200);
      })
      .catch((err) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Reset Password";
        showError("Network error — could not reach the server. Please try again.");
        console.error(err);
      });
  });

  // "Send a new one" reuses forgot-password — that's what actually
  // generates a fresh resetPasswordOTP on the backend, not verify-otp's
  // resend endpoint (that one is for account verification, a separate OTP).
  resendBtn.addEventListener("click", () => {
    if (resendBtn.disabled) return;
    hideError();
    resendBtn.disabled = true;
    resendBtn.textContent = "Sending...";

    fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ data }) => {
        resendBtn.disabled = false;
        resendBtn.textContent = "Send a new one";
        if (!data.success) {
          showError(data.message || "Could not send a new code.");
        }
      })
      .catch((err) => {
        resendBtn.disabled = false;
        resendBtn.textContent = "Send a new one";
        showError("Network error — could not reach the server.");
        console.error(err);
      });
  });
});
