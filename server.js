const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { join, normalize, extname } = require("node:path");
const { openDatabase } = require("./database");
const publicFiles = require("./public-files");
const paymob = require("./paymob");
const { getProductsWithSales } = require("./catalog");
const shippingRates = require("./shipping-rates.json");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const database = openDatabase();
const recovery = require("./password-recovery").createRecovery(database);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const sessionDays = 7;

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
    const hash = scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    const [salt, expected] = storedHash.split(":");
    const actual = scryptSync(password, salt, 64);
    return timingSafeEqual(actual, Buffer.from(expected, "hex"));
}

function now() {
    return new Date().toISOString();
}

async function initializeDatabase({ seedProducts = true } = {}) {
    await database.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price INTEGER NOT NULL CHECK (price >= 0),
            stock INTEGER NOT NULL CHECK (stock >= 0),
            category TEXT NOT NULL,
            brand TEXT NOT NULL DEFAULT 'Other',
            image TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS password_resets (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            payment TEXT NOT NULL,
            items_json TEXT NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
    `);

    await ensureColumn("orders", "status", "TEXT NOT NULL DEFAULT 'pending'");
    await ensureColumn("orders", "payment_status", "TEXT NOT NULL DEFAULT 'pending'");
    await ensureColumn("orders", "payment_reference", "TEXT DEFAULT ''");
    await ensureColumn("orders", "delivery_date", "TEXT DEFAULT ''");
    await ensureColumn("orders", "delivery_time", "TEXT DEFAULT ''");
    await ensureColumn("orders", "payment_screenshot", "TEXT DEFAULT ''");
    await ensureColumn("orders", "deposit_amount", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("orders", "remaining_amount", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("orders", "payment_reviewed_at", "TEXT DEFAULT ''");
    await ensureColumn("orders", "reviewed_by", "INTEGER");
    await ensureColumn("orders", "whatsapp_notification_status", "TEXT NOT NULL DEFAULT 'not_sent'");
    await ensureColumn("products", "brand", "TEXT NOT NULL DEFAULT 'Other'");
    await ensureCommerceSchema();

    const admin = (await database.prepare("SELECT id FROM users WHERE email = ?").get(ADMIN_EMAIL));
    if (!admin && ADMIN_EMAIL && ADMIN_PASSWORD) {
        if (ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
        (await database.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)")
            .run("Bondok Admin", ADMIN_EMAIL, hashPassword(ADMIN_PASSWORD), now()));
    }

    const productCount = (await database.prepare("SELECT COUNT(*) AS count FROM products").get()).count;
    if (seedProducts && productCount === 0) {
        const insert = database.prepare("INSERT INTO products (name, price, stock, category, image, created_at) VALUES (?, ?, ?, ?, ?, ?)");
        const seedProducts = [
            ["Everyday essential", 850, 8, "T-Shirts", "images/cover.jpeg"],
            ["Signature collection", 1200, 5, "Shirts", "images/cover.jpeg"],
            ["Classic favorite", 950, 12, "Pants", "images/cover.jpeg"],
            ["New season piece", 1450, 3, "Accessories", "images/cover.jpeg"]
        ];
        for (const product of seedProducts) await insert.run(...product, now());
    }
}

async function ensureColumn(table, column, definition) {
    const columns = (await database.prepare(`PRAGMA table_info(${table})`).all());
    if (!columns.some((item) => item.name === column)) await database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureCommerceSchema() {
    await ensureColumn("products", "best_seller", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("orders", "paymob_checkout_url", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("orders", "paymob_order_id", "TEXT DEFAULT NULL");
    await database.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_paymob_order ON orders(paymob_order_id)");
    await ensureColumn("products", "colors_json", "TEXT NOT NULL DEFAULT '[]'");
    await ensureColumn("products", "sizes_json", "TEXT NOT NULL DEFAULT '[]'");
    await ensureColumn("products", "description", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("orders", "customer_email", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("orders", "governorate", "TEXT NOT NULL DEFAULT ''");
    await ensureColumn("orders", "shipping_fee", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("orders", "subtotal", "INTEGER NOT NULL DEFAULT 0");
    await ensureColumn("orders", "checkout_key", "TEXT DEFAULT NULL");
    await database.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_key ON orders(checkout_key)");
}

function publicUser(user) {
    return { id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, role: user.role };
}

// The image field accepts old single URLs and ordered galleries, avoiding a
// products schema migration on existing hosted stores. Public clients get both.
function publicProduct(product) {
    let images;
    try { images = JSON.parse(product.image); } catch { images = [product.image]; }
    if (!Array.isArray(images)) images = [product.image];
    let sizes;
    try { sizes = JSON.parse(product.sizes_json || "[]"); } catch { sizes = []; }
    if (!Array.isArray(sizes) || !sizes.length) sizes = product.category === "Accessories" ? ["One size"] : ["S", "M", "L", "XL"];
    let colors;
    try { colors = JSON.parse(product.colors_json || "[]"); } catch { colors = []; }
    if (!Array.isArray(colors)) colors = [];
    const { sizes_json, colors_json, ...rest } = product;
    return { ...rest, image: images[0] || "", images, sizes, colors, bestSeller: product.best_seller === 1 };
}

function productColors(body, existing) {
    const colors = body.colors ?? existing?.colors ?? [];
    if (!Array.isArray(colors) || colors.length > 30 || colors.some(color => typeof color !== "string" || !/^[\p{L}\p{N} #.+/-]{1,40}$/u.test(color.trim()))) return null;
    return JSON.stringify([...new Set(colors.map(color => color.trim()))]);
}

function productSizes(body, existing) {
    const sizes = body.sizes ?? existing?.sizes ?? (body.category === "Accessories" ? ["One size"] : ["S", "M", "L", "XL"]);
    if (!Array.isArray(sizes) || !sizes.length || sizes.length > 30 || sizes.some(size => typeof size !== "string" || !/^[\p{L}\p{N} .+/-]{1,30}$/u.test(size.trim()))) return null;
    return JSON.stringify([...new Set(sizes.map(size => size.trim()))]);
}

function productImages(body, existing) {
    const images = body.images ?? (existing && body.image === existing.image ? existing.images : [body.image]);
    if (!Array.isArray(images) || !images.length || images.length > 20 || images.some(url =>
        typeof url !== "string" || url.length > 2048 || !/^(?:https?:\/\/[^\s<>"']+|images\/[\w.-]+|\/api\/media\/[a-f0-9]{32})$/.test(url))) return null;
    return images.length === 1 ? images[0] : JSON.stringify(images);
}

let mediaReady;
function ensureMediaStorage() {
    mediaReady ||= Promise.resolve().then(() => database.exec("CREATE TABLE IF NOT EXISTS product_media (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL)"))
        .catch(error => { mediaReady = undefined; throw error; });
    return mediaReady;
}

function parseBody(request) {
    if (request.body !== undefined) return Promise.resolve(typeof request.body === "string" ? JSON.parse(request.body) : request.body);
    return new Promise((resolve, reject) => {
        let body = "";
        request.on("data", (chunk) => {
            body += chunk;
            if (body.length > 14_000_000) request.destroy(new Error("Request too large"));
        });
        request.on("end", () => {
            try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON")); }
        });
        request.on("error", reject);
    });
}

function sendJson(response, status, payload) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(payload));
}

async function getUser(request) {
    const header = request.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const session = (await database.prepare(`SELECT users.*, sessions.token FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > ?`).get(token, now()));
    return session || null;
}

async function requireUser(request, response, role) {
    const user = await getUser(request);
    if (!user) {
        sendJson(response, 401, { error: "You must be signed in." });
        return null;
    }
    if (role && user.role !== role) {
        sendJson(response, 403, { error: "Admin access is required." });
        return null;
    }
    return user;
}

async function handleApi(request, response, pathname) {
    if (request.method === "GET" && pathname === "/api/payment-options") {
        return sendJson(response, 200, { card: paymob.configured(process.env) });
    }
    if (request.method === "GET" && pathname === "/api/payment-status") {
        const key = new URL(request.url, "http://localhost").searchParams.get("key");
        if (!/^[a-f0-9-]{32,64}$/i.test(key || "")) return sendJson(response, 400, { error: "Invalid order key." });
        const order = await database.prepare("SELECT id, total, payment_status FROM orders WHERE checkout_key = ? AND payment = 'Paymob card'").get(key);
        return sendJson(response, order ? 200 : 404, order || { error: "Order not found." });
    }
    if (request.method === "GET" && pathname === "/api/card-checkout") {
        const key = new URL(request.url, "http://localhost").searchParams.get("key");
        if (!/^[a-f0-9-]{32,64}$/i.test(key || "")) return sendJson(response, 400, { error: "Invalid order key." });
        const order = await database.prepare("SELECT id, total, payment_status, paymob_checkout_url, created_at FROM orders WHERE checkout_key = ? AND payment = 'Paymob card'").get(key);
        if (!order) return sendJson(response, 404, { error: "Order not found." });
        if (order.payment_status === "Paid") return sendJson(response, 200, { id: order.id, total: order.total, paid: true });
        if (Date.now() - Date.parse(order.created_at) >= 3600000) return sendJson(response, 410, { error: "This payment session has expired. Contact the store with order #" + order.id + " to continue." });
        if (!order.paymob_checkout_url) return sendJson(response, 409, { error: "Payment is not ready. Please try again shortly." });
        const checkout = new URL(order.paymob_checkout_url);
        return sendJson(response, 200, { id: order.id, total: order.total, publicKey: checkout.searchParams.get('publicKey'), clientSecret: checkout.searchParams.get('clientSecret') });
    }
    if (request.method === "POST" && pathname === "/api/paymob/callback") {
        const body = await parseBody(request);
        if (body.type !== "TRANSACTION") return sendJson(response, 200, { ignored: true });
        const obj = body.obj;
        const signature = new URL(request.url, "http://localhost").searchParams.get("hmac");
        if (!paymob.verifyCallback(obj, signature, process.env.PAYMOB_HMAC_SECRET)) return sendJson(response, 401, { error: "Invalid payment signature." });
        const order = await database.prepare("SELECT id, total FROM orders WHERE paymob_order_id = ? AND payment = 'Paymob card'").get(String(obj.order.id));
        if (!order) return sendJson(response, 503, { error: "Payment reference is not ready; retry callback." });
        if (Number(obj.amount_cents) !== Math.round(order.total * 100) || obj.currency !== "EGP" || Number(obj.integration_id) !== Number(process.env.PAYMOB_CARD_INTEGRATION_ID)) return sendJson(response, 400, { error: "Payment details do not match the order." });
        if (obj.pending === false && obj.success === true && obj.error_occured === false && obj.is_refunded === false && obj.is_voided === false && obj.is_auth === false) {
            // Conditional update makes replayed callbacks harmless; fulfillment is handled separately.
            await database.prepare("UPDATE orders SET payment_status = 'Paid', status = 'Confirmed', remaining_amount = 0, payment_reference = ?, payment_reviewed_at = ? WHERE id = ? AND payment_status IN ('Awaiting Card Payment', 'Card Payment Failed')").run(String(obj.id), now(), order.id);
        } else if (obj.pending === false && obj.success === false) {
            await database.prepare("UPDATE orders SET payment_status = 'Card Payment Failed', status = 'Payment Failed' WHERE id = ? AND payment_status = 'Awaiting Card Payment'").run(order.id);
        }
        return sendJson(response, 200, { ok: true });
    }
    if (request.method === "GET" && pathname === "/api/shipping-rates") {
        return sendJson(response, 200, { currency: "EGP", rates: shippingRates.rates.map(({ id, name, price }) => ({ id, name, price })) });
    }
    if (request.method === "GET" && pathname === "/api/products") {
        return sendJson(response, 200, (await getProductsWithSales(database)).map(publicProduct));
    }
    const publicProductMatch = pathname.match(/^\/api\/products\/(\d+)$/);
    if (request.method === "GET" && publicProductMatch) {
        const product = await database.prepare("SELECT * FROM products WHERE id = ?").get(Number(publicProductMatch[1]));
        return sendJson(response, product ? 200 : 404, product ? publicProduct(product) : { error: "Product not found." });
    }

    const mediaMatch = pathname.match(/^\/api\/media\/([a-f0-9]{32})$/);
    if (request.method === "GET" && mediaMatch) {
        await ensureMediaStorage();
        const media = await database.prepare("SELECT mime, data FROM product_media WHERE id = ?").get(mediaMatch[1]);
        if (!media) return sendJson(response, 404, { error: "Image not found." });
        response.writeHead(200, { "Content-Type": media.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
        return response.end(Buffer.from(media.data, "base64"));
    }

    if (request.method === "POST" && pathname === "/api/auth/register") {
        const body = await parseBody(request);
        if (!body.name || !body.email || !body.phone || !body.address || !body.password) return sendJson(response, 400, { error: "All customer fields are required." });
        try {
            const result = (await database.prepare("INSERT INTO users (name, email, phone, address, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'customer', ?)")
                .run(body.name.trim(), body.email.trim().toLowerCase(), body.phone.trim(), body.address.trim(), hashPassword(body.password), now()));
            const user = (await database.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid));
            return createSession(response, user);
        } catch (error) {
            if (String(error.message).includes("UNIQUE")) return sendJson(response, 409, { error: "This email is already registered." });
            throw error;
        }
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
        const body = await parseBody(request);
        const user = (await database.prepare("SELECT * FROM users WHERE email = ?").get(String(body.email || "").trim().toLowerCase()));
        if (!user || !verifyPassword(String(body.password || ""), user.password_hash)) return sendJson(response, 401, { error: "Invalid email or password." });
        return createSession(response, user);
    }

    if (request.method === "POST" && pathname === "/api/auth/forgot-password") {
        const body = await parseBody(request);
        const [status, result] = await recovery.request(body.email);
        return sendJson(response, status, result);
    }
    if (request.method === "POST" && pathname === "/api/auth/reset-password") {
        const body = await parseBody(request);
        const [status, result] = await recovery.reset(body, hashPassword);
        return sendJson(response, status, result);
    }

    if (request.method === "POST" && pathname === "/api/auth/logout") {
        const token = (request.headers.authorization || "").replace(/^Bearer /, "");
        (await database.prepare("DELETE FROM sessions WHERE token = ?").run(token));
        return sendJson(response, 200, { ok: true });
    }

    if (request.method === "GET" && pathname === "/api/auth/me") {
        const user = await getUser(request);
        return sendJson(response, user ? 200 : 401, user ? { user: publicUser(user) } : { error: "Not signed in." });
    }

    if (request.method === "PUT" && pathname === "/api/profile") {
        const user = await requireUser(request, response);
        if (!user) return;
        const body = await parseBody(request);
        if (!body.name || !body.phone || !body.address) return sendJson(response, 400, { error: "Name, phone, and address are required." });
        (await database.prepare("UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?").run(body.name.trim(), body.phone.trim(), body.address.trim(), user.id));
        return sendJson(response, 200, { user: publicUser((await database.prepare("SELECT * FROM users WHERE id = ?").get(user.id))) });
    }

    if (request.method === "POST" && pathname === "/api/orders") {
        const user = await getUser(request);
        if (user?.role === "admin") return sendJson(response, 403, { error: "Use a customer account or guest checkout to place an order." });
        const body = await parseBody(request);
        if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.length > 150 ||
            typeof body.address !== "string" || body.address.trim().length < 5 || body.address.length > 1000 ||
            typeof body.email !== "string" || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
            typeof body.phone !== "string" || !/^(?:\+?20|0)1[0125]\d{8}$/.test(body.phone.replace(/[\s()-]/g, "")) ||
            !Array.isArray(body.items) || !body.items.length || body.items.length > 100) return sendJson(response, 400, { error: "Enter your full name, valid email, Egyptian mobile number, address, and order items." });
        const destination = shippingRates.rates.find(rate => rate.id === body.governorate);
        if (!destination) return sendJson(response, 400, { error: "Choose a valid governorate." });
        const checkoutKey = typeof body.checkoutKey === "string" && /^[a-f0-9-]{32,64}$/i.test(body.checkoutKey) ? body.checkoutKey : null;
        if (checkoutKey) {
            const previous = await database.prepare("SELECT id, total, subtotal, shipping_fee, status, payment, paymob_checkout_url FROM orders WHERE checkout_key = ?").get(checkoutKey);
            if (previous) {
                if (previous.payment === "Paymob card" && !previous.paymob_checkout_url) return sendJson(response, 409, { error: "This payment needs review. Contact the store with order #" + previous.id + " before trying again." });
                return sendJson(response, 200, { id: previous.id, total: previous.total, subtotal: previous.subtotal, status: previous.status, shipping: previous.shipping_fee, checkoutUrl: previous.paymob_checkout_url || undefined });
            }
        }
        const isCard = body.paymentMethod === "card";
        if (isCard && !checkoutKey) return sendJson(response, 400, { error: "A checkout key is required." });
        if (isCard && !paymob.configured(process.env)) return sendJson(response, 503, { error: "Card payments are awaiting gateway activation. Choose another payment method." });
        const isCashDeposit = body.paymentMethod === "cash_deposit";
        const paymentMethod = isCard ? "Paymob card" : isCashDeposit ? "Cash on Delivery deposit" : null;
        if (!paymentMethod) return sendJson(response, 400, { error: "Choose a valid payment method." });
        const depositChannel = String(body.depositChannel || "");
        if (!isCard && !["instapay", "vodafone_cash"].includes(depositChannel)) {
            return sendJson(response, 400, { error: "Choose InstaPay or Vodafone Cash for your payment." });
        }
        const screenshot = String(body.paymentScreenshot || "");
        if (!isCard && (!/^data:image\/(png|jpe?g|webp);base64,/i.test(screenshot) || screenshot.length > 13_333_360 || Buffer.from(screenshot.split(",")[1] || "", "base64").length >= 10_000_000)) {
            return sendJson(response, 400, { error: "Upload a PNG, JPG, or WebP payment screenshot (under 10 MB)." });
        }
        // Never trust prices supplied by the browser.
        const items = [];
        const quantities = new Map();
        for (const item of body.items) {
            const productId = Number(item.id);
            if (!Number.isInteger(productId) || productId < 1) return sendJson(response, 400, { error: "Your cart contains an invalid product. Refresh the page and try again." });
            const row = await database.prepare("SELECT * FROM products WHERE id = ?").get(productId);
            const product = row && publicProduct(row);
            const quantity = Number(item.quantity);
            if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.stock) return sendJson(response, 400, { error: "One or more cart items are unavailable." });
            if (!product.sizes.includes(item.size)) return sendJson(response, 400, { error: `Choose an available size for ${product.name}.` });
            if (product.colors.length && !product.colors.includes(item.color)) return sendJson(response, 400, { error: `Choose an available color for ${product.name}.` });
            const totalQuantity = (quantities.get(product.id) || 0) + quantity;
            if (totalQuantity > product.stock) return sendJson(response, 400, { error: `The requested quantity of ${product.name} exceeds available stock.` });
            quantities.set(product.id, totalQuantity);
            const existing = items.find(line => line.id === product.id && line.size === item.size && (line.color || "") === (item.color || ""));
            if (existing) existing.quantity += quantity;
            else items.push({ id: product.id, name: product.name, price: product.price, image: product.image, size: item.size, color: product.colors.length ? item.color : "", quantity });
        }
        const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const total = Math.round((subtotal + destination.price) * 100) / 100;
        const depositAmount = isCashDeposit ? destination.price + Math.min(50, subtotal) : total;
        const paymentStatus = isCard ? "Awaiting Card Payment" : isCashDeposit ? "Pending Deposit Verification" : "Pending Payment Verification";
        const paymentLabel = isCard ? paymentMethod : `${paymentMethod} (${depositChannel === "instapay" ? "InstaPay" : "Vodafone Cash"})`;
        // Older stores require an owner on each order. Guests receive an opaque,
        // non-login identity; their actual email belongs only to the order.
        let userId = user?.id;
        if (!userId) {
            const guest = await database.prepare("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, 'customer', ?)")
                .run(body.name.trim(), `guest-${randomBytes(24).toString("hex")}@checkout.invalid`, hashPassword(randomBytes(32).toString("hex")), now());
            userId = guest.lastInsertRowid;
        }
        const result = await database.prepare(`INSERT INTO orders (user_id, name, phone, address, payment, items_json, total, status, payment_status, payment_screenshot, deposit_amount, remaining_amount, created_at, customer_email, governorate, shipping_fee, subtotal, checkout_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(userId, body.name.trim(), body.phone.trim(), body.address.trim(), paymentLabel, JSON.stringify(items), total, paymentStatus, paymentStatus, screenshot, depositAmount, total, now(), body.email.trim(), destination.name, destination.price, subtotal, checkoutKey);
        const id = Number(result.lastInsertRowid);
        if (isCard) {
            try {
                const checkout = await paymob.createCheckout({ id, total, name: body.name, customer_email: body.email, phone: body.phone, address: body.address, governorate: destination.name }, process.env);
                await database.prepare("UPDATE orders SET paymob_checkout_url = ?, paymob_order_id = ? WHERE id = ?").run(checkout.url, checkout.reference, id);
                return sendJson(response, 201, { id, total, checkoutUrl: checkout.url });
            } catch {
                return sendJson(response, 502, { error: `Unable to start card payment for order #${id}. Contact the store before trying again.` });
            }
        }
        return sendJson(response, 201, { id, subtotal, shipping: destination.price, total, status: paymentStatus });
    }

    const adminRoute = pathname.startsWith("/api/admin/");
    const admin = (adminRoute || ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) ? await requireUser(request, response, "admin") : true;
    if (!admin) return;

    if (request.method === "POST" && pathname === "/api/admin/product-images") {
        const body = await parseBody(request);
        const match = typeof body.image === "string" && body.image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
        if (!match || match[2].length > 1_000_000) return sendJson(response, 400, { error: "Upload a JPG, PNG, or WebP image up to 750 KB after compression." });
        const bytes = Buffer.from(match[2], "base64");
        const valid = match[1] === "image/png" ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" :
            match[1] === "image/jpeg" ? bytes.subarray(0, 3).toString("hex") === "ffd8ff" :
            bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
        if (!valid || bytes.length > 750_000) return sendJson(response, 400, { error: "Invalid image file." });
        await ensureMediaStorage();
        const id = randomBytes(16).toString("hex");
        await database.prepare("INSERT INTO product_media (id, mime, data) VALUES (?, ?, ?)").run(id, match[1], match[2]);
        return sendJson(response, 201, { url: `/api/media/${id}` });
    }

    if (request.method === "POST" && pathname === "/api/products") {
        const body = await parseBody(request);
        const image = productImages(body);
        if (!image) return sendJson(response, 400, { error: "Add between 1 and 20 valid product photos." });
        const colors = productColors(body);
        if (!colors) return sendJson(response, 400, { error: "Enter valid available colors." });
        const sizes = productSizes(body);
        if (!sizes) return sendJson(response, 400, { error: "Enter valid available sizes." });
        const result = (await database.prepare("INSERT INTO products (name, price, stock, category, brand, image, created_at, sizes_json, description, colors_json, best_seller) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(body.name, Number(body.price), Number(body.stock), body.category, body.brand || "Other", image, now(), sizes, String(body.description || "").slice(0, 5000), colors, body.bestSeller === true ? 1 : 0));
        return sendJson(response, 201, publicProduct(await database.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid)));
    }

    const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
    if (productMatch && ["PUT", "DELETE"].includes(request.method)) {
        const id = Number(productMatch[1]);
        if (request.method === "DELETE") {
            (await database.prepare("DELETE FROM products WHERE id = ?").run(id));
            return sendJson(response, 200, { ok: true });
        }
        const body = await parseBody(request);
        const existing = await database.prepare("SELECT * FROM products WHERE id = ?").get(id);
        if (!existing) return sendJson(response, 404, { error: "Product not found." });
        const image = productImages(body, publicProduct(existing));
        if (!image) return sendJson(response, 400, { error: "Add between 1 and 20 valid product photos." });
        const colors = productColors(body, publicProduct(existing));
        if (!colors) return sendJson(response, 400, { error: "Enter valid available colors." });
        const sizes = productSizes(body, publicProduct(existing));
        if (!sizes) return sendJson(response, 400, { error: "Enter valid available sizes." });
        (await database.prepare("UPDATE products SET name = ?, price = ?, stock = ?, category = ?, brand = ?, image = ?, sizes_json = ?, description = ?, colors_json = ?, best_seller = ? WHERE id = ?")
            .run(body.name, Number(body.price), Number(body.stock), body.category, body.brand || "Other", image, sizes, String(body.description ?? existing.description ?? "").slice(0, 5000), colors, body.bestSeller === undefined ? existing.best_seller : body.bestSeller === true ? 1 : 0, id));
        return sendJson(response, 200, publicProduct(await database.prepare("SELECT * FROM products WHERE id = ?").get(id)));
    }

    if (request.method === "GET" && pathname === "/api/admin/orders") {
        const orders = (await database.prepare(`SELECT orders.id, orders.name, orders.phone, orders.address,
            orders.payment, orders.items_json, orders.total, orders.status, orders.payment_status,
            orders.deposit_amount, orders.remaining_amount, orders.delivery_date, orders.delivery_time,
            orders.created_at, COALESCE(NULLIF(orders.customer_email, ''), users.email) AS customer_email,
            orders.governorate, orders.shipping_fee, CASE WHEN orders.subtotal = 0 THEN orders.total - orders.shipping_fee ELSE orders.subtotal END AS subtotal,
            CASE WHEN orders.payment_screenshot != '' THEN 1 ELSE 0 END AS has_screenshot
            FROM orders JOIN users ON users.id = orders.user_id ORDER BY orders.created_at DESC`).all());
        return sendJson(response, 200, orders.map((order) => ({ ...order, items: JSON.parse(order.items_json) })));
    }

    const screenshotMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/screenshot$/);
    if (screenshotMatch && request.method === "GET") {
        const order = await database.prepare("SELECT payment_screenshot FROM orders WHERE id = ?").get(Number(screenshotMatch[1]));
        const match = order?.payment_screenshot?.match(/^data:(image\/(?:png|jpe?g|webp));base64,([\s\S]+)$/i);
        if (!match) return sendJson(response, 404, { error: "Screenshot not found." });
        response.writeHead(200, { "Content-Type": match[1], "Cache-Control": "private, no-store" });
        return response.end(Buffer.from(match[2], "base64"));
    }

    const paymentDecisionMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/payment-decision$/);
    if (paymentDecisionMatch && request.method === "POST") {
        const body = await parseBody(request);
        if (!["approve", "reject"].includes(body.decision)) return sendJson(response, 400, { error: "Invalid payment decision." });
        const order = (await database.prepare("SELECT * FROM orders WHERE id = ?").get(Number(paymentDecisionMatch[1])));
        if (!order) return sendJson(response, 404, { error: "Order not found." });
        if (!String(order.payment_status).startsWith("Pending")) return sendJson(response, 409, { error: "This payment has already been reviewed." });
        if (body.decision === "approve" && (!body.deliveryDate || !body.deliveryTime)) return sendJson(response, 400, { error: "A delivery date and time are required before approval." });
        const isCashDeposit = String(order.payment).startsWith("Cash on Delivery deposit");
        const paidAmount = isCashDeposit ? order.deposit_amount : order.total;
        const paymentStatus = body.decision === "approve" ? (isCashDeposit ? "Deposit Paid" : "Paid") : "Payment Rejected";
        const status = body.decision === "approve" ? "Confirmed" : "Rejected";
        const remaining = body.decision === "approve" ? Math.max(0, order.total - paidAmount) : order.total;
        (await database.prepare(`UPDATE orders SET status = ?, payment_status = ?, remaining_amount = ?, delivery_date = ?, delivery_time = ?, payment_reviewed_at = ?, reviewed_by = ?, whatsapp_notification_status = 'not_sent' WHERE id = ?`)
            .run(status, paymentStatus, remaining, body.decision === "approve" ? body.deliveryDate : "", body.decision === "approve" ? body.deliveryTime : "", now(), admin.id, Number(paymentDecisionMatch[1])));
        return sendJson(response, 200, { order: (await database.prepare("SELECT * FROM orders WHERE id = ?").get(Number(paymentDecisionMatch[1]))) });
    }

    const notificationMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/whatsapp-notification$/);
    if (notificationMatch && request.method === "POST") {
        const order = (await database.prepare("SELECT * FROM orders WHERE id = ?").get(Number(notificationMatch[1])));
        if (!order) return sendJson(response, 404, { error: "Order not found." });
        if (order.status !== "Confirmed") return sendJson(response, 409, { error: "Only confirmed orders can be notified." });
        const phone = String(order.phone).replace(/\D/g, "").replace(/^0/, "20");
        if (!phone) return sendJson(response, 400, { error: "The customer has no valid phone number." });
        const paidText = order.payment_status === "Deposit Paid" ? `${order.deposit_amount} EGP deposit` : `${order.total} EGP payment`;
        const message = `Your order has been confirmed successfully. We have received your ${paidText}. Your order will be delivered on ${order.delivery_date} at ${order.delivery_time}. The remaining amount to be paid upon delivery is ${order.remaining_amount} EGP.`;
        // This is deliberately a best-effort notification. The order was committed before this route is called.
        (await database.prepare("UPDATE orders SET whatsapp_notification_status = 'opened' WHERE id = ?").run(order.id));
        return sendJson(response, 200, { url: `https://wa.me/${phone}?text=${encodeURIComponent(message)}` });
    }

    const fulfillmentMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)\/fulfillment$/);
    if (fulfillmentMatch && request.method === "POST") {
        const order = (await database.prepare("SELECT status FROM orders WHERE id = ?").get(Number(fulfillmentMatch[1])));
        if (!order) return sendJson(response, 404, { error: "Order not found." });
        if (order.status !== "Confirmed") return sendJson(response, 409, { error: "Only confirmed orders can be marked as delivered." });
        (await database.prepare("UPDATE orders SET status = 'Delivered' WHERE id = ?").run(Number(fulfillmentMatch[1])));
        return sendJson(response, 200, { ok: true });
    }

    const adminOrderMatch = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (adminOrderMatch && request.method === "DELETE") {
        const order = (await database.prepare("SELECT status FROM orders WHERE id = ?").get(Number(adminOrderMatch[1])));
        if (!order) return sendJson(response, 404, { error: "Order not found." });
        (await database.prepare("DELETE FROM orders WHERE id = ?").run(Number(adminOrderMatch[1])));
        return sendJson(response, 200, { ok: true });
    }

    return sendJson(response, 404, { error: "API route not found." });
}

