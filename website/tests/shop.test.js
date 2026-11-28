// The shop, the home page of a contractor (routes/shop.js): the categories, the popular materials as cards, the search, the pages
// of cards, the page of one material with the offers of the suppliers, and the open deliveries of the company.
// Uses the test database siteproof_test like the other system tests. Without MySQL the tests are skipped.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDatabase = require('./helpers/testDatabase');
const { Browser } = require('./helpers/browser');

let skip = null;
let app, server, db, world, baseUrl;
const users = {};

const PENDING = '90000505', CHEAP = '90000606', OTHER_CONTRACTOR = '90000808';
const REBAR = '90000303', CEMENT = '90000304', PLYWOOD = '90000305', CRANE = '90000306', HIDDEN = '90000307';

before(async () => {
    skip = await testDatabase.available();
    if (skip) return;
    world = await testDatabase.create();
    process.env.DB_NAME = testDatabase.NAME;
    app = require('../app');
    db = app.db;
    await db.query(`INSERT INTO material_category (category_name) VALUES ('Equipment')`);
    await db.query(`INSERT INTO material (material_id, material_name, unit, category_id) VALUES
        ('${CEMENT}', 'Cement Type I', 'bag', 1), ('${PLYWOOD}', 'Plywood 18 mm', 'sheet', 1),
        ('${CRANE}', 'Mobile crane 25 t', 'day', 2), ('${HIDDEN}', 'Only unlisted 100% steel', 'ton', 1)`);
    await db.query(`INSERT INTO organization (org_id, org_name, org_type, status) VALUES
        ('${PENDING}', 'Waiting Supplier', 'SUPPLIER', 'PENDING'), ('${CHEAP}', 'Cheap Supplier', 'SUPPLIER', 'APPROVED'),
        ('${OTHER_CONTRACTOR}', 'Other Contractor', 'CONTRACTOR', 'APPROVED')`);
    // Rebar: 2 approved suppliers (+1 that is not approved); cement and the crane: 1; plywood: only a supplier that is not approved;
    // the last material: only an unlisted product. So the shop shows rebar, cement and the crane.
    await db.query(`INSERT INTO supplier_product (org_id, material_id, price_min, price_max, min_order_qty, lead_time_days, active) VALUES
        ('90000202', '${REBAR}', 24000, 26000, 5, 3, 1), ('${CHEAP}', '${REBAR}', 23000, 23000, NULL, NULL, 1),
        ('${PENDING}', '${REBAR}', 1, 1, NULL, 1, 1),
        ('90000202', '${CEMENT}', 150, 170, NULL, 1, 1), ('${CHEAP}', '${CRANE}', 18000, 20000, 1, 2, 1),
        ('${PENDING}', '${PLYWOOD}', 550, 600, NULL, NULL, 1), ('90000202', '${HIDDEN}', 9, 9, NULL, NULL, 0)`);
    // Purchases of the given data: cement 3 times, rebar 2 times, the crane never; so cement is the most popular.
    await db.query(`INSERT INTO purchase (purchase_id, org_id, material_id, quantity, unit_price, discount_rate, purchase_date) VALUES
        ('P0000001', '90000202', '${CEMENT}', 100, 150, 0, '2024-01-10'), ('P0000002', '90000202', '${CEMENT}', 80, 160, 0, '2024-02-10'),
        ('P0000003', '${CHEAP}', '${CEMENT}', 60, 170, 0, '2024-03-10'),
        ('P0000004', '90000202', '${REBAR}', 10, 24000, 0, '2024-01-15'), ('P0000005', '${CHEAP}', '${REBAR}', 12, 22000, 0, '2024-04-01')`);
    const [[u]] = await db.execute("SELECT user_id, password FROM user_account WHERE email = 'pm@test.example.com'");
    await db.execute(`INSERT INTO user_account (org_id, full_name, email, password, role) VALUES ('${OTHER_CONTRACTOR}', 'Other PM', 'otherpm@test.example.com', ?, 'CONTRACTOR_PM')`, [u.password]);
    await db.query(`INSERT INTO project (org_id, project_name, retention_rate) VALUES ('${OTHER_CONTRACTOR}', 'Other Tower', 0.05)`);
    const [[other]] = await db.query(`SELECT project_id FROM project WHERE org_id = '${OTHER_CONTRACTOR}'`);
    // Deliveries: 2 open and 1 completed of the test contractor, 1 open of another contractor.
    const slot = days => `NOW() + INTERVAL ${days} DAY`;
    await db.query(`INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status) VALUES
        (${world.projectId}, '90000202', '${REBAR}', ${u.user_id}, 12, 300000, ${slot(2)}, ${slot(2)} + INTERVAL 3 HOUR, 'SCHEDULED'),
        (${world.projectId}, '90000202', '${CEMENT}', ${u.user_id}, 300, 48000, ${slot(1)}, ${slot(1)} + INTERVAL 3 HOUR, 'IN_TRANSIT'),
        (${world.projectId}, '${CHEAP}', '${CRANE}', ${u.user_id}, 2, 36000, ${slot(-9)}, ${slot(-9)} + INTERVAL 3 HOUR, 'COMPLETED'),
        (${other.project_id}, '${CHEAP}', '${CRANE}', ${u.user_id}, 1, 18000, ${slot(3)}, ${slot(3)} + INTERVAL 3 HOUR, 'SCHEDULED')`);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    for (const [name, email] of [['pm', 'pm'], ['supplier', 'supplier'], ['inspector', 'inspector'], ['otherPm', 'otherpm']]) {
        users[name] = new Browser(baseUrl);
        users[name].home = await users[name].login(email + '@test.example.com', testDatabase.PASSWORD);
    }
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
});

