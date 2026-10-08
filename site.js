const authToken = sessionStorage.getItem("bondok-auth-token") || "";
const logoutButton = document.querySelector("[data-logout]");

if (logoutButton) {
    if (!authToken) logoutButton.hidden = true;
    else {
        fetch("/api/auth/me", { headers: { Authorization: `Bearer ${authToken}` } })
            .then((response) => response.ok ? response.json() : Promise.reject())
            .then(() => { logoutButton.hidden = false; })
            .catch(() => { logoutButton.hidden = true; });
    }
}

document.addEventListener("click", (event) => {
    if (event.target.closest("[data-toggle-menu]")) {
        const button = event.target.closest("[data-toggle-menu]");
        const navLinks = document.querySelector(".nav-links");
        navLinks.classList.toggle("is-mobile-open");
        button.setAttribute("aria-expanded", navLinks.classList.contains("is-mobile-open"));
    }

    if (event.target.closest("[data-logout]")) {
        fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${sessionStorage.getItem("bondok-auth-token") || ""}` } })
            .catch(() => { })
            .finally(() => {
                sessionStorage.removeItem("bondok-auth-token");
                localStorage.removeItem("bondok-auth-token");
                window.location.href = "index.html";
            });
    }
});
