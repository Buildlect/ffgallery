const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
require('dotenv').config();

async function createAdmin(username, password) {
    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.execute(
            "INSERT INTO admin_users (username, password_hash, is_active) VALUES (?, ?, TRUE)",
            [username, hash]
        );
        console.log(`Admin user '${username}' created successfully!`);
        process.exit(0);
    } catch (error) {
        console.error('Error creating admin:', error.message);
        process.exit(1);
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: node createAdmin.js <username> <password>');
    process.exit(1);
}

createAdmin(args[0], args[1]);
