const { randomInt, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const nodemailer = require('nodemailer');
const digest = value => createHash('sha256').update(value).digest('hex');
const normalizeEmail = value => String(value || '').trim().toLowerCase();

function createRecovery(database, { sendMail, configured } = {}) {
    const ready = () => configured ? configured() : Boolean(process.env.SMTP_PASSWORD);
    const deliver = sendMail || (message => nodemailer.createTransport({
        service: 'gmail', auth: { user: 'maromagdy433@gmail.com', pass: process.env.SMTP_PASSWORD },
        connectionTimeout: 10000, socketTimeout: 15000
    }).sendMail(message));
    let schema;
    // Promise wrapper supports both synchronous SQLite and asynchronous Turso.
    async function ensure() {
        if (!schema) schema = Promise.resolve().then(() => database.exec(`CREATE TABLE IF NOT EXISTS recovery_codes (
            email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, salt TEXT NOT NULL,
            expires INTEGER NOT NULL, resend_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0
        )`)).catch(error => { schema = null; throw error; });
        await schema;
    }
    return {
        async request(emailInput) {
            const email = normalizeEmail(emailInput);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return [400, { error: 'Enter a valid email address.' }];
            if (!ready()) return [503, { error: 'Email recovery is not configured yet. Please contact the store.' }];
            await ensure();
            const time = Date.now();
            const code = String(randomInt(100000, 1000000));
            const salt = randomBytes(24).toString('hex');
            const result = await database.prepare(`INSERT INTO recovery_codes (email, code_hash, salt, expires, resend_at, attempts, used)
                VALUES (?, ?, ?, ?, ?, 0, 0) ON CONFLICT(email) DO UPDATE SET
                code_hash=excluded.code_hash, salt=excluded.salt, expires=excluded.expires,
                resend_at=excluded.resend_at, attempts=0, used=0 WHERE recovery_codes.resend_at <= ?`)
                .run(email, digest(salt + code), salt, time + 600000, time + 60000, time);
            if (Number(result.changes ?? result.rowsAffected) === 0) return [429, { error: 'Please wait one minute before requesting another code.' }];
            const user = await database.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (user) {
                try {
                    await deliver({ from: { name: 'Bondok Store', address: 'maromagdy433@gmail.com' }, to: email,
                        subject: 'Bondok Store — Password reset code',
                        text: `Bondok Store\n\nYour password reset code is: ${code}\nThis code expires in 10 minutes. Do not share it.\nIf you did not request this, ignore this email.\n\nرمز استعادة كلمة المرور: ${code}\nالرمز صالح لمدة 10 دقائق. لا تشاركه مع أحد.` });
                } catch {
                    await database.prepare('UPDATE recovery_codes SET used = 1 WHERE email = ? AND salt = ?').run(email, salt);
                    return [503, { error: 'Unable to send the email. Please try again later.' }];
                }
            }
            return [200, { message: 'If this email is registered, a code has been sent.', expiresAt: time + 600000, resendAt: time + 60000 }];
        },
        async reset(body, hashPassword) {
            await ensure();
            const email = normalizeEmail(body.email);
            if (!/^\d{6}$/.test(String(body.code || '')) || String(body.password || '').length < 8 || String(body.password).length > 128)
                return [400, { error: 'Enter a six-digit code and a password of 8–128 characters.' }];
            const row = await database.prepare('SELECT * FROM recovery_codes WHERE email = ?').get(email);
            const failure = [400, { error: 'This code is invalid or expired. Request a new code.' }];
            if (!row || row.used || row.expires <= Date.now() || row.attempts >= 5) return failure;
            const attempt = await database.prepare('UPDATE recovery_codes SET attempts = attempts + 1 WHERE email = ? AND salt = ? AND used = 0 AND attempts < 5 AND expires > ?').run(email, row.salt, Date.now());
            if (!Number(attempt.changes ?? attempt.rowsAffected)) return failure;
            if (!timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(digest(row.salt + body.code), 'hex'))) return failure;
            const user = await database.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (!user) return failure;
            const claimed = await database.prepare('UPDATE recovery_codes SET used = 1 WHERE email = ? AND salt = ? AND used = 0 AND expires > ?').run(email, row.salt, Date.now());
            if (!Number(claimed.changes ?? claimed.rowsAffected)) return failure;
            await database.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), user.id);
            await database.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
            return [200, { message: 'Password reset successfully. You can log in now.' }];
        }
    };
}
module.exports = { createRecovery };
