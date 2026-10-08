const { join } = require("node:path");

function openDatabase(env = process.env) {
    if (env.TURSO_DATABASE_URL) {
        if (!env.TURSO_AUTH_TOKEN) throw new Error("TURSO_AUTH_TOKEN is required.");
        const { createClient } = require("@libsql/client/web");
        const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN, intMode: "number" });
        return {
            remote: true,
            prepare(sql) {
                return {
                    async all(...args) { return (await client.execute({ sql, args })).rows; },
                    async get(...args) { return (await client.execute({ sql, args })).rows[0]; },
                    async run(...args) { return client.execute({ sql, args }); }
                };
            },
            exec: sql => client.executeMultiple(sql),
            close: () => client.close(),
            client
        };
    }
    if (env.VERCEL) throw new Error("Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying.");
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(env.DATABASE_PATH || join(__dirname, "bondok.sqlite"));
}

module.exports = { openDatabase };
