// The seller center, the home page of a supplier (routes/seller.js): the numbers of the work to do, the next deliveries,
// the RFQs to answer, the performance, the products and the latest ratings; and "My storefront" with the place of the prices.
// Uses the test database siteproof_test like the other system tests. Without MySQL the tests are skipped.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDatabase = require('./helpers/testDatabase');
const { Browser } = require('./helpers/browser');

let skip = null;
let app, server, db, world, baseUrl;
const users = {};

const OTHER = '90000606', PENDING = '90000505';
const REBAR = '90000303', CEMENT = '90000304', CRANE = '90000306';

before(async () => {
    skip = await testDatabase.available();
    if (skip) return;
    world = await testDatabase.create();
    process.env.DB_NAME = testDatabase.NAME;
    app = require('../app');
    db = app.db;
    await db.query(`INSERT INTO material (material_id, material_name, unit, category_id) VALUES
        ('${CEMENT}', 'Cement Type I', 'bag', 1), ('${CRANE}', 'Mobile crane 25 t', 'day', 1)`);
    await db.query(`INSERT INTO organization (org_id, org_name, org_type, status) VALUES
        ('${OTHER}', 'Other Supplier', 'SUPPLIER', 'APPROVED'), ('${PENDING}', 'Waiting Supplier', 'SUPPLIER', 'PENDING')`);
    // Test Supplier: rebar (2nd cheapest of 2: the supplier that is not approved does not count), cement (the only one), the crane unlisted.
    await db.query(`INSERT INTO supplier_product (org_id, material_id, price_min, price_max, min_order_qty, lead_time_days, active) VALUES
        ('90000202', '${REBAR}', 24000, 26000, 5, 3, 1), ('${OTHER}', '${REBAR}', 23000, 23000, NULL, NULL, 1), ('${PENDING}', '${REBAR}', 1, 1, NULL, NULL, 1),
        ('90000202', '${CEMENT}', 150, 170, NULL, 1, 1), ('90000202', '${CRANE}', 18000, 20000, NULL, NULL, 0)`);
    const [[pm]] = await db.execute("SELECT user_id, password FROM user_account WHERE email = 'pm@test.example.com'");
    await db.execute(`INSERT INTO user_account (org_id, full_name, email, password, role) VALUES ('${OTHER}', 'Other', 'other@test.example.com', ?, 'SUPPLIER')`, [pm.password]);
    // Deliveries of Test Supplier: tomorrow (to ship soon), in 5 days, declined, delivered without a document, completed and rated 4.
    // And one of the other supplier (must never be counted).
    const at = (days, status, extra) => `(${world.projectId}, '${extra && extra.org || '90000202'}', '${extra && extra.material || REBAR}', ${pm.user_id}, 1, 1000,
        CURDATE() + INTERVAL ${days} DAY + INTERVAL 9 HOUR, CURDATE() + INTERVAL ${days} DAY + INTERVAL 12 HOUR, '${status}', ${extra && extra.declined ? 'NOW()' : 'NULL'})`;
    await db.query(`INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status, declined_at) VALUES
        ${at(1, 'PREPARING', { material: CEMENT })}, ${at(5, 'SCHEDULED')}, ${at(2, 'SCHEDULED', { declined: true })},
        ${at(-1, 'DELIVERED')}, ${at(-3, 'COMPLETED')}, ${at(1, 'SCHEDULED', { org: OTHER })}`);
    const [ids] = await db.query("SELECT delivery_id, status FROM delivery WHERE org_id = '90000202' ORDER BY delivery_id");
    const delivered = ids.find(d => d.status === 'DELIVERED').delivery_id, completed = ids.find(d => d.status === 'COMPLETED').delivery_id;
    // The delivered one arrived on time, the completed one late; the completed one is rated 4.
    await db.query(`INSERT INTO delivery_event (delivery_id, event, user_id, created_at) VALUES
        (${delivered}, 'DELIVERED', ${pm.user_id}, CURDATE() - INTERVAL 1 DAY + INTERVAL 10 HOUR),
        (${completed}, 'DELIVERED', ${pm.user_id}, CURDATE() - INTERVAL 3 DAY + INTERVAL 15 HOUR),
        (${completed}, 'COMPLETED', ${pm.user_id}, CURDATE() - INTERVAL 2 DAY)`);
    await db.query(`INSERT INTO supplier_rating (delivery_id, rated_by, score) VALUES (${completed}, ${pm.user_id}, 4)`);
    // RFQs: one sent to Test Supplier and not answered (closes tomorrow), one answered, one sent only to the other supplier.
    await db.query(`INSERT INTO rfq (project_id, created_by, title, slot_start, slot_end, due_date, status, sent_at) VALUES
        (${world.projectId}, ${pm.user_id}, 'Rebar for floor 3', CURDATE() + INTERVAL 5 DAY, CURDATE() + INTERVAL 5 DAY + INTERVAL 3 HOUR, CURDATE() + INTERVAL 1 DAY, 'SENT', NOW()),
        (${world.projectId}, ${pm.user_id}, 'Answered RFQ', CURDATE() + INTERVAL 5 DAY, CURDATE() + INTERVAL 5 DAY + INTERVAL 3 HOUR, CURDATE() + INTERVAL 1 DAY, 'SENT', NOW()),
        (${world.projectId}, ${pm.user_id}, 'Only for the other', CURDATE() + INTERVAL 5 DAY, CURDATE() + INTERVAL 5 DAY + INTERVAL 3 HOUR, CURDATE() + INTERVAL 1 DAY, 'SENT', NOW())`);
    const [rfqs] = await db.query('SELECT rfq_id, title FROM rfq ORDER BY rfq_id');
    await db.query(`INSERT INTO rfq_supplier (rfq_id, org_id) VALUES (${rfqs[0].rfq_id}, '90000202'), (${rfqs[1].rfq_id}, '90000202'), (${rfqs[2].rfq_id}, '${OTHER}')`);
    await db.query(`INSERT INTO quotation (rfq_id, org_id, submitted_by, lead_time_days) SELECT ${rfqs[1].rfq_id}, '90000202', user_id, 2 FROM user_account WHERE email = 'supplier@test.example.com'`);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    for (const [name, email] of [['supplier', 'supplier'], ['other', 'other'], ['pm', 'pm']]) {
        users[name] = new Browser(baseUrl);
        users[name].home = await users[name].login(email + '@test.example.com', testDatabase.PASSWORD);
    }
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
});

