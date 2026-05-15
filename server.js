const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();
const { initializeDatabase } = require('./config/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: false, 
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Global variables for templates
app.use((req, res, next) => {
    res.locals.SITE_NAME = process.env.SITE_NAME;
    res.locals.SITE_URL = process.env.SITE_URL;
    res.locals.WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER;
    res.locals.WHATSAPP_CHAT_URL = `https://wa.me/${process.env.WHATSAPP_NUMBER}`;
    res.locals.admin = req.session.admin || null;
    res.locals.user = req.session.user || null;
    next();
});

// Routes
const indexRoutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');

app.use('/', indexRoutes);
app.use('/', userRoutes);
app.use('/admin', adminRoutes);

// Error handling
app.use((req, res) => {
    res.status(404).render('404', { title: 'Page Not Found' });
});

// Initialize DB and start server
async function startServer() {
    const dbReady = await initializeDatabase();
    if (dbReady) {
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    } else {
        console.error('Failed to start server: Database not ready.');
        process.exit(1);
    }
}

startServer();
