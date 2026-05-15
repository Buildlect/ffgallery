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

        const [orders] = await pool.execute(`
            SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC
        `, [req.session.user.id]);
        
        res.render('user/dashboard', { user: req.session.user, favorites, orders });
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

// Cart Page
router.get('/cart', isUser, async (req, res) => {
    const cart = req.session.cart || [];
    let cartProducts = [];
    let total = 0;

    if (cart.length > 0) {
        const productIds = cart.map(item => item.id);
        const [products] = await pool.query("SELECT * FROM products WHERE id IN (?)", [productIds]);
        
        cartProducts = products.map(p => {
            const cartItem = cart.find(item => item.id == p.id);
            const subtotal = p.price * cartItem.quantity;
            total += subtotal;
            return { ...p, quantity: cartItem.quantity, subtotal };
        });
    }

    res.render('user/cart', { cartProducts, total });
});

// Add to Cart (AJAX)
router.post('/api/cart/add', isUser, (req, res) => {
    const { product_id, quantity = 1 } = req.body;
    let cart = req.session.cart || [];
    
    const existingIndex = cart.findIndex(item => item.id == product_id);
    if (existingIndex > -1) {
        cart[existingIndex].quantity += parseInt(quantity);
    } else {
        cart.push({ id: product_id, quantity: parseInt(quantity) });
    }
    
    req.session.cart = cart;
    res.json({ success: true, cartCount: cart.length });
});

// Remove from Cart
router.post('/cart/remove', isUser, (req, res) => {
    const { product_id } = req.body;
    let cart = req.session.cart || [];
    req.session.cart = cart.filter(item => item.id != product_id);
    res.redirect('/cart');
});

// Checkout Page
router.get('/checkout', isUser, (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/buy');
    res.render('user/checkout', { user: req.session.user });
});

// Place Order
router.post('/place-order', isUser, async (req, res) => {
    const { shipping_address, phone_number } = req.body;
    const cart = req.session.cart || [];
    
    if (cart.length === 0) return res.redirect('/buy');
    
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        
        // Calculate total
        const productIds = cart.map(item => item.id);
        const [products] = await connection.query("SELECT id, price FROM products WHERE id IN (?)", [productIds]);
        
        let total = 0;
        const itemsToInsert = [];
        
        for (const item of cart) {
            const product = products.find(p => p.id == item.id);
            if (product) {
                total += product.price * item.quantity;
                itemsToInsert.push([product.id, item.quantity, product.price]);
            }
        }
        
        // Create order
        const [orderResult] = await connection.execute(
            "INSERT INTO orders (user_id, total_amount, shipping_address, phone_number) VALUES (?, ?, ?, ?)",
            [req.session.user.id, total, shipping_address, phone_number]
        );
        const orderId = orderResult.insertId;
        
        // Create order items
        for (const item of itemsToInsert) {
            await connection.execute(
                "INSERT INTO order_items (order_id, product_id, quantity, price_at_time) VALUES (?, ?, ?, ?)",
                [orderId, item[0], item[1], item[2]]
            );
        }
        
        await connection.commit();
        req.session.cart = []; // Clear cart
        res.redirect('/dashboard?message=' + encodeURIComponent('Order placed successfully!'));
    } catch (error) {
        await connection.rollback();
        console.error('Order error:', error);
        res.redirect('/checkout?error=Order failed');
    } finally {
        connection.release();
    }
});

// Logout
router.get('/logout', (req, res) => {
    delete req.session.user;
    res.redirect('/login');
});

module.exports = router;
