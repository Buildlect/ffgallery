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

// User Dashboard (Updated to include orders)
router.get('/dashboard', isUser, async (req, res) => {
    try {
        const [favorites] = await pool.execute(`
            SELECT p.* FROM products p
            JOIN favorites f ON p.id = f.product_id
            WHERE f.user_id = ? AND p.status = 'active'
        `, [req.session.user.id]);

        const [orders] = await pool.execute(`
            SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC
        `, [req.session.user.id]);
        
        res.render('user/dashboard', { user: req.session.user, favorites, orders });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Server error');
    }
});

// Cart and Checkout Routes
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

router.get('/cart', isUser, (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('user/cart', { cart, total });
});

router.post('/api/cart/add', isUser, (req, res) => {
    const { product_id, name, price, image } = req.body;
    if (!req.session.cart) req.session.cart = [];
    
    const existingIndex = req.session.cart.findIndex(item => String(item.id) === String(product_id));
    if (existingIndex > -1) {
        req.session.cart[existingIndex].quantity += 1;
    } else {
        req.session.cart.push({ 
            id: product_id, 
            name, 
            price: parseFloat(price), 
            image, 
            quantity: 1 
        });
    }
    res.json({ success: true, cartCount: req.session.cart.reduce((a, b) => a + b.quantity, 0) });
});

router.post('/api/cart/update', isUser, (req, res) => {
    const { product_id, quantity } = req.body;
    if (!req.session.cart) return res.json({ success: false });
    
    const index = req.session.cart.findIndex(item => String(item.id) === String(product_id));
    if (index > -1) {
        if (parseInt(quantity) <= 0) {
            req.session.cart.splice(index, 1);
        } else {
            req.session.cart[index].quantity = parseInt(quantity);
        }
    }
    res.json({ success: true, cartCount: req.session.cart.reduce((a, b) => a + b.quantity, 0) });
});

router.post('/checkout', isUser, async (req, res) => {
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.redirect('/buy');
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const { address, payment_method } = req.body;

    try {
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            const [orderResult] = await connection.execute(
                "INSERT INTO orders (user_id, total_amount, shipping_address, payment_method) VALUES (?, ?, ?, ?)",
                [req.session.user.id, total, address, payment_method || 'WhatsApp/Cash']
            );
            const orderId = orderResult.insertId;

            for (const item of cart) {
                await connection.execute(
                    "INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES (?, ?, ?, ?)",
                    [orderId, item.id, item.quantity, item.price]
                );
            }

            await connection.commit();
            req.session.cart = []; 
            res.redirect('/orders/success?id=' + orderId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).send('Checkout failed');
    }
});

router.get('/orders/success', isUser, (req, res) => {
    res.render('user/order-success', { orderId: req.query.id });
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

module.exports = router;
