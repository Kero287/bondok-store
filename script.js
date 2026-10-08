let products = [];
const cart = BondokCommerce.items;
const productGrid = document.querySelector("#product-grid");
const cartItems = document.querySelector("#cart-items");
const cartTotal = document.querySelector("#cart-total");
const cartPanel = document.querySelector("#cart-panel");
const overlay = document.querySelector(".overlay");
const checkoutDialog = document.querySelector("#checkout-dialog");
const adminDialog = document.querySelector("#admin-dialog");
const wishlistDialog = document.querySelector("#wishlist-dialog");
const profileDialog = document.querySelector("#profile-dialog");
const logoutButton = document.querySelector("[data-logout]");
const adminButtons = document.querySelectorAll("[data-open-admin]");
const cartCount = document.querySelector(".cart-count");
const accountLink = document.querySelector("[data-account-link]");
const adminDashboardLink = document.querySelector("[data-admin-dashboard]");
const cartButtons = document.querySelectorAll("[data-open-cart]");
const wishlist = JSON.parse(localStorage.getItem("bondok-wishlist") || "[]");
let currentUser = null;
let authToken = sessionStorage.getItem("bondok-auth-token") || "";
const catalogParams = new URLSearchParams(window.location.search);
let activeCategory = catalogParams.get("category") || "all";
let activeBrand = new URLSearchParams(window.location.search).get("brand") || "";
let searchQuery = catalogParams.get("q") || "";
let showBestSellers = catalogParams.get("collection") === "best-sellers" || (!window.location.pathname.endsWith("shop.html") && activeCategory === "all" && !activeBrand && !searchQuery);
let showAllProducts = !!activeBrand;
if (activeCategory !== "all" || activeBrand || searchQuery || catalogParams.get("collection")) {
    const categories = document.querySelector(".category-section");
    if (categories) categories.hidden = true;
    const title = activeCategory === "Swetpants" ? "Pants" : activeCategory !== "all" ? activeCategory : searchQuery ? `Search: ${searchQuery}` : activeBrand || "Best Sellers";
    const heading = document.querySelector(".page-heading h1");
    if (heading) heading.textContent = title;
    document.title = `${title} | Bondok Store`;
}
if (logoutButton) logoutButton.style.display = "none";
adminButtons.forEach((button) => { button.hidden = true; button.style.display = "none"; });
const formatPrice = (price) => `${Number(price).toLocaleString("en-EG")} EGP`;
const saveCart = () => localStorage.setItem("bondok-cart", JSON.stringify(cart));
const saveWishlist = () => localStorage.setItem("bondok-wishlist", JSON.stringify(wishlist));

const addButtonTimers = new WeakMap();

function showCartFeedback(product, button) {
    clearTimeout(addButtonTimers.get(button));
    button.classList.add("is-loading");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-disabled", "true");
    addButtonTimers.set(button, setTimeout(() => {
        button.classList.remove("is-loading");
        button.removeAttribute("aria-busy");
        button.removeAttribute("aria-disabled");
        addButtonTimers.delete(button);
    }, 800));
}
async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(path, { ...options, headers });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
}

async function loadProducts() {
    products = await api("/api/products");
    renderProducts();
}

async function loadCurrentUser() {
    if (!authToken) {
        updateAuthUI();
        return;
    }
    try {
        const data = await api("/api/auth/me");
        currentUser = data.user;
        updateAuthUI();
    } catch {
        authToken = "";
        sessionStorage.removeItem("bondok-auth-token");
        localStorage.removeItem("bondok-auth-token");
        updateAuthUI();
    }
}

function updateAuthUI() {
    const isAdmin = currentUser?.role === "admin";
    if (logoutButton) {
        logoutButton.hidden = !currentUser;
        logoutButton.style.display = currentUser ? "" : "none";
    }
    adminButtons.forEach((button) => {
        button.hidden = !isAdmin;
        button.style.display = isAdmin ? "" : "none";
    });
    if (adminDashboardLink) adminDashboardLink.hidden = !isAdmin;
    cartButtons.forEach((button) => { button.hidden = isAdmin; button.style.display = isAdmin ? "none" : ""; });
}

