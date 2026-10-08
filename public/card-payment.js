(() => {
    const arabic = document.documentElement.lang === 'ar';
    const copy = {
        total: 'المبلغ الإجمالي', shipping: 'شامل الشحن', secure: 'دفع آمن',
        back: 'العودة لإتمام الطلب', checkout: 'إتمام الدفع', method: 'طريقة الدفع',
        loading: 'جاري تحميل بيانات الدفع الآمن…', retry: 'حاول مرة أخرى',
        privacy: 'تتم معالجة بيانات بطاقتك بأمان بواسطة Paymob.'
    };
    if (arabic) document.querySelectorAll('[data-copy]').forEach(el => { el.textContent = copy[el.dataset.copy]; });
    const loading = document.querySelector('#card-loading');
    const retry = document.querySelector('#card-retry');
    retry.addEventListener('click', () => location.reload());
    if (new URLSearchParams(location.search).get('preview') === '1') {
        let preview;
        try { preview = JSON.parse(sessionStorage.getItem('bondok-card-preview') || 'null'); } catch {}
        loading.hidden = true;
        document.querySelector('#card-back').href = preview?.buyNow ? 'checkout.html?mode=buy-now' : 'checkout.html';
        document.querySelector('#card-heading').textContent = arabic ? 'معاينة الدفع بالبطاقة' : 'Card payment preview';
        document.querySelector('#card-order').textContent = arabic ? 'معاينة فقط — لم يتم إنشاء طلب' : 'Preview only — no order created';
        if (Number.isFinite(preview?.total)) document.querySelector('#card-total').textContent = new Intl.NumberFormat(arabic ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(preview.total);
        document.querySelector('.card-payment-trust').hidden = true;
        document.querySelector('.card-payment-footnote').textContent = arabic ? 'بيانات تجريبية للعرض فقط. الدفع وإدخال بيانات البطاقة الحقيقية متاحان بعد تفعيل Paymob.' : 'Sample details for preview only. Real card entry and payment will be available after Paymob activation.';
        const fields = document.querySelector('#paymob-card-fields');
        fields.innerHTML = `<div class="card-preview-notice" role="status">${arabic ? 'وضع المعاينة — لا يتم خصم أي مبالغ أو حفظ بيانات بطاقات.' : 'Preview mode — no charges or card data saved.'}</div>
            <fieldset class="card-preview-fields" disabled>
                <legend>${arabic ? 'بيانات البطاقة (مثال)' : 'Card information (sample)'}</legend>
                <label>${arabic ? 'رقم البطاقة' : 'Card number'}<input value="4242 4242 4242 4242" type="text" dir="ltr"></label>
                <div><label>${arabic ? 'تاريخ الانتهاء' : 'Expiry date'}<input value="12/30" type="text" dir="ltr"></label><label>CVV<input value="123" type="password" dir="ltr"></label></div>
                <label>${arabic ? 'اسم حامل البطاقة' : 'Cardholder name'}<input value="SAMPLE CUSTOMER" type="text" dir="ltr"></label>
                <button type="button">${arabic ? 'الدفع متاح بعد التفعيل' : 'Payment available after activation'}</button>
            </fieldset>`;
        return;
    }
    function loadPixel() {
        return new Promise((resolve, reject) => {
            if (window.Pixel) return resolve();
            const script = document.createElement('script');
            script.type = 'module';
            script.src = 'https://cdn.jsdelivr.net/npm/paymob-pixel@1.2.7/main.js';
            const timeout = setTimeout(() => reject(new Error(arabic ? 'تعذر تحميل صفحة الدفع. حاول مرة أخرى.' : 'Secure payment could not load. Please try again.')), 15000);
            script.onload = () => { clearTimeout(timeout); window.Pixel ? resolve() : reject(new Error('Secure card fields are unavailable. Please try again.')); };
            script.onerror = () => { clearTimeout(timeout); reject(new Error(arabic ? 'تعذر الاتصال بخدمة الدفع. حاول مرة أخرى.' : 'Could not connect to the payment service. Please try again.')); };
            document.head.append(script);
        });
    }
    (async () => {
        try {
            let pending;
            try { pending = JSON.parse(sessionStorage.getItem('bondok-pending-card') || 'null'); } catch {}
            if (!pending?.key) throw new Error(arabic ? 'ابدأ طلبك من صفحة إتمام الطلب أولاً.' : 'Please place your order from checkout first.');
            document.querySelector('#card-back').href = pending.buyNow ? 'checkout.html?mode=buy-now' : 'checkout.html';
            const response = await fetch(`/api/card-checkout?key=${encodeURIComponent(pending.key)}`, { cache: 'no-store' });
            const session = await response.json();
            if (!response.ok) throw new Error(session.error || 'Unable to load this payment.');
            if (session.paid) { location.replace('checkout.html?payment=return'); return; }
            if (!session.publicKey || !session.clientSecret) throw new Error('Payment is not ready. Please try again.');
            document.querySelector('#card-total').textContent = new Intl.NumberFormat(arabic ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(session.total);
            document.querySelector('#card-order').textContent = `${arabic ? 'طلب' : 'Order'} #${session.id}`;
            await loadPixel();
            new window.Pixel({
                publicKey: session.publicKey, clientSecret: session.clientSecret,
                paymentMethods: ['card'], elementId: 'paymob-card-fields',
                showSaveCard: false, forceSaveCard: false, disablePay: false,
                afterPaymentComplete: () => { location.assign('checkout.html?payment=return'); },
                customStyle: {
                    Font_Family: 'Arial', Font_Size_Label: '16', Font_Size_Input_Fields: '16',
                    Font_Size_Payment_Button: '16', Font_Weight_Payment_Button: 600,
                    Color_Container: '#FFFFFF', Color_Input_Fields: '#FFFFFF',
                    Color_Border_Input_Fields: '#D0D5DD', Radius_Border: '10',
                    Color_Primary: '#315CFF', Color_Disabled: '#A1B8FF', Color_Error: '#B42318',
                    Text_Color_For_Label: '#344054', Text_Color_For_Input_Fields: '#101828',
                    Text_Color_For_Payment_Button: '#FFFFFF', Color_For_Text_Placeholder: '#667085',
                    Width_of_Container: '100%', Container_Padding: '0', Vertical_Spacing_between_components: '20',
                    Direction: arabic ? 'rtl' : 'ltr',
                    ...(arabic ? {
                        Label_Text: { cardLabel: 'بيانات البطاقة' },
                        Placeholder_Text: { holderName: 'اسم حامل البطاقة', cardNumber: 'رقم البطاقة', expiryDate: 'شهر / سنة', securityCode: 'CVV' },
                        Button_Text: { payBtn: 'ادفع' }
                    } : {})
                }
            });
            loading.hidden = true;
        } catch (error) {
            loading.hidden = true;
            const message = document.querySelector('#card-error');
            message.textContent = error.message; message.hidden = false;
            retry.hidden = false;
        }
    })();
})();
