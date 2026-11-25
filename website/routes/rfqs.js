// Requests for quotation (RFQ) of a contractor. A project manager writes an RFQ for one of the projects of his company: the wanted
// delivery time slot, the last day for the quotations, the materials with their quantities, and the suppliers that are invited.
// Rules (as in the assignment):
//   - while the RFQ is a DRAFT the contractor can change and delete everything;
//   - "Send" makes it SENT: the invited suppliers can answer with a quotation (routes/quotations.js). After sending, the RFQ cannot be
//     changed or deleted any more; the contractor can only cancel it (CANCELLED, it stays for the history);
//   - every query is limited to the projects of the company of the logged-in user (p.org_id = req.user.orgId).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList, like } = require('../lib/listing');
const { findMaterials } = require('../lib/materials');
const app = express.Router();

const db = () => app.connection.promise();

const BADGES = { DRAFT: 'secondary', SENT: 'primary', AWARDED: 'success', CANCELLED: 'dark' };

const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;

// ---------- the list ----------
const SELECT_RFQS = `
    SELECT r.rfq_id                                     AS ID,
           r.title                                      AS title,
           p.project_name                               AS project,
           r.status                                     AS status,
           DATE_FORMAT(r.due_date, '%Y-%m-%d')          AS due,
           DATE_FORMAT(r.slot_start, '%Y-%m-%d')        AS slotDay,
           (SELECT COUNT(*) FROM rfq_item i WHERE i.rfq_id = r.rfq_id)      AS items,
           (SELECT COUNT(*) FROM rfq_supplier s WHERE s.rfq_id = r.rfq_id)  AS suppliers,
           (SELECT COUNT(*) FROM quotation q WHERE q.rfq_id = r.rfq_id)     AS quotations
    FROM rfq r
    JOIN project p ON p.project_id = r.project_id
    WHERE p.org_id = ?`;

const LIST = {
    search: ['CAST(r.rfq_id AS CHAR)', 'r.title', 'p.project_name'],
    statuses: Object.keys(BADGES),
    statusColumn: 'r.status',
    sorts: { ID: 'r.rfq_id', title: 'r.title', project: 'p.project_name', due: 'r.due_date', slot: 'r.slot_start',
             quotations: 'quotations', status: "FIELD(r.status, 'DRAFT', 'SENT', 'AWARDED', 'CANCELLED')" },
    tieBreak: 'r.rfq_id DESC',
    defaultOrder: "FIELD(r.status, 'DRAFT', 'SENT', 'AWARDED', 'CANCELLED'), r.due_date, r.rfq_id DESC"
};

function prepareRow(row) {
    row.badge = BADGES[row.status];
    return row;
}

async function showList(req, res, message) {
    const data = await readList(db(), req, LIST, SELECT_RFQS, [req.user.orgId], prepareRow);
    res.render('rfqs/index', Object.assign(data, { message: message, kind: 'success' }));
}

// ---------- one RFQ with its items and suppliers ----------
async function findRfq(id, orgId) {
    const [rows] = await db().execute(
        `SELECT r.rfq_id AS ID, r.title, r.project_id AS projectId, p.project_name AS project, r.status, r.note,
                DATE_FORMAT(r.slot_start, '%Y-%m-%d %H:%i') AS slotStart,
                IF(DATE(r.slot_end) = DATE(r.slot_start), DATE_FORMAT(r.slot_end, '%H:%i'), DATE_FORMAT(r.slot_end, '%Y-%m-%d %H:%i')) AS slotEnd,
                DATE_FORMAT(r.slot_start, '%Y-%m-%dT%H:%i') AS slotStartInput,
                DATE_FORMAT(r.slot_end, '%Y-%m-%dT%H:%i')   AS slotEndInput,
                DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due,
                (r.due_date < CURDATE()) AS duePassed,
                DATE_FORMAT(r.sent_at, '%Y-%m-%d %H:%i') AS sentAt,
                u.full_name AS createdBy
         FROM rfq r
         JOIN project p      ON p.project_id = r.project_id
         JOIN user_account u ON u.user_id = r.created_by
         WHERE r.rfq_id = ? AND p.org_id = ?`, [id, orgId]);
    if (rows.length !== 1) return null;
    const r = rows[0];
    r.badge = BADGES[r.status];
    r.isDraft = (r.status === 'DRAFT');
    r.isSent = (r.status === 'SENT');
    r.duePassed = Boolean(r.duePassed);
    return r;
}

