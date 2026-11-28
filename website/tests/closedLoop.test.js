// System test of the Material Delivery Closed-Loop through the real routes and a real MySQL database (testing laboratory, section 12):
// the contractor creates a delivery, the supplier moves it to DELIVERED and uploads a document, the inspector inspects it
// (the system calculates the retention), and the contractor completes it with a rating.
// Each step also tries what must NOT work (wrong role, wrong status, wrong values).
//
// It uses the separate database siteproof_test (see tests/helpers/testDatabase.js); without MySQL the tests are skipped.
// The tests in this file run in order and build on each other, like the steps of the real workflow.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDatabase = require('./helpers/testDatabase');
const { Browser } = require('./helpers/browser');

let skip = null;        // the reason why the tests are skipped (no MySQL)
let app, server, db, world, baseUrl;
let deliveryId;
const pm = () => new Browser(baseUrl);
const users = {};

// A time slot in the future, in the format of <input type="datetime-local"> (Taiwan time).
function slot(daysFromNow, hour) {
    const d = new Date(Date.now() + 8 * 3600000 + daysFromNow * 86400000);
    return d.toISOString().slice(0, 10) + 'T' + String(hour).padStart(2, '0') + ':00';
}
const status = async () => (await db.execute('SELECT status FROM delivery WHERE delivery_id = ?', [deliveryId]))[0][0].status;

before(async () => {
    skip = await testDatabase.available();
    if (skip) return;
    world = await testDatabase.create();
    process.env.DB_NAME = testDatabase.NAME;          // before require: app.js opens the database when it is loaded
    app = require('../app');
    db = app.db;
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    for (const role of ['pm', 'supplier', 'inspector']) {
        users[role] = new Browser(baseUrl);
        users[role].home = await users[role].login(role + '@test.example.com', testDatabase.PASSWORD);
    }
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
});

// Every test starts with this line: without MySQL it is skipped (and says why).
const guard = t => { if (skip) { t.skip(skip); return true; } return false; };

// ---------- login and roles ----------

test('each role starts on its own page after the login', t => {
    if (guard(t)) return;
    assert.equal(users.pm.home, '/shop');
    assert.equal(users.supplier.home, '/assigned');
    assert.equal(users.inspector.home, '/inspections');
});

test('a wrong password does not log in', async t => {
    if (guard(t)) return;
    assert.equal(await pm().login('pm@test.example.com', 'wrong-password'), '/login?error=wrong');
});

test('a visitor is sent to the login page', async t => {
    if (guard(t)) return;
    assert.equal((await pm().get('/deliveries')).hxRedirect, '/login');
});

test('a user cannot open the pages of another role', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier.get('/deliveries')).status, 403);
    assert.equal((await users.inspector.get('/ratings')).status, 403);
    assert.equal((await users.pm.get('/inspections')).status, 403);
    assert.equal((await users.pm.get('/deliveries')).status, 200);
});

// ---------- 1. the contractor creates a delivery ----------

const order = changes => Object.assign({
    project_id: world.projectId, org_id: world.supplierId, material_id: world.materialId,
    ordered_quantity: '12', unit_price: '25000', slot_start: slot(2, 9), slot_end: slot(2, 12)
}, changes);

test('a delivery with wrong values is refused', async t => {
    if (guard(t)) return;
    for (const [why, changes] of [
        ['time slot in the past', { slot_start: slot(-1, 9), slot_end: slot(-1, 12) }],
        ['end before start', { slot_end: slot(2, 8) }],
        ['quantity 0', { ordered_quantity: '0' }],
        ['negative price', { unit_price: '-1' }],
        ['not a supplier', { org_id: '90000101' }]
    ]) {
        const res = await users.pm.post('/deliveries', order(changes));
        assert.ok(res.status >= 400, why + ' -> ' + res.status);
    }
    assert.equal((await db.execute('SELECT COUNT(*) AS n FROM delivery'))[0][0].n, 0);
});

test('the contractor creates a delivery (value = quantity x unit price)', async t => {
    if (guard(t)) return;
    const res = await users.pm.post('/deliveries', order({}));
    assert.equal(res.status, 200);
    const [[d]] = await db.execute('SELECT delivery_id, status, delivery_value FROM delivery');
    deliveryId = d.delivery_id;
    assert.equal(d.status, 'SCHEDULED');
    assert.equal(Number(d.delivery_value), 300000);
});

// ---------- 2. the supplier updates the status ----------

test('the supplier cannot skip a step', async t => {
    if (guard(t)) return;
    await users.supplier.put('/assigned/' + deliveryId, { from: 'IN_TRANSIT' });     // the delivery is still SCHEDULED
    assert.equal(await status(), 'SCHEDULED');
});

test('the supplier moves the delivery step by step to DELIVERED', async t => {
    if (guard(t)) return;
    for (const [from, to] of [['SCHEDULED', 'PREPARING'], ['PREPARING', 'IN_TRANSIT'], ['IN_TRANSIT', 'DELIVERED']]) {
        const res = await users.supplier.put('/assigned/' + deliveryId, { from: from });
        assert.equal(res.status, 200);
        assert.equal(await status(), to);
    }
});

