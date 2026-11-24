// UC5: the supplier sees the deliveries assigned to its company and updates their status step by step:
// SCHEDULED -> PREPARING -> IN_TRANSIT -> DELIVERED.
// A supplier only sees the deliveries of its own company (d.org_id = the company of the logged-in user).
// Rules: one step forward at a time (no skipping, no going back); the supplier cannot set INSPECTED or COMPLETED
// (the inspector and the contractor do that). The button sends the status that the user saw ("from"), so a double click
// or a change made meanwhile cannot move the delivery two steps.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};

const NEXT = { SCHEDULED: 'PREPARING', PREPARING: 'IN_TRANSIT', IN_TRANSIT: 'DELIVERED' };
const LABELS = { SCHEDULED: 'Start preparing', PREPARING: 'Mark in transit', IN_TRANSIT: 'Mark delivered' };

// One delivery as the supplier sees it. The caller adds the rest of the WHERE condition and the ORDER BY.
const SELECT_ASSIGNED = `
    SELECT d.delivery_id                               AS ID,
           c.org_name                                  AS contractor,
           p.project_name                              AS project,
           m.material_name                             AS material,
           m.unit                                      AS unit,
           CAST(d.ordered_quantity AS DOUBLE)          AS quantity,
           DATE_FORMAT(d.slot_start, '%Y-%m-%d %H:%i') AS slotStart,
           IF(DATE(d.slot_end) = DATE(d.slot_start),
              DATE_FORMAT(d.slot_end, '%H:%i'),
              DATE_FORMAT(d.slot_end, '%Y-%m-%d %H:%i')) AS slotEnd,
           d.status                                    AS status,
           (SELECT COUNT(*) FROM delivery_document x WHERE x.delivery_id = d.delivery_id) AS documents
    FROM delivery d
    JOIN project p      ON p.project_id = d.project_id
    JOIN organization c ON c.org_id = p.org_id
    JOIN material m     ON m.material_id = d.material_id
    WHERE d.org_id = ?`;

// Add the values that the template needs (Handlebars cannot compare values, so we do it here).
function prepare(row) {
    row.badge = BADGES[row.status];
    row.nextStatus = NEXT[row.status];            // undefined when the supplier has nothing more to do
    row.nextLabel = LABELS[row.status];
    return row;
}

async function findAssigned(id, orgId) {
    const [rows] = await db().execute(SELECT_ASSIGNED + ' AND d.delivery_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Search, status filter and sorting of the list (see lib/listing.js).
const LIST = {
    search: ['CAST(d.delivery_id AS CHAR)', 'c.org_name', 'p.project_name', 'm.material_name'],
    statuses: Object.keys(BADGES),
    statusColumn: 'd.status',
    sorts: {
        ID: 'd.delivery_id', contractor: 'c.org_name', material: 'm.material_name', quantity: 'd.ordered_quantity',
        slot: 'd.slot_start', documents: 'documents', status: "FIELD(d.status, 'SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED')"
    },
    tieBreak: 'd.delivery_id DESC',
    // the deliveries that still need work first, the nearest time slot first
    defaultOrder: "d.status IN ('INSPECTED', 'COMPLETED'), d.slot_start, d.delivery_id"
};

// ---------- R: list ----------
app.get('/', async (req, res) => {
    res.render('assigned/index', await readList(db(), req, LIST, SELECT_ASSIGNED, [req.user.orgId], prepare));
});

// ---------- U: move the delivery one step forward ----------
app.put('/:id', async (req, res) => {
    const id = req.params.id;
    const orgId = req.user.orgId;
    const from = req.body.from;

    const to = NEXT[from];
    if (!to) return fail(res, 'This status cannot be changed by the supplier.');

    const row = await findAssigned(id, orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);

    try {
        // The condition status = from makes sure that the delivery is still in the status that the user saw.
        const [result] = await db().execute(
            'UPDATE delivery SET status = ? WHERE delivery_id = ? AND org_id = ? AND status = ?',
            [to, id, orgId, from]);

        const fresh = await findAssigned(id, orgId);
        if (result.affectedRows === 0) {
            // The status was already different: show the row as it is now, with a warning, instead of changing anything.
            return res.render('assigned/rowToast', Object.assign(fresh, {
                message: 'Delivery #' + id + ' is now ' + fresh.status + ' (it changed meanwhile). Nothing was changed.',
                kind: 'warning'
            }));
        }
        res.render('assigned/rowToast', Object.assign(fresh, {
            message: 'Delivery #' + id + ' is now ' + to + '.',
            kind: 'success'
        }));
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
