// The company account (role COMPANY): sees and manages the users of its own company, and
//   - a contractor appoints third-party inspection companies (their inspectors can then inspect the deliveries of the contractor's projects);
//   - an inspection company sees which contractors appointed it.
// Every query uses req.user.orgId, so a company account can never see or change the users of another company.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList, like } = require('../lib/listing');
const { ROLE_NAMES } = require('../lib/auth');
const { resetPassword } = require('../lib/password');
const app = express.Router();

const db = () => app.connection.promise();

// ---------- the users of the company ----------
// The state of a user as the company account sees it: a new registration WAITING for a decision, ACTIVE, SWITCHED OFF or REJECTED.
const USER_STATE = "CASE WHEN u.status = 'PENDING' THEN 'WAITING' WHEN u.status = 'REJECTED' THEN 'REJECTED' "
                 + "WHEN u.active = 1 THEN 'ACTIVE' ELSE 'SWITCHED OFF' END";

const SELECT_USERS = `
    SELECT u.user_id AS ID, u.full_name AS name, u.email AS email, u.role AS role, u.active AS active, u.status AS approval,
           DATE_FORMAT(u.created_at, '%Y-%m-%d') AS registered
    FROM user_account u
    WHERE u.org_id = ? AND u.role <> 'COMPANY'`;

const LIST = {
    search: ['u.full_name', 'u.email'],
    statuses: ['WAITING', 'ACTIVE', 'SWITCHED OFF', 'REJECTED'],
    statusColumn: USER_STATE,
    sorts: { name: 'u.full_name', email: 'u.email', role: 'u.role', status: "FIELD(" + USER_STATE + ", 'WAITING', 'ACTIVE', 'SWITCHED OFF', 'REJECTED')",
             registered: 'u.created_at' },
    tieBreak: 'u.user_id',
    defaultOrder: "u.status = 'PENDING' DESC, u.full_name",      // the registrations that wait for a decision first
    allLabel: 'All users'
};

function prepare(row) {
    row.roleName = ROLE_NAMES[row.role];
    row.isWaiting = (row.approval === 'PENDING');
    row.isRejected = (row.approval === 'REJECTED');
    row.isActive = (row.approval === 'APPROVED' && row.active === 1);
    row.isOff = (row.approval === 'APPROVED' && row.active !== 1);
    return row;
}