const guard = t => { if (skip) { t.skip(skip); return true; } return false; };
// The number on the card with this label.
const card = (body, label) => {
    const at = body.indexOf('>' + label + '<');
    assert.ok(at > 0, 'card ' + label);
    return Number(body.slice(0, at).match(/<span class="display-6 fw-semibold text-body">\d+<\/span>/g).pop().match(/>(\d+)</)[1]);
};

test('the supplier starts in the seller center, and Home is the seller center too', async t => {
    if (guard(t)) return;
    assert.equal(users.supplier.home, '/seller');
    const home = await users.supplier.get('/');
    assert.ok(home.body.includes('Seller center'));
});

test('only suppliers can open the seller center and the storefront', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.get('/seller')).status, 403);
    assert.equal((await users.pm.get('/seller/storefront')).status, 403);
    assert.equal((await new Browser(baseUrl).get('/seller')).hxRedirect, '/login');
});

test('the cards count the work of the own company only', async t => {
    if (guard(t)) return;
    const body = (await users.supplier.get('/seller')).body;
    assert.equal(card(body, 'RFQs to answer'), 1, 'not the answered one, not the one of the other supplier');
    assert.equal(card(body, 'to ship today or tomorrow'), 1, 'the cement tomorrow; not the declined one, not the one in 5 days');
    assert.ok(body.includes('2 deliveries to work on in all'));
    assert.equal(card(body, 'without a quality document'), 1, 'the delivered one');
    assert.equal(card(body, 'declined by you'), 1);
    assert.ok(body.includes('the first one closes tomorrow'));
});

