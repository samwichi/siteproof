// System test of the start of the demo (steps 1 to 4) through the real routes and the test database siteproof_test:
// a new supplier company registers with a proof document, the administrator approves it, a person registers as a supplier
// of that company, the company account approves the person, and the new supplier lists a product that contractors can find.
// Each step also tries what must NOT work. The tests run in order and build on each other. Without MySQL they are skipped.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const testDatabase = require('./helpers/testDatabase');
const { Browser } = require('./helpers/browser');
const { HOME_PAGES } = require('../lib/auth');      // the first page of each role (it can change, the test follows it)

let skip = null;
let app, server, db, baseUrl;
let newOrgId, newUserId;
const users = {};
const visitor = () => new Browser(baseUrl);

const COMPANY_EMAIL = 'owner@newsteel.example.com';
const USER_EMAIL = 'sales@newsteel.example.com';
const NEW_PASSWORD = 'new-steel-password';
const PDF = '%PDF-1.4\n% business registration of New Steel\n';

const count = async (sql, args) => Number((await db.execute(sql, args || []))[0][0].n);

before(async () => {
    skip = await testDatabase.available();
    if (skip) return;
    await testDatabase.create();
    process.env.DB_NAME = testDatabase.NAME;
    app = require('../app');
    db = app.db;
    // The company account of the test contractor (to show that it cannot approve the people of another company).
    const [[u]] = await db.execute("SELECT password FROM user_account WHERE email = 'pm@test.example.com'");
    await db.execute("INSERT INTO user_account (org_id, full_name, email, password, role) VALUES ('90000101', 'Contractor Office', 'company@test.example.com', ?, 'COMPANY')", [u.password]);
    await new Promise(resolve => { server = app.listen(0, resolve); });
    baseUrl = 'http://127.0.0.1:' + server.address().port;
    for (const role of ['admin', 'pm', 'company']) {
        users[role] = new Browser(baseUrl);
        await users[role].login(role + '@test.example.com', testDatabase.PASSWORD);
    }
});

after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await db.end();
});

const guard = t => { if (skip) { t.skip(skip); return true; } return false; };

// ---------- 1. a new company registers ----------

function companyForm(changes, file) {
    const fields = Object.assign({
        org_type: 'SUPPLIER', org_name: 'New Steel Co.', address: 'Taipei', phone: '02-1234-5678', org_email: 'info@newsteel.example.com',
        full_name: 'New Steel Office', email: COMPANY_EMAIL, password: NEW_PASSWORD, password2: NEW_PASSWORD
    }, changes);
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    if (file) form.append('proof', new Blob([file.content]), file.name);
    return form;
}

test('a company registration with wrong values is refused', async t => {
    if (guard(t)) return;
    for (const [why, changes] of [
        ['no type', { org_type: 'BANK' }],
        ['no company name', { org_name: '' }],
        ['bad e-mail', { email: 'not-an-email' }],
        ['short password', { password: 'short', password2: 'short' }],
        ['two different passwords', { password2: 'another-password' }]
    ]) {
        assert.equal((await visitor().post('/register/company', companyForm(changes))).status, 400, why);
    }
    const fake = await visitor().post('/register/company', companyForm({}, { name: 'proof.pdf', content: 'MZ a program' }));
    assert.equal(fake.status, 400, 'a proof file that is not a real PDF');
    assert.equal(await count("SELECT COUNT(*) AS n FROM organization WHERE org_name = 'New Steel Co.'"), 0);
});

test('a supplier company registers with a proof document and waits for the approval', async t => {
    if (guard(t)) return;
    const res = await visitor().post('/register/company', companyForm({}, { name: 'registration.pdf', content: PDF }));
    assert.equal(res.status, 200);
    const [[org]] = await db.execute("SELECT org_id, org_type, status FROM organization WHERE org_name = 'New Steel Co.'");
    newOrgId = org.org_id;
    assert.match(newOrgId, /^\d{8}$/, 'the server gives an 8-digit company ID');
    assert.equal(org.org_type, 'SUPPLIER');
    assert.equal(org.status, 'PENDING');
    assert.equal(await count("SELECT COUNT(*) AS n FROM user_account WHERE email = ? AND role = 'COMPANY' AND org_id = ?", [COMPANY_EMAIL, newOrgId]), 1);
    assert.equal(await count('SELECT COUNT(*) AS n FROM org_document WHERE org_id = ?', [newOrgId]), 1);
});

