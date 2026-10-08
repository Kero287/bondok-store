const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const paymob = require('../paymob');
const env = { PAYMOB_SECRET_KEY: 'test-secret', PAYMOB_PUBLIC_KEY: 'test-public', PAYMOB_HMAC_SECRET: 'test-hmac', PAYMOB_CARD_INTEGRATION_ID: '6741', STORE_URL: 'https://store.example.test' };
const transaction = { amount_cents: 61000, created_at: '2026-09-23T12:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 2556706, integration_id: 6741, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: 4778239 }, owner: 4705, pending: false, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true };
function sign(obj) {
    const flat = { ...obj, order: obj.order.id, 'source_data.pan': obj.source_data.pan, 'source_data.sub_type': obj.source_data.sub_type, 'source_data.type': obj.source_data.type };
    delete flat.source_data;
    return createHmac('sha512', env.PAYMOB_HMAC_SECRET).update(Object.keys(flat).sort().map(key => String(flat[key])).join('')).digest('hex');
}
(async () => {
    assert.equal(paymob.configured({}), false);
    assert.equal(paymob.configured(env), true);
    const checkout = await paymob.createCheckout({ id: 1, total: 610, name: 'Test Customer', customer_email: 'test@example.test', phone: '01000000000', address: 'Test street', governorate: 'Asyut' }, env, async (url, options) => {
        assert.equal(url, 'https://accept.paymob.com/v1/intention/');
        const body = JSON.parse(options.body);
        assert.equal(body.amount, 61000);
        assert.equal(body.notification_url, 'https://store.example.test/api/paymob/callback');
        assert.equal(body.billing_data.email, 'test@example.test');
        assert.deepEqual(body.payment_methods, [6741]);
        return { ok: true, json: async () => ({ client_secret: 'test-client', intention_order_id: 4778239 }) };
    });
    assert.match(checkout.url, /publicKey=test-public&clientSecret=test-client/);
    assert.equal(paymob.verifyCallback(transaction, sign(transaction), env.PAYMOB_HMAC_SECRET), true);
    assert.equal(paymob.verifyCallback({ ...transaction, amount_cents: 1 }, sign(transaction), env.PAYMOB_HMAC_SECRET), false);
    assert.equal(paymob.verifyCallback(transaction, 'invalid', env.PAYMOB_HMAC_SECRET), false);
    const db = new DatabaseSync(':memory:');
    const root = path.join(__dirname, '..');
    const localRequire = createRequire(path.join(root, 'server.js'));
    const module = { exports: {} };
    let gatewayCalls = 0;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), {
        require: name => name === './database' ? { openDatabase: () => db } : name === './paymob' ? { ...paymob, createCheckout: async order => { gatewayCalls++; assert.equal(order.total, 610); return checkout; } } : localRequire(name),
        module, __dirname: root, Buffer, URL, console, process: { env }
    });
    const { handler, initializeDatabase } = module.exports;
    await initializeDatabase();
    db.prepare('UPDATE products SET price = 500 WHERE id = 1').run();
    async function request(method, url, body) {
        let status, result;
        await handler({ method, url, body, headers: {} }, { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } });
        return { status, data: result };
    }
    const body = { name: 'Test Customer', email: 'test@example.test', phone: '01000000000', address: 'Test street', governorate: 'asyut', paymentMethod: 'card', checkoutKey: '12345678-1234-1234-1234-123456789012', items: [{ id: 1, size: 'M', quantity: 1, price: 1 }] };
    const order = await request('POST', '/api/orders', body);
    assert.equal(order.status, 201);
    assert.equal(order.data.checkoutUrl, checkout.url);
    assert.equal((await request('POST', '/api/orders', body)).status, 200);
    assert.equal(gatewayCalls, 1);
    const cardSession = await request('GET', `/api/card-checkout?key=${body.checkoutKey}`);
    assert.equal(cardSession.status, 200);
    assert.equal(cardSession.data.total, 610);
    assert.equal(cardSession.data.publicKey, env.PAYMOB_PUBLIC_KEY);
    assert.equal(cardSession.data.clientSecret, 'test-client');
    assert.ok(!JSON.stringify(cardSession.data).includes(env.PAYMOB_SECRET_KEY));
    assert.equal((await request('GET', '/api/card-checkout?key=bad')).status, 400);
    assert.equal((await request('GET', '/api/card-checkout?key=00000000-0000-0000-0000-000000000000')).status, 404);
    db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', order.data.id);
    assert.equal((await request('GET', `/api/card-checkout?key=${body.checkoutKey}`)).status, 410);
    db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(new Date().toISOString(), order.data.id);
    const callback = obj => request('POST', `/api/paymob/callback?hmac=${sign(obj)}`, { type: 'TRANSACTION', obj });
    assert.equal((await request('POST', '/api/paymob/callback?hmac=bad', { type: 'TRANSACTION', obj: transaction })).status, 401);
    assert.equal((await callback({ ...transaction, amount_cents: 1 })).status, 400);
    assert.equal((await callback({ ...transaction, currency: 'USD' })).status, 400);
    assert.equal((await callback({ ...transaction, integration_id: 123 })).status, 400);
    await callback({ ...transaction, pending: true });
    assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id = ?').get(order.data.id).payment_status, 'Awaiting Card Payment');
    await callback({ ...transaction, success: false });
    assert.equal(db.prepare('SELECT payment_status FROM orders WHERE id = ?').get(order.data.id).payment_status, 'Card Payment Failed');
    await callback(transaction);
    await callback(transaction);
    await callback({ ...transaction, success: false });
    const saved = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.data.id);
    assert.equal(saved.payment_status, 'Paid');
    assert.equal(saved.remaining_amount, 0);
    assert.equal(saved.status, 'Confirmed');
    assert.equal((await request('GET', `/api/payment-status?key=${body.checkoutKey}`)).data.payment_status, 'Paid');
    const paidSession = (await request('GET', `/api/card-checkout?key=${body.checkoutKey}`)).data;
    assert.equal(paidSession.paid, true);
    assert.equal(paidSession.clientSecret, undefined);
    db.close();
    console.log('Passed: Paymob request amount, hosted checkout, signed callbacks, amount/currency/integration mismatch rejection, pending/failure/success, duplicate requests and callback replay. No external payment requests sent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
