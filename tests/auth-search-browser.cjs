const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        for (const name of ['login', 'register']) {
            await page.goto(`http://localhost:3101/${name}.html`);
            assert.equal(await page.locator('.auth-cover').evaluate(img => img.complete && img.naturalWidth > 0), true);
            const photo = await page.locator('.auth-visual').boundingBox();
            const form = await page.locator('.auth-form-panel').boundingBox();
            assert.equal(Math.round(photo.width), 720);
            assert.equal(form.x, 720);
            await page.click('[data-toggle-password]');
            assert.equal(await page.locator('[name=password]').getAttribute('type'), 'text');
            await page.click('[data-toggle-password]');
            await page.fill('[name=email]', 'customer@example.test');
            await page.fill('[name=password]', 'test-password');
            if (name === 'register') {
                await page.fill('[name=name]', 'Test Customer');
                await page.fill('[name=phone]', '01000000000');
                await page.fill('[name=address]', 'Test address');
            }
            let sent;
            await page.route(`**/api/auth/${name}`, route => {
                sent = route.request().postDataJSON();
                return route.fulfill({ status: 400, json: { error: 'Test response' } });
            });
            await page.click('.auth-submit');
            await page.getByText('Test response').waitFor();
            assert.equal(sent.email, 'customer@example.test');
            assert.equal(await page.locator('.auth-submit').isEnabled(), true);
            await page.screenshot({ path: `${name}-design-review.png` });
            await page.setViewportSize({ width: 390, height: 844 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            await page.setViewportSize({ width: 1440, height: 1000 });
        }
        for (const url of ['index.html', 'shop.html', 'product.html?id=1', 'checkout.html']) {
            await page.goto(`http://localhost:3101/${url}`);
            const trigger = page.locator('.header-search summary').first();
            await trigger.click();
            assert.equal(await page.locator('#header-search-input').isVisible(), true);
            assert.equal(await page.locator('dialog[open]').count(), 0);
            const icon = await trigger.boundingBox();
            const search = await page.locator('.header-search-panel').boundingBox();
            assert.equal(Math.round(search.y), Math.round(icon.y + icon.height + 8));
            await trigger.click();
            assert.equal(await page.locator('.header-search-panel').isVisible(), false);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.header-search summary').click();
        const search = await page.locator('.header-search-panel').boundingBox();
        assert.ok(search.x >= 0 && search.x + search.width <= 390);
        assert.ok(search.y >= 0 && search.y + search.height <= 844);
        assert.deepEqual(errors, []);
        console.log('Passed: split auth layouts, cover image, mobile overflow, password visibility, auth submission, search dropdown on four pages and mobile positioning.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
