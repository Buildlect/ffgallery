const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { pool } = require('../config/db');
const { isAdmin } = require('../middleware/auth');
const csv = require('csv-parser');
const fs = require('fs');

// Multer Setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/products/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (extname && mimetype) return cb(null, true);
        cb(new Error('Only images (jpg, png, webp) are allowed'));
    }
});

// Admin Login Page
router.get('/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.render('admin/login', { error: null });
});

// Handle Login
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [rows] = await pool.execute(
            "SELECT * FROM admin_users WHERE username = ? AND is_active = TRUE",
            [username]
        );
        const admin = rows[0];
        
        if (admin && await bcrypt.compare(password, admin.password_hash)) {
            req.session.admin = {
                id: admin.id,
                username: admin.username
            };
            
            // Update last login
            await pool.execute("UPDATE admin_users SET last_login = NOW() WHERE id = ?", [admin.id]);
            
            res.redirect('/admin');
        } else {
            res.render('admin/login', { error: "Invalid username or password" });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.render('admin/login', { error: "Database connection failed" });
    }
});

// Admin Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Admin Dashboard
router.get('/', isAdmin, async (req, res) => {
    try {
        const [products] = await pool.execute(
            "SELECT * FROM products WHERE status = 'active' ORDER BY created_at DESC"
        );
        
        const [statsRow] = await pool.execute(`
            SELECT 
                COUNT(*) as total_products,
                SUM(is_featured) as featured_products,
                SUM(price > 20000) as premium_products
            FROM products WHERE status = 'active'
        `);
        const stats = statsRow[0];
        
        res.render('admin/dashboard', { products, stats, message: req.query.message || null });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Server error');
    }
});

// Add Product
router.post('/add-product', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { name, description, price, category, size_range, colors_available, is_featured, stock_status } = req.body;
        const image_path = req.file ? `products/${req.file.filename}` : '';
        const featured = is_featured === 'on' ? 1 : 0;
        
        await pool.execute(
            "INSERT INTO products (name, description, price, category, image_path, size_range, colors_available, is_featured, stock_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [name, description, price, category, image_path, size_range || '', colors_available || '', featured, stock_status]
        );
        
        res.redirect('/admin?message=' + encodeURIComponent('✅ Product added successfully!'));
    } catch (error) {
        console.error('Add product error:', error);
        res.redirect('/admin?message=' + encodeURIComponent('❌ Error adding product: ' + error.message));
    }
});

// Update Product
router.post('/update-product', isAdmin, upload.single('image'), async (req, res) => {
    try {
        const { product_id, name, description, price, category, size_range, colors_available, is_featured, stock_status } = req.body;
        const featured = is_featured === 'on' ? 1 : 0;
        
        let query = "UPDATE products SET name = ?, description = ?, price = ?, category = ?, size_range = ?, colors_available = ?, is_featured = ?, stock_status = ?";
        let params = [name, description, price, category, size_range || '', colors_available || '', featured, stock_status];
        
        if (req.file) {
            query += ", image_path = ?";
            params.push(`products/${req.file.filename}`);
        }
        
        query += " WHERE id = ?";
        params.push(product_id);
        
        await pool.execute(query, params);
        
        res.redirect('/admin?message=' + encodeURIComponent('✅ Product updated successfully!'));
    } catch (error) {
        console.error('Update product error:', error);
        res.redirect('/admin?message=' + encodeURIComponent('❌ Error updating product: ' + error.message));
    }
});

// Bulk Image Upload (Advanced UI)
router.get('/bulk-upload', isAdmin, async (req, res) => {
    res.render('admin/bulk-upload', { message: req.query.message || null });
});

router.post('/bulk-upload-json', isAdmin, upload.array('images', 50), async (req, res) => {
    try {
        const files = req.files;
        const productsData = JSON.parse(req.body.productsData); // Array of { originalName, name, price, category, etc }
        
        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, message: 'No images uploaded' });
        }
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const data = productsData.find(p => p.originalName === file.originalname) || {};
            
            const name = data.name || path.parse(file.originalname).name.replace(/[-_]/g, ' ');
            const price = data.price || 0;
            const category = data.category || 'Uncategorized';
            const image_path = `products/${file.filename}`;
            
            await pool.execute(
                "INSERT INTO products (name, description, price, category, image_path, stock_status) VALUES (?, ?, ?, ?, ?, ?)",
                [name, '', price, category, image_path, 'in_stock']
            );
        }
        
        res.json({ success: true, message: `${files.length} products uploaded successfully!` });
    } catch (error) {
        console.error('Advanced bulk upload error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete Product (Soft delete)
router.post('/delete-product', isAdmin, async (req, res) => {
    try {
        const { product_id } = req.body;
        await pool.execute("UPDATE products SET status = 'inactive' WHERE id = ?", [product_id]);
        res.redirect('/admin?message=' + encodeURIComponent('✅ Product deleted successfully!'));
    } catch (error) {
        console.error('Delete product error:', error);
        res.redirect('/admin?message=' + encodeURIComponent('❌ Error deleting product: ' + error.message));
    }
});

// Bulk CSV Upload
router.post('/bulk-csv-upload', isAdmin, upload.single('csvFile'), async (req, res) => {
    if (!req.file) return res.redirect('/admin?message=' + encodeURIComponent('❌ No CSV file uploaded'));
    
    const results = [];
    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                for (const row of results) {
                    await pool.execute(
                        "INSERT INTO products (name, description, price, category, image_path, size_range, colors_available, is_featured, stock_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        [
                            row.name, 
                            row.description || '', 
                            row.price || 0, 
                            row.category || 'Uncategorized', 
                            row.image_path || '', 
                            row.size_range || '', 
                            row.colors_available || '', 
                            row.is_featured == '1' ? 1 : 0, 
                            row.stock_status || 'in_stock'
                        ]
                    );
                }
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                res.redirect('/admin?message=' + encodeURIComponent(`✅ ${results.length} products imported successfully!`));
            } catch (error) {
                console.error('CSV Import error:', error);
                res.redirect('/admin?message=' + encodeURIComponent('❌ Error importing CSV: ' + error.message));
            }
        });
});

module.exports = router;
