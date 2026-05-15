const express = require('express');
const router = express.Router();
const { pool } = require('../config/db');

// Landing Page
router.get('/', async (req, res) => {
    if (!req.session.user) {
        return res.render('landing');
    }

    try {
        const [featuredProducts] = await pool.execute(
            "SELECT * FROM products WHERE is_featured = TRUE AND status = 'active' ORDER BY created_at DESC LIMIT 8"
        );
        
        const [categoriesRows] = await pool.execute(
            "SELECT DISTINCT category FROM products WHERE status = 'active' AND category IS NOT NULL ORDER BY category"
        );
        const categories = categoriesRows.map(row => row.category);
        
        res.render('index', { featuredProducts, categories });
    } catch (error) {
        console.error('Database error:', error);
        res.render('index', { featuredProducts: [], categories: [], db_error: true });
    }
});

// All Products Page
router.get('/buy', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login?message=' + encodeURIComponent('Please login to view products'));
    }

    try {
        const search = req.query.search || '';
        const categoryFilter = req.query.category || '';
        
        let query = "SELECT * FROM products WHERE status = 'active'";
        let params = [];
        
        if (search) {
            query += " AND (name LIKE ? OR description LIKE ?)";
            params.push(`%${search}%`, `%${search}%`);
        }
        
        if (categoryFilter) {
            query += " AND category = ?";
            params.push(categoryFilter);
        }
        
        query += " ORDER BY created_at DESC";
        
        const [allProducts] = await pool.execute(query, params);
        
        const [categoriesRows] = await pool.execute(
            "SELECT DISTINCT category FROM products WHERE status = 'active' AND category IS NOT NULL ORDER BY category"
        );
        const categories = categoriesRows.map(row => row.category);
        
        res.render('buy', { 
            allProducts, 
            categories, 
            search, 
            categoryFilter,
            filteredProducts: allProducts // In the Node version we filter in DB
        });
    } catch (error) {
        console.error('Database error:', error);
        res.render('buy', { allProducts: [], categories: [], search: '', categoryFilter: '', db_error: true });
    }
});

// Get Product Detail (AJAX)
router.get('/get-product', async (req, res) => {
    try {
        const productId = req.query.id;
        if (!productId) return res.status(400).send('Product ID not specified');
        
        const [rows] = await pool.execute(
            "SELECT * FROM products WHERE id = ? AND status = 'active'",
            [productId]
        );
        
        if (rows.length === 0) return res.status(404).send('Product not found');
        
        res.render('product-modal', { product: rows[0] });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).send('Server error');
    }
});

module.exports = router;
