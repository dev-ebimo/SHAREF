document.addEventListener("DOMContentLoaded", () => {
  const email = localStorage.getItem("pendingVerificationEmail");

  // Nothing to verify without knowing which account this is for
  if (!email) {
    window.location.href = "signup.html";
    return;
  }

  const emailDisplay = document.getElementById("verify-email-display");
  if (emailDisplay) emailDisplay.textContent = email;

  const inputs = document.querySelectorAll(".otp-container input");
  const form = document.getElementById("otp-form");
  const fullOtpInput = document.getElementById("full-otp-input");
  const resendBtn = document.getElementById("resend-btn");
  const timerSpan = document.getElementById("timer");
  const progressFill = document.getElementById("cooldown-progress");
  const errorBox = document.getElementById("otp-error");
  const submitBtn = form.querySelector(".btn-submit");

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }
  function hideError() {
    errorBox.style.display = "none";
  }

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

  // Cooldown timer, restartable (used both on load and after a resend)
  let cooldownInterval = null;
  function startCooldown(duration) {
    let secondsLeft = duration;
    resendBtn.disabled = true;
    clearInterval(cooldownInterval);

    cooldownInterval = setInterval(() => {
      secondsLeft--;
      const percentageRemaining = (secondsLeft / duration) * 100;
      progressFill.style.width = `${percentageRemaining}%`;

      if (secondsLeft <= 0) {
        clearInterval(cooldownInterval);
        resendBtn.disabled = false;
        resendBtn.innerText = "Resend Code";
        progressFill.style.width = "0%";
      } else {
        timerSpan.innerText = secondsLeft;
        resendBtn.innerHTML = `Resend Code (<span id="timer">${secondsLeft}</span>s)`;
      }
    }, 1000);
  }
  startCooldown(59);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    hideError();

    const otp = fullOtpInput.value;
    if (otp.length !== 6) {
      showError("Please enter the full 6-digit code.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Verifying...";

    fetch(`${API_BASE}/auth/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp }),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ data }) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Verify Account";

        if (!data.success) {
          showError(data.message || "Verification failed. Please try again.");
          return;
        }

        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        localStorage.removeItem("pendingVerificationEmail");

        window.location.href = "confirm.html";
      })
      .catch((err) => {
        submitBtn.disabled = false;
        submitBtn.textContent = "Verify Account";
        showError("Network error — could not reach the server. Please try again.");
        console.error(err);
      });
  });

  resendBtn.addEventListener("click", () => {
    if (resendBtn.disabled) return;
    hideError();
    resendBtn.disabled = true;
    resendBtn.innerText = "Sending...";

    fetch(`${API_BASE}/auth/resend-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then((res) => res.json().then((data) => ({ status: res.status, data })))
      .then(({ data }) => {
        if (!data.success) {
          showError(data.message || "Could not resend code. Please try again.");
          resendBtn.disabled = false;
          resendBtn.innerText = "Resend Code";
          return;
        }
        startCooldown(59);
      })
      .catch((err) => {
        showError("Network error — could not reach the server. Please try again.");
        resendBtn.disabled = false;
        resendBtn.innerText = "Resend Code";
        console.error(err);
      });
  });
});
