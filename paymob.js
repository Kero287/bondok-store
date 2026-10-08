const { createHmac, timingSafeEqual } = require('node:crypto');

function configured(env = process.env) {
    return !!(env.PAYMOB_SECRET_KEY && env.PAYMOB_PUBLIC_KEY && env.PAYMOB_HMAC_SECRET &&
        /^[1-9]\d*$/.test(env.PAYMOB_CARD_INTEGRATION_ID || '') && /^https:\/\/[^\s]+$/.test(env.STORE_URL || ''));
}

async function createCheckout(order, env = process.env, request = fetch) {
    if (!configured(env)) throw new Error('Card payments are not configured.');
    const origin = new URL(env.STORE_URL).origin;
    const names = order.name.trim().split(/\s+/);
    const response = await request('https://accept.paymob.com/v1/intention/', {
        method: 'POST', headers: { Authorization: `Token ${env.PAYMOB_SECRET_KEY}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
            amount: Math.round(order.total * 100), currency: 'EGP',
            payment_methods: [Number(env.PAYMOB_CARD_INTEGRATION_ID)],
            special_reference: `bondok-${order.id}`, expiration: 3600,
            billing_data: { first_name: names[0], last_name: names.slice(1).join(' ') || names[0],
                email: order.customer_email, phone_number: order.phone, street: order.address,
                city: order.governorate, state: order.governorate, country: 'EGY', building: 'NA', floor: 'NA', apartment: 'NA' },
            notification_url: `${origin}/api/paymob/callback`,
            redirection_url: `${origin}/checkout.html?payment=return`
        })
    });
    if (!response.ok) throw new Error('Paymob checkout could not be started.');
    const result = await response.json();
    if (!result.client_secret || !result.intention_order_id) throw new Error('Paymob returned an incomplete checkout.');
    const url = new URL('https://accept.paymob.com/unifiedcheckout/');
    url.searchParams.set('publicKey', env.PAYMOB_PUBLIC_KEY);
    url.searchParams.set('clientSecret', result.client_secret);
    return { url: url.href, reference: String(result.intention_order_id) };
}

function verifyCallback(obj, signature, secret) {
    if (!secret || !obj || !/^[a-f0-9]{128}$/i.test(signature || '')) return false;
    const fields = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction',
        'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded',
        'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
        'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success'];
    const values = fields.map(field => field.split('.').reduce((value, key) => value?.[key], obj));
    if (values.some(value => value === undefined || value === null)) return false;
    const expected = createHmac('sha512', secret).update(values.map(String).join('')).digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

module.exports = { configured, createCheckout, verifyCallback };
