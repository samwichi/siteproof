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
           DATE_FORMAT(o.created_at, '%Y-%m-%d') AS registered,
           (SELECT COUNT(*) FROM user_account u WHERE u.org_id = o.org_id AND u.role <> 'COMPANY') AS users,
           (SELECT COUNT(*) FROM org_document d WHERE d.org_id = o.org_id) AS documents
    FROM organization o
    WHERE 1 = 1`;

const LIST = {
    search: ['o.org_id', 'o.org_name', 'o.email'],
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
    return row;
}

app.get('/', async (req, res) => {
    const result = await readList(db(), req, LIST, SELECT_COMPANIES, [], prepare);
    const [[waiting]] = await db().execute("SELECT COUNT(*) AS n FROM organization WHERE status = 'PENDING'");
    result.pending = Number(waiting.n);
    result.pendingMany = result.pending > 1;
    res.render('admin/index', result);
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

    const [accounts] = await db().execute(
        "SELECT full_name AS name, email, active FROM user_account WHERE org_id = ? AND role = 'COMPANY' ORDER BY user_id", [req.params.id]);
    const [documents] = await db().execute(
        'SELECT document_id AS id, file_name AS name, file_type AS type, file_size AS size, DATE_FORMAT(uploaded_at, \'%Y-%m-%d\') AS uploaded FROM org_document WHERE org_id = ? ORDER BY document_id', [req.params.id]);
    documents.forEach(d => { d.kb = Math.max(1, Math.round(d.size / 1024)); });
    const [users] = await db().execute(
        "SELECT full_name AS name, email, role, active FROM user_account WHERE org_id = ? AND role <> 'COMPANY' ORDER BY full_name LIMIT " + USERS_SHOWN, [req.params.id]);
    users.forEach(u => { u.roleName = ROLE_NAMES[u.role]; u.isActive = (u.active === 1); });
    const [[counted]] = await db().execute("SELECT COUNT(*) AS n FROM user_account WHERE org_id = ? AND role <> 'COMPANY'", [req.params.id]);

    res.render('admin/company', { org: org, accounts: accounts, documents: documents, users: users,
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
