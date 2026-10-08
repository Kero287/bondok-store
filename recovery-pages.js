(() => {
    const form = document.querySelector('#recovery-form');
    const message = document.querySelector('#recovery-message');
    const verify = document.body.dataset.recoveryPage === 'verify-otp';
    const resend = document.querySelector('#resend-code');
    let state;
    try { state = JSON.parse(sessionStorage.getItem('bondok-recovery') || 'null'); } catch {}
    if (verify && !state?.email) { location.replace('forgot-password.html'); return; }
    const t = text => window.bondokTranslate?.(text) || text;
    const save = data => { state = { ...state, ...data }; sessionStorage.setItem('bondok-recovery', JSON.stringify(state)); };
    const show = text => { message.textContent = text; };
    async function post(path, data) {
        const response = await fetch('/api/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to continue.');
        return result;
    }
    function tick() {
        if (!verify) return;
        const seconds = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));
        const cooldown = Math.max(0, Math.ceil((state.resendAt - Date.now()) / 1000));
        document.querySelector('#otp-countdown').textContent = seconds ? `${t('Code expires in')} ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : t('Code expired. Request a new code.');
        resend.disabled = Boolean(cooldown) || resend.dataset.busy === 'true';
        resend.textContent = t('Resend code') + (cooldown ? ` (${cooldown})` : '');
    }
    if (verify) {
        document.querySelector('#recovery-email').textContent = state.email;
        tick(); setInterval(tick, 1000);
        resend.addEventListener('click', async () => {
            resend.dataset.busy = 'true'; tick(); show('');
            try { save(await post('forgot-password', { email: state.email })); show('If this email is registered, a code has been sent.'); }
            catch (error) { show(error.message); }
            finally { resend.dataset.busy = 'false'; tick(); }
        });
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('[type=submit]');
        if (button.disabled) return;
        const data = Object.fromEntries(new FormData(form));
        if (verify && data.password !== data.confirm) { show('Passwords do not match.'); return; }
        button.disabled = true; show('');
        try {
            if (verify) {
                const result = await post('reset-password', { email: state.email, code: data.code, password: data.password });
                sessionStorage.removeItem('bondok-recovery'); sessionStorage.removeItem('bondok-auth-token');
                form.hidden = true; resend.hidden = true; document.querySelector('#otp-countdown').hidden = true;
                show(result.message);
                const link = document.createElement('a'); link.href = 'login.html'; link.textContent = t('Back to login'); message.append(' ', link);
            } else {
                const result = await post('forgot-password', { email: data.email });
                save({ ...result, email: data.email.trim().toLowerCase() }); location.href = 'verify-otp.html';
            }
        } catch (error) { show(error.message); }
        finally { button.disabled = false; }
    });
})();
