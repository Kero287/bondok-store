(() => {
    const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const money = value => `${Number(value).toLocaleString("en-EG", { maximumFractionDigits: 2 })} EGP`;
    let items;
    try { items = JSON.parse(localStorage.getItem("bondok-cart") || "[]"); } catch { items = []; }
    if (!Array.isArray(items)) items = [];
    items = items.filter(item => item && Number.isInteger(item.id) && Number.isInteger(item.quantity) && item.quantity > 0);
    const save = () => {
        localStorage.setItem("bondok-cart", JSON.stringify(items));
        render();
        document.dispatchEvent(new Event("bondok:cart"));
    };
    async function api(path, options = {}) {
        const token = sessionStorage.getItem("bondok-auth-token");
        const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Please try again.");
        return body;
    }
    function add(product, size, quantity = 1, color = "") {
        if (!product.sizes.includes(size)) throw new Error("Please select your size.");
        if (product.colors?.length && !product.colors.includes(color)) throw new Error("Please select an available color.");
        const total = items.filter(item => item.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
        if (!Number.isInteger(quantity) || quantity < 1 || total + quantity > product.stock) throw new Error("This is the maximum available quantity.");
        const existing = items.find(item => item.id === product.id && item.size === size && (item.color || "") === color);
        if (existing) existing.quantity += quantity;
        else items.push({ id: product.id, name: product.name, image: product.image, price: product.price, stock: product.stock, size, color, quantity });
        save();
    }
    function ensureDrawer() {
        if (document.querySelector("#cart-panel")) return;
        document.body.insertAdjacentHTML("beforeend", `<aside class="cart-panel" id="cart-panel" aria-label="Shopping cart" aria-hidden="true"><div class="cart-header"><h2>Your cart</h2><button class="close-button" type="button" data-close-cart aria-label="Close cart">&times;</button></div><div class="cart-items" id="cart-items"></div><div class="cart-footer"><div class="cart-total"><span>Subtotal</span><strong id="cart-total"></strong></div><p>Shipping is calculated at checkout.</p><a class="primary-button checkout-link" href="checkout.html">Checkout</a></div></aside><div class="overlay" data-close-cart></div>`);
    }
    function render() {
        const container = document.querySelector("#cart-items");
        if (container) container.innerHTML = items.length ? items.map((item, index) => `<div class="cart-item"><a href="product.html?id=${item.id}"><img src="${escape(item.image)}" alt="${escape(item.name)}"></a><div><h3><a href="product.html?id=${item.id}">${escape(item.name)}</a></h3><p>Size: ${escape(item.size || "Please choose")}${item.color ? ` / Color: ${escape(item.color)}` : ""}</p><p>${money(item.price * item.quantity)}</p><button class="cart-remove" type="button" data-cart-remove="${index}">Remove</button></div><div class="quantity-controls" aria-label="Quantity for ${escape(item.name)}"><button type="button" data-cart-change="${index}" data-delta="-1" aria-label="Decrease quantity">&minus;</button><span>${item.quantity}</span><button type="button" data-cart-change="${index}" data-delta="1" aria-label="Increase quantity">+</button></div></div>`).join("") : '<p>Your cart is empty. <a href="shop.html">Explore the collection.</a></p>';
        const total = document.querySelector("#cart-total");
        if (total) total.textContent = money(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
        document.querySelectorAll(".cart-count").forEach(el => el.textContent = items.reduce((sum, item) => sum + item.quantity, 0));
    }
    let previousFocus;
    function open() {
        ensureDrawer(); render(); previousFocus = document.activeElement;
        document.querySelector("#cart-panel").classList.add("is-open");
        document.querySelector("#cart-panel").setAttribute("aria-hidden", "false");
        document.querySelector(".overlay").classList.add("is-visible");
        document.querySelector("#cart-panel [data-close-cart]").focus();
    }
    function close() {
        document.querySelector("#cart-panel")?.classList.remove("is-open");
        document.querySelector("#cart-panel")?.setAttribute("aria-hidden", "true");
        document.querySelector(".overlay")?.classList.remove("is-visible");
        previousFocus?.focus();
    }
    document.addEventListener("click", event => {
        if (event.target.closest('[data-open-cart], a[href="shop.html?panel=cart"]')) { event.preventDefault(); open(); }
        if (event.target.closest("[data-close-cart]")) close();
        const change = event.target.closest("[data-cart-change]");
        const remove = event.target.closest("[data-cart-remove]");
        if (!change && !remove) return;
        const index = Number((change || remove).dataset[change ? "cartChange" : "cartRemove"]);
        const item = items[index]; if (!item) return;
        if (remove) items.splice(index, 1);
        else {
            const delta = Number(change.dataset.delta);
            const total = items.filter(line => line.id === item.id).reduce((sum, line) => sum + line.quantity, 0);
            if (delta > 0 && total >= item.stock) return;
            item.quantity += delta;
            if (item.quantity < 1) items.splice(index, 1);
        }
        save();
    });
    document.addEventListener("keydown", event => {
        const drawer = document.querySelector("#cart-panel.is-open");
        if (!drawer) return;
        if (event.key === "Escape") close();
        if (event.key === "Tab") {
            const elements = [...drawer.querySelectorAll('a[href], button:not(:disabled)')];
            const first = elements[0], last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    window.BondokCommerce = { escape, money, items, save, add, render, open, close, api };
    render();
})();
