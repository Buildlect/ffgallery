const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { isUser } = require('../middleware/auth');

// Registration Page
router.get('/register', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('user/register', { error: null });
});

// Handle Registration
router.post('/register', async (req, res) => {
    const { full_name, email, password, phone } = req.body;
    try {
        const password_hash = await bcrypt.hash(password, 10);
        await pool.execute(
            "INSERT INTO users (full_name, email, password_hash, phone) VALUES (?, ?, ?, ?)",
            [full_name, email, password_hash, phone || '']
        );
        res.redirect('/login?message=' + encodeURIComponent('Account created! Please login.'));
    } catch (error) {
        console.error('Registration error:', error);
        res.render('user/register', { error: error.code === 'ER_DUP_ENTRY' ? 'Email already exists' : 'Registration failed' });
    }
});

// Login Page
router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render('user/login', { error: null, message: req.query.message || null });
});

// Handle Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [email]);
        const user = rows[0];
        
        if (user && await bcrypt.compare(password, user.password_hash)) {
            req.session.user = {
                id: user.id,
                full_name: user.full_name,
                email: user.email
            };
            res.redirect('/dashboard');
        } else {
            res.render('user/login', { error: 'Invalid email or password', message: null });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.render('user/login', { error: 'Database connection failed', message: null });
    }
});

// User Dashboard
router.get('/dashboard', isUser, async (req, res) => {
    try {
        const [favorites] = await pool.execute(`
            SELECT p.* FROM products p
            JOIN favorites f ON p.id = f.product_id
            WHERE f.user_id = ? AND p.status = 'active'
        `, [req.session.user.id]);
        
        res.render('user/dashboard', { user: req.session.user, favorites });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Server error');
    }
});

// Toggle Favorite (AJAX)
router.post('/api/favorites/toggle', isUser, async (req, res) => {
    const { product_id } = req.body;
    try {
        const [existing] = await pool.execute(
            "SELECT id FROM favorites WHERE user_id = ? AND product_id = ?",
            [req.session.user.id, product_id]
        );
        
        if (existing.length > 0) {
            await pool.execute("DELETE FROM favorites WHERE id = ?", [existing[0].id]);
            res.json({ success: true, action: 'removed' });
        } else {
            await pool.execute(
                "INSERT INTO favorites (user_id, product_id) VALUES (?, ?)",
                [req.session.user.id, product_id]
            );
            res.json({ success: true, action: 'added' });
        }
    } catch (error) {
        console.error('Favorite toggle error:', error);
        res.status(500).json({ success: false });
    }
});

// Logout
router.get('/logout', (req, res) => {
    delete req.session.user;
    res.redirect('/login');
});

module.exports = router;
