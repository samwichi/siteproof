// Login helpers. The login state is kept in one signed cookie called "user" (same idea as the cookie-parser laboratory).
// The cookie only says WHO the user is. On every request the database is asked again whether the account may still be used
// (the user is not switched off and the company is APPROVED), so a company account that switches a user off, or an administrator
// that rejects a company, takes effect immediately and not only after the cookie expires.

// The names that the pages show for the roles.
const ROLE_NAMES = {
    CONTRACTOR_PM: 'Contractor',
    SUPPLIER: 'Supplier',
    INSPECTOR: 'Inspector',
    COMPANY: 'Company account',
    ADMIN: 'Administrator'
};

// The page where each role starts (after the login and after a registration).
const HOME_PAGES = {
    CONTRACTOR_PM: '/deliveries',
    INSPECTOR: '/inspections',
    SUPPLIER: '/assigned',
    COMPANY: '/company',
    ADMIN: '/admin'
};

// The cookie of a logged-in user (valid for 1 hour).
function setLoginCookie(res, u) {
    res.cookie('user', { id: u.user_id, orgId: u.org_id, name: u.full_name, role: u.role },
        { signed: true, maxAge: 3600000, httpOnly: true, sameSite: 'lax' });
}

// Middleware factory: if the signed cookie is valid and the account is still allowed, put the user in req.user and in res.locals.user
// (so the templates can use {{user.name}}). db = the promise version of the connection pool.
function loadUser(db) {
    return async function (req, res, next) {
        const c = req.signedCookies.user;
        if (!c || !c.id) return next();

        const [rows] = await db.execute(
            `SELECT u.user_id, u.org_id, u.full_name, u.role, u.active, o.org_name, o.org_type, o.status
             FROM user_account u LEFT JOIN organization o ON o.org_id = u.org_id
             WHERE u.user_id = ?`, [c.id]);
        const u = rows[0];
        const allowed = u && u.active === 1 && (u.role === 'ADMIN' || u.status === 'APPROVED');
        if (!allowed) {
            res.clearCookie('user');           // the account does not exist any more, is switched off, or its company is not approved
            return next();
        }

        const user = { id: u.user_id, orgId: u.org_id, orgName: u.org_name, orgType: u.org_type, name: u.full_name,
                       role: u.role, roleName: ROLE_NAMES[u.role] };
        req.user = user;
        res.locals.user = user;
        res.locals.isContractor = (u.role === 'CONTRACTOR_PM');   // the templates cannot compare strings, so we prepare the answer here
        res.locals.isInspector = (u.role === 'INSPECTOR');
        res.locals.isSupplier = (u.role === 'SUPPLIER');
        res.locals.isCompany = (u.role === 'COMPANY');
        res.locals.isAdmin = (u.role === 'ADMIN');
        res.locals.isContractorCompany = (u.role === 'COMPANY' && u.org_type === 'CONTRACTOR');
        res.locals.isInspectionCompany = (u.role === 'COMPANY' && u.org_type === 'INSPECTION');
        next();
    };
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

module.exports = { loadUser, requireRole, setLoginCookie, ROLE_NAMES, HOME_PAGES };
