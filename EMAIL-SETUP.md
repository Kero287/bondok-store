# Password recovery email

The sender is `Bondok Store <maromagdy433@gmail.com>`.

1. Enable two-step verification on that Google account and generate a Gmail App Password: https://support.google.com/accounts/answer/185833
2. Set `SMTP_PASSWORD` to that App Password in the server environment (Vercel project environment variables for production; `.env.local` for local development). Never put it in HTML, client JavaScript, or source control.
3. Restart the local server or redeploy after setting the production environment variable.
4. Use a registered test customer's email on `forgot-password.html` to check actual delivery. The automated tests mock email delivery and never send real emails.

The code expires after 10 minutes, can be requested again after 60 seconds, permits five verification attempts, and works once. A successful password reset revokes existing sessions. Codes are hashed in the database and never returned by the API. Existing users and unknown emails receive the same successful request message.

The recovery table is created lazily on SQLite and Turso. The configured database credential must permit creating tables. Until SMTP_PASSWORD is configured, the form displays an explicit unavailable message and does not pretend to send mail.

Gmail setup reference: https://nodemailer.com/guides/using-gmail