const guard = t => { if (skip) { t.skip(skip); return true; } return false; };
// The names of the material cards, in the order of the page.
const cardNames = body => [...body.matchAll(/<h3 class="h6 mb-0 shop-name" title="([^"]*)"/g)].map(m => m[1]);

test('the contractor starts in the shop, and Home is the shop too', async t => {
    if (guard(t)) return;
    assert.equal(users.pm.home, '/shop');
    const home = await users.pm.get('/');
    assert.equal(home.status, 200);
    assert.ok(home.body.includes('Popular materials'));
    const supplierHome = await users.supplier.get('/');
    assert.ok(!supplierHome.body.includes('Popular materials'), 'the other roles keep their own Home page');
});

test('only contractors can open the shop', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier.get('/shop')).status, 403);
    assert.equal((await users.inspector.get('/shop/materials/' + REBAR)).status, 403);
    assert.equal((await new Browser(baseUrl).get('/shop')).hxRedirect, '/login');
});

test('the popular materials: only listed products of approved suppliers, the most bought first', async t => {
    if (guard(t)) return;
    const res = await users.pm.get('/shop');
    assert.deepEqual(cardNames(res.body), ['Cement Type I', 'Rebar SD420', 'Mobile crane 25 t']);
    assert.ok(res.body.includes('1-3 of 3'));
    // Rebar: the supplier that is not approved is not counted, and its price of 1 is not the lowest price.
    assert.match(res.body, /from NT\$ 23,000/);
    assert.match(res.body, /2 suppliers · bought 3 times/, 'rebar: 2 purchases + 1 delivery');
});

test('the category tiles count the materials that can be bought, and filter the cards', async t => {
    if (guard(t)) return;
    const res = await users.pm.get('/shop');
    assert.ok(res.body.includes('2 materials'), 'Material: rebar and cement');
    assert.ok(res.body.includes('1 material<'), 'Equipment: the crane');
    const [[equipment]] = await db.execute("SELECT category_id FROM material_category WHERE category_name = 'Equipment'");
    const filtered = await users.pm.get('/shop?category=' + equipment.category_id);
    assert.deepEqual(cardNames(filtered.body), ['Mobile crane 25 t']);
    assert.ok(filtered.body.includes('aria-current="true"'), 'the chosen tile is marked');
});

test('the search finds materials by name or ID; % is searched as a normal character', async t => {
    if (guard(t)) return;
    assert.deepEqual(cardNames((await users.pm.get('/shop?q=rebar')).body), ['Rebar SD420']);
    assert.deepEqual(cardNames((await users.pm.get('/shop?q=' + CEMENT)).body), ['Cement Type I']);
    const none = await users.pm.get('/shop?q=' + encodeURIComponent('100%'));
    assert.deepEqual(cardNames(none.body), [], 'the only material with 100% is unlisted');
    assert.ok(none.body.includes('No material matches your search'));
    const strange = await users.pm.get('/shop?q=' + encodeURIComponent("' OR 1=1 --") + '&category=abc&page=-3');
    assert.equal(strange.status, 200);
    assert.deepEqual(cardNames(strange.body), []);
});

