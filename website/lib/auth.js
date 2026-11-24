// Login helpers. The login state is kept in one signed cookie called "user" (same idea as the cookie-parser laboratory).

// Middleware: if the signed cookie is valid, put the user in req.user and in res.locals.user (so the templates can use {{user.name}}).
function loadUser(req, res, next) {
    const u = req.signedCookies.user;
    if (u && u.id) {
        req.user = u;
        res.locals.user = u;
        res.locals.isContractor = (u.role === 'CONTRACTOR_PM');   // the templates cannot compare strings, so we prepare the answer here
        res.locals.isInspector = (u.role === 'INSPECTOR');
    }
    next();
}

// Middleware factory: only a logged-in user with the given role can continue.
function requireRole(role) {
    return function (req, res, next) {
        if (req.user && req.user.role === role) {
            return next();
        }
        if (!req.user) {
            // Not logged in: send the browser to the login page. HTMX requests need the HX-Redirect header.
            if (req.get('HX-Request')) {
                res.set('HX-Redirect', '/login');
                return res.send('');
            }
            return res.redirect('/login');
        }
        // Logged in, but with another role.
        res.status(403).send('<div class="alert alert-danger">You do not have access to this page.</div>');
    };
}

module.exports = { loadUser, requireRole };
