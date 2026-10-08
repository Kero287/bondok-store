if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env.local first.");
}
if (!process.env.ADMIN_EMAIL || (process.env.ADMIN_PASSWORD || "").length < 12) {
    throw new Error("Set ADMIN_EMAIL and a new ADMIN_PASSWORD of at least 12 characters.");
}
const { initializeDatabase, database, hashPassword } = require("../server");

(async () => {
    const usersTable = await database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    if (usersTable) {
        const otherAdmins = await database.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND email != ?").get(process.env.ADMIN_EMAIL);
        if (otherAdmins.count) throw new Error("Use the existing admin email for ADMIN_EMAIL so its old password is replaced before deployment.");
    }
    await initializeDatabase();
    const admin = await database.prepare("SELECT id, role FROM users WHERE email = ?").get(process.env.ADMIN_EMAIL);
    if (admin.role !== "admin") throw new Error("The selected email belongs to a customer. Choose an admin email.");
    await database.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(process.env.ADMIN_PASSWORD), admin.id);
    await database.prepare("DELETE FROM sessions WHERE user_id = ?").run(admin.id);
    console.log("Cloud database initialized and admin password updated.");
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => database.close());
