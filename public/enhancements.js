(() => {
    const root = document.documentElement;
    const controls = document.createElement('div'); controls.className = 'site-preferences';
    controls.innerHTML = '<button type="button" data-theme-toggle aria-label="Toggle dark mode">☾</button><button type="button" data-language-toggle>العربية</button>';
    const authContent = document.querySelector('.auth-form-content');
    const navbar = document.querySelector('.navbar');
    const mobileMenu = navbar?.querySelector('.nav-links');
    const isLoginOrRegister = ['login', 'register'].includes(document.body.dataset.authPage);
    const mobileViewport = matchMedia('(max-width: 850px)');
    function placeControls() {
        if (isLoginOrRegister) return;
        if (mobileViewport.matches && mobileMenu) mobileMenu.append(controls);
        else if (authContent) authContent.prepend(controls);
        else (navbar || document.querySelector('header') || document.body).append(controls);
    }
    placeControls();
    mobileViewport.addEventListener('change', placeControls);
    const themeButton = controls.querySelector('[data-theme-toggle]');
    const languageButton = controls.querySelector('[data-language-toggle]');
    function updateControls() {
        document.querySelectorAll('.brand-image img, .auth-brand img, .logo img').forEach(image => {
            image.src = root.dataset.theme === 'dark' ? 'images/logodark.jpeg' : 'images/logo.png';
        });
        themeButton.textContent = root.dataset.theme === 'dark' ? '☀' : '☾';
        themeButton.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
        languageButton.textContent = root.lang === 'ar' ? 'English' : 'العربية';
        languageButton.lang = root.lang === 'ar' ? 'en' : 'ar';
    }
    themeButton.addEventListener('click', () => {
        root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem('bondok-theme', root.dataset.theme); } catch {}
        updateControls();
    });
    languageButton.addEventListener('click', () => {
        root.lang = root.lang === 'ar' ? 'en' : 'ar'; root.dir = root.lang === 'ar' ? 'rtl' : 'ltr';
        try { localStorage.setItem('bondok-language', root.lang); } catch {}
        window.bondokApplyLanguage(); updateControls();
    });
    updateControls();
    document.querySelectorAll('.cover, body:not([data-auth-page="login"]):not([data-auth-page="register"]) .auth-visual').forEach(container => {
        container.classList.add('has-slideshow');
        const stage = document.createElement('div'); stage.className = 'cover-slides'; stage.setAttribute('aria-hidden', 'true');
        const track = document.createElement('div'); track.className = 'cover-track';
        for (let index = 1; index <= 3; index++) {
            const image = document.createElement('img'); image.src = `images/cover${index}.jpeg`; image.alt = '';
            image.className = index === 1 ? 'is-active' : ''; track.append(image);
        }
        const clone = track.firstElementChild.cloneNode(true); clone.className = ''; track.append(clone);
        stage.append(track);
        container.prepend(stage);
        const oldPhoto = container.querySelector('.auth-cover'); if (oldPhoto) oldPhoto.hidden = true;
        const navigation = document.createElement('div'); navigation.className = 'slide-controls';
        let active = 0;
        const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        const display = index => {
            active = index % 3;
            track.style.transform = `translateX(-${index * 100}%)`;
            [...track.children].forEach((image, i) => image.classList.toggle('is-active', i === active));
            navigation.querySelectorAll('[data-slide]').forEach((button, i) => button.setAttribute('aria-pressed', String(i === active)));
        };
        track.addEventListener('transitionend', event => {
            if (event.target !== track || active !== 0) return;
            track.style.transition = 'none';
            track.style.transform = 'translateX(0)';
            void track.offsetWidth;
            track.style.transition = '';
        });
        for (let i = 0; i < 3; i++) {
            const button = document.createElement('button'); button.type = 'button'; button.dataset.slide = i;
            button.setAttribute('aria-label', `Cover ${i + 1}`); button.addEventListener('click', () => display(i)); navigation.append(button);
        }
        container.append(navigation); display(0);
        setInterval(() => {
            if (!document.hidden && !reducedMotion.matches) display(active + 1);
        }, 5000);
    });
})();
