const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        // Exercise the same older local server that cannot serve search.js.
        for (const mobile of [false, true]) {
            const context = await browser.newContext({ javaScriptEnabled: false, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 } });
            const page = await context.newPage();
            for (const name of ['index.html', 'shop.html', 'product.html?id=1', 'checkout.html']) {
                await page.goto(`http://localhost:3000/${name}`);
                const trigger = page.locator('.header-search summary');
                await trigger.click();
                assert.equal(await page.locator('#header-search-input').isVisible(), true);
                const box = await page.locator('.header-search-panel').boundingBox();
                assert.ok(box.x >= 0 && box.y >= 0);
                assert.ok(box.x + box.width <= (mobile ? 390 : 1440));
                await page.fill('#header-search-input', 'hoodie');
                await page.locator('.header-search button[type=submit]').click();
                await page.waitForURL('**/shop.html?q=hoodie');
            }
            await context.close();
        }
        const page = await browser.newPage();
        for (const name of ['login', 'register']) {
            await page.goto(`http://localhost:3000/${name}.html`);
            assert.equal(await page.locator('.auth-submit').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(233, 107, 58)');
        }
        console.log('Passed: native search opens and submits without JavaScript on the affected server, desktop/mobile, four pages; auth buttons use the store accent.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