async function findUser(id, orgId) {
    const [rows] = await db().execute(SELECT_USERS + ' AND u.user_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

app.get('/', async (req, res) => {
    res.render('company/index', await readList(db(), req, LIST, SELECT_USERS, [req.user.orgId], prepare));
});

// Make a temporary password for a user of the company who forgot his password (shown once, for the company account to pass on).
app.put('/users/:id/password', async (req, res) => {
    const user = await findUser(req.params.id, req.user.orgId);
    if (!user) return fail(res, 'User not found.', 404);
    if (!user.isActive) return fail(res, 'Only an active user can get a new password.', 409);
    const temporary = await resetPassword(db(), user.ID, "org_id = ? AND role <> 'COMPANY' AND status = 'APPROVED' AND active = 1", [req.user.orgId]);
    if (!temporary) return fail(res, 'The password of ' + user.name + ' could not be reset.', 409);
    res.render('company/rowToast', Object.assign(user, {
        message: 'Temporary password of ' + user.name + ': ' + temporary + ' . Give it to the person now (it is shown only once); '
            + 'the old password does not work any more, and the new one must be changed after the sign in.',
        kind: 'warning', seconds: 120
    }));
});

// Switch a user of the company off or on. A switched off user cannot sign in, and the pages stop working at his next click.
app.put('/users/:id', async (req, res) => {
    const user = await findUser(req.params.id, req.user.orgId);
    if (!user) return fail(res, 'User not found.', 404);
    if (user.approval !== 'APPROVED') return fail(res, 'Approve or reject the registration of ' + user.name + ' first.', 409);
    const active = (req.body.active === '1') ? 1 : 0;
    try {
        await db().execute("UPDATE user_account SET active = ? WHERE user_id = ? AND org_id = ? AND role <> 'COMPANY' AND status = 'APPROVED'",
            [active, req.params.id, req.user.orgId]);
        const fresh = await findUser(req.params.id, req.user.orgId);
        fresh.message = active ? fresh.name + ' can sign in again.' : fresh.name + ' is switched off and cannot sign in.';
        fresh.kind = 'success';
        res.render('company/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- U: approve or reject a new registration (PENDING -> APPROVED or REJECTED; a rejected person can still be approved later) ----------
app.put('/users/:id/approval', async (req, res) => {
    const user = await findUser(req.params.id, req.user.orgId);
    if (!user) return fail(res, 'User not found.', 404);
    const decision = req.body.decision;
    if (decision !== 'APPROVED' && decision !== 'REJECTED') return fail(res, 'Please approve or reject the registration.');
    if (decision === 'REJECTED' && user.approval !== 'PENDING') return fail(res, 'Only a waiting registration can be rejected. Switch the account off instead.', 409);
    if (decision === 'APPROVED' && user.approval === 'APPROVED') return fail(res, user.name + ' is already approved.', 409);
    try {
        // The condition on the old status makes sure that a double click or a decision made meanwhile does not change anything.
        const [result] = await db().execute(
            "UPDATE user_account SET status = ?, active = 1 WHERE user_id = ? AND org_id = ? AND role <> 'COMPANY' AND status = ?",
            [decision, req.params.id, req.user.orgId, user.approval]);
        const fresh = await findUser(req.params.id, req.user.orgId);
        if (result.affectedRows === 0) {
            return res.render('company/rowToast', Object.assign(fresh, { message: 'The registration of ' + fresh.name + ' changed meanwhile. Nothing was changed.', kind: 'warning' }));
        }
        fresh.message = decision === 'APPROVED'
            ? fresh.name + ' is approved and can sign in now.'
            : 'The registration of ' + fresh.name + ' is rejected. The person cannot sign in.';
        fresh.kind = 'success';
        // The new number of waiting registrations, for the badge in the menu (company/rowToast sends it with an <hx-partial>).
        const [[w]] = await db().execute("SELECT COUNT(*) AS n FROM user_account WHERE org_id = ? AND status = 'PENDING'", [req.user.orgId]);
        fresh.waitingUsers = Number(w.n);
        res.render('company/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- appointments of third-party inspection companies ----------
// A contractor chooses the inspection companies; an inspection company only sees the contractors that chose it.
async function showAppointments(req, res, message) {
    const orgId = req.user.orgId;
    if (req.user.orgType === 'CONTRACTOR') {
        const [appointed] = await db().execute(
            `SELECT o.org_id AS ID, o.org_name AS name, DATE_FORMAT(a.appointed_at, '%Y-%m-%d') AS since
             FROM inspection_appointment a JOIN organization o ON o.org_id = a.inspection_id
             WHERE a.contractor_id = ? ORDER BY o.org_name`, [orgId]);
        const options = await findInspectionCompanies(orgId, '');
        return res.render('company/appointments', Object.assign({ isContractor: true, appointed: appointed, message: message, kind: 'success' }, options));
    }
    if (req.user.orgType === 'INSPECTION') {
        const [appointed] = await db().execute(
            `SELECT o.org_id AS ID, o.org_name AS name, DATE_FORMAT(a.appointed_at, '%Y-%m-%d') AS since
             FROM inspection_appointment a JOIN organization o ON o.org_id = a.contractor_id
             WHERE a.inspection_id = ? ORDER BY o.org_name`, [orgId]);
        return res.render('company/appointments', { isContractor: false, appointed: appointed });
    }
    fail(res, 'Appointments are only for contractors and inspection companies.', 404);
}

// The approved inspection companies (not appointed yet) whose name or ID contains the text. The first 50 are sent.
const LIMIT = 50;
async function findInspectionCompanies(contractorId, textToFind) {
    const q = String(textToFind || '').trim().slice(0, 100);
    const where = ` WHERE o.org_type = 'INSPECTION' AND o.status = 'APPROVED'
                    AND o.org_id NOT IN (SELECT inspection_id FROM inspection_appointment WHERE contractor_id = ?)`
                  + (q ? ' AND (o.org_name LIKE ? OR o.org_id LIKE ?)' : '');
    const args = [contractorId].concat(q ? [like(q), like(q)] : []);
    const [[counted]] = await db().execute('SELECT COUNT(*) AS n FROM organization o' + where, args);
    const [companies] = await db().execute('SELECT o.org_id, o.org_name FROM organization o' + where + ' ORDER BY o.org_name LIMIT ' + LIMIT, args);
    const total = Number(counted.n);
    return { companies: companies, total: total, shown: companies.length, more: total > companies.length };
}

app.get('/appointments', async (req, res) => {
    await showAppointments(req, res);
});

app.get('/appointments/search', async (req, res) => {
    if (req.user.orgType !== 'CONTRACTOR') return fail(res, 'Only a contractor can appoint an inspection company.', 403);
    res.render('company/inspectionOptions', await findInspectionCompanies(req.user.orgId, req.query.q));
});

app.post('/appointments', async (req, res) => {
    if (req.user.orgType !== 'CONTRACTOR') return fail(res, 'Only a contractor can appoint an inspection company.', 403);
    const id = String(req.body.inspection_id || '').trim();
    if (!id) return fail(res, 'Please choose an inspection company.');
    try {
        const [orgs] = await db().execute("SELECT org_name FROM organization WHERE org_id = ? AND org_type = 'INSPECTION' AND status = 'APPROVED'", [id]);
        if (orgs.length === 0) return fail(res, 'Please choose an inspection company from the list.', 404);
        await db().execute('INSERT IGNORE INTO inspection_appointment (contractor_id, inspection_id) VALUES (?, ?)', [req.user.orgId, id]);
        await showAppointments(req, res, orgs[0].org_name + ' is appointed. Its inspectors can now inspect your deliveries.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

app.delete('/appointments/:id', async (req, res) => {
    if (req.user.orgType !== 'CONTRACTOR') return fail(res, 'Only a contractor can change the appointments.', 403);
    try {
        const [result] = await db().execute('DELETE FROM inspection_appointment WHERE contractor_id = ? AND inspection_id = ?', [req.user.orgId, req.params.id]);
        if (result.affectedRows === 0) return fail(res, 'This inspection company is not appointed.', 404);
        // Nothing except the message: hx-swap="delete" of the button removes the row (HTMX 4 does not swap an empty response next to a partial) and the message goes to #toast.
        res.render('toast', { message: 'The appointment is removed. Its inspectors cannot see your deliveries any more.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
