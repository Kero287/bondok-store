const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
    const browser = await chromium.launch({ channel:'chrome', headless:true });
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url().startsWith('http://localhost:3101/') ? route.continue() : route.abort());
    const errors=[]; page.on('pageerror', error => errors.push(error.message));
    try {
        const files = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('admin') && !['verify-otp.html', 'card-payment.html'].includes(f));
        await page.addInitScript(() => { if (location.origin !== 'http://localhost:3101') return; if (!localStorage.getItem('bondok-language')) { localStorage.setItem('bondok-language', 'ar'); localStorage.setItem('bondok-theme', 'dark'); } });
        for (const width of [320, 390, 768, 1440]) {
            await page.setViewportSize({ width, height:900 });
            for (const file of files) {
                await page.goto('http://localhost:3101/' + file);
                await page.waitForTimeout(100);
                const overflow = await page.evaluate(() => ({ width:innerWidth, scroll:document.documentElement.scrollWidth }));
                assert.ok(overflow.scroll <= overflow.width + 1, `${file} at ${width}: overflow ${overflow.scroll}`);
                assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
                assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
                assert.equal(await page.locator('.footer-column a[href="mailto:maromagdy433@gmail.com"]').count(), 1);
            }
        }
        await page.goto('http://localhost:3101/index.html');
        await page.mouse.move(0,0);
        assert.equal(await page.locator('.cover-slides img.is-active').getAttribute('src'),'images/cover1.jpeg');
        await page.waitForTimeout(5100);
        assert.equal(await page.locator('.cover-slides img.is-active').getAttribute('src'),'images/cover2.jpeg');
        await page.click('[data-language-toggle]');
        assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
        assert.equal(await page.locator('.cover h1, .cover-kicker, .slide-pause').count(),0);
        await page.click('[data-theme-toggle]');
        assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
        await page.reload();
        assert.equal(await page.locator('html').getAttribute('dir'),'ltr');
        assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
        for (const file of files) {
            await page.setViewportSize({width:320,height:700});
            await page.goto('http://localhost:3101/'+file);
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),file+' English mobile');
        }
        await page.goto('http://localhost:3101/product.html?id=1');
        await page.locator('#purchase-form').waitFor();
        await page.selectOption('#product-size',{index:1});
        await page.click('[name=action][value=cart]');
        await page.goto('http://localhost:3101/checkout.html');
        await page.locator('#checkout-items .checkout-item').waitFor();
        await page.click('[data-toggle-menu]');
        await page.click('[data-language-toggle]');
        await page.click('[data-theme-toggle]');
        await page.selectOption('[name=governorate]',{index:1});
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),'Populated Arabic checkout mobile');
        assert.match(await page.locator('#summary-shipping').innerText(),/ج\.م/);
        await page.route('**/api/auth/forgot-password', route => route.fulfill({ json:{ expiresAt:Date.now()+600000, resendAt:Date.now()+60000, message:'If this email is registered, a code has been sent.' } }));
        await page.goto('http://localhost:3101/forgot-password.html');
        await page.fill('[name=email]','customer@example.test'); await page.click('.auth-submit');
        await page.waitForURL('**/verify-otp.html');
        await page.locator('#recovery-email').waitFor();
        assert.equal(await page.locator('#resend-code').isDisabled(),true);
        assert.match(await page.locator('#otp-countdown').innerText(),/10:00|9:59/);
        await page.route('**/api/auth/reset-password', route => route.fulfill({ json:{message:'Password reset successfully. You can log in now.'} }));
        await page.fill('[name=code]','123456'); await page.fill('[name=password]','new-password'); await page.fill('[name=confirm]','new-password');
        await page.click('.auth-submit'); await page.waitForTimeout(100);
        assert.equal(await page.locator('#recovery-form').isVisible(),false);
        assert.deepEqual(errors,[]);
        console.log('Passed: storefront pages at 320/390/768/1440, RTL/dark mode, canonical footer, ordered autoplay, language/theme switching, OTP navigation/countdown/success.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
