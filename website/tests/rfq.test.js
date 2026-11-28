// System test of the RFQ workflow (phase 2) through the real routes and the test database siteproof_test:
// the contractor writes a draft RFQ, adds materials and invites suppliers, sends it; the suppliers answer with quotations
// (send, change, withdraw); the contractor compares them and accepts one, and the deliveries are created for that supplier.
// Each step also tries what must NOT work (wrong values, wrong status, a company that is not invited).
// The tests run in order and build on each other, like the steps of the demo (steps 5 to 7). Without MySQL they are skipped.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDatabase = require('./helpers/testDatabase');
const { Browser } = require('./helpers/browser');

let skip = null;
let app, server, db, world, baseUrl;
let rfqId, items;
const users = {};

const CEMENT = '90000304';
const SECOND_SUPPLIER = '90000606', NOT_INVITED = '90000707', OTHER_CONTRACTOR = '90000808';

// A day or a time in the future, in the formats of <input type="date"> and <input type="datetime-local"> (Taiwan time).
function day(daysFromNow) {
    return new Date(Date.now() + 8 * 3600000 + daysFromNow * 86400000).toISOString().slice(0, 10);
}
const slot = (daysFromNow, hour) => day(daysFromNow) + 'T' + String(hour).padStart(2, '0') + ':00';

const rfqForm = changes => Object.assign({
    project_id: world.projectId, title: 'Rebar and cement for floor 12',
    slot_start: slot(5, 9), slot_end: slot(5, 12), due_date: day(2), note: 'Please deliver to gate 2.'
}, changes);

const rfqStatus = async id => (await db.execute('SELECT status FROM rfq WHERE rfq_id = ?', [id || rfqId]))[0][0].status;
const count = async (sql, args) => Number((await db.execute(sql, args || []))[0][0].n);

before(async () => {
    skip = await testDatabase.available();
    if (skip) return;
    world = await testDatabase.create();
    process.env.DB_NAME = testDatabase.NAME;
    app = require('../app');
    db = app.db;
    const [[u]] = await db.execute("SELECT password FROM user_account WHERE email = 'pm@test.example.com'");
    await db.query(`INSERT INTO material (material_id, material_name, unit, category_id) VALUES ('${CEMENT}', 'Cement Type I', 'bag', 1)`);
    await db.query(`INSERT INTO organization (org_id, org_name, org_type) VALUES
        ('${SECOND_SUPPLIER}', 'Second Supplier', 'SUPPLIER'), ('${NOT_INVITED}', 'Not Invited Supplier', 'SUPPLIER'),
        ('${OTHER_CONTRACTOR}', 'Other Contractor', 'CONTRACTOR')`);
    await db.execute(`INSERT INTO user_account (org_id, full_name, email, password, role) VALUES
        ('${SECOND_SUPPLIER}', 'Second', 'supplier2@test.example.com', ?, 'SUPPLIER'),
        ('${NOT_INVITED}', 'Not Invited', 'notinvited@test.example.com', ?, 'SUPPLIER'),
        ('${OTHER_CONTRACTOR}', 'Other PM', 'otherpm@test.example.com', ?, 'CONTRACTOR_PM')`, [u.password, u.password, u.password]);
    await db.query(`INSERT INTO supplier_product (org_id, material_id, price_min, price_max) VALUES
        ('90000202', '90000303', 24000, 26000), ('90000202', '${CEMENT}', 150, 170), ('${SECOND_SUPPLIER}', '90000303', 23000, 25000)`);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    for (const [name, email] of [['pm', 'pm'], ['supplier', 'supplier'], ['supplier2', 'supplier2'], ['notInvited', 'notinvited'], ['otherPm', 'otherpm']]) {
        users[name] = new Browser(baseUrl);
        await users[name].login(email + '@test.example.com', testDatabase.PASSWORD);
    }
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
});

const guard = t => { if (skip) { t.skip(skip); return true; } return false; };

// ---------- 1. the contractor writes a draft ----------

