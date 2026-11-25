// UC2 / UC3: the contractor creates, lists, edits and deletes delivery records, and opens the detail page of one delivery.
// A contractor only sees the deliveries of the projects of his own company (p.org_id = the company of the logged-in user).
// A delivery can be edited or deleted only while its status is SCHEDULED (before the supplier starts to work on it).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList, like } = require('../lib/listing');
const { findMaterials } = require('../lib/materials');
const notify = require('../lib/notify');
const app = express.Router();

// The promise version of the connection pool injected by app.js (same mysql2 package as in the laboratory, but with async/await).
const db = () => app.connection.promise();

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};

// The life of a delivery, in order (used for the progress line on the detail page).
const STEPS = ['SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED'];

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

// Search, status filter and sorting of the list (see lib/listing.js).
const LIST = {
    search: ['CAST(d.delivery_id AS CHAR)', 'p.project_name', 's.org_name', 'm.material_name'],
    statuses: STEPS,
    statusColumn: 'd.status',
    sorts: {
        ID: 'd.delivery_id', project: 'p.project_name', supplier: 's.org_name', material: 'm.material_name',
        quantity: 'd.ordered_quantity', value: 'd.delivery_value', slot: 'd.slot_start',
        status: "FIELD(d.status, 'SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED')"
    },
    tieBreak: 'd.delivery_id DESC',
    defaultOrder: 'd.slot_start DESC, d.delivery_id DESC'
};

// Show the page of the list that the user asked for (?q=&status=&sort=&dir=&page=) in main#main, with an optional message in the toast.
async function showList(req, res, message) {
    const data = await readList(db(), req, LIST, SELECT_DELIVERIES, [req.user.orgId], prepare);
    res.render('deliveries/index', Object.assign(data, { message: message, kind: 'success' }));
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
    await showList(req, res);
});

// The suppliers whose name contains the text (500 suppliers are too many for a normal <select>, so only the first 50 are sent).
const SUPPLIER_LIMIT = 50;
async function findSuppliers(text) {
    const q = String(text || '').trim().slice(0, 100);
    const where = q ? ' AND org_name LIKE ?' : '';
    const args = q ? [like(q)] : [];
    const [[counted]] = await db().execute("SELECT COUNT(*) AS n FROM organization WHERE org_type = 'SUPPLIER' AND status = 'APPROVED'" + where, args);
    const [suppliers] = await db().execute(
        "SELECT org_id, org_name FROM organization WHERE org_type = 'SUPPLIER' AND status = 'APPROVED'" + where + ' ORDER BY org_name LIMIT ' + SUPPLIER_LIMIT, args);
    const total = Number(counted.n);
    return { suppliers: suppliers, total: total, shown: suppliers.length, more: total > suppliers.length };
}

// ---------- C: the <option>s of the supplier <select> while the user types in the search box (must be before /:id routes) ----------
app.get('/suppliers', async (req, res) => {
    res.render('deliveries/supplierOptions', await findSuppliers(req.query.q));
});

// The material picker (category buttons, search box, <select>) is shared with the product catalog of the suppliers: see lib/materials.js.

// ---------- C: the <option>s of the material <select> and the category buttons, while the user types or clicks a category (must be before /:id routes) ----------
app.get('/materials', async (req, res) => {
    res.render('deliveries/materialResponse', await findMaterials(db(), req.query.material_q, req.query.category));
});

// A listed product of an approved supplier (routes/catalog.js shows them), with the values that the new delivery form needs.
async function findCatalogProduct(id) {
    const [rows] = await db().execute(
        `SELECT sp.org_id AS supplierId, s.org_name AS supplier, sp.material_id AS materialId, m.material_name AS material, m.unit AS unit,
                CAST(sp.price_min AS DOUBLE) AS priceMin, CAST(sp.price_max AS DOUBLE) AS priceMax,
                CAST(sp.min_order_qty AS DOUBLE) AS minOrder, sp.lead_time_days AS leadTime, sp.note AS note
         FROM supplier_product sp
         JOIN organization s ON s.org_id = sp.org_id
         JOIN material m     ON m.material_id = sp.material_id
         WHERE sp.product_id = ? AND sp.active = 1 AND s.org_type = 'SUPPLIER' AND s.status = 'APPROVED'`, [id]);
    if (rows.length !== 1) return null;
    const p = rows[0];
    p.samePrice = (p.priceMin === p.priceMax);
    p.priceMid = Math.round((p.priceMin + p.priceMax) / 2 * 100) / 100;
    p.priceMinText = p.priceMin.toLocaleString('en-US');          // 2400 -> 2,400 (the form shows the range as a help)
    p.priceMaxText = p.priceMax.toLocaleString('en-US');
    return p;
}

// ---------- C: the form to create a delivery (must be before /:id routes) ----------
app.get('/new', async (req, res) => {
    const [projects] = await db().execute(
        'SELECT project_id, project_name FROM project WHERE org_id = ? ORDER BY project_name', [req.user.orgId]);
    const suppliers = await findSuppliers('');
    const materials = await findMaterials(db(), '', 0);
    // Opened from "Find products" (?product=ID): the supplier and the material of that listed product are chosen already.
    const product = req.query.product ? await findCatalogProduct(req.query.product) : null;
    res.render('deliveries/new', Object.assign(suppliers, materials,
        { projects: projects, product: product, productMissing: Boolean(req.query.product) && !product }));
});

