// UC4: after the inspection, the contractor project manager completes the delivery and rates the supplier (1 to 5).
// The rating is mandatory, also when the delivery was rejected (Business Plan v3, section 5.4).
// A contractor only sees the deliveries of the projects of his own company (p.org_id = the company of the logged-in user).
// Rules: an INSPECTED delivery can be rated (it becomes COMPLETED); the rating of a COMPLETED delivery can be changed,
// or deleted (the delivery goes back to INSPECTED).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const { inTransaction } = require('../lib/transaction');
const notify = require('../lib/notify');
const app = express.Router();

const db = () => app.connection.promise();

const BADGES = { INSPECTED: 'dark', COMPLETED: 'success' };

const SELECT_ROWS = `
    SELECT d.delivery_id                         AS ID,
           p.project_name                        AS project,
           s.org_name                            AS supplier,
           m.material_name                       AS material,
           d.status                              AS status,
           CAST(i.received_quantity AS DOUBLE)   AS received,
           CAST(i.accepted_quantity AS DOUBLE)   AS accepted,
           r.score                               AS score,
           u.full_name                           AS ratedBy
    FROM delivery d
    JOIN project p              ON p.project_id = d.project_id
    JOIN organization s         ON s.org_id = d.org_id
    JOIN material m             ON m.material_id = d.material_id
    JOIN inspection i           ON i.delivery_id = d.delivery_id
    LEFT JOIN supplier_rating r ON r.delivery_id = d.delivery_id
    LEFT JOIN user_account u    ON u.user_id = r.rated_by
    WHERE p.org_id = ? AND d.status IN ('INSPECTED', 'COMPLETED')`;

// Add the values that the template needs (Handlebars cannot compare values, so we do it here).
function prepare(row) {
    row.badge = BADGES[row.status];
    row.canRate = (row.status === 'INSPECTED');
    row.canChange = (row.status === 'COMPLETED');
    if (row.accepted === 0) row.decision = 'Rejected';
    else if (row.accepted === row.received) row.decision = 'Accepted';
    else row.decision = 'Partially accepted';
    if (row.score) row.stars = '★'.repeat(row.score) + '☆'.repeat(5 - row.score);
    // The 5 options of the <select>, with the current score selected.
    row.options = [1, 2, 3, 4, 5].map(n => ({ value: n, selected: n === (row.score || 3) }));
    return row;
}

async function findRow(id, orgId) {
    const [rows] = await db().execute(SELECT_ROWS + ' AND d.delivery_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Returns the score as a number from 1 to 5, or null when it is not valid.
function readScore(text) {
    const score = Number(text);
    return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

// Search, status filter and sorting of the list (see lib/listing.js).
const LIST = {
    search: ['CAST(d.delivery_id AS CHAR)', 'p.project_name', 's.org_name', 'm.material_name'],
    statuses: Object.keys(BADGES),
    statusColumn: 'd.status',
    sorts: {
        ID: 'd.delivery_id', project: 'p.project_name', supplier: 's.org_name', material: 'm.material_name',
        rating: 'r.score', status: "FIELD(d.status, 'SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED')"
    },
    tieBreak: 'd.delivery_id DESC',
    defaultOrder: "d.status = 'INSPECTED' DESC, d.slot_start DESC"
};

// ---------- R: the list (deliveries waiting for a rating first) ----------
app.get('/', async (req, res) => {
    res.render('ratings/index', await readList(db(), req, LIST, SELECT_ROWS, [req.user.orgId], prepare));
});

// ---------- C: the form to complete and rate ----------
app.get('/:id/new', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (!row.canRate) return fail(res, 'Only INSPECTED deliveries can be rated.', 409);
    row.isNew = true;
    res.render('ratings/form', row);
});

// ---------- C: save the rating and complete the delivery ----------
app.post('/:id', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (req.body.action !== 'save') return res.render('ratings/row', row);     // cancel

    const score = readScore(req.body.score);
    if (!score) return fail(res, 'Please choose a score from 1 to 5.');

    try {
        // One transaction: the record and the new status of the delivery are saved together, or not at all.
        const result = await inTransaction(db(), async conn => {
            const [r] = await conn.execute(
                `INSERT INTO supplier_rating (delivery_id, rated_by, score)
                 SELECT d.delivery_id, ?, ?
                 FROM delivery d JOIN project p ON p.project_id = d.project_id
                 WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'INSPECTED'`,
                [req.user.id, score, req.params.id, req.user.orgId]);
            if (r.affectedRows === 1) await conn.execute("UPDATE delivery SET status = 'COMPLETED' WHERE delivery_id = ? AND status = 'INSPECTED'", [req.params.id]);
            return r;
        });
        if (result.affectedRows === 0) return fail(res, 'Only INSPECTED deliveries can be rated.', 409);

        const fresh = await findRow(req.params.id, req.user.orgId);
        const about = await notify.aboutDelivery(db(), req.params.id);
        await notify.toCompany(db(), about.supplierId, 'SUPPLIER',
            about.contractor + ' completed delivery #' + req.params.id + ' (' + about.material + ') and rated it ' + score + '/5.', '/history', req.user.id);
        fresh.message = 'Delivery #' + req.params.id + ' completed and rated ' + score + '/5.';
        fresh.kind = 'success';
        res.render('ratings/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- U: the form to change the rating ----------
app.get('/:id/edit', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (!row.canChange) return fail(res, 'Only the rating of a COMPLETED delivery can be changed.', 409);
    row.isNew = false;
    res.render('ratings/form', row);
});

// ---------- U: save the new score ----------
app.put('/:id', async (req, res) => {
    const row = await findRow(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);
    if (req.body.action !== 'save') return res.render('ratings/row', row);     // cancel
    if (!row.canChange) return fail(res, 'Only the rating of a COMPLETED delivery can be changed.', 409);

    const score = readScore(req.body.score);
    if (!score) return fail(res, 'Please choose a score from 1 to 5.');

    try {
        await db().execute(
            `UPDATE supplier_rating r
             JOIN delivery d ON d.delivery_id = r.delivery_id
             JOIN project p  ON p.project_id = d.project_id
             SET r.score = ?, r.rated_by = ?
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'COMPLETED'`,
            [score, req.user.id, req.params.id, req.user.orgId]);

        const fresh = await findRow(req.params.id, req.user.orgId);
        fresh.message = 'Rating of delivery #' + req.params.id + ' changed to ' + score + '/5.';
        fresh.kind = 'success';
        res.render('ratings/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete the rating (the delivery is not completed any more) ----------
app.delete('/:id', async (req, res) => {
    try {
        // One transaction: the record and the new status of the delivery are saved together, or not at all.
        const result = await inTransaction(db(), async conn => {
            const [r] = await conn.execute(
                `DELETE r FROM supplier_rating r
                 JOIN delivery d ON d.delivery_id = r.delivery_id
                 JOIN project p  ON p.project_id = d.project_id
                 WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'COMPLETED'`,
                [req.params.id, req.user.orgId]);
            if (r.affectedRows === 1) await conn.execute("UPDATE delivery SET status = 'INSPECTED' WHERE delivery_id = ? AND status = 'COMPLETED'", [req.params.id]);
            return r;
        });
        if (result.affectedRows === 0) return fail(res, 'Only the rating of a COMPLETED delivery can be deleted.', 409);

        const fresh = await findRow(req.params.id, req.user.orgId);
        fresh.message = 'Rating of delivery #' + req.params.id + ' deleted. The delivery must be rated again to be completed.';
        fresh.kind = 'success';
        res.render('ratings/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
