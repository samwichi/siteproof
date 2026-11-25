// Quotations of a supplier: the supplier sees the requests for quotation (RFQ) that a contractor sent to its company and answers with
// a quotation: a unit price for every material of the RFQ, a lead time and a note.
// Rules:
//   - only an RFQ that is SENT to the company can be answered, and only until its last day (due_date); a draft is never visible;
//   - one quotation per company and RFQ; it can be changed or withdrawn (deleted) until the last day, as long as the contractor
//     has not decided; after the decision (ACCEPTED or NOT_CHOSEN) it is read only;
//   - the supplier never sees the quotations of the other suppliers;
//   - every query is limited to the company of the logged-in supplier (rs.org_id = req.user.orgId).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;

// The state of an RFQ as the supplier sees it (used for the filter and the badge).
const STATE = `CASE WHEN q.status = 'ACCEPTED' THEN 'ACCEPTED'
                    WHEN q.status = 'NOT_CHOSEN' THEN 'NOT CHOSEN'
                    WHEN r.status = 'CANCELLED' THEN 'CANCELLED'
                    WHEN r.status = 'SENT' AND q.quotation_id IS NULL AND r.due_date >= CURDATE() THEN 'TO ANSWER'
                    WHEN r.status = 'SENT' AND q.quotation_id IS NOT NULL THEN 'ANSWERED'
                    ELSE 'CLOSED' END`;
const BADGES = { 'TO ANSWER': 'warning', ANSWERED: 'primary', ACCEPTED: 'success', 'NOT CHOSEN': 'secondary', CANCELLED: 'dark', CLOSED: 'light' };

const SELECT_RFQS = `
    SELECT r.rfq_id                              AS ID,
           r.title                               AS title,
           c.org_name                            AS contractor,
           p.project_name                        AS project,
           DATE_FORMAT(r.due_date, '%Y-%m-%d')   AS due,
           DATE_FORMAT(r.slot_start, '%Y-%m-%d') AS slotDay,
           (SELECT COUNT(*) FROM rfq_item i WHERE i.rfq_id = r.rfq_id) AS items,
           (SELECT ${money('SUM(qi.unit_price * i.quantity)')} FROM quotation_item qi JOIN rfq_item i ON i.item_id = qi.item_id
            WHERE qi.quotation_id = q.quotation_id) AS total,
           ${STATE}                              AS state
    FROM rfq_supplier rs
    JOIN rfq r          ON r.rfq_id = rs.rfq_id AND r.status <> 'DRAFT'
    JOIN project p      ON p.project_id = r.project_id
    JOIN organization c ON c.org_id = p.org_id
    LEFT JOIN quotation q ON q.rfq_id = rs.rfq_id AND q.org_id = rs.org_id
    WHERE rs.org_id = ?`;

const LIST = {
    search: ['CAST(r.rfq_id AS CHAR)', 'r.title', 'c.org_name', 'p.project_name'],
    statuses: Object.keys(BADGES),
    statusColumn: STATE,
    sorts: { ID: 'r.rfq_id', title: 'r.title', contractor: 'c.org_name', due: 'r.due_date', slot: 'r.slot_start',
             state: "FIELD(" + STATE + ", 'TO ANSWER', 'ANSWERED', 'ACCEPTED', 'NOT CHOSEN', 'CANCELLED', 'CLOSED')" },
    tieBreak: 'r.rfq_id DESC',
    defaultOrder: "FIELD(" + STATE + ", 'TO ANSWER', 'ANSWERED', 'ACCEPTED', 'NOT CHOSEN', 'CANCELLED', 'CLOSED'), r.due_date, r.rfq_id DESC"
};

function prepareRow(row) {
    row.badge = BADGES[row.state];
    return row;
}

// The number of RFQs that wait for an answer of the company (badge in the menu).
async function countOpen(orgId) {
    const [[n]] = await db().execute(
        `SELECT COUNT(*) AS n FROM rfq_supplier rs JOIN rfq r ON r.rfq_id = rs.rfq_id
         WHERE rs.org_id = ? AND r.status = 'SENT' AND r.due_date >= CURDATE()
           AND NOT EXISTS (SELECT 1 FROM quotation q WHERE q.rfq_id = rs.rfq_id AND q.org_id = rs.org_id)`, [orgId]);
    return Number(n.n);
}

