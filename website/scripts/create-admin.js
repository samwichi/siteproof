// Create a website administrator (no company; he approves the companies that register).
//   node scripts/create-admin.js <e-mail> "<full name>" <password>
// Run it on the computer that has config.js (the database address). The password is stored as a bcrypt hash, like all passwords.
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const configs = require('../config');

async function main() {
    const [email, name, password] = process.argv.slice(2);
    if (!email || !name || !password) {
        console.log('Usage: node scripts/create-admin.js <e-mail> "<full name>" <password>');
        process.exit(1);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) { console.log('The e-mail address is not valid.'); process.exit(1); }
    if (name.length > 100) { console.log('The name can have at most 100 characters.'); process.exit(1); }
    if (password.length < 8 || Buffer.byteLength(password) > 72) { console.log('The password needs 8 to 72 characters.'); process.exit(1); }

    const db = await mysql.createConnection(configs.db);
    try {
        await db.execute("INSERT INTO user_account (org_id, full_name, email, password, role) VALUES (NULL, ?, ?, ?, 'ADMIN')",
            [name, email.toLowerCase(), await bcrypt.hash(password, 10)]);
        console.log('Administrator created: ' + email);
    }
    catch (err) {
        console.log(err.errno === 1062 ? 'This e-mail address already has an account.' : 'Error: ' + err.message);
        process.exitCode = 1;
    }
    finally {
        await db.end();
    }
}
main();
