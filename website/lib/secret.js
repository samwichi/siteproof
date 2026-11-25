// The secret that signs the login cookie. Whoever knows it can make a valid cookie for ANY user (also the administrator),
// so it must never be the example from GitHub. Rule:
//   - config.cookieSecret is used when it is long enough (32 characters or more) and is not a known example;
//   - otherwise a random secret is made once and kept in the file website/.cookie-secret (not in Git, see .gitignore),
//     so it stays the same after a restart and the users stay signed in.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', '.cookie-secret');
const KNOWN_EXAMPLES = ['siteproof-secret-ingredient', 'change-me'];

function cookieSecret(configured) {
    const value = String(configured || '');
    if (value.length >= 32 && !KNOWN_EXAMPLES.includes(value)) return value;

    try {
        const saved = fs.readFileSync(FILE, 'utf8').trim();
        if (saved.length >= 32) return saved;
    }
    catch (err) {
        // no file yet: make one below
    }
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(FILE, secret + '\n', { mode: 0o600 });
    console.log('The cookie secret of config.js is missing, too short or the public example: a random secret was saved in ' + FILE + '.');
    return secret;
}

module.exports = { cookieSecret };