test('an RFQ with wrong values is refused', async t => {
    if (guard(t)) return;
    for (const [why, changes] of [
        ['no title', { title: '' }],
        ['end of the slot before its start', { slot_end: slot(5, 8) }],
        ['last day in the past', { due_date: day(-1) }],
        ['slot in the past', { slot_start: slot(-1, 9), slot_end: slot(-1, 12), due_date: day(0) }],
        ['last day after the delivery day', { due_date: day(6) }],
        ['project of another company', { project_id: '999999' }]
    ]) {
        const res = await users.pm.post('/rfqs', rfqForm(changes));
        assert.equal(res.status, 400, why);
    }
    assert.equal(await count('SELECT COUNT(*) AS n FROM rfq'), 0);
});

test('the contractor creates a draft RFQ', async t => {
    if (guard(t)) return;
    const res = await users.pm.post('/rfqs', rfqForm({}));
    assert.equal(res.status, 200);
    const [[r]] = await db.execute('SELECT rfq_id, status FROM rfq');
    rfqId = r.rfq_id;
    assert.equal(r.status, 'DRAFT');
});

test('nobody else sees the draft: not the suppliers, not another contractor', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier.get('/quotations/' + rfqId)).status, 404);
    assert.equal((await users.otherPm.get('/rfqs/' + rfqId)).status, 404);
    assert.equal((await users.supplier.get('/rfqs/' + rfqId)).status, 403);      // the RFQ pages are for contractors only
});

test('a draft without materials and suppliers cannot be sent', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/send')).status, 400);
    assert.equal(await rfqStatus(), 'DRAFT');
});

test('the contractor adds materials (no quantity 0, no material twice)', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/items', { material_id: '90000303', quantity: '0' })).status, 400);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/items', { material_id: '90000303', quantity: '12' })).status, 200);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/items', { material_id: '90000303', quantity: '5' })).status, 409);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/items', { material_id: CEMENT, quantity: '300' })).status, 200);
    [items] = await db.execute('SELECT item_id, material_id, CAST(quantity AS DOUBLE) AS quantity FROM rfq_item WHERE rfq_id = ? ORDER BY item_id', [rfqId]);
    assert.deepEqual(items.map(i => [i.material_id, i.quantity]), [['90000303', 12], [CEMENT, 300]]);
});

test('the contractor invites suppliers (only approved suppliers)', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/suppliers', { org_id: OTHER_CONTRACTOR })).status, 404);
    for (const id of ['90000202', SECOND_SUPPLIER]) {
        assert.equal((await users.pm.post('/rfqs/' + rfqId + '/suppliers', { org_id: id })).status, 200);
    }
    assert.equal(await count('SELECT COUNT(*) AS n FROM rfq_supplier WHERE rfq_id = ?', [rfqId]), 2);
});

test('the suppliers that offer the materials are suggested first', async t => {
    if (guard(t)) return;
    // Test Supplier offers both materials, Second Supplier one; both are invited, so only the not invited one is left.
    const res = await users.pm.get('/rfqs/' + rfqId + '/suppliers');
    assert.ok(res.body.includes('Not Invited Supplier'));
    assert.ok(!res.body.includes('Second Supplier'), 'an invited supplier is not suggested again');
});

// ---------- 2. send ----------

test('the contractor sends the RFQ and the invited suppliers are told', async t => {
    if (guard(t)) return;
    const res = await users.pm.post('/rfqs/' + rfqId + '/send');
    assert.equal(res.status, 200);
    assert.equal(await rfqStatus(), 'SENT');
    for (const email of ['supplier@test.example.com', 'supplier2@test.example.com']) {
        assert.equal(await count(`SELECT COUNT(*) AS n FROM notification n JOIN user_account u ON u.user_id = n.user_id
                                  WHERE u.email = ? AND n.link = ?`, [email, '/quotations/' + rfqId]), 1, email);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM notification n JOIN user_account u ON u.user_id = n.user_id WHERE u.email = 'notinvited@test.example.com'"), 0);
});

test('a sent RFQ cannot be changed or deleted any more', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/items', { material_id: '90000303', quantity: '1' })).status, 409);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/suppliers', { org_id: NOT_INVITED })).status, 409);
    assert.equal((await users.pm.request('DELETE', '/rfqs/' + rfqId)).status, 409);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/send')).status, 409);
    assert.equal(await rfqStatus(), 'SENT');
});

