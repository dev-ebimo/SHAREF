document.addEventListener("DOMContentLoaded", () => {
  const user = requireAuth();
  if (!user) return;

  const statusIcon = document.getElementById("status-icon");
  const statusTitle = document.getElementById("status-title");
  const statusMessage = document.getElementById("status-message");
  const manualLink = document.getElementById("manual-link");

  function showSuccess(message) {
    statusIcon.className = "icon-wrapper is-success";
    statusIcon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    statusTitle.textContent = "Payment Confirmed";
    statusMessage.textContent = message;
    setTimeout(() => {
      window.location.href = "dashboard.html";
    }, 2000);
  }

  function showError(message) {
    statusIcon.className = "icon-wrapper is-error";
    statusIcon.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    statusTitle.textContent = "Payment Not Confirmed";
    statusMessage.textContent = message;
    manualLink.style.display = "inline-block";
  }

  // Paystack appends the reference as either `reference` or `trxref`
  // depending on the exact checkout flow — check both to be safe.
  const params = new URLSearchParams(window.location.search);
  const reference = params.get("reference") || params.get("trxref");

  if (!reference) {
    showError("No payment reference was found in the URL. If you completed a payment, check your wallet balance on the dashboard — it may already be reflected.");
    return;
  }

  authFetch(`${API_BASE}/wallet/fund/verify/${reference}`)
    .then((res) => res.json().then((data) => ({ status: res.status, data })))
    .then(({ data }) => {
      if (!data.success) {
        showError(data.message || "We couldn't confirm this payment. If you were charged, contact support with your reference.");
        return;
      }
      showSuccess("Your wallet has been credited. Redirecting you to the dashboard...");
    })
    .catch((err) => {
      showError("Network error while confirming payment. Check your wallet balance on the dashboard.");
      console.error(err);
    });
});
