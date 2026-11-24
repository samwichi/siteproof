// Projects of a contractor: the company account of a contractor creates, lists, edits and deletes the projects of its company.
// The project managers of the company choose one of these projects when they create a delivery (routes/deliveries.js).
// Rules:
//   - every query is limited to the company of the logged-in company account (p.org_id = req.user.orgId);
//   - the retention rate is entered in percent (5 = 5%) and stored as a rate (0.050). An inspection copies the rate of the project when
//     it is recorded, so a new rate only changes the retention of the next inspections, never of the ones that were already recorded;
//   - a project can be deleted only while it has no delivery (the deliveries need it for their history).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

// Only the company account of a contractor has projects (suppliers and inspection companies do not).
app.use((req, res, next) => {
    if (req.user.orgType !== 'CONTRACTOR') return fail(res, 'Only a contractor has projects.', 403);
    next();
});

// One project as the company account sees it. The caller adds the rest of the WHERE condition and the ORDER BY.
const SELECT_PROJECTS = `
    SELECT p.project_id                                 AS ID,
           p.project_name                               AS name,
           CAST(p.retention_rate * 100 AS DOUBLE)       AS retentionPercent,
           (SELECT COUNT(*) FROM delivery d WHERE d.project_id = p.project_id)                            AS deliveries,
           (SELECT COUNT(*) FROM delivery d WHERE d.project_id = p.project_id AND d.status <> 'COMPLETED') AS open
    FROM project p
    WHERE p.org_id = ?`;

function prepare(row) {
    row.deliveries = Number(row.deliveries);
    row.open = Number(row.open);
    row.canDelete = (row.deliveries === 0);
    return row;
}

async function findProject(id, orgId) {
    const [rows] = await db().execute(SELECT_PROJECTS + ' AND p.project_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Search and sorting of the list (see lib/listing.js). There is no status, so the status filter is hidden.
const LIST = {
    search: ['p.project_name'],
    sorts: { name: 'p.project_name', retention: 'p.retention_rate', deliveries: 'deliveries', open: 'open' },
    tieBreak: 'p.project_id',
    defaultOrder: 'p.project_name'
};

async function showList(req, res, message) {
    const data = await readList(db(), req, LIST, SELECT_PROJECTS, [req.user.orgId], prepare);
    res.render('projects/index', Object.assign(data, { message: message, kind: 'success' }));
}

// Check the two fields of the create form and the edit form. Returns { error } or { name, rate }.
function readFields(body) {
    const name = String(body.project_name || '').trim();
    const percent = Number(body.retention_percent);
    if (!name) return { error: 'Please enter the name of the project.' };
    if (name.length > 100) return { error: 'The name of the project can have at most 100 characters.' };
    if (String(body.retention_percent || '').trim() === '' || !(percent >= 0 && percent <= 100)) {
        return { error: 'The retention rate must be a number from 0 to 100 (%).' };
    }
    if (Math.round(percent * 10) !== percent * 10) return { error: 'The retention rate can have at most one decimal (for example 5.5).' };
    return { name: name, rate: Math.round(percent * 10) / 1000 };       // 5.5 % -> 0.055
}

function duplicateMessage(err) {
    return err.errno === 1062 ? 'Your company has already a project with this name.' : sqlMessage(err);
}

// ---------- R: list (with the create form at the top) ----------
app.get('/', async (req, res) => {
    await showList(req, res);
});

// ---------- C: create ----------
app.post('/', async (req, res) => {
    const f = readFields(req.body);
    if (f.error) return fail(res, f.error);
    try {
        await db().execute('INSERT INTO project (org_id, project_name, retention_rate) VALUES (?, ?, ?)', [req.user.orgId, f.name, f.rate]);
        await showList(req, res, 'Project "' + f.name + '" created. Your project managers can now create deliveries for it.');
    }
    catch (err) {
        fail(res, duplicateMessage(err));
    }
});

// ---------- U: the form to edit one row ----------
app.get('/:id/edit', async (req, res) => {
    const row = await findProject(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Project not found.', 404);
    res.render('projects/edit', row);
});

// ---------- U: save (action=update) or close the form (action=cancel) ----------
app.put('/:id', async (req, res) => {
    const row = await findProject(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Project not found.', 404);
    if (req.body.action !== 'update') return res.render('projects/row', row);       // cancel: show the row without changes

    const f = readFields(req.body);
    if (f.error) return fail(res, f.error);
    try {
        await db().execute('UPDATE project SET project_name = ?, retention_rate = ? WHERE project_id = ? AND org_id = ?',
            [f.name, f.rate, req.params.id, req.user.orgId]);
        const fresh = await findProject(req.params.id, req.user.orgId);
        const note = fresh.retentionPercent !== row.retentionPercent && row.deliveries > 0
            ? ' The new retention rate is used for the next inspections; the recorded inspections keep their rate.' : '';
        res.render('projects/rowToast', Object.assign(fresh, { message: 'Project "' + fresh.name + '" updated.' + note, kind: 'success' }));
    }
    catch (err) {
        fail(res, duplicateMessage(err));
    }
});

// ---------- D: delete (only a project without deliveries) ----------
app.delete('/:id', async (req, res) => {
    try {
        const [result] = await db().execute(
            `DELETE p FROM project p
             WHERE p.project_id = ? AND p.org_id = ?
               AND NOT EXISTS (SELECT 1 FROM delivery d WHERE d.project_id = p.project_id)`,
            [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) return fail(res, 'Only a project of your company without deliveries can be deleted.', 409);
        // hx-swap="delete" of the button removes the row (see the note in website/README.md, section 4).
        res.render('toast', { message: 'Project deleted.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
