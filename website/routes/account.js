// The account of the logged-in user (every role): who he is, and changing his own password.
// The current password must be given (somebody at an open computer cannot change it), and the new one follows the same rules
// as at the registration (at least 8 characters, at most 72 bytes for bcrypt).
const express = require('express');
const bcrypt = require('bcryptjs');
const { fail } = require('../lib/respond');
const { setLoginCookie } = require('../lib/auth');
const app = express.Router();

const db = () => app.connection.promise();

async function showAccount(req, res, message) {
    const [[u]] = await db().execute(
        "SELECT full_name AS name, email, DATE_FORMAT(created_at, '%Y-%m-%d') AS created FROM user_account WHERE user_id = ?", [req.user.id]);
    res.render('account/index', Object.assign(u, { message: message, kind: 'success' }));
}

app.get('/', async (req, res) => {
    await showAccount(req, res);
});

app.put('/password', async (req, res) => {
    const current = String(req.body.current || '');
    const password = String(req.body.password || '');
    if (password.length < 8) return fail(res, 'The new password needs at least 8 characters.');
    if (Buffer.byteLength(password) > 72) return fail(res, 'The new password can have at most 72 bytes.');
    if (password !== String(req.body.password2 || '')) return fail(res, 'The two new passwords are not the same.');
    if (password === current) return fail(res, 'The new password must be different from the current one.');

    const [[u]] = await db().execute('SELECT password FROM user_account WHERE user_id = ?', [req.user.id]);
    if (!await bcrypt.compare(current, u.password)) return fail(res, 'The current password is not correct.');
    const hash = await bcrypt.hash(password, 10);
    await db().execute('UPDATE user_account SET password = ? WHERE user_id = ?', [hash, req.user.id]);
    // This browser stays signed in with a new cookie; every other browser where the old password was used is signed out.
    setLoginCookie(res, { user_id: req.user.id, org_id: req.user.orgId, full_name: req.user.name, role: req.user.role, password: hash });
    await showAccount(req, res, 'Your password is changed. Other computers where you were signed in are signed out.');
});

module.exports = app;
