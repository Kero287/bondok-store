let adminToken = sessionStorage.getItem("bondok-auth-token") || "";
let adminProducts = [];
let receiptUrls = [];
let productPhotos = [""];
let photoBusy = false;

function renderPhotoUploads() {
    const container = document.querySelector("#product-uploads");
    if (!container) return;
    container.replaceChildren();
    productPhotos.forEach((url, index) => {
        const slot = document.createElement("div");
        slot.className = "product-upload-slot";
        const label = document.createElement("label");
        label.textContent = `Upload ${index + 1}${index === 0 ? " - Main photo" : ""}`;
        if (url) {
            const preview = document.createElement("img");
            preview.src = url; preview.alt = `Product photo ${index + 1}`;
            slot.append(preview);
        }
        const input = document.createElement("input");
        input.type = "file"; input.accept = "image/jpeg,image/png,image/webp";
        input.multiple = true; input.dataset.photoIndex = index;
        label.append(input); slot.append(label);
        if (url || productPhotos.length > 1) {
            const remove = document.createElement("button");
            remove.type = "button"; remove.dataset.removePhoto = index;
            remove.textContent = "Remove"; slot.append(remove);
        }
        if (index > 0 && url) {
            const main = document.createElement("button");
            main.type = "button"; main.dataset.mainPhoto = index;
            main.textContent = "Make main photo"; slot.append(main);
        }
        container.append(slot);
    });
    document.querySelector("[data-add-photo]").disabled = productPhotos.length >= 20;
}

// Resize locally, then send one image per request to keep hosted uploads small.
async function prepareProductPhoto(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose JPG, PNG, or WebP photos.");
    if (file.size > 20_000_000) throw new Error("Please choose an image smaller than 20 MB.");
    const bitmap = await createImageBitmap(file);
    try {
        const canvas = document.createElement("canvas");
        const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
        canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.85, 0.7, 0.55, 0.4]) {
            const data = canvas.toDataURL("image/webp", quality);
            if (data.length <= 950_000) return data;
        }
        throw new Error("This photo is too detailed to upload. Choose a smaller image.");
    } finally { bitmap.close(); }
}

document.querySelector("#product-uploads")?.addEventListener("change", async event => {
    const input = event.target.closest("[data-photo-index]");
    if (!input || !input.files.length || photoBusy) return;
    const files = Array.from(input.files);
    const index = Number(input.dataset.photoIndex);
    const status = document.querySelector("#upload-status");
    if (productPhotos.length - 1 + files.length > 20) {
        status.textContent = "You can add up to 20 photos per product.";
        input.value = ""; return;
    }
    photoBusy = true;
    document.querySelector(".product-upload-field").disabled = true;
    document.querySelector("#product-submit").disabled = true;
    try {
        const urls = [];
        for (const [i, file] of files.entries()) {
            status.textContent = `Uploading photo ${i + 1} of ${files.length}...`;
            const image = await prepareProductPhoto(file);
            const result = await adminApi("/api/admin/product-images", { method: "POST", body: JSON.stringify({ image }) });
            urls.push(result.url);
        }
        productPhotos.splice(index, 1, ...urls);
        status.textContent = "Photos uploaded. Save the product to publish your changes.";
    } catch (error) {
        status.textContent = `Upload failed: ${error.message} Your previous photos have been kept.`;
    } finally {
        photoBusy = false;
        document.querySelector(".product-upload-field").disabled = false;
        document.querySelector("#product-submit").disabled = false;
        renderPhotoUploads();
    }
});

renderPhotoUploads();

