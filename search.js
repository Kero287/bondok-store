(() => {
    const triggers = [...document.querySelectorAll('[data-open-search], a[href="shop.html?panel=search"]')];
    if (!triggers.length) return;
    document.body.insertAdjacentHTML('beforeend', '<div class="inline-search" id="store-search" hidden><form action="shop.html" method="get" role="search"><label class="search-label" for="store-search-input">Search products</label><input id="store-search-input" type="search" name="q" placeholder="Search products, brands..." required maxlength="150"><button type="submit">Search</button><button type="button" data-close-inline-search aria-label="Close search">&times;</button></form></div>');
    const panel = document.querySelector('#store-search');
    const input = panel.querySelector('input');
    input.value = new URLSearchParams(location.search).get('q') || '';
    let previousFocus;
    const position = () => {
        if (panel.hidden || !previousFocus) return;
        const rect = previousFocus.getBoundingClientRect();
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop || 0;
        const bottom = top + (viewport?.height || innerHeight);
        const left = Math.max(12, Math.min(rect.left, innerWidth - panel.offsetWidth - 12));
        // The mobile actions sit at the bottom, so place the field just above them.
        const y = rect.bottom + panel.offsetHeight + 12 <= bottom ? rect.bottom + 8 : Math.max(top + 12, Math.min(rect.top - panel.offsetHeight - 8, bottom - panel.offsetHeight - 12));
        panel.style.left = `${left}px`;
        panel.style.top = `${y}px`;
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
    };
    const close = () => {
        panel.hidden = true;
        triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
        previousFocus?.focus();
    };
    const open = trigger => {
        previousFocus = trigger;
        panel.hidden = false;
        triggers.forEach(button => button.setAttribute('aria-expanded', 'true'));
        position();
        input.focus({ preventScroll: true });
    };
    triggers.forEach(trigger => {
        trigger.setAttribute('aria-controls', 'store-search');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', event => {
            event.preventDefault();
            if (panel.hidden) open(trigger); else close();
        });
    });
    panel.querySelector('[data-close-inline-search]').addEventListener('click', close);
    panel.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    document.addEventListener('click', event => {
        if (!panel.hidden && !panel.contains(event.target) && !triggers.some(trigger => trigger.contains(event.target))) {
            panel.hidden = true;
            triggers.forEach(trigger => trigger.setAttribute('aria-expanded', 'false'));
        }
    });
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, { passive: true });
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    if (new URLSearchParams(location.search).get('panel') === 'search') open(triggers[0]);
})();