test('the same e-mail cannot register twice', async t => {
    if (guard(t)) return;
    assert.equal((await visitor().post('/register/company', companyForm({ org_name: 'Copy Co.' }))).status, 409);
});

test('the company account cannot sign in before the approval, and nobody can register for the company yet', async t => {
    if (guard(t)) return;
    assert.equal(await visitor().login(COMPANY_EMAIL, NEW_PASSWORD), '/login?error=pending');
    const options = await visitor().get('/register/companies?role=SUPPLIER');
    assert.ok(!options.body.includes('New Steel Co.'));
});

// ---------- 2. the administrator approves ----------

test('only the administrator can approve a company', async t => {
    if (guard(t)) return;
    assert.equal((await users.pm.post('/admin/companies/' + newOrgId + '/approve')).status, 403);
    assert.equal((await users.company.post('/admin/companies/' + newOrgId + '/approve')).status, 403);
    assert.equal((await visitor().post('/admin/companies/' + newOrgId + '/approve')).hxRedirect, '/login');
    assert.equal(await count("SELECT COUNT(*) AS n FROM organization WHERE org_id = ? AND status = 'PENDING'", [newOrgId]), 1);
});

test('the administrator sees the waiting company with its document and approves it', async t => {
    if (guard(t)) return;
    const page = await users.admin.get('/admin/companies/' + newOrgId);
    assert.equal(page.status, 200);
    assert.ok(page.body.includes('registration.pdf'));
    assert.equal((await users.admin.post('/admin/companies/' + newOrgId + '/approve')).status, 200);
    assert.equal(await count("SELECT COUNT(*) AS n FROM organization WHERE org_id = ? AND status = 'APPROVED'", [newOrgId]), 1);
    users.newCompany = new Browser(baseUrl);
    assert.equal(await users.newCompany.login(COMPANY_EMAIL, NEW_PASSWORD), HOME_PAGES.COMPANY);
});

test('a rejected company cannot sign in and sees the reason', async t => {
    if (guard(t)) return;
    await visitor().post('/register/company', companyForm({ org_name: 'Fake Steel', email: 'owner@fake.example.com' }));
    const [[org]] = await db.execute("SELECT org_id FROM organization WHERE org_name = 'Fake Steel'");
    assert.equal((await users.admin.post('/admin/companies/' + org.org_id + '/reject', { note: 'The document is missing.' })).status, 200);
    const browser = visitor();
    assert.equal(await browser.login('owner@fake.example.com', NEW_PASSWORD), '/login?error=rejected');
    const page = await browser.get('/login?error=rejected');
    assert.ok(page.body.includes('The document is missing.'));
});

// ---------- 3. a person registers for the company, and the company account approves ----------

const userForm = changes => Object.assign({
    role: 'SUPPLIER', org_id: newOrgId, full_name: 'Amy Sales', email: USER_EMAIL, password: NEW_PASSWORD, password2: NEW_PASSWORD
}, changes);

test('the approved company is in the list of the registration (for the right role only)', async t => {
    if (guard(t)) return;
    assert.ok((await visitor().get('/register/companies?role=SUPPLIER')).body.includes('New Steel Co.'));
    assert.ok(!(await visitor().get('/register/companies?role=CONTRACTOR_PM')).body.includes('New Steel Co.'));
});

test('a person cannot register for a company of the wrong type', async t => {
    if (guard(t)) return;
    assert.equal((await visitor().post('/register/user', userForm({ role: 'CONTRACTOR_PM' }))).status, 404);
    assert.equal((await visitor().post('/register/user', userForm({ role: 'SUPPLIER', org_id: '90000101' }))).status, 404);
    assert.equal(await count('SELECT COUNT(*) AS n FROM user_account WHERE email = ?', [USER_EMAIL]), 0);
});