test('another supplier company cannot change the delivery', async t => {
    if (guard(t)) return;
    await db.execute("INSERT INTO organization (org_id, org_name, org_type) VALUES ('90000404', 'Other Supplier', 'SUPPLIER')");
    const [[u]] = await db.execute("SELECT password FROM user_account WHERE email = 'supplier@test.example.com'");
    await db.execute("INSERT INTO user_account (org_id, full_name, email, password, role) VALUES ('90000404', 'Other', 'other@test.example.com', ?, 'SUPPLIER')", [u.password]);
    const other = new Browser(baseUrl);
    await other.login('other@test.example.com', testDatabase.PASSWORD);
    const res = await other.put('/assigned/' + deliveryId, { from: 'IN_TRANSIT' });
    assert.equal(res.status, 404);
    assert.equal(await status(), 'DELIVERED');
});

// ---------- 3. the supplier uploads a quality document ----------

function upload(name, content) {
    const form = new FormData();
    form.append('delivery_id', String(deliveryId));
    form.append('doc_type', 'Mill Certificate');
    form.append('file', new Blob([content]), name);
    return users.supplier.post('/documents', form);
}

test('a file that is not a PDF, JPG or PNG is refused, also with the name .pdf', async t => {
    if (guard(t)) return;
    const res = await upload('mill-cert.pdf', 'MZ this is a program');
    assert.equal(res.status, 400);
    assert.match(res.body, /not a PDF, JPG or PNG/);
});

test('the supplier uploads the mill certificate', async t => {
    if (guard(t)) return;
    const res = await upload('mill-cert.pdf', '%PDF-1.4\n% test file\n');
    assert.equal(res.status, 200);
    const [[doc]] = await db.execute('SELECT file_name, file_type FROM delivery_document WHERE delivery_id = ?', [deliveryId]);
    assert.deepEqual({ ...doc }, { file_name: 'mill-cert.pdf', file_type: 'PDF' });
});

// ---------- 4. the inspector inspects, the system calculates the retention ----------

test('the inspector cannot accept more than was received', async t => {
    if (guard(t)) return;
    const res = await users.inspector.post('/inspections/' + deliveryId, { action: 'save', received_quantity: '10', accepted_quantity: '11' });
    assert.equal(res.status, 400);
    assert.equal(await status(), 'DELIVERED');
});

test('partial acceptance: retention = accepted value x the rate of the project', async t => {
    if (guard(t)) return;
    const res = await users.inspector.post('/inspections/' + deliveryId, { action: 'save', received_quantity: '12', accepted_quantity: '9' });
    assert.equal(res.status, 200);
    assert.match(res.body, /Partially accepted/);
    assert.equal(await status(), 'INSPECTED');
    const [[r]] = await db.execute(
        `SELECT i.retention_rate, d.delivery_value * i.accepted_quantity / d.ordered_quantity AS accepted_value,
                d.delivery_value * i.accepted_quantity / d.ordered_quantity * i.retention_rate AS retention
         FROM inspection i JOIN delivery d ON d.delivery_id = i.delivery_id WHERE i.delivery_id = ?`, [deliveryId]);
    assert.equal(Number(r.retention_rate), 0.05);
    assert.equal(Number(r.accepted_value), 225000);       // 300,000 x 9 / 12
    assert.equal(Number(r.retention), 11250);             // 225,000 x 5%
});

test('a later change of the project rate does not change the recorded inspection', async t => {
    if (guard(t)) return;
    await db.execute('UPDATE project SET retention_rate = 0.10');
    const [[r]] = await db.execute('SELECT retention_rate FROM inspection WHERE delivery_id = ?', [deliveryId]);
    assert.equal(Number(r.retention_rate), 0.05);
});

test('a delivery cannot be inspected twice', async t => {
    if (guard(t)) return;
    const res = await users.inspector.post('/inspections/' + deliveryId, { action: 'save', received_quantity: '12', accepted_quantity: '12' });
    assert.equal(res.status, 409);
});

// ---------- 5. the contractor completes the delivery with a rating ----------

test('the score must be 1 to 5', async t => {
    if (guard(t)) return;
    for (const score of ['0', '6', '3.5', 'abc', '']) {
        const res = await users.pm.post('/ratings/' + deliveryId, { action: 'save', score: score });
        assert.equal(res.status, 400, 'score ' + JSON.stringify(score));
    }
    assert.equal(await status(), 'INSPECTED');
});

test('the contractor rates the supplier and the delivery is COMPLETED', async t => {
    if (guard(t)) return;
    const res = await users.pm.post('/ratings/' + deliveryId, { action: 'save', score: '4' });
    assert.equal(res.status, 200);
    assert.equal(await status(), 'COMPLETED');
    assert.equal((await users.pm.post('/ratings/' + deliveryId, { action: 'save', score: '5' })).status, 409, 'only once');
});

test('the history has every step in order, with who did it', async t => {
    if (guard(t)) return;
    const [rows] = await db.execute(
        `SELECT e.event, u.email FROM delivery_event e JOIN user_account u ON u.user_id = e.user_id
         WHERE e.delivery_id = ? ORDER BY e.created_at, e.event_id`, [deliveryId]);
    assert.deepEqual(rows.map(r => r.event + ' ' + r.email.split('@')[0]), [
        'CREATED pm', 'PREPARING supplier', 'IN_TRANSIT supplier', 'DELIVERED supplier', 'INSPECTED inspector', 'COMPLETED pm'
    ]);
});

test('the supplier was told about the result (notifications)', async t => {
    if (guard(t)) return;
    const [rows] = await db.execute(
        "SELECT n.text FROM notification n JOIN user_account u ON u.user_id = n.user_id WHERE u.email = 'supplier@test.example.com' ORDER BY n.notification_id");
    const texts = rows.map(r => r.text).join('\n');
    assert.match(texts, /New delivery/);
    assert.match(texts, /Partially accepted/);
    assert.match(texts, /rated it 4\/5/);
});