// ---------- 3. the suppliers answer ----------

const prices = (rebar, cement, changes) => Object.assign({
    ['price_' + items[0].item_id]: rebar, ['price_' + items[1].item_id]: cement, lead_time_days: '3', note: 'Price includes transport.'
}, changes);

test('a quotation needs a price for every material', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier.post('/quotations/' + rfqId, prices('25000', ''))).status, 400);
    assert.equal((await users.supplier.post('/quotations/' + rfqId, prices('25000', '-5'))).status, 400);
    assert.equal((await users.supplier.post('/quotations/' + rfqId, prices('25000', '160', { lead_time_days: '1.5' }))).status, 400);
    assert.equal(await count('SELECT COUNT(*) AS n FROM quotation'), 0);
});

test('a supplier that is not invited cannot see or answer the RFQ', async t => {
    if (guard(t)) return;
    assert.equal((await users.notInvited.get('/quotations/' + rfqId)).status, 404);
    assert.equal((await users.notInvited.post('/quotations/' + rfqId, prices('1', '1'))).status, 404);
    assert.equal(await count('SELECT COUNT(*) AS n FROM quotation'), 0);
});

test('the first supplier sends a quotation, once, and the contractor is told', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier.post('/quotations/' + rfqId, prices('25000', '160'))).status, 200);
    assert.equal((await users.supplier.post('/quotations/' + rfqId, prices('24000', '150'))).status, 409);
    assert.equal(await count("SELECT COUNT(*) AS n FROM quotation WHERE org_id = '90000202' AND status = 'SUBMITTED'"), 1);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM notification n JOIN user_account u ON u.user_id = n.user_id
                              WHERE u.email = 'pm@test.example.com' AND n.text LIKE '%sent a quotation%'`), 1);
});

test('the supplier changes its quotation', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier.put('/quotations/' + rfqId, prices('24500', '155', { lead_time_days: '2' }))).status, 200);
    const [rows] = await db.execute(`SELECT CAST(qi.unit_price AS DOUBLE) AS price, q.lead_time_days AS leadTime FROM quotation_item qi
                                     JOIN quotation q ON q.quotation_id = qi.quotation_id WHERE q.org_id = '90000202' ORDER BY qi.item_id`);
    assert.deepEqual(rows.map(r => r.price), [24500, 155]);
    assert.equal(rows[0].leadTime, 2);
});

test('the second supplier sends, withdraws and sends again', async t => {
    if (guard(t)) return;
    assert.equal((await users.supplier2.post('/quotations/' + rfqId, prices('23000', '140'))).status, 200);
    assert.equal((await users.supplier2.request('DELETE', '/quotations/' + rfqId)).status, 200);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM quotation WHERE org_id = '${SECOND_SUPPLIER}'`), 0);
    assert.equal((await users.supplier2.post('/quotations/' + rfqId, prices('23500', '145'))).status, 200);
    assert.equal(await count('SELECT COUNT(*) AS n FROM quotation WHERE rfq_id = ?', [rfqId]), 2);
});

// ---------- 4. compare and accept ----------

test('the contractor compares the quotations: the cheapest total is first', async t => {
    if (guard(t)) return;
    // Test Supplier: 12 x 24,500 + 300 x 155 = 340,500; Second Supplier: 12 x 23,500 + 300 x 145 = 325,500.
    const res = await users.pm.get('/rfqs/' + rfqId);
    assert.equal(res.status, 200);
    for (const text of ['325,500', '340,500']) assert.ok(res.body.includes(text), 'the page shows the total ' + text);
    assert.ok(res.body.indexOf('325,500') < res.body.indexOf('340,500'), 'the cheaper quotation is shown first');
});

