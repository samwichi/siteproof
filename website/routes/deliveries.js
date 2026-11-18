// UC2 / UC3: the contractor creates, lists, edits and deletes delivery records.
// A contractor only sees the deliveries of the projects of his own company (p.org_id = the company of the logged-in user).
// A delivery can be edited or deleted only while its status is SCHEDULED (before the supplier starts to work on it).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const app = express.Router();

// The promise version of the connection pool injected by app.js (same mysql2 package as in the laboratory, but with async/await).
const db = () => app.connection.promise();

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};

// One delivery as the user sees it. The caller adds the rest of the WHERE condition and the ORDER BY.
const SELECT_DELIVERIES = `
    SELECT d.delivery_id                              AS ID,
           p.project_name                             AS project,
           s.org_name                                 AS supplier,
           m.material_name                            AS material,
           m.unit                                     AS unit,
           CAST(d.ordered_quantity AS DOUBLE)         AS quantity,
           CAST(d.delivery_value AS DOUBLE)           AS valueRaw,
           FORMAT(d.delivery_value, 0)                AS value,
           DATE_FORMAT(d.slot_start, '%Y-%m-%d %H:%i') AS slotStart,
           IF(DATE(d.slot_end) = DATE(d.slot_start),
              DATE_FORMAT(d.slot_end, '%H:%i'),
              DATE_FORMAT(d.slot_end, '%Y-%m-%d %H:%i')) AS slotEnd,
           DATE_FORMAT(d.slot_start, '%Y-%m-%dT%H:%i') AS slotStartInput,
           DATE_FORMAT(d.slot_end, '%Y-%m-%dT%H:%i')   AS slotEndInput,
           d.status                                   AS status,
           (d.status = 'SCHEDULED')                   AS canEdit
    FROM delivery d
    JOIN project p      ON p.project_id = d.project_id
    JOIN organization s ON s.org_id = d.org_id
    JOIN material m     ON m.material_id = d.material_id
    WHERE p.org_id = ?`;

function prepare(row) {
    row.badge = BADGES[row.status];
    return row;
}

async function findDelivery(id, orgId) {
    const [rows] = await db().execute(SELECT_DELIVERIES + ' AND d.delivery_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Show the whole list in main#main, with an optional message in the toast.
async function showList(res, orgId, message) {
    const [rows] = await db().execute(SELECT_DELIVERIES + ' ORDER BY d.slot_start DESC, d.delivery_id DESC', [orgId]);
    res.render('deliveries/index', { rows: rows.map(prepare), message: message, kind: 'success' });
}

// The browser sends 2026-11-24T08:00 (datetime-local); MySQL wants a space.
const toDatetime = (text) => String(text).replace('T', ' ');

// Check the fields that the create form and the edit form have in common. Returns an error message, or null when everything is fine.
function checkFields(quantity, value, start, end) {
    if (!(quantity > 0)) return 'The quantity must be more than 0.';
    if (!(value >= 0)) return 'The value cannot be negative.';
    if (!start || !end) return 'Please enter the time slot.';
    if (String(end) <= String(start)) return 'The end of the time slot must be after its start.';
    return null;
}

// ---------- R: list ----------
app.get('/', async (req, res) => {
    await showList(res, req.user.orgId);
});

// ---------- C: the form to create a delivery (must be before /:id routes) ----------
app.get('/new', async (req, res) => {
    const [projects] = await db().execute(
        'SELECT project_id, project_name FROM project WHERE org_id = ? ORDER BY project_name', [req.user.orgId]);
    const [suppliers] = await db().execute(
        "SELECT org_id, org_name FROM organization WHERE org_type = 'SUPPLIER' ORDER BY org_name");
    const [materials] = await db().execute(
        `SELECT m.material_id, m.material_name, m.unit, c.category_name
         FROM material m JOIN material_category c ON c.category_id = m.category_id
         ORDER BY c.category_id, m.material_name`);

    // Group the materials by category, so the <select> can show <optgroup>s.
    const groups = [];
    for (const m of materials) {
        let g = groups[groups.length - 1];
        if (!g || g.category !== m.category_name) {
            g = { category: m.category_name, items: [] };
            groups.push(g);
        }
        g.items.push(m);
    }
    res.render('deliveries/new', { projects: projects, suppliers: suppliers, groups: groups });
});

// ---------- C: create ----------
app.post('/', async (req, res) => {
    const b = req.body;
    const quantity = Number(b.ordered_quantity);
    const price = Number(b.unit_price);
    const value = Math.round(quantity * price * 100) / 100;       // delivery value = quantity x agreed unit price

    const message = checkFields(quantity, price, b.slot_start, b.slot_end);
    if (message) return fail(res, message);

    try {
        // The project must belong to the company of the logged-in user.
        const [own] = await db().execute(
            'SELECT project_id FROM project WHERE project_id = ? AND org_id = ?', [b.project_id, req.user.orgId]);
        if (own.length === 0) return fail(res, 'Please choose one of your projects.', 404);

        const [result] = await db().execute(
            `INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [b.project_id, b.org_id, b.material_id, req.user.id, quantity, value,
             toDatetime(b.slot_start), toDatetime(b.slot_end)]);
        await showList(res, req.user.orgId, 'Delivery #' + result.insertId + ' created.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- U: the form to edit one row ----------
app.get('/:id/edit', async (req, res) => {
    const row = await findDelivery(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (!row.canEdit) return fail(res, 'Only deliveries with status SCHEDULED can be edited.', 409);
    res.render('deliveries/edit', row);
});

// ---------- U: save (action=update) or close the form (action=cancel) ----------
app.put('/:id', async (req, res) => {
    const id = req.params.id;
    const orgId = req.user.orgId;
    const row = await findDelivery(id, orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);

    if (req.body.action !== 'update') {
        return res.render('deliveries/row', row);                 // cancel: show the row without changes
    }

    const b = req.body;
    const quantity = Number(b.ordered_quantity);
    const value = Number(b.delivery_value);
    const message = checkFields(quantity, value, b.slot_start, b.slot_end);
    if (message) return fail(res, message);
    if (!row.canEdit) return fail(res, 'Only deliveries with status SCHEDULED can be edited.', 409);

    try {
        const [result] = await db().execute(
            `UPDATE delivery d JOIN project p ON p.project_id = d.project_id
             SET d.ordered_quantity = ?, d.delivery_value = ?, d.slot_start = ?, d.slot_end = ?
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'SCHEDULED'`,
            [quantity, value, toDatetime(b.slot_start), toDatetime(b.slot_end), id, orgId]);

        const fresh = await findDelivery(id, orgId);
        if (result.affectedRows === 0 && !fresh.canEdit) {
            return fail(res, 'The status changed meanwhile: only SCHEDULED deliveries can be edited.', 409);
        }
        res.render('deliveries/rowToast', Object.assign(fresh, { message: 'Delivery #' + id + ' updated.', kind: 'success' }));
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete ----------
app.delete('/:id', async (req, res) => {
    try {
        const [result] = await db().execute(
            `DELETE d FROM delivery d JOIN project p ON p.project_id = d.project_id
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'SCHEDULED'`,
            [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) {
            return fail(res, 'Only SCHEDULED deliveries of your projects can be deleted.', 409);
        }
        // Nothing except the message: HTMX removes the row (outerHTML swap with an empty response) and shows the message in #toast.
        res.render('toast', { message: 'Delivery #' + req.params.id + ' deleted.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