async function createSession(response, user) {
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + sessionDays * 86400000).toISOString();
    (await database.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, user.id, expires));
    return sendJson(response, 200, { token, user: publicUser(user) });
}

const MIME_TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml" };

async function serveStatic(response, pathname) {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = normalize(join(ROOT, requested));
    const asset = requested.slice(1);
    if (!publicFiles.includes(asset) && !/^images\/[a-zA-Z0-9_-]+\.(svg|png|jpe?g|gif|webp)$/.test(asset)) return sendJson(response, 404, { error: "File not found." });
    try {
        const file = await readFile(filePath);
        const fileType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
        response.writeHead(200, { "Content-Type": fileType });
        response.end(file);
    } catch { sendJson(response, 404, { error: "File not found." }); }
}

let ready;
let commerceReady;
async function handler(request, response) {
    const pathname = new URL(request.url, "http://localhost").pathname;
    try {
        if (pathname.startsWith("/api/")) {
            // Cloud schema is initialized explicitly before deployment.
            if (!database.remote) {
                ready ||= initializeDatabase().catch(error => { ready = null; throw error; });
                await ready;
            }
            else {
                commerceReady ||= ensureCommerceSchema().catch(error => { commerceReady = null; throw error; });
                await commerceReady;
            }
            await handleApi(request, response, pathname);
        } else await serveStatic(response, pathname);
    } catch (error) {
        console.error(error);
        if (!response.headersSent) sendJson(response, 500, { error: "Server error." });
    }
}

if (require.main === module) {
    createServer(handler).listen(PORT, () => console.log(`Bondok Store running at http://localhost:${PORT}`));
}
module.exports = { handler, initializeDatabase, database, hashPassword };