test('only a quotation of this RFQ can be accepted', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/award', { quotation_id: '999999' })).status, 404);
    const [[q]] = await db.execute("SELECT quotation_id FROM quotation WHERE org_id = '90000202'");
    assert.equal((await users.otherPm.post('/rfqs/' + rfqId + '/award', { quotation_id: q.quotation_id })).status, 404);
    assert.equal(await rfqStatus(), 'SENT');
    assert.equal(await count('SELECT COUNT(*) AS n FROM delivery'), 0);
});

test('the contractor accepts a quotation: one SCHEDULED delivery per material for that supplier', async t => {
    if (guard(t)) return;
    // The contractor chooses Test Supplier (faster lead time), not the cheapest one.
    const [[q]] = await db.execute("SELECT quotation_id FROM quotation WHERE org_id = '90000202'");
    const res = await users.pm.post('/rfqs/' + rfqId + '/award', { quotation_id: q.quotation_id });
    assert.equal(res.status, 200);
    assert.equal(await rfqStatus(), 'AWARDED');

    const [deliveries] = await db.execute(
        `SELECT org_id, material_id, status, CAST(ordered_quantity AS DOUBLE) AS quantity, CAST(delivery_value AS DOUBLE) AS value,
                DATE_FORMAT(slot_start, '%Y-%m-%dT%H:%i') AS slotStart, quotation_id
         FROM delivery ORDER BY delivery_id`);
    assert.deepEqual(deliveries.map(d => [d.org_id, d.material_id, d.status, d.quantity, d.value]), [
        ['90000202', '90000303', 'SCHEDULED', 12, 294000],
        ['90000202', CEMENT, 'SCHEDULED', 300, 46500]
    ]);
    for (const d of deliveries) {
        assert.equal(d.slotStart, slot(5, 9), 'the time slot of the RFQ');
        assert.equal(d.quotation_id, q.quotation_id);
    }
    assert.equal(await count("SELECT COUNT(*) AS n FROM delivery_event WHERE event = 'CREATED'"), 2, 'the history starts');
    const [statuses] = await db.execute('SELECT org_id, status FROM quotation ORDER BY org_id');
    assert.deepEqual(statuses.map(s => [s.org_id, s.status]), [['90000202', 'ACCEPTED'], [SECOND_SUPPLIER, 'NOT_CHOSEN']]);
});

test('both suppliers are told the result', async t => {
    if (guard(t)) return;
    const text = async email => (await db.execute(
        `SELECT n.text FROM notification n JOIN user_account u ON u.user_id = n.user_id WHERE u.email = ? ORDER BY n.notification_id DESC LIMIT 1`, [email]))[0][0].text;
    assert.match(await text('supplier@test.example.com'), /accepted your quotation.*2 new deliveries/);
    assert.match(await text('supplier2@test.example.com'), /chose another quotation/);
});

test('the new deliveries are in the list of the supplier and of the contractor', async t => {
    if (guard(t)) return;
    const assigned = await users.supplier.get('/assigned');
    assert.ok(assigned.body.includes('Cement Type I') && assigned.body.includes('Rebar SD420'));
    const other = await users.supplier2.get('/assigned');
    assert.ok(!other.body.includes('Cement Type I'), 'the supplier that was not chosen has no delivery');
    const own = await users.pm.get('/deliveries');
    assert.ok(own.body.includes('Cement Type I'));
});

test('after the decision nothing can change: no second award, no change of a quotation, no cancel', async t => {
    if (guard(t)) return;
    const [[q]] = await db.execute(`SELECT quotation_id FROM quotation WHERE org_id = '${SECOND_SUPPLIER}'`);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/award', { quotation_id: q.quotation_id })).status, 409);
    assert.equal((await users.supplier2.put('/quotations/' + rfqId, prices('1', '1'))).status, 409);
    assert.equal((await users.supplier.request('DELETE', '/quotations/' + rfqId)).status, 409);
    assert.equal((await users.pm.post('/rfqs/' + rfqId + '/cancel')).status, 409);
    assert.equal(await count('SELECT COUNT(*) AS n FROM delivery'), 2);
    assert.equal(await rfqStatus(), 'AWARDED');
});

