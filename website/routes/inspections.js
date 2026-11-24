// UC8, UC9, UC10: the site inspector records the received and accepted quantity of a delivery.
// The system calculates the accepted value and the retention (Business Plan v3, section 5.4).
// An inspector only sees the deliveries of the projects of his own company (p.org_id = the company of the logged-in user).
// Rules: a delivery can be inspected only when its status is DELIVERED; the inspection can be changed or deleted
// only while the status is INSPECTED (after the contractor completes the delivery it is closed).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const app = express.Router();

const db = () => app.connection.promise();

const BADGES = { DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success' };

// One row of the inspection list. Accepted value = delivery value x accepted / ordered; retention = accepted value x rate.
const SELECT_ROWS = `
    SELECT d.delivery_id                         AS ID,
           p.project_name                        AS project,
           s.org_name                            AS supplier,
           m.material_name                       AS material,
           m.unit                                AS unit,
           CAST(d.ordered_quantity AS DOUBLE)    AS ordered,
           d.status                              AS status,
           CAST(i.received_quantity AS DOUBLE)   AS received,
           CAST(i.accepted_quantity AS DOUBLE)   AS accepted,
           FORMAT(d.delivery_value * i.accepted_quantity / d.ordered_quantity, 0)                    AS acceptedValue,
           FORMAT(d.delivery_value * i.accepted_quantity / d.ordered_quantity * i.retention_rate, 0) AS retention
    FROM delivery d
    JOIN project p         ON p.project_id = d.project_id
    JOIN organization s    ON s.org_id = d.org_id
    JOIN material m        ON m.material_id = d.material_id
    LEFT JOIN inspection i ON i.delivery_id = d.delivery_id
    WHERE p.org_id = ? AND d.status IN ('DELIVERED', 'INSPECTED', 'COMPLETED')`;

// Add the values that the template needs (Handlebars cannot compare values, so we do it here).
function prepare(row) {
    row.badge = BADGES[row.status];
    row.canInspect = (row.status === 'DELIVERED');
    row.canChange = (row.status === 'INSPECTED');
    if (row.received !== null) {
        if (row.accepted === 0) row.decision = 'Rejected';
        else if (row.accepted === row.received) row.decision = 'Accepted';
        else row.decision = 'Partially accepted';
    }
    return row;
}

async function findRow(id, orgId) {
    const [rows] = await db().execute(SELECT_ROWS + ' AND d.delivery_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Check the two quantities. Returns an error message, or null when they are fine.
function checkQuantities(received, accepted, ordered) {
    if (!(received >= 0)) return 'The received quantity cannot be negative.';
    if (!(accepted >= 0)) return 'The accepted quantity cannot be negative.';
    if (accepted > received) return 'The accepted quantity cannot be more than the received quantity.';
    if (accepted > ordered) return 'The accepted quantity cannot be more than the ordered quantity.';
    return null;
}

// ---------- R: the list (deliveries waiting for inspection first) ----------
app.get('/', async (req, res) => {
    const SQL = SELECT_ROWS + " ORDER BY d.status = 'DELIVERED' DESC, d.slot_start DESC";
    const [rows] = await db().execute(SQL, [req.user.orgId]);
    res.render('inspections/index', { rows: rows.map(prepare) });
});

// ---------- C: the form to inspect a delivery ----------
app.get('/:id/new', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (!row.canInspect) return fail(res, 'Only DELIVERED deliveries can be inspected.', 409);
    row.isNew = true;
    row.received = row.ordered;      // usually the full quantity arrives
    row.accepted = row.ordered;
    res.render('inspections/form', row);
});

// ---------- C: save the inspection ----------
app.post('/:id', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (req.body.action !== 'save') return res.render('inspections/row', row);     // cancel

    const received = Number(req.body.received_quantity);
    const accepted = Number(req.body.accepted_quantity);
    const message = checkQuantities(received, accepted, row.ordered);
    if (message) return fail(res, message);

    try {
        // The retention rate is copied from the project, so a later change of the project rate does not change this delivery.
        const [result] = await db().execute(
            `INSERT INTO inspection (delivery_id, inspector_id, received_quantity, accepted_quantity, retention_rate)
             SELECT d.delivery_id, ?, ?, ?, p.retention_rate
             FROM delivery d JOIN project p ON p.project_id = d.project_id
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'DELIVERED'`,
            [req.user.id, received, accepted, req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) return fail(res, 'Only DELIVERED deliveries can be inspected.', 409);

        await db().execute("UPDATE delivery SET status = 'INSPECTED' WHERE delivery_id = ?", [req.params.id]);

        const fresh = await findRow(req.params.id, req.user.orgId);
        fresh.message = 'Delivery #' + req.params.id + ' inspected: ' + fresh.decision + '.';
        fresh.kind = 'success';
        res.render('inspections/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- U: the form to change an inspection ----------
app.get('/:id/edit', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (!row.canChange) return fail(res, 'Only INSPECTED deliveries can be changed.', 409);
    row.isNew = false;
    res.render('inspections/form', row);
});

// ---------- U: save the changes ----------
app.put('/:id', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (req.body.action !== 'save') return res.render('inspections/row', row);     // cancel
    if (!row.canChange) return fail(res, 'Only INSPECTED deliveries can be changed.', 409);

    const received = Number(req.body.received_quantity);
    const accepted = Number(req.body.accepted_quantity);
    const message = checkQuantities(received, accepted, row.ordered);
    if (message) return fail(res, message);

    try {
        await db().execute(
            `UPDATE inspection i
             JOIN delivery d ON d.delivery_id = i.delivery_id
             JOIN project p  ON p.project_id = d.project_id
             SET i.received_quantity = ?, i.accepted_quantity = ?, i.inspector_id = ?
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'INSPECTED'`,
            [received, accepted, req.user.id, req.params.id, req.user.orgId]);

        const fresh = await findRow(req.params.id, req.user.orgId);
        fresh.message = 'Inspection of delivery #' + req.params.id + ' updated: ' + fresh.decision + '.';
        fresh.kind = 'success';
        res.render('inspections/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete the inspection (the delivery goes back to DELIVERED) ----------
app.delete('/:id', async (req, res) => {
    try {
        const [result] = await db().execute(
            `DELETE i FROM inspection i
             JOIN delivery d ON d.delivery_id = i.delivery_id
             JOIN project p  ON p.project_id = d.project_id
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'INSPECTED'`,
            [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) return fail(res, 'Only inspections of INSPECTED deliveries can be deleted.', 409);

        await db().execute("UPDATE delivery SET status = 'DELIVERED' WHERE delivery_id = ?", [req.params.id]);

        const fresh = await findRow(req.params.id, req.user.orgId);
        fresh.message = 'Inspection of delivery #' + req.params.id + ' deleted. The delivery is waiting for inspection again.';
        fresh.kind = 'success';
        res.render('inspections/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