// The items, with what the catalog says about each material (how many listed suppliers offer it, and their lowest and highest price).
async function readItems(rfqId) {
    const [items] = await db().execute(
        `SELECT i.item_id AS itemId, i.material_id AS materialId, m.material_name AS material, m.unit, c.category_name AS category,
                CAST(i.quantity AS DOUBLE) AS quantity,
                (SELECT COUNT(*) FROM supplier_product sp JOIN organization o ON o.org_id = sp.org_id AND o.status = 'APPROVED'
                 WHERE sp.material_id = i.material_id AND sp.active = 1) AS offeredBy,
                (SELECT ${money('MIN(sp.price_min)')} FROM supplier_product sp JOIN organization o ON o.org_id = sp.org_id AND o.status = 'APPROVED'
                 WHERE sp.material_id = i.material_id AND sp.active = 1) AS catalogMin,
                (SELECT ${money('MAX(sp.price_max)')} FROM supplier_product sp JOIN organization o ON o.org_id = sp.org_id AND o.status = 'APPROVED'
                 WHERE sp.material_id = i.material_id AND sp.active = 1) AS catalogMax
         FROM rfq_item i
         JOIN material m          ON m.material_id = i.material_id
         JOIN material_category c ON c.category_id = m.category_id
         WHERE i.rfq_id = ?
         ORDER BY i.item_id`, [rfqId]);
    items.forEach(i => { i.offeredBy = Number(i.offeredBy); i.catalogSame = (i.catalogMin === i.catalogMax); });
    return items;
}

// The invited suppliers: how many of the items each one offers in its catalog, its rating, and whether it has answered.
async function readSuppliers(rfqId) {
    const [suppliers] = await db().execute(
        `SELECT o.org_id AS orgId, o.org_name AS name,
                (SELECT COUNT(*) FROM supplier_product sp JOIN rfq_item i ON i.material_id = sp.material_id AND i.rfq_id = rs.rfq_id
                 WHERE sp.org_id = o.org_id AND sp.active = 1) AS offers,
                (SELECT CAST(AVG(r.score) AS DOUBLE) FROM supplier_rating r JOIN delivery d ON d.delivery_id = r.delivery_id
                 WHERE d.org_id = o.org_id) AS rating,
                (SELECT q.status FROM quotation q WHERE q.rfq_id = rs.rfq_id AND q.org_id = o.org_id) AS answer
         FROM rfq_supplier rs
         JOIN organization o ON o.org_id = rs.org_id
         WHERE rs.rfq_id = ?
         ORDER BY o.org_name`, [rfqId]);
    suppliers.forEach(s => {
        s.offers = Number(s.offers);
        s.ratingText = s.rating === null ? null : s.rating.toFixed(1);
        s.answered = Boolean(s.answer);
    });
    return suppliers;
}

// The suppliers that can still be invited, those that offer the most items of the RFQ first (the first 50; type to narrow down).
const SUPPLIER_LIMIT = 50;
async function findSuppliersToInvite(rfqId, text) {
    const q = String(text || '').trim().slice(0, 100);
    const where = `WHERE o.org_type = 'SUPPLIER' AND o.status = 'APPROVED'
                     AND o.org_id NOT IN (SELECT rs.org_id FROM rfq_supplier rs WHERE rs.rfq_id = ?)` + (q ? ' AND o.org_name LIKE ?' : '');
    const args = [rfqId].concat(q ? [like(q)] : []);
    const [[counted]] = await db().execute('SELECT COUNT(*) AS n FROM organization o ' + where, args);
    const [rows] = await db().execute(
        `SELECT o.org_id, o.org_name,
                (SELECT COUNT(*) FROM supplier_product sp JOIN rfq_item i ON i.material_id = sp.material_id AND i.rfq_id = ?
                 WHERE sp.org_id = o.org_id AND sp.active = 1) AS offers
         FROM organization o ${where}
         ORDER BY offers DESC, o.org_name LIMIT ${SUPPLIER_LIMIT}`, [rfqId].concat(args));
    const [[n]] = await db().execute('SELECT COUNT(*) AS n FROM rfq_item WHERE rfq_id = ?', [rfqId]);
    const total = Number(counted.n);
    rows.forEach(r => { r.offers = Number(r.offers); });
    return { suppliers: rows, total: total, shown: rows.length, more: total > rows.length, itemCount: Number(n.n) };
}