// ---------- one RFQ with the quotation of the company ----------
async function findRfq(rfqId, orgId) {
    const [rows] = await db().execute(
        `SELECT r.rfq_id AS ID, r.title, r.status AS rfqStatus, r.note, c.org_name AS contractor, p.project_name AS project,
                DATE_FORMAT(r.slot_start, '%Y-%m-%d %H:%i') AS slotStart,
                IF(DATE(r.slot_end) = DATE(r.slot_start), DATE_FORMAT(r.slot_end, '%H:%i'), DATE_FORMAT(r.slot_end, '%Y-%m-%d %H:%i')) AS slotEnd,
                DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due,
                (r.status = 'SENT' AND r.due_date >= CURDATE()) AS open,
                q.quotation_id AS quotationId, q.status AS quotationStatus, q.lead_time_days AS leadTime, q.note AS quotationNote,
                DATE_FORMAT(q.submitted_at, '%Y-%m-%d %H:%i') AS submittedAt, u.full_name AS submittedBy,
                ${STATE} AS state
         FROM rfq_supplier rs
         JOIN rfq r          ON r.rfq_id = rs.rfq_id AND r.status <> 'DRAFT'
         JOIN project p      ON p.project_id = r.project_id
         JOIN organization c ON c.org_id = p.org_id
         LEFT JOIN quotation q    ON q.rfq_id = rs.rfq_id AND q.org_id = rs.org_id
         LEFT JOIN user_account u ON u.user_id = q.submitted_by
         WHERE rs.rfq_id = ? AND rs.org_id = ?`, [rfqId, orgId]);
    if (rows.length !== 1) return null;
    const r = rows[0];
    r.open = Boolean(r.open);
    r.badge = BADGES[r.state];
    r.hasQuotation = Boolean(r.quotationId);
    r.canSubmit = r.open && !r.hasQuotation;                                    // C
    r.canChange = r.open && r.hasQuotation && r.quotationStatus === 'SUBMITTED';  // U and D
    r.accepted = (r.quotationStatus === 'ACCEPTED');
    r.notChosen = (r.quotationStatus === 'NOT_CHOSEN');
    r.stillSubmitted = (r.quotationStatus === 'SUBMITTED');
    r.cancelled = (r.rfqStatus === 'CANCELLED');
    return r;
}

// The items of the RFQ, with the price range of the company's own catalog and the unit price of its quotation.
async function readItems(rfqId, orgId, quotationId) {
    const [items] = await db().execute(
        `SELECT i.item_id AS itemId, m.material_name AS material, m.unit, CAST(i.quantity AS DOUBLE) AS quantity,
                CAST(sp.price_min AS DOUBLE) AS catalogMin, CAST(sp.price_max AS DOUBLE) AS catalogMax,
                CAST(qi.unit_price AS DOUBLE) AS unitPrice,
                ${money('qi.unit_price * i.quantity')} AS lineTotal
         FROM rfq_item i
         JOIN material m ON m.material_id = i.material_id
         LEFT JOIN supplier_product sp ON sp.org_id = ? AND sp.material_id = i.material_id
         LEFT JOIN quotation_item qi   ON qi.item_id = i.item_id AND qi.quotation_id = ?
         WHERE i.rfq_id = ?
         ORDER BY i.item_id`, [orgId, quotationId || 0, rfqId]);
    items.forEach(i => {
        i.inCatalog = i.catalogMin !== null;
        i.samePrice = i.catalogMin === i.catalogMax;
        // The form starts with the price of the quotation, or else the middle of the catalog range.
        i.priceInput = i.unitPrice !== null ? i.unitPrice : (i.inCatalog ? Math.round((i.catalogMin + i.catalogMax) / 2 * 100) / 100 : '');
    });
    return items;
}

async function showDetail(req, res, rfqId, message, kind) {
    const rfq = await findRfq(rfqId, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    rfq.items = await readItems(rfq.ID, req.user.orgId, rfq.quotationId);
    if (rfq.hasQuotation) {
        const [[t]] = await db().execute(
            `SELECT ${money('SUM(qi.unit_price * i.quantity)')} AS total FROM quotation_item qi JOIN rfq_item i ON i.item_id = qi.item_id
             WHERE qi.quotation_id = ?`, [rfq.quotationId]);
        rfq.total = t.total;
    }
    rfq.message = message;
    rfq.kind = kind || 'success';
    rfq.openRfqs = await countOpen(req.user.orgId);       // for the badge in the menu (an <hx-partial> of the page)
    res.render('quotations/detail', rfq);
}

// Read the form: a unit price for every item of the RFQ (fields price_<item id>), the lead time and the note.
const MAX_MONEY = 99999999.99;
async function readFields(b, rfqId) {
    const [items] = await db().execute('SELECT item_id, material_id FROM rfq_item WHERE rfq_id = ? ORDER BY item_id', [rfqId]);
    const prices = [];
    for (const item of items) {
        const text = String(b['price_' + item.item_id] === undefined ? '' : b['price_' + item.item_id]).trim();
        const price = Number(text);
        if (text === '' || !(price >= 0 && price <= MAX_MONEY)) return { error: 'Please enter a unit price (0 or more) for every material.' };
        prices.push({ itemId: item.item_id, price: Math.round(price * 100) / 100 });
    }
    let leadTime = null;
    const leadText = String(b.lead_time_days || '').trim();
    if (leadText !== '') {
        leadTime = Number(leadText);
        if (!Number.isInteger(leadTime) || leadTime < 0 || leadTime > 365) return { error: 'The lead time must be a whole number of days from 0 to 365 (or leave it empty).' };
    }
    const note = String(b.note || '').trim();
    if (note.length > 500) return { error: 'The note can have at most 500 characters.' };
    return { prices: prices, leadTime: leadTime, note: note || null };
}

// Run fn(conn) in a transaction after locking the RFQ row: the RFQ must still be SENT, open (last day not passed) and the company invited.
// The contractor locks the same row when he accepts a quotation, so a quotation cannot change while the contractor decides.
async function withOpenRfq(rfqId, orgId, fn) {
    const conn = await db().getConnection();
    try {
        await conn.beginTransaction();
        const [lock] = await conn.execute(
            `SELECT r.rfq_id FROM rfq r JOIN rfq_supplier rs ON rs.rfq_id = r.rfq_id AND rs.org_id = ?
             WHERE r.rfq_id = ? AND r.status = 'SENT' AND r.due_date >= CURDATE() FOR UPDATE`, [orgId, rfqId]);
        if (lock.length === 0) {
            await conn.rollback();
            return 'closed';
        }
        const result = await fn(conn);
        await conn.commit();
        return result;
    }
    catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    }
    finally {
        conn.release();
    }
}