test('a person registers as a supplier of the company and waits; the company account is told', async t => {
    if (guard(t)) return;
    assert.equal((await visitor().post('/register/user', userForm({}))).status, 200);
    const [[u]] = await db.execute('SELECT user_id, role, status FROM user_account WHERE email = ?', [USER_EMAIL]);
    newUserId = u.user_id;
    assert.equal(u.role, 'SUPPLIER');
    assert.equal(u.status, 'PENDING');
    assert.equal(await visitor().login(USER_EMAIL, NEW_PASSWORD), '/login?error=userPending');
    assert.equal(await count(`SELECT COUNT(*) AS n FROM notification n JOIN user_account c ON c.user_id = n.user_id
                              WHERE c.email = ? AND n.text LIKE '%waits for your approval%'`, [COMPANY_EMAIL]), 1);
});

test('the company account of another company cannot approve the person', async t => {
    if (guard(t)) return;
    assert.equal((await users.company.put('/company/users/' + newUserId + '/approval', { decision: 'APPROVED' })).status, 404);
    assert.equal(await count("SELECT COUNT(*) AS n FROM user_account WHERE user_id = ? AND status = 'PENDING'", [newUserId]), 1);
});

test('the company account approves the person, who can then sign in as a supplier', async t => {
    if (guard(t)) return;
    assert.equal((await users.newCompany.put('/company/users/' + newUserId + '/approval', { decision: 'MAYBE' })).status, 400);
    assert.equal((await users.newCompany.put('/company/users/' + newUserId + '/approval', { decision: 'APPROVED' })).status, 200);
    assert.equal((await users.newCompany.put('/company/users/' + newUserId + '/approval', { decision: 'APPROVED' })).status, 409, 'twice');
    users.newSupplier = new Browser(baseUrl);
    assert.equal(await users.newSupplier.login(USER_EMAIL, NEW_PASSWORD), HOME_PAGES.SUPPLIER);
});

// ---------- 4. the new supplier lists a product ----------

const product = changes => Object.assign({ material_id: '90000303', price_min: '24000', price_max: '26000', min_order_qty: '5', lead_time_days: '3' }, changes);

test('a product with wrong values is refused', async t => {
    if (guard(t)) return;
    for (const [why, changes] of [
        ['no material', { material_id: '' }],
        ['highest price lower than the lowest', { price_max: '20000' }],
        ['negative price', { price_min: '-1' }],
        ['lead time not a whole number', { lead_time_days: '2.5' }],
        ['minimum order 0', { min_order_qty: '0' }]
    ]) {
        assert.equal((await users.newSupplier.post('/products', product(changes))).status, 400, why);
    }
    assert.equal(await count('SELECT COUNT(*) AS n FROM supplier_product WHERE org_id = ?', [newOrgId]), 0);
});

test('the new supplier lists a product (once) and contractors find it', async t => {
    if (guard(t)) return;
    assert.equal((await users.newSupplier.post('/products', product({}))).status, 200);
    assert.equal((await users.newSupplier.post('/products', product({ price_min: '1', price_max: '2' }))).status, 409, 'the same material twice');
    const catalog = await users.pm.get('/catalog?q=' + encodeURIComponent('Rebar'));
    assert.ok(catalog.body.includes('New Steel Co.'));
});

test('an unlisted product is not in the catalog of the contractors; listed again, it is back', async t => {
    if (guard(t)) return;
    const [[p]] = await db.execute('SELECT product_id FROM supplier_product WHERE org_id = ?', [newOrgId]);
    assert.equal((await users.newSupplier.put('/products/' + p.product_id + '/active', { active: '0' })).status, 200);
    assert.ok(!(await users.pm.get('/catalog')).body.includes('New Steel Co.'));
    assert.equal((await users.newSupplier.put('/products/' + p.product_id + '/active', { active: '1' })).status, 200);
    assert.ok((await users.pm.get('/catalog')).body.includes('New Steel Co.'));
});

test('another supplier cannot change the product', async t => {
    if (guard(t)) return;
    const [[p]] = await db.execute('SELECT product_id FROM supplier_product WHERE org_id = ?', [newOrgId]);
    const other = new Browser(baseUrl);
    await other.login('supplier@test.example.com', testDatabase.PASSWORD);
    assert.equal((await other.put('/products/' + p.product_id + '/active', { active: '0' })).status, 404);
    assert.equal((await other.request('DELETE', '/products/' + p.product_id)).status, 404);
    assert.equal(await count('SELECT COUNT(*) AS n FROM supplier_product WHERE product_id = ? AND active = 1', [p.product_id]), 1);
});
