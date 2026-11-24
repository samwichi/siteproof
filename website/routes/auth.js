// UC1: sign in with a role-based account.
const express = require('express');
const bcrypt = require('bcryptjs');
const { setLoginCookie, HOME_PAGES } = require('../lib/auth');
const app = express.Router();

// The messages of the login page. The text of a rejection comes from the administrator (a signed cookie keeps it for one request).
const ERRORS = {
    wrong: 'Wrong e-mail or password.',
    inactive: 'This account has been switched off. Please ask the account of your company.',
    pending: 'Your company has not been approved yet. The administrator is checking the documents; please try again later.',
    rejected: 'Your company was not approved. Please contact the administrator.',
    userPending: 'Your registration is waiting for the approval of the company account of your company. Please try again later.',
    userRejected: 'The company account of your company did not approve your registration. Please contact your company.'
};

// The login form (a fragment shown inside main#main).
app.get('/login', (req, res) => {
    const error = ERRORS[req.query.error];
    const note = req.signedCookies.loginNote;
    if (note) res.clearCookie('loginNote');
    res.render('login', { error: error, note: req.query.error === 'rejected' ? note : null, registered: req.query.registered });
});

// Check the e-mail and password (stored as a bcrypt hash in user_account).
app.post('/login', async (req, res) => {
    const SQL = `SELECT u.user_id, u.org_id, u.full_name, u.password, u.role, u.active, u.status AS user_status, o.status, o.review_note
                 FROM user_account u LEFT JOIN organization o ON o.org_id = u.org_id
                 WHERE u.email = ?`;
    const [rows] = await app.connection.promise().execute(SQL, [String(req.body.email || '').trim()]);

    const ok = rows.length === 1 && await bcrypt.compare(String(req.body.password || ''), rows[0].password);
    if (!ok) {
        return res.redirect('/login?error=wrong');
    }

    // The password is right. Now: is the account allowed to work? (The administrator belongs to no company.)
    const u = rows[0];
    if (u.user_status === 'PENDING') return res.redirect('/login?error=userPending');
    if (u.user_status === 'REJECTED') return res.redirect('/login?error=userRejected');
    if (u.active !== 1) return res.redirect('/login?error=inactive');
    if (u.role !== 'ADMIN' && u.status === 'PENDING') return res.redirect('/login?error=pending');
    if (u.role !== 'ADMIN' && u.status === 'REJECTED') {
        if (u.review_note) res.cookie('loginNote', u.review_note, { signed: true, maxAge: 60000, httpOnly: true, sameSite: 'lax' });
        return res.redirect('/login?error=rejected');
    }

    setLoginCookie(res, u);
    res.redirect(HOME_PAGES[u.role] || '/');         // each role starts on its own page
});

app.post('/logout', (req, res) => {
    res.clearCookie('user');
    res.redirect('/');
});

module.exports = app;
