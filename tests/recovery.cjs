const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createRecovery } = require('../password-recovery');

(async () => {
    for (const remote of [false, true]) {
        const sqlite = new DatabaseSync(':memory:');
        sqlite.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, password_hash TEXT); CREATE TABLE sessions (token TEXT, user_id INTEGER); INSERT INTO users VALUES (1, 'customer@example.test', 'old'); INSERT INTO sessions VALUES ('active', 1)");
        const database = remote ? {
            exec: async sql => sqlite.exec(sql),
            prepare: sql => Object.fromEntries(['get', 'run'].map(method => [method, async (...args) => sqlite.prepare(sql)[method](...args)]))
        } : sqlite;
        const messages = [];
        const recovery = createRecovery(database, { configured: () => true, sendMail: async mail => messages.push(mail) });
        let [status, result] = await recovery.request('customer@example.test');
        assert.equal(status, 200); assert.equal(result.resetToken, undefined);
        assert.equal(messages[0].from.name, 'Bondok Store');
        assert.equal(messages[0].from.address, 'maromagdy433@gmail.com');
        const code = messages[0].text.match(/code is: (\d{6})/)[1];
        assert.equal((await recovery.request('customer@example.test'))[0], 429);
        assert.equal((await recovery.reset({ email:'customer@example.test', code:'000000', password:'new-password' }, p => p))[0], 400);
        assert.equal((await recovery.reset({ email:'customer@example.test', code, password:'new-password' }, p => 'hashed:' + p))[0], 200);
        assert.equal(sqlite.prepare('SELECT password_hash FROM users').get().password_hash, 'hashed:new-password');
        assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
        assert.equal((await recovery.reset({ email:'customer@example.test', code, password:'different' }, p => p))[0], 400);
        sqlite.exec('UPDATE recovery_codes SET resend_at = 0');
        await recovery.request('customer@example.test');
        const next = messages[1].text.match(/code is: (\d{6})/)[1];
        for (let i=0;i<5;i++) await recovery.reset({ email:'customer@example.test', code:'000000', password:'password2' }, p => p);
        assert.equal((await recovery.reset({ email:'customer@example.test', code:next, password:'password2' }, p => p))[0],400);
        sqlite.exec('UPDATE recovery_codes SET resend_at = 0');
        await recovery.request('customer@example.test');
        sqlite.exec('UPDATE recovery_codes SET expires = 0');
        assert.equal((await recovery.reset({ email:'customer@example.test', code:messages[2].text.match(/code is: (\d{6})/)[1], password:'password2' }, p => p))[0],400);
        assert.equal((await recovery.request('missing@example.test'))[0],200);
        assert.equal(messages.length,3);
        const unavailable = createRecovery(database, { configured: () => false });
        assert.equal((await unavailable.request('customer@example.test'))[0],503);
        sqlite.close();
    }
    console.log('Passed: local and async OTP delivery contract, cooldown, reset, session revocation, replay rejection, five-attempt limit, expiry, unknown account privacy, missing configuration. No real emails sent.');
})().catch(error => { console.error(error); process.exitCode=1; });
