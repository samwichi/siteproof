// The website administrator (role ADMIN): checks the companies that registered, sees all companies and their users.
// The administrator sees the public data (companies, their proof documents, users) but none of the deliveries.
// Passwords are never read here.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const { ROLE_NAMES } = require('../lib/auth');
const app = express.Router();

const db = () => app.connection.promise();

const TYPE_NAMES = { CONTRACTOR: 'Contractor', SUPPLIER: 'Supplier', INSPECTION: 'Inspection company' };
const BADGES = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

// ---------- the list of all companies (waiting companies first) ----------
const SELECT_COMPANIES = `
    SELECT o.org_id AS ID, o.org_name AS name, o.org_type AS type, o.status AS status,
           o.phone AS phone, o.email AS email, o.address AS address,
           (SELECT COUNT(*) FROM organization x WHERE x.org_name = o.org_name AND x.org_id <> o.org_id) AS sameName,
           DATE_FORMAT(o.created_at, '%Y-%m-%d') AS registered,
           (SELECT COUNT(*) FROM user_account u WHERE u.org_id = o.org_id AND u.role <> 'COMPANY') AS users,
           (SELECT COUNT(*) FROM org_document d WHERE d.org_id = o.org_id) AS documents
    FROM organization o
    WHERE 1 = 1`;

// A company "has an account" when somebody registered for it. The 500 companies of the given data have none until somebody does.
const HAS_ACCOUNT = 'EXISTS (SELECT 1 FROM user_account u WHERE u.org_id = o.org_id)';
const HAS_SAME_NAME = 'EXISTS (SELECT 1 FROM organization x WHERE x.org_name = o.org_name AND x.org_id <> o.org_id)';

const LIST = {
    search: ['o.org_id', 'o.org_name', 'o.email', 'o.phone', 'o.address'],
    filters: [
        { name: 'type', label: 'type', allLabel: 'All types', options: [
            { value: 'CONTRACTOR', label: TYPE_NAMES.CONTRACTOR, sql: "o.org_type = 'CONTRACTOR'" },
            { value: 'SUPPLIER', label: TYPE_NAMES.SUPPLIER, sql: "o.org_type = 'SUPPLIER'" },
            { value: 'INSPECTION', label: TYPE_NAMES.INSPECTION, sql: "o.org_type = 'INSPECTION'" }] },
        // The normal view: the companies that are in use (they have an account) and the ones that wait for the approval.
        { name: 'scope', label: 'accounts', default: 'registered', options: [
            { value: 'registered', label: 'With an account', sql: "o.status = 'PENDING' OR " + HAS_ACCOUNT },
            { value: 'all', label: 'All companies' },
            { value: 'none', label: 'Without an account', sql: 'NOT ' + HAS_ACCOUNT },
            { value: 'samename', label: 'Same name as another', sql: HAS_SAME_NAME }] }
    ],
    statuses: Object.keys(BADGES),
    statusColumn: 'o.status',
    sorts: { ID: 'o.org_id', name: 'o.org_name', type: 'o.org_type', status: "FIELD(o.status, 'PENDING', 'REJECTED', 'APPROVED')",
             registered: 'o.created_at', users: 'users' },
    tieBreak: 'o.org_id',
    defaultOrder: "FIELD(o.status, 'PENDING', 'REJECTED', 'APPROVED'), o.created_at DESC, o.org_name"
};

function prepare(row) {
    row.typeName = TYPE_NAMES[row.type];
    row.badge = BADGES[row.status];
    row.encodedName = encodeURIComponent(row.name || '');      // for the link "more with this name"
    return row;
}

