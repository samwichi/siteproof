// A limit for wrong passwords, so that nobody can try thousands of passwords (the demo passwords are even in the README).
//   - 5 wrong passwords for the same e-mail within 15 minutes: that e-mail is locked for 15 minutes;
//   - 100 wrong passwords from the same IP address within 15 minutes: that address is locked for 15 minutes (high on purpose:
//     behind Docker or a school network many users can come from the same address).
// A correct password resets the counter of the e-mail. The counters are kept in memory (a restart of the server clears them).
const WINDOW = 15 * 60 * 1000;
const LIMITS = { email: 5, ip: 100 };
const failures = new Map();          // key -> { count, first, lockedUntil }

function entry(key) {
    const now = Date.now();
    let e = failures.get(key);
    if (!e || (now - e.first > WINDOW && e.lockedUntil < now)) {
        e = { count: 0, first: now, lockedUntil: 0 };
        failures.set(key, e);
    }
    return e;
}

const keys = (email, ip) => [['email', 'e:' + String(email).toLowerCase()], ['ip', 'i:' + ip]];

// Minutes until the login is possible again (0 = not locked).
function lockedMinutes(email, ip) {
    const now = Date.now();
    let until = 0;
    for (const [, key] of keys(email, ip)) {
        const e = failures.get(key);
        if (e && e.lockedUntil > now) until = Math.max(until, e.lockedUntil);
    }
    return until ? Math.ceil((until - now) / 60000) : 0;
}

function recordFailure(email, ip) {
    for (const [kind, key] of keys(email, ip)) {
        const e = entry(key);
        e.count += 1;
        if (e.count >= LIMITS[kind]) e.lockedUntil = Date.now() + WINDOW;
    }
}

function recordSuccess(email) {
    failures.delete('e:' + String(email).toLowerCase());
}

// Forget old entries now and then, so that the map does not grow forever.
setInterval(() => {
    const now = Date.now();
    for (const [key, e] of failures) if (now - e.first > WINDOW && e.lockedUntil < now) failures.delete(key);
}, WINDOW).unref();

module.exports = { lockedMinutes, recordFailure, recordSuccess };
