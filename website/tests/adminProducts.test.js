// The administrator sees the products of all suppliers (routes/adminProducts.js), read only.
// Uses the test database siteproof_test like tests/closedLoop.test.js (npm test runs the files one after the other,
// because both make the database again). Without MySQL the tests are skipped.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDatabase = require('./helpers/testDatabase');
const { Browser } = require('./helpers/browser');

let skip = null;
let app, server, db, baseUrl;
const users = {};

before(async () => {
    skip = await testDatabase.available();
    if (skip) return;
    await testDatabase.create();
    process.env.DB_NAME = testDatabase.NAME;
    app = require('../app');
    db = app.db;
    // Three products: one listed, one unlisted (same supplier), and one of a supplier that waits for the approval.
    await db.query(`INSERT INTO material (material_id, material_name, unit, category_id) VALUES
        ('90000304', 'Cement Type I', 'bag', 1), ('90000305', 'Plywood 18 mm', 'sheet', 1)`);
    await db.query("INSERT INTO organization (org_id, org_name, org_type, status) VALUES ('90000505', 'Waiting Supplier', 'SUPPLIER', 'PENDING')");
    await db.query(`INSERT INTO supplier_product (org_id, material_id, price_min, price_max, active) VALUES
        ('90000202', '90000303', 24000, 26000, 1),
        ('90000202', '90000304', 160, 160, 0),
        ('90000505', '90000305', 550, 600, 1)`);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    for (const role of ['admin', 'pm', 'supplier']) {
        users[role] = new Browser(baseUrl);
        await users[role].login(role + '@test.example.com', testDatabase.PASSWORD);
    }
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
});

const guard = t => { if (skip) { t.skip(skip); return true; } return false; };

test('the administrator sees every product, also unlisted ones and those of a supplier that is not approved', async t => {
    if (guard(t)) return;
    const res = await users.admin.get('/admin/products');
    assert.equal(res.status, 200);
    for (const text of ['Rebar SD420', 'Cement Type I', 'Plywood 18 mm', 'Waiting for approval', 'Unlisted', '1-3 of 3']) {
        assert.ok(res.body.includes(text), 'the page shows ' + text);
    }
});

test('the contractor still sees only the listed products of approved suppliers', async t => {
    if (guard(t)) return;
    const res = await users.pm.get('/catalog');
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('Rebar SD420'));
    assert.ok(!res.body.includes('Cement Type I'), 'unlisted');
    assert.ok(!res.body.includes('Plywood 18 mm'), 'supplier not approved');
});

test('the filters work: listed / unlisted, and the search by supplier', async t => {
    if (guard(t)) return;
    const unlisted = await users.admin.get('/admin/products?listed=no');
    assert.ok(unlisted.body.includes('Cement Type I'));
    assert.ok(!unlisted.body.includes('Rebar SD420'));
    const waiting = await users.admin.get('/admin/products?q=' + encodeURIComponent('Waiting Supplier'));
    assert.ok(waiting.body.includes('Plywood 18 mm'));
    assert.ok(!waiting.body.includes('Rebar SD420'));
});

test('other roles and visitors cannot open the page', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.get('/admin/products')).status, 403);
    assert.equal((await users.supplier.get('/admin/products')).status, 403);
    assert.equal((await new Browser(baseUrl).get('/admin/products')).hxRedirect, '/login');
});

test('the page is read only: there is no route to change a product', async t => {
    if (guard(t)) return;
    const before = (await db.execute('SELECT price_min, active FROM supplier_product ORDER BY product_id'))[0];
    for (const method of ['post', 'put']) {
        const res = await users.admin[method]('/admin/products/1', { price_min: '1', active: '0' });
        assert.ok(res.status >= 400, method + ' -> ' + res.status);
    }
    assert.deepEqual((await db.execute('SELECT price_min, active FROM supplier_product ORDER BY product_id'))[0], before);
});