app.get('/', async (req, res) => {
    const result = await readList(db(), req, LIST, SELECT_COMPANIES, [], prepare);
    const [[waiting]] = await db().execute("SELECT COUNT(*) AS n FROM organization WHERE status = 'PENDING'");
    result.pending = Number(waiting.n);
    result.pendingMany = result.pending > 1;
    // In the normal view the companies without an account are not shown: tell how many they are, so that nobody thinks they are lost.
    const scope = result.list.filters.find(f => f.name === 'scope');
    if (scope.value === 'registered') {
        const [[hidden]] = await db().execute("SELECT COUNT(*) AS n FROM organization o WHERE o.status <> 'PENDING' AND NOT " + HAS_ACCOUNT);
        result.hidden = Number(hidden.n);
    }
    res.render('admin/index', result);
});

// ---------- the products of a supplier ----------
// A product of a supplier is a material that the supplier has purchase records for (table purchase, from the given data): the price range
// and the number of records come from there. A company that registered itself has no records until it has some.
// The GROUP BY is in a sub-select, so that the list helper can add its search and filter conditions to the outer WHERE.
const SELECT_PRODUCTS = `
    SELECT * FROM (
        SELECT m.material_id AS ID, m.material_name AS material, c.category_name AS category, m.unit AS unit,
               COUNT(*) AS purchases, MIN(p.unit_price) AS minPrice, MAX(p.unit_price) AS maxPrice,
               DATE_FORMAT(MAX(p.purchase_date), '%Y-%m-%d') AS lastDate
        FROM purchase p
        JOIN material m ON m.material_id = p.material_id
        JOIN material_category c ON c.category_id = m.category_id
        WHERE p.org_id = ?
        GROUP BY m.material_id, m.material_name, c.category_name, m.unit
    ) AS t
    WHERE 1 = 1`;

const PRODUCTS = {
    search: ['t.ID', 't.material'],
    statuses: ['Material', 'Labor', 'Equipment', 'Other'],      // the 4 categories of the table material_category
    statusColumn: 't.category',
    filterLabel: 'category',
    allLabel: 'All categories',
    sorts: { material: 't.material', category: 't.category', unit: 't.unit', price: 't.minPrice', purchases: 't.purchases', lastDate: 't.lastDate' },
    tieBreak: 't.ID',
    defaultOrder: 't.purchases DESC, t.material'
};

const money = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
function prepareProduct(row) {
    row.unit = /[?\uFFFD]/.test(row.unit || '?') ? '-' : row.unit;          // some units of the given data are damaged (a "?" instead of the character)
    row.price = Number(row.minPrice) === Number(row.maxPrice) ? money(row.minPrice) : money(row.minPrice) + ' - ' + money(row.maxPrice);
    return row;
}

// The numbers for the summary on the page of the company.
async function productSummary(id) {
    const [[total]] = await db().execute(
        'SELECT COUNT(DISTINCT p.material_id) AS materials, COUNT(*) AS purchases FROM purchase p WHERE p.org_id = ?', [id]);
    const [categories] = await db().execute(
        `SELECT c.category_name AS name, COUNT(DISTINCT p.material_id) AS n
         FROM purchase p JOIN material m ON m.material_id = p.material_id JOIN material_category c ON c.category_id = m.category_id
         WHERE p.org_id = ? GROUP BY c.category_name ORDER BY n DESC`, [id]);
    return { materials: Number(total.materials), purchases: Number(total.purchases), categories: categories };
}

app.get('/companies/:id/products', async (req, res) => {
    const [orgs] = await db().execute('SELECT org_id, org_name, org_type FROM organization WHERE org_id = ?', [req.params.id]);
    if (orgs.length === 0) return fail(res, 'Company not found.', 404);
    const cfg = Object.assign({}, PRODUCTS, { path: '/admin/companies/' + orgs[0].org_id + '/products' });   // the id comes from the database
    const result = await readList(db(), req, cfg, SELECT_PRODUCTS, [orgs[0].org_id], prepareProduct);
    result.org = { ID: orgs[0].org_id, name: orgs[0].org_name };
    result.summary = await productSummary(orgs[0].org_id);
    res.render('admin/products', result);
});

