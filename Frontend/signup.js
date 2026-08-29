document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  const errorBox = document.getElementById("signup-error");
  const submitBtn = form.querySelector(".btn-submit");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "block";
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function hideError() {
    errorBox.style.display = "none";
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideError();

    const discoverySelect = document.getElementById("discovery");

    const payload = {
      fullName: document.getElementById("fullname").value.trim(),
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
      // Store the readable label ("Word of Mouth / Friend"), not the raw slug —
      // this field is just free-text context for admins, not filtered on.
      communitySurvey: discoverySelect.options[discoverySelect.selectedIndex]?.text || "",
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating your account...";

    fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ status, data }) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create My Account";

        if (!data.success) {
          if (data.errors && data.errors.length > 0) {
            showError(data.errors.map((e) => e.message).join(" "));
          } else {
            showError(data.message || "Registration failed. Please check your details and try again.");
          }
          return;
        }

        localStorage.setItem("pendingVerificationEmail", data.email);
        window.location.href = "verify.html";
      })
      .catch((err) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create My Account";
        showError("Network error — could not reach the server. Please try again.");
        console.error(err);
      });
  });
});
