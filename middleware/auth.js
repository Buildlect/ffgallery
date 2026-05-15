function isAdmin(req, res, next) {
    if (req.session && req.session.admin) {
        return next();
    }
    res.redirect('/admin/login');
}

function isUser(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login');
}

module.exports = { isAdmin, isUser };