async function adminApi(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}`, ...(options.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong.");
    return data;
}

const escapeAdmin = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const price = (value) => `${Number(value).toLocaleString("en-EG")} EGP`;

function renderProducts() {
    const form = document.querySelector("#product-form");
    if (!form) return;
    document.querySelector("#admin-best-sellers").innerHTML = adminProducts.filter(product => product.bestSeller).map(product => `<div class="admin-product"><span>${escapeAdmin(product.name)} / ${escapeAdmin(product.category)}</span><button type="button" data-edit-product="${product.id}">Edit Best Seller</button></div>`).join("") || "<p>No Best Sellers selected. This section stays empty on the storefront until you add products.</p>";
    const category = form.elements.category.value;
    const categoryProducts = adminProducts.filter((product) => product.category === category);
    document.querySelector("#admin-products").innerHTML = categoryProducts.map((product) => `<div class="admin-product"><span>${product.name} · ${product.brand || "Other"} · ${price(product.price)} · ${product.stock} in stock</span><span><button type="button" data-edit-product="${product.id}">Edit</button><button type="button" data-delete-product="${product.id}">Delete</button></span></div>`).join("") || `<p>No ${category} products yet. Add the first one above.</p>`;
}

async function loadProducts() {
    adminProducts = await adminApi("/api/products");
    renderProducts();
}

async function loadOrders() {
    const orderList = document.querySelector("#admin-orders");
    if (!orderList) return;
    const orders = await adminApi("/api/admin/orders");
    receiptUrls.forEach(url => URL.revokeObjectURL(url));
    receiptUrls = [];
    orderList.innerHTML = orders.map((order) => `
        <article class="admin-order"><div class="admin-order-top"><strong>Order #${order.id}</strong><span class="order-status ${String(order.status).toLowerCase()}">${order.status}</span><button class="order-delete-button" type="button" data-delete-order="${order.id}" aria-label="Delete order #${order.id}" title="Delete order">🗑</button></div>
        <p>${escapeAdmin(order.name)} &middot; ${escapeAdmin(order.phone)}</p><p>${escapeAdmin(order.customer_email)}</p><p>${escapeAdmin(order.address)}${order.governorate ? `, ${escapeAdmin(order.governorate)}` : ""}</p><p>Subtotal: ${price(order.subtotal)} &middot; Shipping: ${price(order.shipping_fee)}</p><p class="admin-order-items">${order.items.map((item) => `${escapeAdmin(item.name)}${item.size ? ` (Size: ${escapeAdmin(item.size)})` : ""} ${item.color ? ` (Color: ${escapeAdmin(item.color)})` : ""} x${item.quantity}`).join(", ")}</p>
        <p><strong>Payment:</strong> ${order.payment} · ${order.payment_status}</p><p><strong>Upfront payment:</strong> ${price(order.deposit_amount)} · <strong>Remaining:</strong> ${price(order.remaining_amount)}</p>
        <div class="admin-order-bottom"><strong>${price(order.total)}</strong><span>${order.delivery_date ? `${order.delivery_date} ${order.delivery_time}` : "Delivery not scheduled"}</span></div>
        ${order.has_screenshot ? `<button type="button" class="receipt-link" data-view-receipt="${order.id}">View payment screenshot</button>` : "<p>No screenshot was provided for this legacy order.</p>"}
        ${String(order.payment_status).startsWith("Pending") ? `<div class="verification-controls"><label>Delivery date<input type="date" data-order-date="${order.id}"></label><label>Delivery time<input type="time" data-order-time="${order.id}"></label></div><div class="admin-order-actions"><button class="admin-refresh" type="button" data-decision="approve" data-order-id="${order.id}">Approve payment</button><button class="admin-refresh" type="button" data-decision="reject" data-order-id="${order.id}">Reject payment</button></div>` : ""}
        ${order.status === "Confirmed" ? `<div class="admin-order-actions"><button class="admin-refresh" type="button" data-notify-order="${order.id}">Notify on WhatsApp</button><button class="admin-refresh" type="button" data-deliver-order="${order.id}">Mark delivered</button></div>` : ""}
        </article>`).join("") || "<p>No orders yet.</p>";
}

document.addEventListener("click", async (event) => {
    if (event.target.closest("[data-add-photo]")) {
        if (!photoBusy && productPhotos.length < 20) { productPhotos.push(""); renderPhotoUploads(); }
        return;
    }
    const removePhoto = event.target.closest("[data-remove-photo]");
    const mainPhoto = event.target.closest("[data-main-photo]");
    if (removePhoto || mainPhoto) {
        if (photoBusy) return;
        if (removePhoto) productPhotos.splice(Number(removePhoto.dataset.removePhoto), 1);
        else productPhotos.unshift(...productPhotos.splice(Number(mainPhoto.dataset.mainPhoto), 1));
        if (!productPhotos.length) productPhotos.push("");
        renderPhotoUploads(); return;
    }
    const receipt = event.target.closest("[data-view-receipt]");
    if (receipt) {
        receipt.disabled = true;
        try {
            const response = await fetch(`/api/admin/orders/${receipt.dataset.viewReceipt}/screenshot`, { headers: { Authorization: `Bearer ${adminToken}` } });
            if (!response.ok) throw new Error("Unable to load the payment screenshot.");
            const url = URL.createObjectURL(await response.blob());
            receiptUrls.push(url);
            const link = document.createElement("a");
            link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
            const image = document.createElement("img");
            image.src = url; image.className = "payment-screenshot"; image.alt = "Payment screenshot";
            link.append(image);
            receipt.replaceWith(link);
        } catch (error) { receipt.disabled = false; alert(error.message); }
        return;
    }
    if (event.target.closest("[data-logout]")) {
        adminApi("/api/auth/logout", { method: "POST" }).catch(() => {}).finally(() => { sessionStorage.removeItem("bondok-auth-token"); localStorage.removeItem("bondok-auth-token"); window.location.href = "index.html"; });
        return;
    }
    if (event.target.closest("[data-refresh-orders]")) return loadOrders().catch((error) => alert(error.message));
    const decision = event.target.closest("[data-decision]");
    if (decision) {
        const id = decision.dataset.orderId;
        const deliveryDate = document.querySelector(`[data-order-date="${id}"]`)?.value || "";
        const deliveryTime = document.querySelector(`[data-order-time="${id}"]`)?.value || "";
        return adminApi(`/api/admin/orders/${id}/payment-decision`, { method: "POST", body: JSON.stringify({ decision: decision.dataset.decision, deliveryDate, deliveryTime }) }).then(loadOrders).catch((error) => alert(error.message));
    }
    const notify = event.target.closest("[data-notify-order]");
    if (notify) return adminApi(`/api/admin/orders/${notify.dataset.notifyOrder}/whatsapp-notification`, { method: "POST" }).then((result) => window.open(result.url, "_blank", "noopener")).catch((error) => alert(`The order remains confirmed. WhatsApp could not be opened: ${error.message}`));
    const deliver = event.target.closest("[data-deliver-order]");
    if (deliver) return adminApi(`/api/admin/orders/${deliver.dataset.deliverOrder}/fulfillment`, { method: "POST" }).then(loadOrders).catch((error) => alert(error.message));
    const deleteOrder = event.target.closest("[data-delete-order]");
    if (deleteOrder && confirm("Delete this order permanently?")) return adminApi(`/api/admin/orders/${deleteOrder.dataset.deleteOrder}`, { method: "DELETE" }).then(loadOrders).catch((error) => alert(error.message));
    const edit = event.target.closest("[data-edit-product]");
    if (edit) {
        if (photoBusy) return;
        const product = adminProducts.find((item) => item.id === Number(edit.dataset.editProduct));
        const form = document.querySelector("#product-form");
        Object.entries(product).forEach(([key, value]) => {
            const field = form.elements[key];
            if (!field) return;
            if (field.tagName === "SELECT" && value && ![...field.options].some(option => option.value === value)) field.add(new Option(value, value));
            field.value = value;
        });
        form.elements.bestSeller.checked = product.bestSeller === true;
        form.elements.sizes.value = product.sizes.join(", ");
        form.elements.colors.value = (product.colors || []).join(", ");
        productPhotos = [...(product.images?.length ? product.images : [product.image])];
        renderPhotoUploads();
        document.querySelector("#upload-status").textContent = "";
        document.querySelector("#product-submit").textContent = "Save changes";
        form.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const remove = event.target.closest("[data-delete-product]");
    if (remove && confirm("Delete this product?")) adminApi(`/api/products/${remove.dataset.deleteProduct}`, { method: "DELETE" }).then(loadProducts).catch((error) => alert(error.message));
});

document.querySelector("#product-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (photoBusy) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    const path = data.id ? `/api/products/${data.id}` : "/api/products";
    data.bestSeller = form.elements.bestSeller.checked;
    const selectedCategory = data.category;
    const images = productPhotos.filter(Boolean);
    const status = document.querySelector("#upload-status");
    if (!images.length || !productPhotos[0]) { status.textContent = "Please upload the main photo (Upload 1)."; return; }
    photoBusy = true;
    const fields = [...form.querySelectorAll("input, select, button")];
    fields.forEach(field => field.disabled = true);
    try {
        await adminApi(path, { method: data.id ? "PUT" : "POST", body: JSON.stringify({ ...data, colors: data.colors.split(",").map(color => color.trim()).filter(Boolean), sizes: data.sizes.split(",").map(size => size.trim()).filter(Boolean), images, image: images[0], price: Number(data.price), stock: Number(data.stock) }) });
        form.reset(); form.elements.category.value = selectedCategory;
        productPhotos = [""]; renderPhotoUploads();
        document.querySelector("#product-submit").textContent = "Add product";
        status.textContent = "Product saved.";
        await loadProducts();
    } catch (error) { status.textContent = error.message; }
    finally { photoBusy = false; fields.forEach(field => field.disabled = false); }
});

document.querySelector("#product-form")?.elements.category.addEventListener("change", renderProducts);

(async () => {
    try {
        const me = await adminApi("/api/auth/me");
        if (me.user.role !== "admin") throw new Error("Admin access is required.");
        document.querySelector("#admin-name").textContent = `Welcome, ${me.user.name}`;
        await Promise.all([document.querySelector("#product-form") ? loadProducts() : Promise.resolve(), document.querySelector("#admin-orders") ? loadOrders() : Promise.resolve()]);
    } catch {
        sessionStorage.removeItem("bondok-auth-token");
        window.location.href = "login.html";
    }
})();