// ---------- C: create ----------
app.post('/', async (req, res) => {
    const b = req.body;
    const quantity = Number(b.ordered_quantity);
    const price = Number(b.unit_price);
    const value = Math.round(quantity * price * 100) / 100;       // delivery value = quantity x agreed unit price

    const message = checkFields(quantity, price, b.slot_start, b.slot_end);
    if (message) return fail(res, message);
    if (!b.org_id) return fail(res, 'Please choose a supplier.');
    if (!b.material_id) return fail(res, 'Please choose a material.');

    try {
        // The project must belong to the company of the logged-in user.
        const [own] = await db().execute(
            'SELECT project_id FROM project WHERE project_id = ? AND org_id = ?', [b.project_id, req.user.orgId]);
        if (own.length === 0) return fail(res, 'Please choose one of your projects.', 404);

        // The supplier must be an approved supplier (a company that is not approved yet cannot get deliveries).
        const [sup] = await db().execute("SELECT org_id FROM organization WHERE org_id = ? AND org_type = 'SUPPLIER' AND status = 'APPROVED'", [b.org_id]);
        if (sup.length === 0) return fail(res, 'Please choose a supplier from the list.', 404);

        const [result] = await db().execute(
            `INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [b.project_id, b.org_id, b.material_id, req.user.id, quantity, value,
             toDatetime(b.slot_start), toDatetime(b.slot_end)]);
        const about = await notify.aboutDelivery(db(), result.insertId);
        await notify.toCompany(db(), about.supplierId, 'SUPPLIER',
            'New delivery #' + about.ID + ' from ' + about.contractor + ': ' + about.material + ' for ' + about.project + '.', notify.pages.supplier(about.ID), req.user.id);
        await showList(req, res, 'Delivery #' + result.insertId + ' created.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- R: the detail page of one delivery (status, documents, inspection, retention and rating in one place) ----------
// Must be after /new (a GET /new would otherwise match /:id). Same company check as everywhere: p.org_id = the user's company.
app.get('/:id', async (req, res) => {
    const row = await findDelivery(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Delivery not found.', 404);

    // The progress line: every status up to the current one is done.
    const current = STEPS.indexOf(row.status);
    row.steps = STEPS.map((name, i) => ({ name: name, done: i <= current, current: i === current }));

    const [documents] = await db().execute(
        'SELECT doc_type, file_name FROM delivery_document WHERE delivery_id = ? ORDER BY document_id', [row.ID]);
    row.documents = documents;

    // The inspection (LEFT JOIN: not every delivery has one). Accepted value = delivery value x accepted / ordered; retention = accepted value x rate.
    const [inspections] = await db().execute(
        `SELECT u.full_name                          AS inspector,
                CAST(i.received_quantity AS DOUBLE)  AS received,
                CAST(i.accepted_quantity AS DOUBLE)  AS accepted,
                CAST(i.retention_rate * 100 AS DOUBLE) AS retentionPercent,
                FORMAT(d.delivery_value * i.accepted_quantity / d.ordered_quantity, 0) AS acceptedValue,
                FORMAT(d.delivery_value * i.accepted_quantity / d.ordered_quantity * i.retention_rate, 0) AS retention
         FROM inspection i
         JOIN delivery d      ON d.delivery_id = i.delivery_id
         JOIN user_account u  ON u.user_id = i.inspector_id
         WHERE i.delivery_id = ?`, [row.ID]);
    if (inspections.length === 1) {
        const i = inspections[0];
        if (i.accepted === 0) i.decision = 'Rejected';
        else if (i.accepted === i.received) i.decision = 'Accepted';
        else i.decision = 'Partially accepted';
        row.inspection = i;
    }

    const [ratings] = await db().execute(
        `SELECT r.score, u.full_name AS ratedBy
         FROM supplier_rating r JOIN user_account u ON u.user_id = r.rated_by
         WHERE r.delivery_id = ?`, [row.ID]);
    if (ratings.length === 1) {
        row.rating = { stars: '★'.repeat(ratings[0].score) + '☆'.repeat(5 - ratings[0].score), score: ratings[0].score, ratedBy: ratings[0].ratedBy };
    }
    row.canRate = (row.status === 'INSPECTED');

    // A delivery that was created by accepting a quotation shows its request for quotation.
    const [source] = await db().execute(
        `SELECT r.rfq_id AS rfqId, r.title AS rfqTitle FROM delivery d JOIN quotation q ON q.quotation_id = d.quotation_id JOIN rfq r ON r.rfq_id = q.rfq_id
         WHERE d.delivery_id = ?`, [row.ID]);
    if (source.length === 1) row.source = source[0];

    res.render('deliveries/detail', row);
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
        if (result.affectedRows > 0) {
            const about = await notify.aboutDelivery(db(), id);
            await notify.toCompany(db(), about.supplierId, 'SUPPLIER',
                'Delivery #' + id + ' (' + about.material + ') was changed by ' + about.contractor + ': please check the quantity and the time slot.',
                notify.pages.supplier(id), req.user.id);
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
        const about = await notify.aboutDelivery(db(), req.params.id);        // read before it is deleted (for the notification)
        const [result] = await db().execute(
            `DELETE d FROM delivery d JOIN project p ON p.project_id = d.project_id
             WHERE d.delivery_id = ? AND p.org_id = ? AND d.status = 'SCHEDULED'`,
            [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) {
            return fail(res, 'Only SCHEDULED deliveries of your projects can be deleted.', 409);
        }
        await notify.toCompany(db(), about.supplierId, 'SUPPLIER',
            'Delivery #' + about.ID + ' (' + about.material + ' for ' + about.project + ') was cancelled by ' + about.contractor + '.', '/assigned', req.user.id);
        // Nothing except the message: hx-swap="delete" of the button removes the row (HTMX 4 does not swap an empty response next to a partial) and the message goes to #toast.
        res.render('toast', { message: 'Delivery #' + req.params.id + ' deleted.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