// ---------- 5. other endings: cancel, and the last day ----------

async function sentRfq(title) {
    await users.pm.post('/rfqs', rfqForm({ title: title }));
    const [[r]] = await db.execute('SELECT rfq_id FROM rfq WHERE title = ?', [title]);
    await users.pm.post('/rfqs/' + r.rfq_id + '/items', { material_id: '90000303', quantity: '3' });
    await users.pm.post('/rfqs/' + r.rfq_id + '/suppliers', { org_id: '90000202' });
    await users.pm.post('/rfqs/' + r.rfq_id + '/send');
    const [[item]] = await db.execute('SELECT item_id FROM rfq_item WHERE rfq_id = ?', [r.rfq_id]);
    return { id: r.rfq_id, item: item.item_id };
}

test('a cancelled RFQ cannot be answered or awarded, and the supplier is told', async t => {
    if (guard(t)) return;
    const r = await sentRfq('Rebar for the parking');
    assert.equal(await rfqStatus(r.id), 'SENT');
    assert.equal((await users.supplier.post('/quotations/' + r.id, { ['price_' + r.item]: '25000' })).status, 200);
    assert.equal((await users.pm.post('/rfqs/' + r.id + '/cancel')).status, 200);
    assert.equal(await rfqStatus(r.id), 'CANCELLED');
    assert.equal((await users.supplier.put('/quotations/' + r.id, { ['price_' + r.item]: '1' })).status, 409);
    const [[q]] = await db.execute('SELECT quotation_id FROM quotation WHERE rfq_id = ?', [r.id]);
    assert.equal((await users.pm.post('/rfqs/' + r.id + '/award', { quotation_id: q.quotation_id })).status, 409);
    assert.equal(await count(`SELECT COUNT(*) AS n FROM notification n JOIN user_account u ON u.user_id = n.user_id
                              WHERE u.email = 'supplier@test.example.com' AND n.text LIKE '%cancelled%'`), 1);
});

test('after the last day the suppliers cannot answer any more (boundary: the last day itself is still open)', async t => {
    if (guard(t)) return;
    const r = await sentRfq('Rebar for the roof');
    await db.execute('UPDATE rfq SET due_date = CURDATE() WHERE rfq_id = ?', [r.id]);
    assert.equal((await users.supplier.post('/quotations/' + r.id, { ['price_' + r.item]: '25000' })).status, 200);
    await db.execute('UPDATE rfq SET due_date = CURDATE() - INTERVAL 1 DAY WHERE rfq_id = ?', [r.id]);
    assert.equal((await users.supplier.put('/quotations/' + r.id, { ['price_' + r.item]: '1' })).status, 409);
    assert.equal((await users.supplier2.post('/quotations/' + r.id, { ['price_' + r.item]: '1' })).status, 404, 'not invited');
});

test('a draft can be deleted with its materials and suppliers', async t => {
    if (guard(t)) return;
    await users.pm.post('/rfqs', rfqForm({ title: 'Draft to delete' }));
    const [[r]] = await db.execute("SELECT rfq_id FROM rfq WHERE title = 'Draft to delete'");
    await users.pm.post('/rfqs/' + r.rfq_id + '/items', { material_id: '90000303', quantity: '1' });
    await users.pm.post('/rfqs/' + r.rfq_id + '/suppliers', { org_id: '90000202' });
    assert.equal((await users.otherPm.request('DELETE', '/rfqs/' + r.rfq_id)).status, 404, 'not by another contractor');
    assert.equal((await users.pm.request('DELETE', '/rfqs/' + r.rfq_id)).status, 200);
    assert.equal(await count('SELECT COUNT(*) AS n FROM rfq WHERE rfq_id = ?', [r.rfq_id]), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM rfq_item WHERE rfq_id = ?', [r.rfq_id]), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM rfq_supplier WHERE rfq_id = ?', [r.rfq_id]), 0);
});
