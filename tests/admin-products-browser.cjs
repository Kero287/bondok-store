const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, extname } = require('node:path');
const publicFiles = new Set(require('../public-files'));

(async () => {
    // Serve only static assets; all API writes below use isolated fixtures.
    const server = createServer(async (req, res) => {
        const file = new URL(req.url, 'http://localhost').pathname.slice(1);
        if (!publicFiles.has(file)) { res.writeHead(404).end(); return; }
        try {
            const data = await readFile(join(__dirname, '..', file));
            res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] || 'application/octet-stream');
            res.end(data);
        } catch { res.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const page = await browser.newPage();
        const origin = `http://127.0.0.1:${server.address().port}`;
        const base = { price: 500, stock: 8, images: ['images/cover.jpeg'], image: 'images/cover.jpeg', sizes: ['S', 'M'], colors: ['Black'], description: 'Cotton', bestSeller: false };
        let products = [
            { ...base, id: 1, name: 'Zara tee <special>', brand: 'ZARA', category: 'T-Shirts', bestSeller: true },
            { ...base, id: 2, name: 'Zara hoodie', brand: 'ZARA', category: 'Hoodie' },
            { ...base, id: 3, name: 'Lacoste jacket', brand: 'LACOSTE', category: 'Jackets', bestSeller: true },
            { ...base, id: 4, name: 'Legacy knit', brand: 'Legacy brand', category: 'Knitwear' },
            { ...base, id: 5, name: 'Other tee', brand: '', category: 'T-Shirts' }
        ];
        const errors = [], writes = [];
        let failNextSave = false;
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', async route => {
            const req = route.request();
            if (!req.url().startsWith(origin + '/')) return route.abort();
            const path = new URL(req.url()).pathname;
            if (path === '/api/auth/me') return route.fulfill({ json: { user: { name: 'Admin', role: 'admin' } } });
            if (path === '/api/products' && req.method() === 'GET') return route.fulfill({ json: products });
            if (path === '/api/admin/product-images') return route.fulfill({ json: { url: '/api/media/test-photo' } });
            if (path.startsWith('/api/products')) {
                if (failNextSave) {
                    failNextSave = false;
                    return route.fulfill({ status: 500, json: { error: 'Save failed. Try again.' } });
                }
                const id = Number(path.split('/').pop());
                const data = req.method() === 'DELETE' ? null : req.postDataJSON();
                writes.push({ method: req.method(), id, data });
                if (req.method() === 'DELETE') products = products.filter(p => p.id !== id);
                else if (req.method() === 'POST') products.push({ ...data, id: 6 });
                else products = products.map(p => p.id === id ? { ...data, id } : p);
                return route.fulfill({ json: { ok: true } });
            }
            return route.continue();
        });
        await page.goto(origin + '/admin-products.html');
        await page.locator('[name=brand] option[value="Legacy brand"]').waitFor({ state: 'attached' });
        assert.equal(await page.locator('#product-details').isVisible(), false);
        assert.equal(await page.locator('[data-new-best-seller]').isEnabled(), true);
        assert.equal(await page.locator('#admin-products [data-edit-product]').count(), 0);
        assert.equal(await page.locator('#admin-best-sellers .admin-product').count(), 2, 'Existing Best Sellers are visible before choosing a brand');
        await page.click('[data-new-best-seller]');
        assert.equal(await page.locator('#product-form-status').isVisible(), true);
        assert.equal(await page.locator('[name=brand]').evaluate(el => el === document.activeElement), true);
        await page.selectOption('[name=brand]', 'ZARA');
        assert.equal(await page.locator('[name=bestSeller]').isChecked(), true, 'Choosing a brand keeps new Best Seller mode');
        assert.equal(await page.locator('#product-form-status').isVisible(), false);
        await page.click('[data-cancel-product]');
        assert.equal(await page.locator('[name=bestSeller]').isChecked(), false);
        assert.equal(await page.locator('#product-details').isVisible(), true);
        assert.equal(await page.locator('#admin-products .admin-product').count(), 2);
        assert.equal(await page.locator('#admin-best-sellers .admin-product').count(), 2, 'The product brand does not hide other Best Sellers');
        await page.selectOption('#best-seller-brand', 'ZARA');
        assert.equal(await page.locator('#admin-best-sellers .admin-product').count(), 1);
        assert.match(await page.locator('#admin-products').innerText(), /Zara tee <special>/);
        assert.equal(await page.locator('#admin-products special').count(), 0);
        await page.selectOption('[name=category]', 'Accessories');
        assert.equal(await page.locator('#admin-products .admin-product').count(), 2, 'All categories of the brand stay visible');

        // Direct inclusion/removal preserves product details and any unsaved editor fields.
        await page.click('#admin-products [data-edit-product="2"]');
        await page.fill('[name=name]', 'Unsaved draft');
        await page.selectOption('#best-seller-brand', 'LACOSTE');
        await page.click('[data-add-best-seller="2"]');
        await page.locator('[data-remove-best-seller="2"]').waitFor();
        assert.equal(await page.inputValue('#best-seller-brand'), '');
        assert.equal(await page.locator('#admin-best-sellers .admin-product').count(), 3);
        assert.equal(products.find(p => p.id === 2).bestSeller, true);
        assert.equal(products.find(p => p.id === 2).name, 'Zara hoodie');
        assert.deepEqual(products.find(p => p.id === 2).images, base.images);
        assert.equal(await page.inputValue('[name=name]'), 'Unsaved draft');
        assert.equal(await page.locator('[name=bestSeller]').isChecked(), true);
        await page.click('[data-remove-best-seller="2"]');
        await page.locator('[data-add-best-seller="2"]').waitFor();
        assert.equal(await page.locator('[name=bestSeller]').isChecked(), false);
        assert.equal(await page.inputValue('[name=name]'), 'Unsaved draft');

        // Editing, cancelling, and brand switching must never leave a stale product ID.
        await page.click('#admin-products [data-edit-product="2"]');
        assert.equal(await page.inputValue('[name=id]'), '2');
        await page.click('[data-cancel-product]');
        assert.equal(await page.inputValue('[name=id]'), '');
        assert.equal(await page.inputValue('[name=brand]'), 'ZARA');
        await page.click('#admin-products [data-edit-product="2"]');
        await page.selectOption('[name=brand]', 'LACOSTE');
        assert.equal(await page.inputValue('[name=id]'), '');
        assert.equal(await page.inputValue('[name=name]'), '');
        assert.equal(await page.locator('#product-uploads img').count(), 0);
        assert.equal(await page.locator('#admin-products .admin-product').count(), 1);
        assert.match(await page.locator('#admin-best-sellers').innerText(), /Lacoste jacket/);
        await page.selectOption('[name=brand]', 'BALENCIAGA');
        assert.match(await page.locator('#admin-products').innerText(), /No products for this brand/);
        assert.equal(await page.locator('#admin-best-sellers .admin-product').count(), 2);
        await page.selectOption('#best-seller-brand', 'BALENCIAGA');
        assert.match(await page.locator('#admin-best-sellers').innerText(), /No Best Sellers for this brand/);
        await page.selectOption('#best-seller-brand', 'LACOSTE');
        await page.selectOption('[name=brand]', 'Legacy brand');
        assert.match(await page.locator('#admin-products').innerText(), /Legacy knit/);
        await page.selectOption('[name=brand]', 'Other');
        assert.match(await page.locator('#admin-products').innerText(), /Other tee/);
        await page.click('#admin-products [data-edit-product="5"]');
        assert.equal(await page.inputValue('[name=brand]'), 'Other');
        assert.equal(await page.locator('#product-details').isVisible(), true);

        await page.selectOption('[name=brand]', 'ZARA');
        await page.click('#admin-products [data-edit-product="2"]');
        await page.fill('[name=name]', 'Updated hoodie');
        await page.check('[name=bestSeller]');
        failNextSave = true;
        await page.click('#product-submit');
        await page.getByText('Save failed. Try again.', { exact: true }).waitFor();
        assert.equal(await page.inputValue('[name=id]'), '2');
        assert.equal(await page.inputValue('[name=name]'), 'Updated hoodie');
        assert.equal(await page.locator('[name=brand]').isEnabled(), true);
        await page.click('#product-submit');
        await page.waitForFunction(() => document.querySelector('#admin-best-sellers').textContent.includes('Updated hoodie'));
        assert.equal(writes.at(-1).method, 'PUT');
        assert.equal(writes.at(-1).data.brand, 'ZARA');
        assert.deepEqual(writes.at(-1).data.images, base.images);
        assert.equal(await page.inputValue('[name=id]'), '');
        assert.equal(await page.inputValue('[name=brand]'), 'ZARA');
        assert.equal(await page.locator('#admin-best-sellers .admin-product').count(), 3);
        assert.equal(await page.inputValue('#best-seller-brand'), '');

        // Unfeaturing preserves the product and all its details.
        await page.click('[data-remove-best-seller="2"]');
        await page.waitForFunction(() => !document.querySelector('[data-remove-best-seller="2"]'));
        assert.equal(await page.locator('#admin-products .admin-product').count(), 2);
        assert.equal(products.find(p => p.id === 2).bestSeller, false);
        assert.deepEqual(products.find(p => p.id === 2).colors, base.colors);

        // A new product uses POST and keeps the selected brand after saving.
        await page.reload();
        await page.locator('[name=brand] option[value="Legacy brand"]').waitFor({ state: 'attached' });
        await page.click('[data-new-best-seller]');
        await page.selectOption('[name=brand]', 'ZARA');
        assert.equal(await page.inputValue('[name=id]'), '');
        assert.equal(await page.inputValue('[name=brand]'), 'ZARA');
        assert.equal(await page.locator('#product-uploads img').count(), 0);
        assert.equal(await page.locator('[name=bestSeller]').isChecked(), true);
        await page.fill('[name=name]', 'New Zara jacket');
        await page.fill('[name=price]', '700');
        await page.fill('[name=stock]', '3');
        await page.selectOption('[name=category]', 'Jackets');
        const png = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 10;
            canvas.getContext('2d').fillRect(0, 0, 10, 10);
            return canvas.toDataURL('image/png').split(',')[1];
        });
        await page.locator('[data-photo-index="0"]').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
        await page.getByText('Photos uploaded. Save the product to publish your changes.', { exact: true }).waitFor();
        await page.click('#product-submit');
        await page.waitForFunction(() => document.querySelector('#admin-products').textContent.includes('New Zara jacket'));
        assert.equal(writes.at(-1).method, 'POST');
        assert.equal(writes.at(-1).data.brand, 'ZARA');
        assert.equal(writes.at(-1).data.bestSeller, true);
        assert.equal(await page.inputValue('[name=brand]'), 'ZARA');

        // Deleting from Best Sellers also clears an editor targeting that product.
        await page.click('#admin-products [data-edit-product="1"]');
        page.once('dialog', dialog => dialog.dismiss());
        await page.click('#admin-best-sellers [data-delete-product="1"]');
        assert.ok(products.some(p => p.id === 1));
        page.once('dialog', dialog => dialog.accept());
        await page.click('#admin-best-sellers [data-delete-product="1"]');
        await page.waitForFunction(() => !document.querySelector('[data-edit-product="1"]'));
        assert.equal(await page.inputValue('[name=id]'), '');
        assert.equal(await page.inputValue('[name=brand]'), 'ZARA');
        assert.ok(!products.some(p => p.id === 1));

        for (const lang of ['en', 'ar']) {
            await page.evaluate(lang => { localStorage.setItem('bondok-language', lang); localStorage.setItem('bondok-theme', 'dark'); }, lang);
            await page.reload();
            await page.selectOption('[name=brand]', 'ZARA');
            await page.locator('#admin-products [data-edit-product]').first().waitFor();
            for (const width of [320, 390, 768, 1440]) {
                await page.setViewportSize({ width, height: 900 });
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${lang} layout at ${width}px`);
            }
        }
        assert.deepEqual(errors, []);
        console.log('Passed: existing Best Sellers visible without a brand, independent brand filter, new Best Seller flow before brand selection, direct inclusion/removal with draft preservation, create/save/filter reset, edit/cancel/switch, failed-save retry, delete, and English/Arabic responsive layouts.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
