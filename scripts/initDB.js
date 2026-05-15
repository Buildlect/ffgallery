const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function initDB() {
    // Create connection without database specified
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS
    });

    try {
        console.log('Connecting to MySQL...');
        
        // Create database if not exists
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
        console.log(`Database '${process.env.DB_NAME}' ensured.`);

        // Switch to the database
        await connection.query(`USE \`${process.env.DB_NAME}\``);

        // Read schema file
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Split by semicolon to run multiple queries
        // Note: This is a simple split, won't handle semicolons inside strings
        const queries = schema.split(';').filter(q => q.trim() !== '');

        for (let query of queries) {
            await connection.query(query);
        }

        console.log('Schema applied successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Initialization error:', error.message);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

initDB();