test('a quality document removes the delivery from the card "without a quality document"', async t => {
    if (guard(t)) return;
    const [[d]] = await db.query("SELECT delivery_id FROM delivery WHERE org_id = '90000202' AND status = 'DELIVERED'");
    const [[u]] = await db.query("SELECT user_id FROM user_account WHERE email = 'supplier@test.example.com'");
    await db.query(`INSERT INTO delivery_document (delivery_id, uploaded_by, doc_type, file_name) VALUES (${d.delivery_id}, ${u.user_id}, 'Mill Certificate', 'mill.pdf')`);
    assert.equal(card((await users.supplier.get('/seller')).body, 'without a quality document'), 0);
    await db.query(`DELETE FROM delivery_document WHERE delivery_id = ${d.delivery_id}`);
});

test('the RFQ to answer and the next deliveries are listed, the nearest first', async t => {
    if (guard(t)) return;
    const body = (await users.supplier.get('/seller')).body;
    assert.ok(body.includes('Rebar for floor 3'));
    assert.ok(!body.includes('Answered RFQ') && !body.includes('Only for the other'));
    const next = body.slice(body.indexOf('Next deliveries'));
    assert.ok(next.indexOf('Cement Type I') < next.indexOf('Rebar SD420'), 'tomorrow before in 5 days');
});

test('the performance: rating, on time and completed (the same numbers as My rating and history)', async t => {
    if (guard(t)) return;
    const body = (await users.supplier.get('/seller')).body;
    assert.ok(body.includes('★★★★☆') && body.includes('>4.0<'));
    assert.ok(body.includes('<strong>50%</strong> (1 of 2 arrived)'));
    assert.ok(body.includes('Completed: <strong>1</strong> of 5 deliveries'));
    const history = (await users.supplier.get('/history')).body;
    assert.ok(history.includes('50%'), 'My rating and history still works with the shared numbers');
});

test('the products: listed, unlisted and the most ordered; the latest rating', async t => {
    if (guard(t)) return;
    const body = (await users.supplier.get('/seller')).body;
    assert.ok(body.includes('<strong>2</strong> listed · <strong>1</strong> unlisted'));
    assert.ok(body.includes('Rebar SD420 <span class="text-muted">(4 deliveries)</span>'));
    const ratings = body.slice(body.indexOf('Latest ratings'));
    assert.ok(ratings.includes('Test Contractor · Rebar SD420'));
});

test('another supplier sees only its own numbers', async t => {
    if (guard(t)) return;
    const body = (await users.other.get('/seller')).body;
    assert.equal(card(body, 'RFQs to answer'), 1, 'its own RFQ');
    assert.equal(card(body, 'to ship today or tomorrow'), 1);
    assert.equal(card(body, 'declined by you'), 0);
    assert.ok(body.includes('No rating yet'));
});

test('My storefront: the listed products as the contractors see them, with the place of the price', async t => {
    if (guard(t)) return;
    const body = (await users.supplier.get('/seller/storefront')).body;
    assert.equal(body.match(/<h2 class="h6 mb-0 shop-name"/g).length, 2, 'only the listed products');
    assert.ok(!body.includes('Mobile crane'), 'not the unlisted one');
    assert.ok(body.includes('Not shown: 1 unlisted product'));
    assert.ok(body.includes('Price place 2 of 2 suppliers'), 'rebar: the other supplier is cheaper, the one that is not approved is not counted');
    assert.ok(body.includes('Only supplier of this material'), 'cement');
    assert.ok(body.includes('Lead time: 3 days') && body.includes('Lead time: 1 day<'), 'plural of day');
    const other = (await users.other.get('/seller/storefront')).body;
    assert.ok(other.includes('Lowest price of 2 suppliers'));
    assert.ok(!other.includes('Cement Type I'), 'only its own products');
});
