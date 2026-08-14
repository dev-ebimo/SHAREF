document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("recovery-form");
  const toast = document.getElementById("success-toast");
  const errorBox = document.getElementById("recovery-error");
  const submitBtn = document.getElementById("submit-btn");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    errorBox.style.display = "none";

    const email = document.getElementById("email").value.trim();

    submitBtn.disabled = true;
    submitBtn.innerText = "Processing Request...";

    fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ data }) => {
        // The backend deliberately returns the same success response whether
        // or not the email exists (prevents account enumeration) — so this
        // branch only fires on real errors like a malformed request.
        if (!data.success) {
          submitBtn.disabled = false;
          submitBtn.innerText = "Send Recovery Code";
          errorBox.textContent = data.message || "Something went wrong. Please try again.";
          errorBox.style.display = "block";
          return;
        }

        localStorage.setItem("pendingResetEmail", email);

        form.style.display = "none";
        toast.style.display = "block";

        setTimeout(() => {
          window.location.href = "reset-password.html";
        }, 2000);
      })
      .catch((err) => {
        submitBtn.disabled = false;
        submitBtn.innerText = "Send Recovery Code";
        errorBox.textContent = "Network error — could not reach the server. Please try again.";
        errorBox.style.display = "block";
        console.error(err);
      });
  });
});
