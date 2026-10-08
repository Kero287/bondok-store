const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { createRequire } = require("node:module");
const { openDatabase } = require("../database");
const { importDatabase } = require("../scripts/import-db");
const root = path.join(__dirname, "..");

assert.throws(() => openDatabase({ VERCEL: "1" }), /Configure TURSO/);

async function checkApi(asynchronous) {
    const db = new DatabaseSync(":memory:");
    const adapter = asynchronous ? {
        remote: true,
        async exec(sql) { db.exec(sql); },
        prepare(sql) {
            const stmt = db.prepare(sql);
            return Object.fromEntries(["get", "all", "run"].map(method => [method, async (...args) => {
                await Promise.resolve();
                return stmt[method](...args);
            }]));
        }
    } : db;
    const localRequire = createRequire(path.join(root, "server.js"));
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, "server.js"), "utf8"), {
        require: name => name === "./database" ? { openDatabase: () => adapter } : localRequire(name),
        module, __dirname: root, Buffer, URL, console,
        process: { env: { ADMIN_EMAIL: "admin@example.test", ADMIN_PASSWORD: "test-password-long" } }
    });
    const { handler, initializeDatabase } = module.exports;
    await initializeDatabase();
    async function request(method, url, body, token) {
        let status, payload, contentType;
        await handler({ method, url, body, headers: { authorization: token ? `Bearer ${token}` : "" } }, {
            writeHead(value, headers) { status = value; contentType = headers["Content-Type"]; },
            end(value) { payload = value; }
        });
        return { status, data: contentType?.includes("application/json") ? JSON.parse(payload) : payload };
    }
    const login = await request("POST", "/api/auth/login", { email: "admin@example.test", password: "test-password-long" });
    assert.equal(login.status, 200);
    const admin = login.data.token;
    const registered = await request("POST", "/api/auth/register", { name: "Customer", email: "customer@example.test", password: "customer-password", phone: "01000000000", address: "Cairo" });
    assert.equal(registered.status, 200);
    const token = registered.data.token;
    const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
    assert.equal((await request("POST", "/api/admin/product-images", { image: photo })).status, 401);
    assert.equal((await request("POST", "/api/admin/product-images", { image: photo }, token)).status, 403);
    assert.equal((await request("POST", "/api/admin/product-images", { image: "data:image/png;base64,AAAA" }, admin)).status, 400);
    assert.equal((await request("POST", "/api/admin/product-images", { image: "data:image/svg+xml;base64,AAAA" }, admin)).status, 400);
    assert.equal((await request("POST", "/api/admin/product-images", { image: "data:image/png;base64," + "A".repeat(1_000_004) }, admin)).status, 400);
    const uploaded = await request("POST", "/api/admin/product-images", { image: photo }, admin);
    assert.equal(uploaded.status, 201);
    const uploaded2 = await request("POST", "/api/admin/product-images", { image: photo }, admin);
    const imageResponse = await request("GET", uploaded.data.url);
    assert.equal(imageResponse.status, 200);
    assert.deepEqual(imageResponse.data, Buffer.from(photo.split(",")[1], "base64"));
    assert.equal((await request("GET", "/api/media/" + "0".repeat(32))).status, 404);
    const galleryBody = { name: "Gallery", price: 150, stock: 2, category: "T-Shirts", brand: "ZARA", images: [uploaded.data.url, uploaded2.data.url] };
    const galleryProduct = await request("POST", "/api/products", galleryBody, admin);
    assert.equal(galleryProduct.status, 201);
    assert.equal(galleryProduct.data.bestSeller, false);
    assert.equal((await request("PUT", `/api/products/${galleryProduct.data.id}`, { ...galleryBody, bestSeller: true }, admin)).data.bestSeller, true);
    assert.equal((await request("GET", "/api/products")).data.find(p => p.id === galleryProduct.data.id).bestSeller, true);
    assert.equal((await request("PUT", `/api/products/${galleryProduct.data.id}`, { ...galleryBody, bestSeller: false }, admin)).data.bestSeller, false);
    assert.equal(galleryProduct.data.image, uploaded.data.url);
    assert.deepEqual(galleryProduct.data.images, galleryBody.images);
    const galleryId = galleryProduct.data.id;
    assert.deepEqual((await request("GET", "/api/products")).data.find(p => p.id === galleryId).images, galleryBody.images);
    // Reordering changes the cover, editing without new files preserves the gallery.
    const reordered = [...galleryBody.images].reverse();
    assert.deepEqual((await request("PUT", `/api/products/${galleryId}`, { ...galleryBody, images: reordered }, admin)).data.images, reordered);
    const { images, ...legacyEdit } = galleryBody;
    assert.deepEqual((await request("PUT", `/api/products/${galleryId}`, { ...legacyEdit, image: reordered[0] }, admin)).data.images, reordered);
    assert.equal((await request("PUT", `/api/products/${galleryId}`, { ...galleryBody, images: [] }, admin)).status, 400);
    assert.equal((await request("POST", "/api/products", { ...galleryBody, images: ['javascript:alert(1)'] }, admin)).status, 400);
    assert.equal((await request("POST", "/api/products", { ...galleryBody, images: Array(21).fill(uploaded.data.url) }, admin)).status, 400);
    assert.deepEqual((await request("PUT", `/api/products/${galleryId}`, { ...galleryBody, images: [reordered[0]] }, admin)).data.images, [reordered[0]]);
    assert.equal((await request("GET", "/api/auth/me", undefined, token)).data.user.name, "Customer");
    assert.equal((await request("GET", "/api/admin/orders", undefined, token)).status, 403);
    assert.equal((await request("GET", "/api/admin/orders")).status, 401);
    const product = await request("POST", "/api/products", { name: "Test", price: 100, stock: 5, category: "Shirts", brand: "Test", image: "images/cover.jpeg" }, admin);
    assert.equal(product.status, 201);
    assert.deepEqual(product.data.images, ["images/cover.jpeg"]);
    assert.deepEqual(product.data.sizes, ["S", "M", "L", "XL"]);
    const body = { name: "Customer", email: "customer@example.test", phone: "01000000000", address: "Cairo", governorate: "asyut", paymentMethod: "cash_deposit", depositChannel: "instapay", paymentScreenshot: "data:image/png;base64,AAAA", items: [{ id: product.data.id, size: "M", quantity: 2, price: 1 }] };
    assert.equal((await request("POST", "/api/orders", { ...body, paymentMethod: "unsupported" }, token)).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, paymentScreenshot: "data:image/png;base64," + Buffer.alloc(10_000_000).toString("base64") }, token)).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, paymentScreenshot: "data:image/png;base64," + Buffer.alloc(9_999_999).toString("base64") }, token)).status, 201);
    assert.equal((await request("POST", "/api/orders", body, token)).status, 201);
    const orders = await request("GET", "/api/admin/orders", undefined, admin);
    assert.equal(orders.data[0].total, 310);
    assert.equal(orders.data[0].shipping_fee, 110);
    assert.equal(orders.data[0].subtotal, 200);
    assert.equal(orders.data[0].governorate, "Asyut");
    assert.equal(orders.data[0].customer_email, body.email);
    assert.equal(orders.data[0].items[0].size, "M");
    assert.equal(orders.data[0].deposit_amount, 160);
    const id = orders.data[0].id;
    const colored = await request("POST", "/api/products", { name: "Color tee", price: 500, stock: 5, category: "T-Shirts", image: "images/cover.jpeg", colors: ["Black", "White"] }, admin);
    assert.equal(colored.status, 201);
    assert.deepEqual(colored.data.colors, ["Black", "White"]);
    assert.deepEqual((await request("GET", "/api/products")).data.find(p => p.id === colored.data.id).colors, ["Black", "White"]);
    assert.equal((await request("POST", "/api/orders", { ...body, items: [{ id: colored.data.id, size: "M", quantity: 1 }] })).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, items: [{ id: colored.data.id, size: "M", color: "Red", quantity: 1 }] })).status, 400);
    const colorOrder = await request("POST", "/api/orders", { ...body, items: [{ id: colored.data.id, size: "M", color: "Black", quantity: 1 }] });
    assert.equal(colorOrder.data.total, 610);
    const savedColor = (await request("GET", "/api/admin/orders", undefined, admin)).data.find(order => order.id === colorOrder.data.id);
    assert.equal(savedColor.deposit_amount, 160);
    assert.equal(savedColor.items[0].color, "Black");
    await request("POST", `/api/admin/orders/${colorOrder.data.id}/payment-decision`, { decision: "approve", deliveryDate: "2026-10-01", deliveryTime: "12:00" }, admin);
    assert.equal((await request("GET", "/api/admin/orders", undefined, admin)).data.find(order => order.id === colorOrder.data.id).remaining_amount, 450);
    const online = await request("POST", "/api/orders", { ...body, paymentMethod: "online_transfer" });
    assert.equal(online.status, 400);

    assert.equal(orders.data[0].has_screenshot, 1);
    assert.equal(orders.data[0].payment_screenshot, undefined);
    assert.equal((await request("GET", `/api/admin/orders/${id}/screenshot`, undefined, token)).status, 403);
    const receipt = await request("GET", `/api/admin/orders/${id}/screenshot`, undefined, admin);
    assert.equal(receipt.status, 200);
    assert.ok(Buffer.isBuffer(receipt.data));
    assert.equal((await request("POST", `/api/admin/orders/${id}/payment-decision`, { decision: "approve", deliveryDate: "2026-10-01", deliveryTime: "12:00" }, admin)).status, 200);
    const catalog = await request("GET", "/api/products");
    assert.equal(catalog.data.find(row => row.id === product.data.id).unitsSold, 2);
    const rates = (await request("GET", "/api/shipping-rates")).data.rates;
    assert.equal(rates.length, 31);
    for (const rate of require("../shipping-rates.json").rates) assert.equal(rate.price, rate.locallyPrice + 10);
    assert.equal((await request("POST", "/api/orders", { ...body, governorate: "unknown" })).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, email: "invalid" })).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, phone: "abc" })).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, items: [{ id: product.data.id, size: "XXXL", quantity: 1 }] })).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, items: [{ id: product.data.id, quantity: 1 }] })).status, 400);
    assert.equal((await request("POST", "/api/orders", { ...body, items: [{ id: product.data.id, size: "M", quantity: 3 }, { id: product.data.id, size: "L", quantity: 3 }] })).status, 400);
    const guestBody = { ...body, checkoutKey: "12345678-1234-1234-1234-123456789012", shipping: 0, total: 1, governorate: "cairo", items: [{ id: product.data.id, size: "S", quantity: 1 }, { id: product.data.id, size: "L", quantity: 1 }] };
    const guestOrder = await request("POST", "/api/orders", guestBody);
    assert.equal(guestOrder.status, 201);
    assert.equal(guestOrder.data.total, 270);
    assert.equal(guestOrder.data.shipping, 70);
    const retry = await request("POST", "/api/orders", guestBody);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.id, guestOrder.data.id);
    const savedGuest = (await request("GET", "/api/admin/orders", undefined, admin)).data.find(order => order.id === guestOrder.data.id);
    assert.equal(savedGuest.customer_email, body.email);
    assert.deepEqual(savedGuest.items.map(item => item.size), ["S", "L"]);
    assert.equal(db.prepare("SELECT user_id FROM orders WHERE id = ?").get(guestOrder.data.id).user_id === registered.data.user.id, false);
    assert.equal((await request("GET", `/api/products/${product.data.id}`)).data.name, "Test");
    assert.equal((await request("GET", "/api/products/999999")).status, 404);
    assert.equal((await request("GET", "/server.js")).status, 404);
    assert.equal((await request("GET", "/bondok.sqlite")).status, 404);
    assert.equal((await request("GET", "/.env.local")).status, 404);
    assert.equal((await request("GET", "/")).status, 200);
    if (asynchronous) assert.equal((await request("POST", "/api/auth/forgot-password", { email: "admin@example.test" })).status, 503);
    await request("POST", "/api/auth/logout", {}, token);
    assert.equal((await request("GET", "/api/auth/me", undefined, token)).status, 401);
    db.close();
}

