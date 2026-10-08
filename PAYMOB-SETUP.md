# Paymob Egypt setup

The integration uses [Paymob Intention API](https://developers.paymob.com/paymob-docs/intention-apis/create-intention) and hosted Unified Checkout. Card details go directly to Paymob. Order confirmation depends on an authenticated server callback, never on browser return parameters.

Set these server environment variables locally in `.env.local` and in your hosting project's environment settings:

- `PAYMOB_SECRET_KEY`
- `PAYMOB_PUBLIC_KEY`
- `PAYMOB_HMAC_SECRET`
- `PAYMOB_CARD_INTEGRATION_ID`: the numeric online card integration ID
- `STORE_URL`: the public HTTPS origin of this store

Use matching test keys and integration ID first. The checkout creation request includes the callback URL `STORE_URL/api/paymob/callback` and return URL `STORE_URL/checkout.html?payment=return`. Set the same URLs in the Paymob dashboard if your integration requires dashboard callback configuration. Never put secret keys in HTML or client JavaScript.

Verify a successful test payment, declined payment, and customer cancellation before switching to live credentials and redeploying. Local automated tests mock gateway requests; they do not prove that your merchant account is activated. A checkout request with an uncertain gateway result remains saved for review to avoid charging twice. Expired or uncertain attempts require checking the Paymob dashboard before creating another order.

The order's price, shipping, size, and color are captured server-side before redirecting. Callbacks must match the saved Paymob order ID, amount, EGP currency, integration ID, and HMAC. Duplicate success callbacks cannot confirm the order twice. Refunds and voids require reconciliation in the merchant dashboard; they are not automated by this integration.

COD example: product 500 EGP + shipping 110 EGP = 610 EGP total. Pay 160 EGP upfront (110 shipping + 50 deposit), then 450 EGP on delivery. Card payments collect 610 EGP upfront.
