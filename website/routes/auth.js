// UC1: sign in with a role-based account.
const express = require('express');
const bcrypt = require('bcryptjs');
const app = express.Router();

// The login form (a fragment shown inside main#main).
app.get('/login', (req, res) => {
    res.render('login', { error: req.query.error });
});

// Check the e-mail and password (stored as a bcrypt hash in user_account).
app.post('/login', async (req, res) => {
    const SQL = 'SELECT user_id, org_id, full_name, password, role FROM user_account WHERE email = ?';
    const [rows] = await app.connection.promise().execute(SQL, [req.body.email || '']);

    const ok = rows.length === 1 && await bcrypt.compare(req.body.password || '', rows[0].password);
    if (!ok) {
        return res.redirect('/login?error=1');
    }

    const u = rows[0];
    const options = { signed: true, maxAge: 3600000, httpOnly: true };    // 1 hour
    res.cookie('user', { id: u.user_id, orgId: u.org_id, name: u.full_name, role: u.role }, options);

    // Only the contractor pages exist so far; the other roles go to the homepage.
    res.redirect(u.role === 'CONTRACTOR_PM' ? '/deliveries' : '/');
});

app.post('/logout', (req, res) => {
    res.clearCookie('user');
    res.redirect('/');
});

module.exports = app;