// ---------- the page of one company ----------
const USERS_SHOWN = 200;
async function showCompany(req, res, message, kind) {
    const [orgs] = await db().execute('SELECT * FROM organization WHERE org_id = ?', [req.params.id]);
    if (orgs.length === 0) return fail(res, 'Company not found.', 404);
    const org = prepare({ ID: orgs[0].org_id, name: orgs[0].org_name, type: orgs[0].org_type, status: orgs[0].status });
    Object.assign(org, {
        address: orgs[0].address, phone: orgs[0].phone, email: orgs[0].email, note: orgs[0].review_note,
        registered: orgs[0].created_at.toISOString().slice(0, 10),
        isPending: orgs[0].status === 'PENDING', isApproved: orgs[0].status === 'APPROVED', isRejected: orgs[0].status === 'REJECTED'
    });

    // Other companies with the same name (the administrator can check before the approval that it is not a second registration of one company).
    const [sameName] = await db().execute(
        `SELECT o.org_id AS ID, o.org_type AS type, o.status AS status, o.phone AS phone, o.email AS email, o.address AS address,
                (SELECT COUNT(*) FROM user_account u WHERE u.org_id = o.org_id AND u.role <> 'COMPANY') AS users
         FROM organization o WHERE o.org_name = ? AND o.org_id <> ? ORDER BY o.org_id LIMIT 20`, [orgs[0].org_name, req.params.id]);
    sameName.forEach(prepare);

    const products = await productSummary(req.params.id);
    products.any = products.materials > 0;

    const [accounts] = await db().execute(
        "SELECT full_name AS name, email, active FROM user_account WHERE org_id = ? AND role = 'COMPANY' ORDER BY user_id", [req.params.id]);
    const [documents] = await db().execute(
        'SELECT document_id AS id, file_name AS name, file_type AS type, file_size AS size, DATE_FORMAT(uploaded_at, \'%Y-%m-%d\') AS uploaded FROM org_document WHERE org_id = ? ORDER BY document_id', [req.params.id]);
    documents.forEach(d => { d.kb = Math.max(1, Math.round(d.size / 1024)); });
    const [users] = await db().execute(
        "SELECT full_name AS name, email, role, active FROM user_account WHERE org_id = ? AND role <> 'COMPANY' ORDER BY full_name LIMIT " + USERS_SHOWN, [req.params.id]);
    users.forEach(u => { u.roleName = ROLE_NAMES[u.role]; u.isActive = (u.active === 1); });
    const [[counted]] = await db().execute("SELECT COUNT(*) AS n FROM user_account WHERE org_id = ? AND role <> 'COMPANY'", [req.params.id]);

    res.render('admin/company', { org: org, products: products, sameName: sameName, sameNameMany: sameName.length > 1, accounts: accounts, documents: documents, users: users,
                                  userTotal: Number(counted.n), moreUsers: Number(counted.n) > users.length, message: message, kind: kind });
}

app.get('/companies/:id', async (req, res) => {
    await showCompany(req, res);
});

// Approve (also possible after a rejection) or reject a company. A company that is not approved cannot be used: nobody of it can sign in,
// and it is not in the lists of the registration.
app.post('/companies/:id/approve', async (req, res) => {
    try {
        const [result] = await db().execute("UPDATE organization SET status = 'APPROVED', review_note = NULL WHERE org_id = ?", [req.params.id]);
        if (result.affectedRows === 0) return fail(res, 'Company not found.', 404);
        await showCompany(req, res, 'The company is approved. Its users can sign in.', 'success');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

app.post('/companies/:id/reject', async (req, res) => {
    const note = String(req.body.note || '').trim();
    if (note.length > 200) return fail(res, 'The reason can have at most 200 characters.');
    try {
        const [result] = await db().execute("UPDATE organization SET status = 'REJECTED', review_note = ? WHERE org_id = ?", [note || null, req.params.id]);
        if (result.affectedRows === 0) return fail(res, 'Company not found.', 404);
        await showCompany(req, res, 'The company is rejected. Nobody of it can sign in.', 'success');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