async function checkImport(withMedia = false) {
    const source = new DatabaseSync(":memory:");
    source.exec("CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE products(id INTEGER PRIMARY KEY); CREATE TABLE orders(id INTEGER PRIMARY KEY); CREATE TABLE sessions(token TEXT); INSERT INTO users VALUES (7, 'Existing'); INSERT INTO sessions VALUES ('old-token');");
    if (withMedia) source.exec("CREATE TABLE product_media(id TEXT PRIMARY KEY, mime TEXT, data TEXT); INSERT INTO product_media VALUES ('image-id', 'image/png', 'persisted-image');");
    const target = new DatabaseSync(":memory:");
    const client = { async transaction() {
        target.exec("BEGIN");
        return {
            async execute(input) {
                const sql = typeof input === "string" ? input : input.sql;
                const args = typeof input === "string" ? [] : input.args;
                const stmt = target.prepare(sql);
                return { rows: stmt.all(...args) };
            },
            async commit() { target.exec("COMMIT"); },
            async rollback() { target.exec("ROLLBACK"); }, close() {}
        };
    }};
    assert.deepEqual(await importDatabase(source, client), { users: 1, products: 0, orders: 0, ...(withMedia ? { product_media: 1 } : {}) });
    if (withMedia) assert.equal(target.prepare("SELECT data FROM product_media WHERE id = 'image-id'").get().data, "persisted-image");
    assert.equal(target.prepare("SELECT name FROM users WHERE id = 7").get().name, "Existing");
    assert.equal(target.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
    await assert.rejects(importDatabase(source, client), /not empty/);
    assert.equal(source.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1);
    source.close(); target.close();
}

(async () => {
    await checkApi(false);
    await checkApi(true);
    await checkImport();
    await checkImport(true);
    console.log("Passed: local/async API, auth, admin, product uploads/galleries, orders, sales, private files, import/media preservation and nonempty-target protection.");
})().catch(error => { console.error(error); process.exitCode = 1; });
