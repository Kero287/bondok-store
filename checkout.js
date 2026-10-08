(() => {
    const { api, escape, money } = BondokCommerce;
    const form = document.querySelector("#order-form");
    const message = document.querySelector("#checkout-message");
    const submit = document.querySelector("#place-order");
    const buyNow = new URLSearchParams(location.search).get("mode") === "buy-now";
    let lines = BondokCommerce.items.map(item => ({ ...item })), rates = [], catalog = [], ready = false, submitting = false, cardAvailable = false;
    if (buyNow) {
        try { lines = JSON.parse(sessionStorage.getItem("bondok-buy-now") || "[]"); } catch { lines = []; }
    }
    if (!Array.isArray(lines)) lines = [];
    const keyName = `bondok-checkout-key-${buyNow ? "buy" : "cart"}`;
    const snapshot = JSON.stringify(lines.map(({ id, size, color, quantity }) => ({ id, size, color, quantity })));
    if (sessionStorage.getItem(`${keyName}-snapshot`) !== snapshot) {
        sessionStorage.removeItem(keyName);
        sessionStorage.setItem(`${keyName}-snapshot`, snapshot);
    }
    let checkoutKey = sessionStorage.getItem(keyName) || crypto.randomUUID();
    sessionStorage.setItem(keyName, checkoutKey);
    function validateLines() {
        const totals = new Map();
        for (const line of lines) {
            const product = catalog.find(product => product.id === line.id);
            if (!product) return "An item is no longer available. Remove it from your cart before continuing.";
            if (!product.sizes.includes(line.size)) return `Choose an available size for ${product.name} on the product page before checkout.`;
            if (product.colors?.length && !product.colors.includes(line.color)) return `Choose an available color for ${product.name} on the product page before checkout.`;
            const quantity = (totals.get(line.id) || 0) + line.quantity;
            totals.set(line.id, quantity);
            if (!Number.isInteger(line.quantity) || line.quantity < 1 || quantity > product.stock) return `Update the quantity of ${product.name}; there are ${product.stock} available.`;
        }
        return "";
    }
    function renderSummary() {
        const subtotal = lines.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const destination = rates.find(rate => rate.id === form.elements.governorate.value);
        document.querySelector("#checkout-items").innerHTML = lines.map((line, index) => {
            const product = catalog.find(product => product.id === line.id);
            return `<div class="checkout-item"><a href="product.html?id=${line.id}"><img src="${escape(line.image)}" alt="${escape(line.name)}"></a><div><a href="product.html?id=${line.id}"><strong>${escape(line.name)}</strong></a><p>Qty: ${line.quantity}</p><p>Size: ${escape(line.size)}${line.color ? ` / Color: ${escape(line.color)}` : ""}</p></div><b>${money(line.price * line.quantity)}</b></div>`;
        }).join("");
        document.querySelector("#summary-subtotal").textContent = money(subtotal);
        document.querySelector("#summary-shipping").textContent = destination ? `+${money(destination.price)}` : "Select governorate";
        const method = form.elements.paymentMethod.value;
        const isCash = method === "cash_deposit", isCard = method === "card";
        const deposit = isCash ? Math.min(50, subtotal) : 0;
        const total = subtotal + (destination?.price || 0);
        const due = isCash ? (destination?.price || 0) + deposit : total;
        document.querySelector("#summary-deposit").textContent = money(deposit);
        document.querySelector("#summary-total").textContent = money(total);
        document.querySelector("#summary-due").textContent = destination ? money(due) : "Select governorate";
        document.querySelector("#summary-remaining").textContent = destination ? money(total - due) : "Select governorate";
        document.querySelector("#payment-due").textContent = destination ? money(due) : "the amount shown after selecting your governorate";
        document.querySelector("#transfer-payment-fields").hidden = isCard;
        document.querySelector("#card-payment-note").hidden = !isCard;
        document.querySelector("#card-payment-note").textContent = cardAvailable ? "After Place Order, enter your card details on the secure payment page. No account needed." : "Preview the card payment page while activation is pending. No payment or order will be submitted.";
        form.elements.paymentScreenshot.required = !isCard;
        form.querySelectorAll('[name="depositChannel"]').forEach(input => input.required = !isCard);
        submit.textContent = isCard ? (cardAvailable ? "Place Order" : "Preview card payment") : isCash ? "Place order with deposit" : "Submit online payment";
        const error = validateLines();
        document.querySelector("#checkout-cart-error").textContent = error;
        submit.disabled = !ready || submitting || !lines.length || !destination || !!error;
        if (!lines.length) {
            document.querySelector("#checkout-layout").hidden = true;
            document.querySelector("#checkout-empty").hidden = false;
        }
    }
    form.elements.governorate.addEventListener("change", renderSummary);
    form.querySelectorAll('[name="paymentMethod"]').forEach(input => input.addEventListener("change", renderSummary));
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!ready || submitting || !lines.length || validateLines()) return;
        const data = new FormData(form);
        const isCard = data.get("paymentMethod") === "card";
        if (isCard && !cardAvailable) {
            const destination = rates.find(rate => rate.id === data.get("governorate"));
            if (!destination) return;
            sessionStorage.setItem('bondok-card-preview', JSON.stringify({
                total: lines.reduce((sum, item) => sum + item.price * item.quantity, 0) + destination.price,
                buyNow
            }));
            location.assign('card-payment.html?preview=1');
            return;
        }
        const screenshot = data.get("paymentScreenshot");
        if (!isCard && (!(screenshot instanceof File) || !screenshot.size || !["image/png", "image/jpeg", "image/webp"].includes(screenshot.type) || screenshot.size >= 10_000_000)) {
            message.textContent = "Upload a JPG, PNG, or WebP payment receipt under 10 MB."; return;
        }
        submitting = true; form.querySelectorAll("input, select, textarea").forEach(input => input.disabled = true); submit.disabled = true; submit.textContent = "Placing order..."; message.textContent = "";
        try {
            let paymentScreenshot = isCard ? "" : await new Promise((resolve, reject) => {
                const reader = new FileReader(); reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("The receipt could not be read. Please choose it again.")); reader.readAsDataURL(screenshot);
            });
            if (!isCard && screenshot.size > 2_000_000) {
                const photo = new Image();
                photo.src = paymentScreenshot;
                await photo.decode();
                const canvas = document.createElement("canvas");
                const scale = Math.min(1, 2200 / Math.max(photo.width, photo.height));
                canvas.width = Math.max(1, Math.round(photo.width * scale));
                canvas.height = Math.max(1, Math.round(photo.height * scale));
                const context = canvas.getContext("2d");
                context.fillStyle = "white";
                context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(photo, 0, 0, canvas.width, canvas.height);
                for (const quality of [0.9, 0.8, 0.7, 0.6]) {
                    paymentScreenshot = canvas.toDataURL("image/jpeg", quality);
                    if (paymentScreenshot.length < 2_800_000) break;
                }
                if (paymentScreenshot.length >= 2_800_000) throw new Error("Please crop the receipt to the payment details and upload it again.");
            }
            const result = await api("/api/orders", { method: "POST", body: JSON.stringify({
                name: data.get("name"), email: data.get("email"), phone: data.get("phone"), address: data.get("address"),
                governorate: data.get("governorate"), paymentMethod: data.get("paymentMethod"), depositChannel: data.get("depositChannel"),
                paymentScreenshot, checkoutKey, items: lines.map(({ id, size, color, quantity }) => ({ id, size, color, quantity }))
            }) });
            if (result.checkoutUrl) {
                sessionStorage.setItem("bondok-pending-card", JSON.stringify({ key: checkoutKey, buyNow, lines }));
                location.assign("card-payment.html");
                return;
            }
            ready = false;
            if (buyNow) sessionStorage.removeItem("bondok-buy-now");
            else { BondokCommerce.items.length = 0; BondokCommerce.save(); }
            sessionStorage.removeItem(keyName);
            document.querySelector("#checkout-layout").hidden = true;
            const success = document.querySelector("#checkout-success");
            success.hidden = false;
            success.innerHTML = `<p class="section-kicker">Thank you for shopping with Bondok</p><h1>Order #${Number(result.id)} received.</h1><p>We will review your payment and contact you to confirm your order. Delivery within 48 working hours after confirmation.</p><dl><div><dt>Subtotal</dt><dd>${money(result.subtotal)}</dd></div><div><dt>Shipping</dt><dd>${money(result.shipping)}</dd></div><div><dt>Total</dt><dd>${money(result.total)}</dd></div><div><dt>Remaining after payment approval</dt><dd>${money(data.get("paymentMethod") === "cash_deposit" ? Math.max(0, result.subtotal - 50) : 0)}</dd></div></dl><a class="primary-button" href="shop.html">Continue shopping</a>`;
            success.tabIndex = -1; success.focus();
        } catch (error) { message.textContent = error.message; }
        finally { form.querySelectorAll("input, select, textarea").forEach(input => input.disabled = false); submitting = false; submit.textContent = "Place Order"; if (ready) renderSummary(); }
    });
    (async () => {
        try {
            if (new URLSearchParams(location.search).get("payment") === "return") {
                let pending;
                try { pending = JSON.parse(sessionStorage.getItem("bondok-pending-card") || "null"); } catch {}
                document.querySelector("#checkout-layout").hidden = true;
                const result = document.querySelector("#checkout-success"); result.hidden = false;
                if (!pending) { result.innerHTML = '<h1>Payment processing</h1><p>Contact the store to check your order confirmation.</p><a href="shop.html">Continue shopping</a>'; return; }
                async function refreshPayment() {
                    const order = await api(`/api/payment-status?key=${encodeURIComponent(pending.key)}`);
                    const paid = order.payment_status === "Paid";
                    result.innerHTML = `<h1>${paid ? "Payment confirmed" : order.payment_status === "Card Payment Failed" ? "Payment unsuccessful" : "Waiting for payment confirmation"}</h1><p>Order #${Number(order.id)} / ${money(order.total)}</p><p>${paid ? "Your order will arrive within 48 working hours." : "Your order is only confirmed after Paymob verifies the payment."}</p>${paid ? '' : '<button type="button" class="primary-button" id="refresh-payment">Check payment status</button>'}<a href="shop.html">Continue shopping</a><p id="payment-return-message" role="status"></p>`;
                    result.querySelector("#refresh-payment")?.addEventListener("click", () => refreshPayment().catch(error => { result.querySelector("#payment-return-message").textContent = error.message; }));
                    if (paid) {
                        sessionStorage.removeItem(`bondok-checkout-key-${pending.buyNow ? "buy" : "cart"}`);
                        if (pending.buyNow) sessionStorage.removeItem("bondok-buy-now");
                        else {
                            for (const purchased of pending.lines) {
                                const item = BondokCommerce.items.find(item => item.id === purchased.id && item.size === purchased.size && (item.color || "") === (purchased.color || ""));
                                if (item) { item.quantity -= purchased.quantity; if (item.quantity <= 0) BondokCommerce.items.splice(BondokCommerce.items.indexOf(item), 1); }
                            }
                            BondokCommerce.save();
                        }
                        sessionStorage.removeItem("bondok-pending-card");
                    }
                }
                await refreshPayment(); return;
            }
            const [shipping, products, payments] = await Promise.all([api("/api/shipping-rates"), api("/api/products"), api("/api/payment-options")]);
            cardAvailable = payments.card;
            rates = shipping.rates; catalog = products;
            form.elements.governorate.innerHTML = '<option value="">Select your governorate</option>' + rates.map(rate => `<option value="${rate.id}">${escape(rate.name)}</option>`).join("");
            for (const line of lines) {
                const product = catalog.find(product => product.id === line.id);
                if (product) Object.assign(line, { name: product.name, image: product.image, price: product.price, stock: product.stock });
            }
            if (sessionStorage.getItem("bondok-auth-token")) {
                try {
                    const { user } = await api("/api/auth/me");
                    for (const key of ["name", "email", "phone", "address"]) if (!form.elements[key].value) form.elements[key].value = user[key] || "";
                } catch { /* Guest checkout stays available if the session expired. */ }
            }
            ready = true; renderSummary();
        } catch (error) { if (new URLSearchParams(location.search).get("payment") === "return") { document.querySelector("#checkout-success").textContent = `Unable to check payment: ${error.message}. Refresh to check again.`; return; } message.textContent = `Unable to load checkout: ${error.message} Refresh to try again.`; }
    })();
})();
