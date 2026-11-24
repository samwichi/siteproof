// UC5: the supplier sees the deliveries assigned to its company and updates their status.
// A supplier only sees the deliveries of its own company (d.org_id = the company of the logged-in user).
// Rules: the status moves one step at a time, SCHEDULED -> PREPARING -> IN_TRANSIT -> DELIVERED.
// The supplier can also go back one step to correct a mistake, but only until the delivery is inspected
// (INSPECTED and COMPLETED are set by the inspector and the contractor, never by the supplier).
// Each change sends the status that the supplier saw ("from"), and the UPDATE checks it, so a double click
// or a second browser tab cannot skip a step.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const app = express.Router();

const db = () => app.connection.promise();

// The steps that the supplier controls, in order.
const STEPS = ['SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED'];

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};

// One delivery as the supplier sees it. The caller adds the rest of the WHERE condition and the ORDER BY.
const SELECT_DELIVERIES = `
    SELECT d.delivery_id                              AS ID,
           p.project_name                             AS project,
           c.org_name                                 AS contractor,
           m.material_name                            AS material,
           m.unit                                     AS unit,
           CAST(d.ordered_quantity AS DOUBLE)         AS quantity,
           DATE_FORMAT(d.slot_start, '%Y-%m-%d %H:%i') AS slotStart,
           IF(DATE(d.slot_end) = DATE(d.slot_start),
              DATE_FORMAT(d.slot_end, '%H:%i'),
              DATE_FORMAT(d.slot_end, '%Y-%m-%d %H:%i')) AS slotEnd,
           (SELECT COUNT(*) FROM delivery_document doc WHERE doc.delivery_id = d.delivery_id) AS documents,
           d.status                                   AS status
    FROM delivery d
    JOIN project p      ON p.project_id = d.project_id
    JOIN organization c ON c.org_id = p.org_id
    JOIN material m     ON m.material_id = d.material_id
    WHERE d.org_id = ?`;

// Add the values that the templates need (Handlebars cannot compare values, so we do it here).
function prepare(row) {
    row.badge = BADGES[row.status];
    const i = STEPS.indexOf(row.status);                       // -1 when INSPECTED or COMPLETED
    row.next = (i >= 0 && i < STEPS.length - 1) ? STEPS[i + 1] : null;
    row.back = (i > 0) ? STEPS[i - 1] : null;
    row.nextBadge = BADGES[row.next];
    return row;
}

async function findDelivery(id, orgId) {
    const [rows] = await db().execute(SELECT_DELIVERIES + ' AND d.delivery_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// ---------- R: list (open deliveries first, then the nearest time slot) ----------
app.get('/', async (req, res) => {
    const [rows] = await db().execute(
        SELECT_DELIVERIES + ` ORDER BY d.status IN ('INSPECTED', 'COMPLETED'), d.slot_start, d.delivery_id`,
        [req.user.orgId]);
    res.render('status/index', { rows: rows.map(prepare) });
});

// ---------- U: one step forward (action=next) or one step back (action=back) ----------
app.put('/:id', async (req, res) => {
    const id = req.params.id;
    const orgId = req.user.orgId;
    const from = req.body.from;
    const i = STEPS.indexOf(from);
    let to = null;
    if (req.body.action === 'next' && i >= 0 && i < STEPS.length - 1) to = STEPS[i + 1];
    if (req.body.action === 'back' && i > 0) to = STEPS[i - 1];
    if (!to) return fail(res, 'This status change is not allowed.');

    try {
        // The delivery must belong to the company of the logged-in user and still have the status that the supplier saw.
        const [result] = await db().execute(
            'UPDATE delivery SET status = ? WHERE delivery_id = ? AND org_id = ? AND status = ?',
            [to, id, orgId, from]);

        const row = await findDelivery(id, orgId);
        if (!row) return fail(res, 'Delivery not found.', 404);
        if (result.affectedRows === 0) {
            // Someone changed the status meanwhile (another tab, or the inspector): show the current row and explain.
            return res.render('status/rowToast', Object.assign(row, {
                message: 'Delivery #' + id + ' is now ' + row.status + ', so it was not changed. Please check it again.',
                kind: 'warning'
            }));
        }
        res.render('status/rowToast', Object.assign(row, {
            message: 'Delivery #' + id + ': ' + from + ' -> ' + to + '.', kind: 'success'
        }));
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