test('the cards come in pages of 12 (boundary values: the last page, a page after the last)', async t => {
    if (guard(t)) return;
    const values = [];
    for (let i = 0; i < 12; i++) values.push(`('9100${String(i).padStart(4, '0')}', 'Extra material ${String(i).padStart(2, '0')}', 'pc', 1)`);
    await db.query('INSERT INTO material (material_id, material_name, unit, category_id) VALUES ' + values.join(', '));
    await db.query(`INSERT INTO supplier_product (org_id, material_id, price_min, price_max) SELECT '${CHEAP}', material_id, 10, 10 FROM material WHERE material_id LIKE '9100%'`);
    const first = await users.pm.get('/shop');
    assert.equal(cardNames(first.body).length, 12);
    assert.ok(first.body.includes('1-12 of 15') && first.body.includes('1 / 2'));
    const second = await users.pm.get('/shop?page=2');
    assert.equal(cardNames(second.body).length, 3);
    assert.ok(second.body.includes('13-15 of 15'));
    assert.equal(cardNames((await users.pm.get('/shop?page=99')).body).length, 3, 'a page after the last shows the last page');
    await db.query("DELETE FROM supplier_product WHERE material_id LIKE '9100%'");
    await db.query("DELETE FROM material WHERE material_id LIKE '9100%'");
});

test('the page of a material: the offers of the approved suppliers, the cheapest first, with Order', async t => {
    if (guard(t)) return;
    const res = await users.pm.get('/shop/materials/' + REBAR);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('2 suppliers offer this material'));
    assert.ok(res.body.indexOf('Cheap Supplier') < res.body.indexOf('Test Supplier'), 'the cheapest first');
    assert.ok(!res.body.includes('Waiting Supplier'), 'not a supplier that is not approved');
    assert.ok(res.body.includes('Lowest price'));
    const [[cheap]] = await db.execute(`SELECT product_id FROM supplier_product WHERE org_id = '${CHEAP}' AND material_id = '${REBAR}'`);
    assert.ok(res.body.includes('/deliveries/new?product=' + cheap.product_id), 'Order opens the delivery form with this product');
    assert.ok(res.body.includes('Lead time: 3 days') && res.body.includes('Minimum order: 5 ton'));
    // The purchases of the given data: (24,000 + 22,000) / 2.
    assert.match(res.body, /NT\$ 23,000 \/ ton on average in 2 purchases/);
});

test('the Order button of a material opens the delivery form with that supplier and material', async t => {
    if (guard(t)) return;
    const [[cheap]] = await db.execute(`SELECT product_id FROM supplier_product WHERE org_id = '${CHEAP}' AND material_id = '${REBAR}'`);
    const form = await users.pm.get('/deliveries/new?product=' + cheap.product_id);
    assert.equal(form.status, 200);
    assert.ok(form.body.includes('Cheap Supplier') && form.body.includes('Rebar SD420'));
});

test('a material that nobody offers says so; an unknown material is 404', async t => {
    if (guard(t)) return;
    const res = await users.pm.get('/shop/materials/' + PLYWOOD);
    assert.equal(res.status, 200);
    assert.ok(res.body.includes('No approved supplier offers this material'));
    assert.equal((await users.pm.get('/shop/materials/99999999')).status, 404);
});

test('the open deliveries of the own company only, the nearest first', async t => {
    if (guard(t)) return;
    const body = (await users.pm.get('/shop')).body;
    const aside = body.slice(body.indexOf('My open deliveries'));
    assert.ok(aside.indexOf('Cement Type I') < aside.indexOf('Rebar SD420'), 'cement arrives first');
    assert.ok(aside.includes('IN_TRANSIT') && aside.includes('SCHEDULED'));
    assert.ok(!aside.includes('Mobile crane'), 'not the completed one, not the one of another contractor');
    const other = (await users.otherPm.get('/shop')).body;
    const otherAside = other.slice(other.indexOf('My open deliveries'));
    assert.ok(otherAside.includes('Mobile crane') && !otherAside.includes('Rebar SD420'));
});