const CLOSED = 'This RFQ cannot be answered any more: the last day has passed, or the contractor has decided or cancelled it.';

async function saveItems(conn, quotationId, prices) {
    await conn.execute('DELETE FROM quotation_item WHERE quotation_id = ?', [quotationId]);
    for (const p of prices) {
        await conn.execute('INSERT INTO quotation_item (quotation_id, item_id, unit_price) VALUES (?, ?, ?)', [quotationId, p.itemId, p.price]);
    }
}

// ---------- R: list ----------
app.get('/', async (req, res) => {
    const data = await readList(db(), req, LIST, SELECT_RFQS, [req.user.orgId], prepareRow);
    res.render('quotations/index', data);
});

// ---------- R: one RFQ and the quotation of the company ----------
app.get('/:rfqId', async (req, res) => {
    await showDetail(req, res, req.params.rfqId);
});

// ---------- C: send a quotation ----------
app.post('/:rfqId', async (req, res) => {
    const rfq = await findRfq(req.params.rfqId, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (!rfq.open) return fail(res, CLOSED, 409);
    const f = await readFields(req.body, rfq.ID);
    if (f.error) return fail(res, f.error);
    try {
        const result = await withOpenRfq(rfq.ID, req.user.orgId, async conn => {
            const [ins] = await conn.execute(
                'INSERT INTO quotation (rfq_id, org_id, submitted_by, lead_time_days, note) VALUES (?, ?, ?, ?, ?)',
                [rfq.ID, req.user.orgId, req.user.id, f.leadTime, f.note]);
            await saveItems(conn, ins.insertId, f.prices);
            return 'ok';
        });
        if (result === 'closed') return fail(res, CLOSED, 409);
        await showDetail(req, res, rfq.ID, 'Quotation sent: the contractor can see it now. You can change or withdraw it until ' + rfq.due + '.');
    }
    catch (err) {
        if (err.errno === 1062) return fail(res, 'Your company has answered this RFQ already. Change that quotation instead.', 409);
        fail(res, sqlMessage(err));
    }
});

// ---------- U: change the quotation ----------
app.put('/:rfqId', async (req, res) => {
    const rfq = await findRfq(req.params.rfqId, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (!rfq.hasQuotation) return fail(res, 'Your company has not answered this RFQ yet.', 404);
    if (!rfq.canChange) return fail(res, CLOSED, 409);
    const f = await readFields(req.body, rfq.ID);
    if (f.error) return fail(res, f.error);
    try {
        const result = await withOpenRfq(rfq.ID, req.user.orgId, async conn => {
            const [upd] = await conn.execute(
                "UPDATE quotation SET lead_time_days = ?, note = ?, submitted_by = ? WHERE quotation_id = ? AND status = 'SUBMITTED'",
                [f.leadTime, f.note, req.user.id, rfq.quotationId]);
            if (upd.affectedRows === 0) return 'closed';
            await saveItems(conn, rfq.quotationId, f.prices);
            return 'ok';
        });
        if (result === 'closed') return fail(res, CLOSED, 409);
        await showDetail(req, res, rfq.ID, 'Quotation updated.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: withdraw the quotation ----------
app.delete('/:rfqId', async (req, res) => {
    const rfq = await findRfq(req.params.rfqId, req.user.orgId);
    if (!rfq) return fail(res, 'Request for quotation not found.', 404);
    if (!rfq.hasQuotation) return fail(res, 'Your company has not answered this RFQ yet.', 404);
    if (!rfq.canChange) return fail(res, CLOSED, 409);
    try {
        const result = await withOpenRfq(rfq.ID, req.user.orgId, async conn => {
            const [check] = await conn.execute("SELECT quotation_id FROM quotation WHERE quotation_id = ? AND status = 'SUBMITTED'", [rfq.quotationId]);
            if (check.length === 0) return 'closed';
            await conn.execute('DELETE FROM quotation_item WHERE quotation_id = ?', [rfq.quotationId]);
            await conn.execute('DELETE FROM quotation WHERE quotation_id = ?', [rfq.quotationId]);
            return 'ok';
        });
        if (result === 'closed') return fail(res, CLOSED, 409);
        await showDetail(req, res, rfq.ID, 'Quotation withdrawn. You can send a new one until ' + rfq.due + '.');
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
