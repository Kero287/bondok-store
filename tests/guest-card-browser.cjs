const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const files = require('../public-files');
const root = path.join(__dirname, '..');
const product = { id: 1, name: 'Guest checkout shirt', image: 'images/cover.jpeg', images: ['images/cover.jpeg'], price: 500, stock: 5, sizes: ['M'], colors: [], brand: 'ZARA', category: 'Hoodie', bestSeller: true };
const server = http.createServer(async (req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (!files.includes(file) && !file.startsWith('images/')) { res.writeHead(404); res.end(); return; }
    try {
        const body = await fs.readFile(path.join(root, file));
        res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'image/jpeg' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        for (const [width, language, buyNow, preview] of [[1440, 'en', true, false], [390, 'ar', false, false], [390, 'ar', true, true], [1440, 'en', false, true]]) {
            const context = await browser.newContext({ viewport: { width, height: 900 } });
            const page = await context.newPage();
            const errors = []; const orders = []; let paid = false;
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(({ language, origin }) => {
                if (location.origin === origin) localStorage.setItem('bondok-language', language);
            }, { language, origin });
            await page.route('**/*', async route => {
                const url = new URL(route.request().url());
                if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('/main.js')) {
                    return route.fulfill({ contentType: 'application/javascript', body: `window.Pixel = class { constructor(options) { window.pixelOptions = options; const button = document.createElement('button'); button.id = 'mock-pay'; button.textContent = 'Pay EGP 610'; button.onclick = () => options.afterPaymentComplete({ success: true }); document.getElementById(options.elementId).append(button); } };` });
                }
                if (url.origin !== origin) return route.abort();
                const json = body => route.fulfill({ json: body });
                if (url.pathname === '/api/products') return json([product]);
                if (url.pathname === '/api/products/1') return json(product);
                if (url.pathname === '/api/shipping-rates') return json({ rates: [{ id: 'asyut', name: 'Asyut', price: 110 }] });
                if (url.pathname === '/api/payment-options') return json({ card: !preview });
                if (url.pathname === '/api/orders') {
                    assert.equal(route.request().headers().authorization, undefined);
                    orders.push(route.request().postDataJSON());
                    return json({ id: 7, total: 610, checkoutUrl: 'https://accept.paymob.com/unifiedcheckout/?publicKey=test-public&clientSecret=test-client' });
                }
                if (url.pathname === '/api/card-checkout') return json({ id: 7, total: 610, publicKey: 'test-public', clientSecret: 'test-client' });
                if (url.pathname === '/api/payment-status') return json({ id: 7, total: 610, payment_status: paid ? 'Paid' : 'Awaiting Card Payment' });
                if (url.pathname.startsWith('/api/')) return json({});
                return route.continue();
            });
            await page.goto(`${origin}/product.html?id=1`);
            await page.selectOption('#product-size', 'M');
            await page.click(buyNow ? '[name=action][value=buy]' : '[name=action][value=cart]');
            if (!buyNow) await page.click('.checkout-link');
            await page.waitForURL('**/checkout.html*');
            assert.equal(await page.evaluate(() => sessionStorage.getItem('bondok-auth-token')), null);
            await page.fill('[name=name]', 'Guest Customer');
            await page.fill('[name=email]', 'guest@example.test');
            await page.fill('[name=phone]', '01012345678');
            await page.fill('[name=address]', '12 Example Street');
            await page.selectOption('[name=governorate]', 'asyut');
            assert.ok(!(await page.locator('[name=governorate]').innerText()).includes('110'));
            await page.check('[name=paymentMethod][value=card]');
            assert.equal(await page.locator('[name=paymentScreenshot]').getAttribute('required'), null);
            await page.click('#place-order');
            if (preview) {
                await page.waitForURL('**/card-payment.html?preview=1');
                await page.locator('.card-preview-fields').waitFor();
                assert.equal(orders.length, 0);
                assert.equal(await page.locator('.card-preview-fields input').first().isDisabled(), true);
                assert.equal(await page.locator('.card-preview-fields button').isDisabled(), true);
                assert.equal(await page.evaluate(() => typeof window.pixelOptions), 'undefined');
                assert.equal(await page.evaluate(() => sessionStorage.getItem('bondok-pending-card')), null);
                const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('bondok-card-preview')));
                assert.deepEqual(saved, { total: 610, buyNow });
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
                assert.deepEqual(errors, []);
                await context.close();
                continue;
            }
            await page.waitForURL('**/card-payment.html');
            await page.locator('#mock-pay').waitFor();
            assert.equal(orders.length, 1);
            assert.equal(orders[0].paymentMethod, 'card');
            assert.deepEqual(orders[0].items, [{ id: 1, size: 'M', color: '', quantity: 1 }]);
            assert.equal(await page.evaluate(() => window.pixelOptions.showSaveCard), false);
            assert.equal(await page.evaluate(() => window.pixelOptions.forceSaveCard), false);
            assert.equal(await page.evaluate(() => window.pixelOptions.customStyle.Direction), language === 'ar' ? 'rtl' : 'ltr');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            assert.equal(await page.locator('#card-total').textContent(), new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(610));
            await page.click('#mock-pay');
            await page.waitForURL('**/checkout.html?payment=return');
            await page.locator('#refresh-payment').waitFor();
            assert.ok(await page.evaluate(() => sessionStorage.getItem('bondok-pending-card')));
            paid = true;
            await page.click('#refresh-payment');
            await page.waitForFunction(() => !sessionStorage.getItem('bondok-pending-card'));
            if (buyNow) assert.equal(await page.evaluate(() => sessionStorage.getItem('bondok-buy-now')), null);
            else assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('bondok-cart'))), []);
            await page.goto(`${origin}/card-payment.html`);
            await page.locator('#card-error').waitFor();
            assert.equal(await page.locator('#mock-pay').count(), 0);
            assert.deepEqual(errors, []);
            await context.close();
        }
        console.log('Passed: guest Buy Now/cart, EN/AR desktop/mobile, order payload, card step, Paymob SDK options, verified payment before clearing cart, missing session. Payment services mocked; no charges.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
