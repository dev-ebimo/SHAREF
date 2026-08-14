// Shared authentication guard + fetch helper.
// Include on every page that requires a logged-in user, right after
// api-config.js and before the page's own script.
//
// Usage at the top of a protected page's script:
//   const user = requireAuth();            // any logged-in user
//   const user = requireAuth("admin");     // admin-only page
//
// For API calls on protected pages, use authFetch(url, options) instead of
// plain fetch() — it attaches the Bearer token automatically and logs the
// user out + redirects to login if the token is invalid/expired (401).

function getToken() {
  return localStorage.getItem("token");
}

function getCurrentUser() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}

function isTokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (!payload.exp) return false; // no expiry claim on the token — let the server be the judge
    return Date.now() >= payload.exp * 1000;
  } catch (err) {
    return true; // malformed/unreadable token — treat as invalid
  }
}

function logout(redirectTo = "login.html") {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = redirectTo;
}

// Call at the top of any protected page's script. Returns the current user
// object, or redirects and returns null if there's no valid session.
function requireAuth(requiredRole) {
  const token = getToken();
  const user = getCurrentUser();

  if (!token || !user || isTokenExpired(token)) {
    logout();
    return null;
  }

  if (requiredRole && user.role !== requiredRole) {
    // Valid session, just the wrong role for this page — send them to
    // their own home instead of logging out a perfectly valid user.
    window.location.href = user.role === "admin" ? "admin-moderation.html" : "dashboard.html";
    return null;
  }

  return user;
}

// Wraps fetch() to attach the Authorization header automatically, and to
// handle an expired/invalid token (401) consistently everywhere instead of
// every page having to check for that itself.
async function authFetch(url, options = {}) {
  const token = getToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401) {
    logout();
    return Promise.reject(new Error("Session expired"));
  }

  return response;
}

// Wires up any .account-logout-item button/link found on the page. Call
// this once per page (safe to call even if the element doesn't exist).
function wireLogoutButton() {
  const logoutItem = document.querySelector(".account-logout-item");
  if (logoutItem) {
    logoutItem.addEventListener("click", () => logout());
  }
}