// The whole detail page (every change of a draft answers with it, so the items, the suppliers and the buttons are always up to date).
async function showDetail(req, res, id, message, kind) {
    const rfq = await findRfq(id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    rfq.items = await readItems(rfq.ID);
    rfq.suppliers = await readSuppliers(rfq.ID);
    rfq.canSend = rfq.isDraft && rfq.items.length > 0 && rfq.suppliers.length > 0;
    if (rfq.isDraft) {
        Object.assign(rfq, await findMaterials(db(), '', 0, null, rfq.ID));
        rfq.materialUrl = '/rfqs/' + rfq.ID + '/materials';
        rfq.invite = await findSuppliersToInvite(rfq.ID, '');
    }
    Object.assign(rfq, await readQuotations(rfq));
    rfq.message = message;
    rfq.kind = kind || 'success';
    res.render('rfqs/detail', rfq);
}

// The quotations of a sent RFQ, side by side: the unit price of every item, the total, the lead time and the rating of the supplier.
// The cheapest total is first; the lowest price of each item is marked. A draft has no quotations.
async function readQuotations(rfq) {
    if (rfq.isDraft) return {};
    const [quotations] = await db().execute(
        `SELECT q.quotation_id AS quotationId, o.org_name AS supplier, q.lead_time_days AS leadTime, q.note, q.status,
                DATE_FORMAT(q.submitted_at, '%Y-%m-%d %H:%i') AS submittedAt,
                CAST(SUM(qi.unit_price * i.quantity) AS DOUBLE) AS totalRaw,
                ${money('SUM(qi.unit_price * i.quantity)')} AS total,
                (SELECT CAST(AVG(r.score) AS DOUBLE) FROM supplier_rating r JOIN delivery d ON d.delivery_id = r.delivery_id
                 WHERE d.org_id = q.org_id) AS rating
         FROM quotation q
         JOIN organization o    ON o.org_id = q.org_id
         JOIN quotation_item qi ON qi.quotation_id = q.quotation_id
         JOIN rfq_item i        ON i.item_id = qi.item_id
         WHERE q.rfq_id = ?
         GROUP BY q.quotation_id, o.org_name, q.lead_time_days, q.note, q.status, q.submitted_at, q.org_id
         ORDER BY totalRaw, q.submitted_at`, [rfq.ID]);
    const [prices] = await db().execute(
        `SELECT qi.quotation_id AS quotationId, qi.item_id AS itemId, CAST(qi.unit_price AS DOUBLE) AS price
         FROM quotation_item qi JOIN quotation q ON q.quotation_id = qi.quotation_id WHERE q.rfq_id = ?`, [rfq.ID]);

    // The lowest unit price of each item among all the quotations.
    const lowest = {};
    for (const p of prices) {
        if (lowest[p.itemId] === undefined || p.price < lowest[p.itemId]) lowest[p.itemId] = p.price;
    }
    const format = n => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    quotations.forEach((q, index) => {
        q.cells = rfq.items.map(item => {
            const p = prices.find(x => x.quotationId === q.quotationId && x.itemId === item.itemId);
            return p ? { price: format(p.price), lowest: p.price === lowest[item.itemId] && quotations.length > 1 } : { price: '-' };
        });
        q.cheapest = (index === 0 && quotations.length > 1);
        q.ratingText = q.rating === null ? null : q.rating.toFixed(1);
        q.accepted = (q.status === 'ACCEPTED');
        q.notChosen = (q.status === 'NOT_CHOSEN');
    });

    let deliveries = [];
    if (rfq.status === 'AWARDED') {
        [deliveries] = await db().execute(
            `SELECT d.delivery_id AS ID, m.material_name AS material, d.status
             FROM delivery d JOIN quotation q ON q.quotation_id = d.quotation_id JOIN material m ON m.material_id = d.material_id
             WHERE q.rfq_id = ? ORDER BY d.delivery_id`, [rfq.ID]);
    }
    return { quotations: quotations, showQuotations: true, canAward: rfq.isSent && quotations.length > 0,
             deliveries: deliveries, isAwarded: rfq.status === 'AWARDED' };
}

// ---------- the fields of the RFQ (create and edit) ----------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

// Returns { error } or the values to save. "Now" and "today" come from the database, the same clock as the due date check of the suppliers.
async function readFields(b, orgId) {
    const text = v => String(v === undefined || v === null ? '' : v).trim();
    const title = text(b.title), note = text(b.note);
    const slotStart = text(b.slot_start), slotEnd = text(b.slot_end), due = text(b.due_date);
    if (!title) return { error: 'Please enter a title, for example "Concrete for floor 12".' };
    if (title.length > 100) return { error: 'The title can have at most 100 characters.' };
    if (!DATETIME.test(slotStart) || !DATETIME.test(slotEnd)) return { error: 'Please enter the wanted delivery time slot.' };
    if (slotEnd <= slotStart) return { error: 'The end of the time slot must be after its start.' };
    if (!DATE.test(due)) return { error: 'Please enter the last day for the quotations.' };
    if (note.length > 500) return { error: 'The note can have at most 500 characters.' };

    const [[clock]] = await db().execute("SELECT DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i') AS now, DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");
    if (due < clock.today) return { error: 'The last day for the quotations cannot be in the past.' };
    if (slotStart <= clock.now) return { error: 'The delivery time slot must be in the future.' };
    if (due > slotStart.slice(0, 10)) return { error: 'The quotations must arrive before the delivery: the last day for the quotations must be on or before the delivery day.' };

    const [own] = await db().execute('SELECT project_id FROM project WHERE project_id = ? AND org_id = ?', [b.project_id, orgId]);
    if (own.length === 0) return { error: 'Please choose one of your projects.' };

    return { projectId: own[0].project_id, title: title, slotStart: slotStart.replace('T', ' '), slotEnd: slotEnd.replace('T', ' '),
             due: due, note: note || null };
}

const readProjects = async orgId =>
    (await db().execute('SELECT project_id, project_name FROM project WHERE org_id = ? ORDER BY project_name', [orgId]))[0];

// ---------- R: list ----------
app.get('/', async (req, res) => {
    await showList(req, res);
});

// ---------- C: the form for a new RFQ (must be before /:id routes) ----------
app.get('/new', async (req, res) => {
    res.render('rfqs/new', { projects: await readProjects(req.user.orgId) });
});

// ---------- C: create (a DRAFT; the items and suppliers are added on its page) ----------
app.post('/', async (req, res) => {
    const f = await readFields(req.body, req.user.orgId);
    if (f.error) return fail(res, f.error);
    try {
        const [result] = await db().execute(
            'INSERT INTO rfq (project_id, created_by, title, slot_start, slot_end, due_date, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [f.projectId, req.user.id, f.title, f.slotStart, f.slotEnd, f.due, f.note]);
        res.set('HX-Push-Url', '/rfqs/' + result.insertId);           // the address bar shows the page of the new RFQ
        await showDetail(req, res, result.insertId, 'Draft RFQ #' + result.insertId + ' created. Now add the materials and invite the suppliers.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- R: the page of one RFQ ----------
app.get('/:id', async (req, res) => {
    await showDetail(req, res, req.params.id);
});

// ---------- U: the form to edit the RFQ (only a DRAFT) ----------
app.get('/:id/edit', async (req, res) => {
    const rfq = await findRfq(req.params.id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (!rfq.isDraft) return fail(res, 'A sent RFQ cannot be changed any more.', 409);
    rfq.projects = (await readProjects(req.user.orgId)).map(p => Object.assign(p, { selected: p.project_id === rfq.projectId }));
    res.render('rfqs/edit', rfq);
});

// ---------- U: save (action=update) or close the form (action=cancel) ----------
app.put('/:id', async (req, res) => {
    const rfq = await findRfq(req.params.id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (req.body.action !== 'update') return showDetail(req, res, rfq.ID);
    if (!rfq.isDraft) return fail(res, 'A sent RFQ cannot be changed any more.', 409);

    const f = await readFields(req.body, req.user.orgId);
    if (f.error) return fail(res, f.error);
    try {
        const [result] = await db().execute(
            `UPDATE rfq SET project_id = ?, title = ?, slot_start = ?, slot_end = ?, due_date = ?, note = ?
             WHERE rfq_id = ? AND status = 'DRAFT'`,
            [f.projectId, f.title, f.slotStart, f.slotEnd, f.due, f.note, rfq.ID]);
        if (result.affectedRows === 0) return fail(res, 'The RFQ was sent meanwhile, so it cannot be changed any more.', 409);
        await showDetail(req, res, rfq.ID, 'RFQ #' + rfq.ID + ' updated.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete (only a DRAFT: nobody has seen it yet) ----------
app.delete('/:id', async (req, res) => {
    const rfq = await findRfq(req.params.id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (!rfq.isDraft) return fail(res, 'A sent RFQ cannot be deleted. Cancel it instead.', 409);
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        // Lock the RFQ row: if it was sent meanwhile, nothing is deleted.
        const [lock] = await conn.execute("SELECT rfq_id FROM rfq WHERE rfq_id = ? AND status = 'DRAFT' FOR UPDATE", [rfq.ID]);
        if (lock.length === 0) {
            await conn.rollback();
            return fail(res, 'The RFQ was sent meanwhile, so it cannot be deleted.', 409);
        }
        await conn.execute('DELETE FROM rfq_item WHERE rfq_id = ?', [rfq.ID]);
        await conn.execute('DELETE FROM rfq_supplier WHERE rfq_id = ?', [rfq.ID]);
        await conn.execute('DELETE FROM rfq WHERE rfq_id = ?', [rfq.ID]);
        await conn.commit();
    }
    catch (err) {
        await conn.rollback().catch(() => {});
        return fail(res, sqlMessage(err));
    }
    finally {
        conn.release();
    }
    res.set('HX-Push-Url', '/rfqs');
    await showList(req, res, 'Draft RFQ #' + rfq.ID + ' deleted.');
});

// A middleware for the routes that change the items or the suppliers: the RFQ must be a DRAFT of the company.
async function draftOnly(req, res, next) {
    const rfq = await findRfq(req.params.id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (!rfq.isDraft) return fail(res, 'A sent RFQ cannot be changed any more.', 409);
    req.rfq = rfq;
    next();
}

// ---------- items: the material picker, add, change the quantity, remove ----------
app.get('/:id/materials', draftOnly, async (req, res) => {
    const materials = await findMaterials(db(), req.query.material_q, req.query.category, null, req.rfq.ID);
    res.render('deliveries/materialResponse', Object.assign(materials, { materialUrl: '/rfqs/' + req.rfq.ID + '/materials' }));
});

function readQuantity(text) {
    const quantity = Number(text);
    return quantity > 0 && quantity <= 99999999 ? Math.round(quantity * 100) / 100 : null;
}

app.post('/:id/items', draftOnly, async (req, res) => {
    const materialId = String(req.body.material_id || '').trim();
    const quantity = readQuantity(req.body.quantity);
    if (!materialId) return fail(res, 'Please choose a material.');
    if (!quantity) return fail(res, 'The quantity must be more than 0.');
    try {
        await db().execute('INSERT INTO rfq_item (rfq_id, material_id, quantity) VALUES (?, ?, ?)', [req.rfq.ID, materialId, quantity]);
        await showDetail(req, res, req.rfq.ID, 'Material added.');
    }
    catch (err) {
        if (err.errno === 1062) return fail(res, 'This material is in the RFQ already. Change its quantity instead.', 409);
        fail(res, sqlMessage(err));
    }
});

app.put('/:id/items/:itemId', draftOnly, async (req, res) => {
    const quantity = readQuantity(req.body.quantity);
    if (!quantity) return fail(res, 'The quantity must be more than 0.');
    const [result] = await db().execute('UPDATE rfq_item SET quantity = ? WHERE item_id = ? AND rfq_id = ?', [quantity, req.params.itemId, req.rfq.ID]);
    if (result.affectedRows === 0) return fail(res, 'Material not found in this RFQ.', 404);
    await showDetail(req, res, req.rfq.ID, 'Quantity changed.');
});

app.delete('/:id/items/:itemId', draftOnly, async (req, res) => {
    const [result] = await db().execute('DELETE FROM rfq_item WHERE item_id = ? AND rfq_id = ?', [req.params.itemId, req.rfq.ID]);
    if (result.affectedRows === 0) return fail(res, 'Material not found in this RFQ.', 404);
    await showDetail(req, res, req.rfq.ID, 'Material removed.');
});

// ---------- suppliers: search, invite, remove ----------
app.get('/:id/suppliers', draftOnly, async (req, res) => {
    res.render('rfqs/supplierOptions', await findSuppliersToInvite(req.rfq.ID, req.query.q));
});

app.post('/:id/suppliers', draftOnly, async (req, res) => {
    const orgId = String(req.body.org_id || '').trim();
    if (!orgId) return fail(res, 'Please choose a supplier.');
    const [sup] = await db().execute("SELECT org_name FROM organization WHERE org_id = ? AND org_type = 'SUPPLIER' AND status = 'APPROVED'", [orgId]);
    if (sup.length === 0) return fail(res, 'Please choose a supplier from the list.', 404);
    await db().execute('INSERT IGNORE INTO rfq_supplier (rfq_id, org_id) VALUES (?, ?)', [req.rfq.ID, orgId]);
    await showDetail(req, res, req.rfq.ID, sup[0].org_name + ' is invited.');
});

app.delete('/:id/suppliers/:orgId', draftOnly, async (req, res) => {
    const [result] = await db().execute('DELETE FROM rfq_supplier WHERE rfq_id = ? AND org_id = ?', [req.rfq.ID, req.params.orgId]);
    if (result.affectedRows === 0) return fail(res, 'This supplier is not invited.', 404);
    await showDetail(req, res, req.rfq.ID, 'Supplier removed from the RFQ.');
});

// ---------- send (DRAFT -> SENT) ----------
app.post('/:id/send', draftOnly, async (req, res) => {
    const rfq = req.rfq;
    const [[counts]] = await db().execute(
        `SELECT (SELECT COUNT(*) FROM rfq_item WHERE rfq_id = ?) AS items, (SELECT COUNT(*) FROM rfq_supplier WHERE rfq_id = ?) AS suppliers,
                (SELECT due_date >= CURDATE() AND slot_start > NOW() FROM rfq WHERE rfq_id = ?) AS datesOk`, [rfq.ID, rfq.ID, rfq.ID]);
    if (Number(counts.items) === 0) return fail(res, 'Add at least one material before you send the RFQ.');
    if (Number(counts.suppliers) === 0) return fail(res, 'Invite at least one supplier before you send the RFQ.');
    if (!Number(counts.datesOk)) return fail(res, 'The last day for the quotations or the delivery time slot has passed. Please edit the dates first.');
    const [result] = await db().execute("UPDATE rfq SET status = 'SENT', sent_at = NOW() WHERE rfq_id = ? AND status = 'DRAFT'", [rfq.ID]);
    if (result.affectedRows === 0) return fail(res, 'The RFQ was sent meanwhile.', 409);
    await showDetail(req, res, rfq.ID, 'RFQ #' + rfq.ID + ' sent to ' + counts.suppliers + ' supplier' + (Number(counts.suppliers) > 1 ? 's' : '') +
        '. They can answer until ' + rfq.due + '.');
});

// ---------- accept one quotation (SENT -> AWARDED): one SCHEDULED delivery per item for that supplier ----------
// Everything happens in one transaction, after locking the RFQ row (the suppliers lock the same row when they send, change or
// withdraw a quotation, so the chosen quotation cannot change meanwhile).
app.post('/:id/award', async (req, res) => {
    const rfq = await findRfq(req.params.id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    const quotationId = Number(req.body.quotation_id);
    const conn = await db().getConnection();
    let created, supplier;
    try {
        await conn.beginTransaction();
        const [lock] = await conn.execute("SELECT rfq_id FROM rfq WHERE rfq_id = ? AND status = 'SENT' FOR UPDATE", [rfq.ID]);
        if (lock.length === 0) {
            await conn.rollback();
            return fail(res, 'Only a sent RFQ can be awarded (it is awarded or cancelled already).', 409);
        }
        // The quotation must belong to this RFQ, have a price for every item, and its supplier must still be approved.
        const [quote] = await conn.execute(
            `SELECT q.quotation_id, o.org_name, o.status AS orgStatus,
                    (SELECT COUNT(*) FROM quotation_item qi WHERE qi.quotation_id = q.quotation_id) AS prices,
                    (SELECT COUNT(*) FROM rfq_item i WHERE i.rfq_id = q.rfq_id) AS items
             FROM quotation q JOIN organization o ON o.org_id = q.org_id
             WHERE q.quotation_id = ? AND q.rfq_id = ? AND q.status = 'SUBMITTED'`, [quotationId, rfq.ID]);
        if (quote.length === 0) {
            await conn.rollback();
            return fail(res, 'Please choose one of the quotations of this RFQ.', 404);
        }
        if (quote[0].orgStatus !== 'APPROVED') {
            await conn.rollback();
            return fail(res, quote[0].org_name + ' is not an approved supplier any more, so its quotation cannot be accepted.', 409);
        }
        if (Number(quote[0].prices) !== Number(quote[0].items)) {
            await conn.rollback();
            return fail(res, 'This quotation has no price for every material, so it cannot be accepted.', 409);
        }
        supplier = quote[0].org_name;

        // One delivery per item: the quantity of the RFQ, the value = quantity x quoted unit price, the wanted time slot of the RFQ.
        const [ins] = await conn.execute(
            `INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, quotation_id)
             SELECT r.project_id, q.org_id, i.material_id, ?, i.quantity, ROUND(i.quantity * qi.unit_price, 2), r.slot_start, r.slot_end, q.quotation_id
             FROM quotation q
             JOIN rfq r             ON r.rfq_id = q.rfq_id
             JOIN quotation_item qi ON qi.quotation_id = q.quotation_id
             JOIN rfq_item i        ON i.item_id = qi.item_id
             WHERE q.quotation_id = ?
             ORDER BY i.item_id`, [req.user.id, quotationId]);
        created = ins.affectedRows;
        await conn.execute("UPDATE quotation SET status = IF(quotation_id = ?, 'ACCEPTED', 'NOT_CHOSEN') WHERE rfq_id = ?", [quotationId, rfq.ID]);
        await conn.execute("UPDATE rfq SET status = 'AWARDED' WHERE rfq_id = ?", [rfq.ID]);
        await conn.commit();
    }
    catch (err) {
        await conn.rollback().catch(() => {});
        return fail(res, sqlMessage(err));
    }
    finally {
        conn.release();
    }
    await showDetail(req, res, rfq.ID, 'Quotation of ' + supplier + ' accepted: ' + created + ' deliver' + (created === 1 ? 'y was' : 'ies were') +
        ' created in your deliveries (SCHEDULED).');
});

// ---------- cancel a sent RFQ (SENT -> CANCELLED; it is not deleted, the suppliers see that it was cancelled) ----------
app.post('/:id/cancel', async (req, res) => {
    const rfq = await findRfq(req.params.id, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    const [result] = await db().execute("UPDATE rfq SET status = 'CANCELLED' WHERE rfq_id = ? AND status = 'SENT'", [rfq.ID]);
    if (result.affectedRows === 0) return fail(res, 'Only a sent RFQ that is not awarded can be cancelled.', 409);
    await showDetail(req, res, rfq.ID, 'RFQ #' + rfq.ID + ' cancelled.');
});

module.exports = app;
