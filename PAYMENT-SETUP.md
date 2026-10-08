# Card checkout

Customers can use Buy Now or the cart without signing in. Login and registration remain optional. Selecting Visa / Mastercard and submitting Place Order creates the order, then opens `card-payment.html`. Paymob Pixel renders the card fields and pay button. Card data is never sent to the store's order API.

Configure these server environment variables in `.env.local` or the deployment settings:

- `PAYMOB_SECRET_KEY`
- `PAYMOB_PUBLIC_KEY`
- `PAYMOB_HMAC_SECRET`
- `PAYMOB_CARD_INTEGRATION_ID`
- `STORE_URL` (the public HTTPS origin)

Use matching test credentials for verification before enabling live payments. No live payment was performed during development.

Before activation, the checkout button opens `card-payment.html?preview=1` with a clearly labeled, non-interactive preview. It shows sample card fields and the cart total, without creating an order, loading Paymob, collecting card details, or clearing the cart. Once the server reports card payments configured, checkout automatically uses the real payment flow instead. Governorate options display names only; shipping charges remain in the order summary.

## Disable instant refund

The store page does not add a refund switch or promotional refund copy. Pixel 1.2.7 can still display its own instant-refund option when enabled in the merchant account: its source reads `customization.customization_data.payments.toggles.enable_instant_refund` from Paymob. This is separate from `showSaveCard`, which is disabled in our integration.

Before launch, disable instant refund in the Paymob checkout customization for this account. If that setting is unavailable, ask Paymob support to disable it. This cannot be confirmed or changed without access to the merchant account. Do not hide an enabled payment feature with CSS or modify the SDK internals.

## Verification

Run `npm test` for server order and signed callback checks, and `node tests/guest-card-browser.cjs` for browser flow checks using mocked payment services. The browser test does not charge a card or replace a real Paymob sandbox end-to-end test.

The signed Paymob callback is the source of truth for paid status; SDK completion alone does not confirm an order. Payment session data expires after one hour and is served with `Cache-Control: no-store`.

References: [Paymob Pixel documentation](https://developers.paymob.com/paymob-docs/developers/checkout-experiences/pixel-embedded), [pinned SDK README](https://cdn.jsdelivr.net/npm/paymob-pixel@1.2.7/README.md), [checkout customization](https://developers.paymob.com/paymob-docs/getting-started/new-dashboard).
