(() => {
    const root = document.documentElement;
    root.dataset.theme = 'dark';
    try {
        root.dataset.theme = localStorage.getItem('bondok-theme') === 'light' ? 'light' : 'dark';
        root.lang = localStorage.getItem('bondok-language') === 'ar' ? 'ar' : 'en';
        root.dir = root.lang === 'ar' ? 'rtl' : 'ltr';
    } catch { /* Storage may be unavailable in private browsing. */ }
})();
