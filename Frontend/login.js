document.addEventListener("DOMContentLoaded", () => {
  const passwordInput = document.getElementById("password");
  const toggleBtn = document.getElementById("password-toggle-btn");
  const form = document.getElementById("login-form");
  const errorBox = document.getElementById("login-error");
  const submitBtn = form.querySelector(".btn-submit");

  // Password visibility toggle
  toggleBtn.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleBtn.innerHTML = isPassword
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  });

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }
  function hideError() {
    errorBox.style.display = "none";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideError();

    const email = document.getElementById("email").value.trim();
    const password = passwordInput.value;

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in...";

    fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ status, data }) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";

        if (!data.success) {
          // Unverified account — send them to finish verification, not just an error message
          if (data.unverified) {
            localStorage.setItem("pendingVerificationEmail", data.email || email);
            window.location.href = "verify.html";
            return;
          }
          showError(data.message || "Login failed. Please try again.");
          return;
        }

        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));

        // Route by role — admins and students land on different home pages
        window.location.href = data.user.role === "admin" ? "admin-moderation.html" : "dashboard.html";
      })
      .catch((err) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
        showError("Network error — could not reach the server. Please try again.");
        console.error(err);
      });
  });
});
