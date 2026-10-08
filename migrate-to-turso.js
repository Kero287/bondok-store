const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createClient } = require("@libsql/client");

function loadEnv(filePath) {
    const env = {};

    const content = fs.readFileSync(filePath, "utf8");

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith("#")) continue;

        const index = line.indexOf("=");
        if (index === -1) continue;

        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    }

    return env;
}

async function main() {
    const env = loadEnv(path.join(__dirname, ".env.local"));

    if (!env.TURSO_DATABASE_URL) {
        throw new Error("TURSO_DATABASE_URL is missing.");
    }

    if (!env.TURSO_AUTH_TOKEN) {
        throw new Error("TURSO_AUTH_TOKEN is missing.");
    }

    console.log("Connecting to Turso...");

    const client = createClient({
        url: env.TURSO_DATABASE_URL,
        authToken: env.TURSO_AUTH_TOKEN,
    });

    const local = new DatabaseSync(path.join(__dirname, "bondok.sqlite"));

    // Check current Turso database
    const existing = await client.execute(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `);

    if (existing.rows.length > 0) {
        console.log("Turso already contains tables:");
        for (const row of existing.rows) {
            console.log(`- ${row.name}`);
        }

        throw new Error(
            "Migration stopped to prevent duplicate/overwriting data."
        );
    }

    console.log("Turso database is empty.");
    console.log("Creating schema...");

    await client.executeMultiple(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            phone TEXT DEFAULT '',
            address TEXT DEFAULT '',
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer'
                CHECK (role IN ('customer', 'admin')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price INTEGER NOT NULL CHECK (price >= 0),
            stock INTEGER NOT NULL CHECK (stock >= 0),
            category TEXT NOT NULL,
            image TEXT NOT NULL,
            created_at TEXT NOT NULL,
            brand TEXT NOT NULL DEFAULT 'Other'
        );

        CREATE TABLE sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL
        );

        CREATE TABLE password_resets (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            payment TEXT NOT NULL,
            items_json TEXT NOT NULL,
            total INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            payment_status TEXT NOT NULL DEFAULT 'pending',
            payment_reference TEXT DEFAULT '',
            delivery_date TEXT DEFAULT '',
            delivery_time TEXT DEFAULT '',
            payment_screenshot TEXT DEFAULT '',
            deposit_amount INTEGER NOT NULL DEFAULT 0,
            remaining_amount INTEGER NOT NULL DEFAULT 0,
            payment_reviewed_at TEXT DEFAULT '',
            reviewed_by INTEGER,
            whatsapp_notification_status TEXT NOT NULL DEFAULT 'not_sent',
            payment_reference_code TEXT DEFAULT ''
        );
    `);

    console.log("Schema created.");

    const tables = [
        "users",
        "products",
        "orders",
    ];

    for (const table of tables) {
        const rows = local
            .prepare(`SELECT * FROM ${table}`)
            .all();

        console.log(`Migrating ${table}: ${rows.length} rows...`);

        for (const row of rows) {
            const columns = Object.keys(row);
            const placeholders = columns.map(() => "?").join(", ");

            const sql = `
                INSERT INTO ${table}
                (${columns.join(", ")})
                VALUES (${placeholders})
            `;

            await client.execute({
                sql,
                args: columns.map(column => row[column]),
            });
        }

        console.log(`${table}: done`);
    }

    // password_resets is currently empty, so we intentionally
    // leave it empty.

    // IMPORTANT:
    // Existing sessions are NOT migrated.
    // Users will simply log in again on the production website.
    console.log("sessions: created empty for security.");

    // Verify counts
    console.log("\nVerifying Turso database...");

    for (const table of [
        "users",
        "products",
        "orders",
        "sessions",
        "password_resets",
    ]) {
        const result = await client.execute(
            `SELECT COUNT(*) AS count FROM ${table}`
        );

        console.log(`${table}: ${result.rows[0].count}`);
    }

    local.close();
    client.close();

    console.log("\nMigration completed successfully.");
}

main().catch(error => {
    console.error("\nMigration failed:");
    console.error(error.message);
    process.exit(1);
});