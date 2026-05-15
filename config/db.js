const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true
});

async function initializeDatabase() {
    try {
        console.log('--- Database Setup Started ---');
        
        // 1. Connect without a database to create it if missing
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS
        });

        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
        await connection.end();
        console.log(`- Database '${process.env.DB_NAME}' ensured.`);

        // 2. Check for missing tables
        const [tables] = await pool.query('SHOW TABLES');
        const tableNames = tables.map(t => Object.values(t)[0]);
        const requiredTables = ['products', 'admin_users', 'users', 'favorites', 'orders', 'order_items'];
        const missingTables = requiredTables.filter(t => !tableNames.includes(t));

        if (missingTables.length > 0) {
            console.log(`- Found ${missingTables.length} missing tables: ${missingTables.join(', ')}`);
            const schemaPath = path.join(__dirname, '../scripts/schema.sql');
            if (fs.existsSync(schemaPath)) {
                const schema = fs.readFileSync(schemaPath, 'utf8');
                await pool.query(schema);
                console.log('- Schema applied successfully.');
            }
        } else {
            console.log('- All tables exist.');
        }

        // 3. Ensure admin exists
        const [admins] = await pool.query('SELECT id FROM admin_users LIMIT 1');
        if (admins.length === 0) {
            const bcrypt = require('bcryptjs');
            const hash = await bcrypt.hash('admin123', 10);
            await pool.execute("INSERT INTO admin_users (username, password_hash) VALUES (?, ?)", ['admin', hash]);
            console.log('--------------------------------------------------');
            console.log('DEFAULT ADMIN CREATED:');
            console.log('Username: admin');
            console.log('Password: admin123');
            console.log('--------------------------------------------------');
        }

        console.log('--- Database Ready ---');
        return true;
    } catch (error) {
        console.error('!!! Database Initialization Failed !!!');
        console.error('Error:', error.message);
        console.error('Make sure XAMPP MySQL is running and credentials in .env are correct.');
        return false;
    }
}

module.exports = { pool, initializeDatabase };