function openProfile() {
    if (!currentUser) {
        window.location.href = "login.html";
        return;
    }
    const form = document.querySelector("#profile-form");
    form.elements.name.value = currentUser.name || "";
    form.elements.email.value = currentUser.email || "";
    form.elements.phone.value = currentUser.phone || "";
    form.elements.address.value = currentUser.address || "";
    profileDialog.showModal();
}

async function loadAdminOrders() {
    if (currentUser?.role !== "admin") return;
    const orders = await api("/api/admin/orders");
    document.querySelector("#admin-orders").innerHTML = orders.length ? orders.map((order) => `
        <article class="admin-order">
            <div class="admin-order-top"><strong>Order #${order.id}</strong><span class="order-status">${order.status}</span></div>
            <p>${order.name} · ${order.phone}</p><p>${order.address}</p>
            <p class="admin-order-items">${order.items.map((item) => `${item.name} x${item.quantity}`).join(", ")}</p>
            <p><strong>Payment:</strong> ${order.payment_status} · ${formatPrice(order.deposit_amount)} received/requested · ${formatPrice(order.remaining_amount)} remaining</p>
            <div class="admin-order-bottom"><strong>${formatPrice(order.total)}</strong><span>${order.delivery_date ? `${order.delivery_date} ${order.delivery_time}` : "Delivery not scheduled"}</span></div>
            ${order.payment_screenshot ? `<a class="receipt-link" href="${order.payment_screenshot}" target="_blank" rel="noreferrer"><img class="payment-screenshot" src="${order.payment_screenshot}" alt="Payment screenshot for order #${order.id}">View payment screenshot</a>` : "<p>No screenshot was provided for this legacy order.</p>"}
            ${String(order.payment_status).startsWith("Pending") ? `<div class="verification-controls"><label>Delivery date<input type="date" data-order-date="${order.id}"></label><label>Delivery time<input type="time" data-order-time="${order.id}"></label></div><div class="admin-order-actions"><button type="button" class="admin-refresh" data-payment-decision="approve" data-order-id="${order.id}">Approve payment</button><button type="button" class="admin-refresh" data-payment-decision="reject" data-order-id="${order.id}">Reject payment</button></div>` : ""}
            ${order.status === "Confirmed" ? `<div class="admin-order-actions"><button type="button" class="admin-refresh" data-send-order="${order.id}">Notify on WhatsApp</button></div>` : ""}
        </article>
    `).join("") : "<p>No orders yet.</p>";
}

function renderProducts() {
    const isAdmin = currentUser?.role === "admin";
    let visibleProducts = products.filter((product) =>
        (activeCategory === "all" || (product.category || "").toLowerCase() === activeCategory.toLowerCase()) &&
        (!activeBrand || (product.brand || "Other").trim().toLowerCase() === activeBrand.trim().toLowerCase()) &&
        (!searchQuery || `${product.name} ${product.brand || ""} ${product.category || ""}`.toLowerCase().includes(searchQuery.toLowerCase()))
    );
    if (showBestSellers) {
        visibleProducts = visibleProducts.filter((product) => product.bestSeller === true);
    }
    if (!showAllProducts) visibleProducts = visibleProducts.slice(0, 8);
    productGrid.innerHTML = visibleProducts.map((product) => `
        <article class="product-card">
            ${renderProductGallery(product)}
            <div class="product-info">
                <p class="product-brand">${product.brand || "Other"}</p><div class="product-title"><h3><a href="product.html?id=${product.id}">${product.name}</a></h3><button class="wish-button ${wishlist.includes(product.id) ? "is-saved" : ""}" type="button" data-wishlist-product="${product.id}" aria-label="Save ${product.name}" aria-pressed="${wishlist.includes(product.id)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.2 8.8c0 5-8.2 10-8.2 10s-8.2-5-8.2-10A4.2 4.2 0 0 1 12 6a4.2 4.2 0 0 1 8.2 2.8Z"/></svg></button></div>
                <div class="product-meta">
                    <span class="product-price">${formatPrice(product.price)}</span>
                    ${product.stock < 1 ? '<span class="stock-label">Out of stock</span>' : ""}
                </div>
            </div>
        </article>
    `).join("");
    const heading = document.querySelector("#shop h2");
    if (heading) {
        if (!heading.dataset.defaultTitle) heading.dataset.defaultTitle = heading.textContent;
        heading.textContent = activeBrand ? `${activeBrand} products` : activeCategory !== "all" ? (activeCategory === "Swetpants" ? "Pants" : activeCategory) : searchQuery ? `Search: ${searchQuery}` : showBestSellers ? "Best Sellers" : "All Products";
    }
    if (!visibleProducts.length) {
        const message = document.createElement("p");
        message.className = "products-empty";
        message.setAttribute("role", "status");
        message.textContent = showBestSellers ? "No best sellers yet." : activeBrand ? `No products available for ${activeBrand} yet.` : "No products available in this category yet.";
        productGrid.append(message);
    }
    document.querySelector("[data-clear-category]").hidden = showAllProducts || !visibleProducts.length;
}

