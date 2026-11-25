// Reset of a forgotten password. There is no e-mail in this version, so the person who manages the account makes a temporary
// password and gives it to the user: the company account for the users of its company, the administrator for a company account.
// The temporary password is shown only once and is never stored in clear text (only its bcrypt hash). The user must change it:
// must_change_password = 1 sends him to "My account" after the sign in, and every page reminds him until he has changed it.
// A new password hash also signs out every computer where the old password was used (see the fingerprint in lib/auth.js).
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// 10 characters without the ones that are easy to confuse (0/O, 1/l/I).
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function temporaryPassword() {
    const bytes = crypto.randomBytes(10);
    let text = '';
    for (const b of bytes) text += LETTERS[b % LETTERS.length];
    return text;
}

// Give the user `userId` a new temporary password (only if `condition` with its arguments also holds). Returns it, or null.
async function resetPassword(db, userId, condition, args) {
    const temporary = temporaryPassword();
    const hash = await bcrypt.hash(temporary, 10);
    const [result] = await db.execute(
        'UPDATE user_account SET password = ?, must_change_password = 1 WHERE user_id = ? AND ' + condition, [hash, userId].concat(args));
    return result.affectedRows === 1 ? temporary : null;
}

module.exports = { resetPassword };
