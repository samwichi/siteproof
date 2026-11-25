// Unit tests of lib/auth.js: who may open a page.
// The database is replaced by a small fake object (a "mock"), so the tests run without MySQL and each test decides
// what the database answers (testing laboratory, section 8).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { loadUser, requireRole } = require('../lib/auth');

// A fake request and a fake response that remember what the middleware did.
function fakeReq(options = {}) {
    return { signedCookies: options.cookie ? { user: options.cookie } : {}, path: options.path || '/deliveries',
             user: options.user, get: name => (options.headers || {})[name] };
}
function fakeRes() {
    const res = { locals: {}, headers: {}, cookies: {}, cleared: [] };
    res.status = code => { res.statusCode = code; return res; };
    res.send = body => { res.body = body; return res; };
    res.redirect = url => { res.redirectedTo = url; return res; };
    res.set = (name, value) => { res.headers[name] = value; return res; };
    res.cookie = (name, value) => { res.cookies[name] = value; return res; };
    res.clearCookie = name => { res.cleared.push(name); return res; };
    return res;
}
const fakeDb = row => ({ execute: async () => [row ? [row] : []] });

// ---------- requireRole ----------

test('a user with the right role can continue', () => {
    let next = false;
    requireRole('SUPPLIER', 'INSPECTOR')(fakeReq({ user: { role: 'INSPECTOR' } }), fakeRes(), () => { next = true; });
    assert.equal(next, true);
});

test('a user with another role gets 403', () => {
    const res = fakeRes();
    let next = false;
    requireRole('CONTRACTOR_PM')(fakeReq({ user: { role: 'SUPPLIER' } }), res, () => { next = true; });
    assert.equal(next, false);
    assert.equal(res.statusCode, 403);
});

test('a visitor who is not logged in is sent to the login page', () => {
    const res = fakeRes();
    requireRole('CONTRACTOR_PM')(fakeReq(), res, () => assert.fail('must not continue'));
    assert.equal(res.redirectedTo, '/login');
});

test('an HTMX request of a visitor gets the HX-Redirect header instead of a redirect', () => {
    const res = fakeRes();
    requireRole('CONTRACTOR_PM')(fakeReq({ headers: { 'HX-Request': 'true' } }), res, () => assert.fail('must not continue'));
    assert.equal(res.headers['HX-Redirect'], '/login');
    assert.equal(res.redirectedTo, undefined);
});

// ---------- loadUser ----------

const HASH = '$2b$10$somethingthatlookslikeabcrypthash';
const pv = hash => crypto.createHash('sha256').update(hash).digest('hex').slice(0, 16);
const account = changes => Object.assign({
    user_id: 7, org_id: '28001683', full_name: 'Lin', password: HASH, role: 'CONTRACTOR_PM', active: 1, user_status: 'APPROVED',
    must_change_password: 0, org_name: 'Formosa Build', org_type: 'CONTRACTOR', status: 'APPROVED', waiting: 0, openRfqs: 0, unread: 3
}, changes);
const cookie = changes => Object.assign({ id: 7, role: 'CONTRACTOR_PM', pv: pv(HASH), at: Date.now() }, changes);

async function run(row, c) {
    const req = fakeReq({ cookie: c });
    const res = fakeRes();
    let next = false;
    await loadUser(fakeDb(row))(req, res, () => { next = true; });
    assert.equal(next, true, 'loadUser always continues; requireRole decides');
    return { req, res };
}

test('a valid cookie of an approved user gives req.user', async () => {
    const { req, res } = await run(account(), cookie());
    assert.equal(req.user.id, 7);
    assert.equal(req.user.role, 'CONTRACTOR_PM');
    assert.equal(res.locals.isContractor, true);
    assert.equal(res.locals.unread, 3);
});

test('the role comes from the database, not from the cookie', async () => {
    const { req } = await run(account({ role: 'SUPPLIER' }), cookie({ role: 'ADMIN' }));
    assert.equal(req.user.role, 'SUPPLIER');
});

// Each row is one reason why an account may not be used any more.
for (const [why, row] of [
    ['the account does not exist any more', null],
    ['the user is switched off', account({ active: 0 })],
    ['the company account has not approved the user', account({ user_status: 'PENDING' })],
    ['the company account rejected the user', account({ user_status: 'REJECTED' })],
    ['the company is not approved', account({ status: 'PENDING' })],
    ['the password was changed on another computer', account({ password: '$2b$10$anewhash' })]
]) {
    test('no login when ' + why, async () => {
        const { req, res } = await run(row, cookie());
        assert.equal(req.user, undefined);
        assert.deepEqual(res.cleared, ['user']);
    });
}

test('the administrator has no company and is still allowed', async () => {
    const { req } = await run(account({ role: 'ADMIN', org_id: null, org_name: null, org_type: null, status: null }), cookie());
    assert.equal(req.user.role, 'ADMIN');
});

test('without a cookie the database is not asked', async () => {
    const db = { execute: async () => assert.fail('no query expected') };
    let next = false;
    await loadUser(db)(fakeReq(), fakeRes(), () => { next = true; });
    assert.equal(next, true);
});

test('the login is renewed after 5 minutes of work, but not by the automatic bell requests', async () => {
    const old = cookie({ at: Date.now() - 6 * 60000 });
    const work = await run(account(), old);
    assert.ok(work.res.cookies.user, 'a normal page renews the cookie');

    const req = fakeReq({ cookie: old, path: '/notifications/badge' });
    const res = fakeRes();
    await loadUser(fakeDb(account()))(req, res, () => {});
    assert.equal(res.cookies.user, undefined, 'the bell does not renew it');
});