function renderProductGallery(product) {
    const images = product.images?.length ? product.images : [product.image];
    const safe = value => String(value || "").replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    return `<div class="product-gallery" data-gallery-product="${product.id}" data-photo="0" role="group" aria-label="${safe(product.name)} photos">
        <a class="gallery-open" href="product.html?id=${product.id}" aria-label="View ${safe(product.name)}"><img class="product-image" src="${safe(images[0])}" alt="${safe(product.name)} - photo 1" loading="lazy"></a>
        ${images.length > 1 ? `<button type="button" class="gallery-arrow gallery-prev" data-gallery-step="-1" aria-label="Previous photo">&#8249;</button><button type="button" class="gallery-arrow gallery-next" data-gallery-step="1" aria-label="Next photo">&#8250;</button><span class="gallery-count" aria-live="polite">1 / ${images.length}</span>` : ""}
    </div>`;
}

function renderWishlist() {
    const items = products.filter((product) => wishlist.includes(product.id));
    document.querySelector("#wishlist-items").innerHTML = items.length ? items.map((product) => `<div class="wishlist-item"><span>${product.name}</span><button type="button" data-add-product="${product.id}">Add to cart</button></div>`).join("") : "<p>Your wishlist is empty.</p>";
}

function renderCart() { BondokCommerce.render(); }

function renderAdminProducts() {
    document.querySelector("#admin-products").innerHTML = products.map((product) => `
        <div class="admin-product"><span>${product.name} · ${product.category} · ${product.stock} in stock</span><span><button type="button" data-edit-product="${product.id}">Edit</button><button type="button" data-delete-product="${product.id}">Delete</button></span></div>
    `).join("");
}

function fillCheckoutForm() {
    if (!currentUser) return;
    const form = document.querySelector("#checkout-form");
    if (!form) return;
    form.elements.name.value = currentUser.name || "";
    form.elements.phone.value = currentUser.phone || "";
    form.elements.address.value = currentUser.address || "";
}

function updatePaymentInstructions() {
    const form = document.querySelector("#checkout-form");
    if (!form) return;
    const depositOptions = form.querySelector("[data-deposit-options]");
    const depositChannel = form.elements.depositChannel;
    const screenshotField = form.querySelector("[data-payment-screenshot]");
    const screenshotInput = form.elements.paymentScreenshot;
    const note = form.querySelector("[data-payment-note]");
    depositOptions.hidden = false;
    depositChannel.required = true;
    screenshotField.hidden = false;
    screenshotInput.required = true;
    note.textContent = "Send a 50 EGP deposit using InstaPay or Vodafone Cash, then upload the screenshot. Your payment is not confirmed until an admin reviews it.";
}

function openCheckout() { window.location.href = "checkout.html"; }

function openCart() {
    if (currentUser?.role === "admin") return;
    cartPanel.classList.add("is-open");
    overlay.classList.add("is-visible");
    cartPanel.setAttribute("aria-hidden", "false");
}

function closeCart() {
    cartPanel.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    cartPanel.setAttribute("aria-hidden", "true");
}

let categoryTransition = null;
function openCategory(button) {
    if (categoryTransition) return;
    const destination = `shop.html?category=${encodeURIComponent(button.dataset.category)}`;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.location.assign(destination);
        return;
    }
    const photo = button.querySelector('img');
    const bounds = button.getBoundingClientRect();
    const preview = document.createElement('div');
    preview.className = 'category-transition';
    preview.setAttribute('role', 'status');
    preview.setAttribute('aria-live', 'polite');
    const card = document.createElement('div');
    card.className = 'category-transition-card';
    if (photo) {
        const image = document.createElement('img');
        image.src = photo.currentSrc || photo.src;
        image.alt = '';
        card.append(image);
    }
    const caption = document.createElement('div');
    caption.className = 'category-transition-caption';
    const eyebrow = document.createElement('span');
    eyebrow.textContent = 'BONDOK / COLLECTION';
    const title = document.createElement('strong');
    title.textContent = button.querySelector('strong')?.textContent || button.dataset.category;
    const message = document.createElement('span');
    message.textContent = document.documentElement.lang === 'ar' ? 'اكتشف تشكيلتك الجديدة' : 'Discover your next look';
    caption.append(eyebrow, title, message);
    card.append(caption);
    preview.append(card);
    categoryTransition = preview;
    document.body.append(preview);
    const target = card.getBoundingClientRect();
    card.animate([
        { transform: `translate(${bounds.left - target.left}px, ${bounds.top - target.top}px) scale(${bounds.width / target.width}, ${bounds.height / target.height})`, borderRadius: '5px' },
        { transform: 'translate(0, 0) scale(1)', borderRadius: '20px' }
    ], { duration: 620, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
    window.setTimeout(() => window.location.assign(destination), 900);
}
window.addEventListener('pageshow', () => {
    categoryTransition?.remove();
    categoryTransition = null;
});

document.addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-add-product]");
    const removeButton = event.target.closest("[data-remove-product]");
    const decreaseButton = event.target.closest("[data-decrease-product]");
    const increaseButton = event.target.closest("[data-increase-product]");
    const deleteButton = event.target.closest("[data-delete-product]");
    const editButton = event.target.closest("[data-edit-product]");
    const wishlistButton = event.target.closest("[data-wishlist-product]");
    const categoryButton = event.target.closest("[data-category]");
    const sendOrderButton = event.target.closest("[data-send-order]");
    const paymentDecisionButton = event.target.closest("[data-payment-decision]");

    if (event.target.closest("[data-open-cart]")) openCart();
    if (event.target.closest("[data-close-cart]")) closeCart();
    if (event.target.closest("[data-open-checkout]")) {
        if (!cart.length) return;
        closeCart();
        openCheckout();
    }
    if (event.target.closest("[data-close-checkout]")) checkoutDialog.close();
    if (event.target.closest("[data-open-admin]")) {
        if (currentUser?.role === "admin") {
            renderAdminProducts();
            loadAdminOrders().catch((error) => { document.querySelector("#admin-orders").textContent = error.message; });
            adminDialog.showModal();
        } else {
            window.location.href = "login.html";
        }
    }
    if (event.target.closest("[data-logout]")) {
        api("/api/auth/logout", { method: "POST" }).catch(() => { }).finally(() => {
            currentUser = null;
            authToken = "";
            sessionStorage.removeItem("bondok-auth-token");
            localStorage.removeItem("bondok-auth-token");
            updateAuthUI();
            if (adminDialog?.open) adminDialog.close();
            if (checkoutDialog?.open) checkoutDialog.close();
            window.location.href = "index.html";
        });
    }
    if (event.target.closest("[data-close-admin]")) adminDialog.close();
    if (event.target.closest("[data-open-profile]")) openProfile();
    if (event.target.closest("[data-close-profile]")) profileDialog.close();
    if (event.target.closest("[data-refresh-orders]")) loadAdminOrders().catch((error) => { document.querySelector("#admin-orders").textContent = error.message; });
    
    
    if (event.target.closest("[data-open-wishlist]")) { renderWishlist(); wishlistDialog.showModal(); }
    if (event.target.closest("[data-close-wishlist]")) wishlistDialog.close();
    if (event.target.closest("[data-toggle-menu]")) {
        const menuButton = event.target.closest("[data-toggle-menu]");
        const navLinks = document.querySelector(".nav-links");
        navLinks.classList.toggle("is-mobile-open");
        menuButton.setAttribute("aria-expanded", navLinks.classList.contains("is-mobile-open"));
    }

    if (paymentDecisionButton) {
        const orderId = paymentDecisionButton.dataset.orderId;
        const dateInput = document.querySelector(`[data-order-date="${orderId}"]`);
        const timeInput = document.querySelector(`[data-order-time="${orderId}"]`);
        api(`/api/admin/orders/${orderId}/payment-decision`, { method: "POST", body: JSON.stringify({ decision: paymentDecisionButton.dataset.paymentDecision, deliveryDate: dateInput?.value || "", deliveryTime: timeInput?.value || "" }) })
            .then(() => loadAdminOrders())
            .catch((error) => { alert(error.message); });
    }

    if (sendOrderButton) {
        const orderId = Number(sendOrderButton.dataset.sendOrder);
        api(`/api/admin/orders/${orderId}/whatsapp-notification`, { method: "POST" })
            .then((result) => window.open(result.url, "_blank", "noopener"))
            .catch((error) => alert(`The order remains confirmed. WhatsApp notification could not be opened: ${error.message}`));
    }


    if (categoryButton) {
        openCategory(categoryButton);
    }
    if (event.target.closest("[data-clear-category]")) {
        showAllProducts = true;
        renderProducts();
    }

    if (wishlistButton) {
        const productId = Number(wishlistButton.dataset.wishlistProduct);
        const index = wishlist.indexOf(productId);
        if (index >= 0) wishlist.splice(index, 1);
        else wishlist.push(productId);
        saveWishlist();
        renderProducts();
        if (wishlistDialog.open) renderWishlist();
    }

    if (addButton) {
        if (currentUser?.role === "admin") return;
        const product = products.find((item) => item.id === Number(addButton.dataset.addProduct));
        if (!product || product.stock < 1 || addButton.disabled || addButton.classList.contains("is-loading")) return;
        if (product.sizes?.length) { window.location.href = `product.html?id=${product.id}`; return; }
        const existing = cart.find((item) => item.id === product.id);
        if (existing) existing.quantity += 1;
        else cart.push({ ...product, quantity: 1 });
        saveCart();
        renderCart();
        showCartFeedback(product, addButton);
    }

    if (removeButton) {
        const index = cart.findIndex((item) => item.id === Number(removeButton.dataset.removeProduct));
        cart.splice(index, 1);
        saveCart();
        renderCart();
    }

    if (decreaseButton) {
        const index = cart.findIndex((item) => item.id === Number(decreaseButton.dataset.decreaseProduct));
        if (index < 0) return;
        if (cart[index].quantity > 1) cart[index].quantity -= 1;
        else cart.splice(index, 1);
        saveCart();
        renderCart();
    }

    if (increaseButton) {
        const item = cart.find((cartItem) => cartItem.id === Number(increaseButton.dataset.increaseProduct));
        if (!item) return;
        if (item.quantity >= item.stock) return alert("This is the maximum available quantity.");
        item.quantity += 1;
        saveCart();
        renderCart();
    }

    if (deleteButton) {
        const index = products.findIndex((item) => item.id === Number(deleteButton.dataset.deleteProduct));
        api(`/api/products/${products[index].id}`, { method: "DELETE" })
            .then(() => {
                products.splice(index, 1);
                renderProducts();
                renderAdminProducts();
            })
            .catch((error) => { alert(error.message); });
    }

    if (editButton) {
        const product = products.find((item) => item.id === Number(editButton.dataset.editProduct));
        const form = document.querySelector("#product-form");
        form.elements.id.value = product.id;
        form.elements.name.value = product.name;
        form.elements.price.value = product.price;
        form.elements.stock.value = product.stock;
        form.elements.category.value = product.category;
        form.elements.image.value = product.image;
        document.querySelector("#product-submit").textContent = "Save changes";
    }
});

document.querySelector("#product-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const productData = {
        name: data.get("name"),
        price: Number(data.get("price")),
        stock: Number(data.get("stock")),
        category: data.get("category"),
        image: data.get("image")
    };
    const editingProduct = products.find((product) => product.id === Number(data.get("id")));
    const request = editingProduct
        ? api(`/api/products/${editingProduct.id}`, { method: "PUT", body: JSON.stringify(productData) })
        : api("/api/products", { method: "POST", body: JSON.stringify(productData) });
    request.then((savedProduct) => {
        if (editingProduct) Object.assign(editingProduct, savedProduct);
        else products.push(savedProduct);
        renderProducts();
        renderAdminProducts();
        event.currentTarget.reset();
        document.querySelector("#product-submit").textContent = "Add product";
    }).catch((error) => { alert(error.message); });
});

document.querySelector("#profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    api("/api/profile", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) })
        .then((result) => {
            currentUser = result.user;
            document.querySelector("#profile-message").textContent = "Profile saved successfully.";
            fillCheckoutForm();
        })
        .catch((error) => { document.querySelector("#profile-message").textContent = error.message; });
});

(async function initializeStore() {
    try {
        await Promise.all([loadProducts(), loadCurrentUser()]);
        renderProducts();
        updatePaymentInstructions();
        renderCart();
        renderWishlist();
    } catch (error) {
        productGrid.innerHTML = `<p class="dialog-message">Could not load the store. Start the Bondok server and refresh.</p>`;
        console.error(error);
    }
})();

function changeGalleryPhoto(gallery, index) {
    const product = products.find(item => item.id === Number(gallery.dataset.galleryProduct));
    if (!product) return;
    const images = product.images?.length ? product.images : [product.image];
    const selected = (index + images.length) % images.length;
    gallery.dataset.photo = selected;
    const image = gallery.querySelector(".product-image");
    image.src = images[selected]; image.alt = `${product.name} - photo ${selected + 1}`;
    const count = gallery.querySelector(".gallery-count");
    if (count) count.textContent = `${selected + 1} / ${images.length}`;
    gallery.querySelectorAll("[data-gallery-index]").forEach(button => button.setAttribute("aria-pressed", Number(button.dataset.galleryIndex) === selected ? "true" : "false"));
}

document.addEventListener("click", event => {
    const step = event.target.closest("[data-gallery-step]");
    const thumbnail = event.target.closest("[data-gallery-index]");
    if (step || thumbnail) {
        const gallery = event.target.closest("[data-gallery-product]");
        changeGalleryPhoto(gallery, thumbnail ? Number(thumbnail.dataset.galleryIndex) : Number(gallery.dataset.photo) + Number(step.dataset.galleryStep));
        return;
    }
    if (event.target.closest("[data-close-gallery]")) { document.querySelector("#product-gallery-dialog")?.close(); return; }
    const open = event.target.closest("[data-open-gallery]");
    if (!open) return;
    const product = products.find(item => item.id === Number(open.dataset.openGallery));
    if (!product) return;
    let dialog = document.querySelector("#product-gallery-dialog");
    if (!dialog) {
        dialog = document.createElement("dialog"); dialog.id = "product-gallery-dialog";
        dialog.className = "product-gallery-dialog"; dialog.setAttribute("aria-label", "Product photos");
        document.body.append(dialog);
        dialog.addEventListener("click", e => { if (e.target === dialog) dialog.close(); });
    }
    dialog.innerHTML = '<button class="gallery-close" type="button" data-close-gallery aria-label="Close photos">&#215;</button>' + renderProductGallery(product);
    const gallery = dialog.querySelector(".product-gallery");
    const imageButton = gallery.querySelector(".gallery-open");
    imageButton.replaceWith(imageButton.querySelector("img"));
    const thumbs = document.createElement("div"); thumbs.className = "gallery-thumbnails";
    (product.images?.length ? product.images : [product.image]).forEach((url, index) => {
        const button = document.createElement("button"); button.type = "button";
        button.dataset.galleryIndex = index; button.setAttribute("aria-label", `View photo ${index + 1}`);
        const image = document.createElement("img"); image.src = url; image.alt = "";
        button.append(image); thumbs.append(button);
    });
    gallery.append(thumbs);
    changeGalleryPhoto(gallery, Number(open.closest("[data-gallery-product]").dataset.photo));
    dialog.showModal();
});

document.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const gallery = event.target.closest("[data-gallery-product]") || document.querySelector("#product-gallery-dialog[open] .product-gallery");
    if (!gallery) return;
    event.preventDefault();
    changeGalleryPhoto(gallery, Number(gallery.dataset.photo) + (event.key === "ArrowRight" ? 1 : -1));
});

let galleryTouch;
document.addEventListener("touchstart", event => {
    const gallery = event.target.closest("[data-gallery-product]");
    galleryTouch = gallery && event.touches.length === 1 ? { gallery, x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
}, { passive: true });
document.addEventListener("touchend", event => {
    if (!galleryTouch) return;
    const { gallery, x, y } = galleryTouch; galleryTouch = null;
    const dx = event.changedTouches[0].clientX - x;
    const dy = event.changedTouches[0].clientY - y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) changeGalleryPhoto(gallery, Number(gallery.dataset.photo) + (dx < 0 ? 1 : -1));
}, { passive: true });
document.addEventListener("touchcancel", () => { galleryTouch = null; }, { passive: true });
