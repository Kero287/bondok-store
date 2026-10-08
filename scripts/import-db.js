const { DatabaseSync } = require("node:sqlite");
const { resolve } = require("node:path");
const { openDatabase } = require("../database");

// Copy into an EMPTY remote database. The local file is always read-only.
async function importDatabase(source, client) {
    const tables = ["users", "products", "orders"];
    const quote = name => '"' + name.replaceAll('"', '""') + '"';
    const tx = await client.transaction("write");
    try {
        const existing = await tx.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
        if (existing.rows.length) throw new Error("The destination is not empty. Import into a new empty database before running db:setup.");
        // Keep schema compatibility, but do not copy login sessions or reset tokens.
        const schema = source.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        if (schema.some(table => table.name === "product_media")) tables.push("product_media");
        for (const table of schema) await tx.execute(table.sql);
        const counts = {};
        for (const table of tables) {
            const rows = source.prepare(`SELECT * FROM ${quote(table)}`).all();
            for (const row of rows) {
                const columns = Object.keys(row);
                await tx.execute({
                    sql: `INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
                    args: columns.map(column => row[column])
                });
            }
            counts[table] = rows.length;
            const result = await tx.execute(`SELECT COUNT(*) AS count FROM ${quote(table)}`);
            if (Number(result.rows[0].count) !== rows.length) throw new Error(`Count mismatch: ${table}`);
        }
        await tx.commit();
        return counts;
    } catch (error) {
        await tx.rollback();
        throw error;
    } finally { tx.close(); }
}

if (require.main === module) {
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) throw new Error("Set Turso credentials in .env.local first.");
    const source = new DatabaseSync(resolve(process.argv[2] || "bondok.sqlite"), { readOnly: true });
    const target = openDatabase();
    importDatabase(source, target.client)
        .then(counts => console.log("Imported records:", counts, "Run npm run db:setup next."))
        .catch(error => { console.error(error.message); process.exitCode = 1; })
        .finally(() => { source.close(); target.close(); });
}
module.exports = { importDatabase };
