(() => {
    const { api, escape, money, add, open } = BondokCommerce;
    const root = document.querySelector("#product-detail");
    let product, selectedPhoto = 0;
    function showPhoto(index) {
        selectedPhoto = (index + product.images.length) % product.images.length;
        document.querySelector("#detail-photo").src = product.images[selectedPhoto];
        document.querySelector("#detail-photo").alt = `${product.name} - photo ${selectedPhoto + 1}`;
        document.querySelectorAll("[data-detail-photo]").forEach(button => button.setAttribute("aria-pressed", Number(button.dataset.detailPhoto) === selectedPhoto ? "true" : "false"));
        document.querySelector("#detail-photo-count").textContent = `${selectedPhoto + 1} / ${product.images.length}`;
        const zoom = document.querySelector("#photo-zoom img");
        if (zoom) zoom.src = product.images[selectedPhoto];
    }
    root.addEventListener("click", event => {
        const thumb = event.target.closest("[data-detail-photo]");
        const step = event.target.closest("[data-detail-step]");
        if (thumb) showPhoto(Number(thumb.dataset.detailPhoto));
        if (step) showPhoto(selectedPhoto + Number(step.dataset.detailStep));
        if (event.target.closest("[data-zoom-photo]")) {
            document.querySelector("#photo-zoom img").src = product.images[selectedPhoto];
            document.querySelector("#photo-zoom").showModal();
        }
        if (event.target.closest("[data-close-zoom]")) document.querySelector("#photo-zoom").close();
    });
    root.addEventListener("keydown", event => {
        if (!event.target.closest(".detail-gallery, #photo-zoom") || !["ArrowRight", "ArrowLeft"].includes(event.key)) return;
        event.preventDefault(); showPhoto(selectedPhoto + (event.key === "ArrowRight" ? 1 : -1));
    });
    root.addEventListener("pointermove", event => {
        const photo = event.target.closest(".detail-zoom");
        if (!photo || event.pointerType !== "mouse") return;
        const rect = photo.getBoundingClientRect();
        photo.querySelector("img").style.transformOrigin = `${(event.clientX - rect.left) / rect.width * 100}% ${(event.clientY - rect.top) / rect.height * 100}%`;
    });
    let touch;
    root.addEventListener("touchstart", event => {
        if (event.target.closest(".detail-main-photo") && event.touches.length === 1) touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }, { passive: true });
    root.addEventListener("touchend", event => {
        if (!touch) return;
        const dx = event.changedTouches[0].clientX - touch.x, dy = event.changedTouches[0].clientY - touch.y; touch = null;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) showPhoto(selectedPhoto + (dx < 0 ? 1 : -1));
    }, { passive: true });
    root.addEventListener("touchcancel", () => { touch = null; }, { passive: true });
    (async () => {
        try {
            const id = new URLSearchParams(location.search).get("id");
            if (!/^\d+$/.test(id || "")) throw new Error("Choose a product from the shop to see its details.");
            product = await api(`/api/products/${id}`);
            document.title = `${product.name} | Bondok Store`;
            document.querySelector("#product-breadcrumb").textContent = product.name;
            root.innerHTML = `<div class="detail-layout"><section class="detail-gallery" aria-label="Product images"><div class="detail-thumbnails">${product.images.map((url, index) => `<button type="button" data-detail-photo="${index}" aria-label="View photo ${index + 1}" aria-pressed="${index === 0}"><img src="${escape(url)}" alt="" loading="lazy"></button>`).join("")}</div><div class="detail-main-photo"><button type="button" class="detail-zoom" data-zoom-photo aria-label="Enlarge product photo"><span>Hover to zoom / Click to enlarge</span><img id="detail-photo" src="${escape(product.image)}" alt="${escape(product.name)}"></button>${product.images.length > 1 ? '<button type="button" class="gallery-arrow gallery-prev" data-detail-step="-1" aria-label="Previous photo">&#8249;</button><button type="button" class="gallery-arrow gallery-next" data-detail-step="1" aria-label="Next photo">&#8250;</button>' : ''}<span class="gallery-count" id="detail-photo-count">1 / ${product.images.length}</span></div></section><section class="detail-information"><a class="detail-brand" href="shop.html?brand=${encodeURIComponent(product.brand || 'Other')}">${escape(product.brand || 'Bondok collection')} &rarr;</a><h1>${escape(product.name)}</h1><p class="detail-price">${money(product.price)}</p><form id="purchase-form"><label for="product-size">Size</label><select id="product-size" name="size" required><option value="">Select your size</option>${product.sizes.map(size => `<option value="${escape(size)}">${escape(size)}</option>`).join("")}</select>${product.colors?.length ? `<label for="product-color">Color</label><select id="product-color" name="color" required><option value="">Select your color</option>${product.colors.map(color => `<option value="${escape(color)}">${escape(color)}</option>`).join("")}</select>` : ""}<div class="detail-stock"><strong>${product.stock > 0 ? `${product.stock} available` : 'Out of stock'}</strong><p>${escape(product.description || 'An everyday piece from the Bondok collection. Choose your size to make it yours.')}</p></div><label for="product-quantity">Quantity</label><input id="product-quantity" name="quantity" type="number" value="1" min="1" max="${product.stock}" required><button class="primary-button" name="action" value="cart" type="submit" ${product.stock < 1 ? 'disabled' : ''}>Add to Cart</button><button class="buy-now-button" name="action" value="buy" type="submit" ${product.stock < 1 ? 'disabled' : ''}>Buy Now</button><p id="purchase-message" role="status" aria-live="polite"></p></form></section></div><div class="detail-notes"><section><h2>Product details</h2><p>${escape(product.description || product.name)}</p></section><section><h2>Delivery & exchanges</h2><p>Delivery within 48 working hours after order confirmation. Shipping is calculated for your governorate at checkout. Exchanges within 2 days only. No returns or refunds.</p><a href="orders-shipping.html">Delivery information &rarr;</a></section></div><dialog id="photo-zoom" class="detail-zoom-dialog" aria-label="Enlarged product photo"><button type="button" class="gallery-close" data-close-zoom aria-label="Close photo">&times;</button><img alt="${escape(product.name)}"><button type="button" class="gallery-arrow gallery-prev" data-detail-step="-1" aria-label="Previous photo">&#8249;</button><button type="button" class="gallery-arrow gallery-next" data-detail-step="1" aria-label="Next photo">&#8250;</button></dialog>`;
            root.querySelector("#purchase-form").addEventListener("submit", event => {
                event.preventDefault();
                const form = event.currentTarget;
                try {
                    const color = form.elements.color?.value || "";
                    if (product.colors?.length && !product.colors.includes(color)) throw new Error("Select an available color first.");
                    const size = form.elements.size.value, quantity = Number(form.elements.quantity.value);
                    if (!product.sizes.includes(size)) throw new Error("Select a size first.");
                    if (!Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) throw new Error("Choose an available quantity.");
                    if (event.submitter?.value === "buy") {
                        sessionStorage.setItem("bondok-buy-now", JSON.stringify([{ id: product.id, name: product.name, image: product.image, price: product.price, size, color, quantity, stock: product.stock }]));
                        location.href = "checkout.html?mode=buy-now";
                    } else { add(product, size, quantity, color); root.querySelector("#purchase-message").textContent = "Added to your cart."; open(); }
                } catch (error) { root.querySelector("#purchase-message").textContent = error.message; }
            });
            root.querySelector("#photo-zoom").addEventListener("click", event => { if (event.target.id === "photo-zoom") event.target.close(); });
        } catch (error) {
            root.innerHTML = `<div class="commerce-empty"><h1>Product unavailable</h1><p>${escape(error.message)}</p><a href="shop.html" class="primary-button">Back to shop</a></div>`;
        }
    })();
})();
