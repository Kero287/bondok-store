const pageType = document.body.dataset.authPage;
const form = document.querySelector("#auth-form");
const message = document.querySelector("#auth-message");
document.querySelector('[data-toggle-password]')?.addEventListener('click', event => {
    const input = form.elements.password;
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed', String(visible));
    event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    if (submit.disabled) return;
    submit.disabled = true;
    message.textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    const endpoint = pageType === "register" ? "/api/auth/register" : "/api/auth/login";

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to continue.");
        if (pageType === "register" && result.user.role === "admin") throw new Error("Admin accounts cannot be registered here.");

        // A login is valid only for this browser tab. Opening the storefront fresh
        // never restores an old admin session or shows its logout controls.
        sessionStorage.setItem("bondok-auth-token", result.token);
        localStorage.removeItem("bondok-auth-token");
        window.location.href = result.user.role === "admin" ? "admin.html" : "index.html";
    } catch (error) {
        message.textContent = error.message;
    } finally {
        submit.disabled = false;
    }
});
