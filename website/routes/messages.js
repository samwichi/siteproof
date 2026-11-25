// Messages: short conversations between the companies, so that they do not need the phone for every question.
//   - the conversation of a DELIVERY: the project managers of the contractor, the users of the supplier and the inspectors that may
//     inspect the delivery (the contractor's own inspectors and those of its appointed inspection companies);
//   - the private conversation of an RFQ between the contractor and ONE invited supplier (the other suppliers never see it).
// Who may read and write is checked in the database at every request (findDeliveryThread / findRfqThread). A user can delete only
// his own messages. The other side gets a notification (lib/notify.js). The open page asks for new messages every 10 seconds.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const notify = require('../lib/notify');
const app = express.Router();

const db = () => app.connection.promise();

// The inspectors of a contractor: its own, and those of the inspection companies that it appointed.
const INSPECTOR_SCOPE = '(p.org_id = ? OR p.org_id IN (SELECT a.contractor_id FROM inspection_appointment a WHERE a.inspection_id = ?))';

// The condition that the logged-in user may see a delivery (d, p are joined), and its arguments.
function deliveryAccess(user) {
    if (user.role === 'CONTRACTOR_PM') return { sql: 'p.org_id = ?', args: [user.orgId] };
    if (user.role === 'SUPPLIER') return { sql: 'd.org_id = ?', args: [user.orgId] };
    return { sql: INSPECTOR_SCOPE, args: [user.orgId, user.orgId] };            // INSPECTOR
}

// The page that shows the delivery or the RFQ to each role (the "back" link of the conversation).
const BACK = {
    delivery: { CONTRACTOR_PM: id => '/deliveries/' + id, SUPPLIER: id => '/assigned?q=' + id, INSPECTOR: id => '/inspections?q=' + id },
    rfq: { CONTRACTOR_PM: id => '/rfqs/' + id, SUPPLIER: id => '/quotations/' + id }
};

// ---------- the two kinds of conversation ----------
async function findDeliveryThread(user, id) {
    const access = deliveryAccess(user);
    const [rows] = await db().execute(
        `SELECT d.delivery_id AS ID, m.material_name AS material, p.project_name AS project, d.status,
                p.org_id AS contractorId, c.org_name AS contractor, d.org_id AS supplierId, s.org_name AS supplier
         FROM delivery d
         JOIN project p      ON p.project_id = d.project_id
         JOIN organization c ON c.org_id = p.org_id
         JOIN organization s ON s.org_id = d.org_id
         JOIN material m     ON m.material_id = d.material_id
         WHERE d.delivery_id = ? AND ${access.sql}`, [id].concat(access.args));
    if (rows.length !== 1) return null;
    const t = rows[0];
    return {
        kind: 'delivery', key: { delivery_id: t.ID }, url: '/messages/delivery/' + t.ID,
        title: 'Delivery #' + t.ID + ': ' + t.material,
        subtitle: t.project + ' · ' + t.contractor + ' → ' + t.supplier + ' · ' + t.status,
        back: BACK.delivery[user.role](t.ID), contractorId: t.contractorId, supplierId: t.supplierId,
        notice: 'Delivery #' + t.ID + ' (' + t.material + ')'
    };
}

async function findRfqThread(user, rfqId, supplierId) {
    // The contractor may open the conversation with each invited supplier; a supplier only its own one.
    if (user.role === 'SUPPLIER' && supplierId !== user.orgId) return null;
    if (user.role !== 'SUPPLIER' && user.role !== 'CONTRACTOR_PM') return null;
    const [rows] = await db().execute(
        `SELECT r.rfq_id AS ID, r.title, r.status, p.org_id AS contractorId, c.org_name AS contractor, rs.org_id AS supplierId, s.org_name AS supplier
         FROM rfq r
         JOIN project p       ON p.project_id = r.project_id
         JOIN organization c  ON c.org_id = p.org_id
         JOIN rfq_supplier rs ON rs.rfq_id = r.rfq_id AND rs.org_id = ?
         JOIN organization s  ON s.org_id = rs.org_id
         WHERE r.rfq_id = ? AND r.status <> 'DRAFT' AND ${user.role === 'SUPPLIER' ? 'rs.org_id = ?' : 'p.org_id = ?'}`,
        [supplierId, rfqId, user.orgId]);
    if (rows.length !== 1) return null;
    const t = rows[0];
    return {
        kind: 'rfq', key: { rfq_id: t.ID, supplier_id: t.supplierId }, url: '/messages/rfq/' + t.ID + '/' + t.supplierId,
        title: 'RFQ #' + t.ID + ': ' + t.title,
        subtitle: 'Private conversation between ' + t.contractor + ' and ' + t.supplier + ' · ' + t.status,
        back: BACK.rfq[user.role](t.ID), contractorId: t.contractorId, supplierId: t.supplierId,
        notice: 'RFQ #' + t.ID + ' (' + t.title + ')'
    };
}

// The WHERE condition of the messages of a conversation.
const threadWhere = t => t.kind === 'delivery'
    ? { sql: 'msg.delivery_id = ?', args: [t.key.delivery_id] }
    : { sql: 'msg.rfq_id = ? AND msg.supplier_id = ?', args: [t.key.rfq_id, t.key.supplier_id] };

const ROLE_SHORT = { CONTRACTOR_PM: 'Contractor', SUPPLIER: 'Supplier', INSPECTOR: 'Inspector' };

async function readMessages(t, user) {
    const w = threadWhere(t);
    const [messages] = await db().execute(
        `SELECT msg.message_id AS ID, msg.body, msg.sender_id AS senderId, u.full_name AS sender, u.role, o.org_name AS company,
                DATE_FORMAT(msg.created_at, '%Y-%m-%d %H:%i') AS created
         FROM message msg JOIN user_account u ON u.user_id = msg.sender_id JOIN organization o ON o.org_id = u.org_id
         WHERE ${w.sql}
         ORDER BY msg.created_at, msg.message_id`, w.args);
    messages.forEach(m => {
        m.mine = (m.senderId === user.id);
        m.roleName = ROLE_SHORT[m.role] || m.role;
    });
    return messages;
}

async function showThread(req, res, t, message, kind) {
    const messages = await readMessages(t, req.user);
    res.render('messages/thread', Object.assign({}, t, { messages: messages, message: message, kind: kind || 'success' }));
}

// Find the conversation of the request (/delivery/:id or /rfq/:rfqId/:supplierId) or answer "not found".
async function thread(req, res) {
    const t = req.params.kind === 'delivery'
        ? await findDeliveryThread(req.user, req.params.id)
        : req.params.kind === 'rfq' ? await findRfqThread(req.user, req.params.id, req.params.supplierId) : null;
    if (!t) fail(res, 'Conversation not found.', 404);
    return t;
}

// The other people of the conversation get a notification: the project managers of the contractor, the users of the supplier,
// and (in the conversation of a delivery) the inspectors that have written in it.
async function notifyOthers(t, user, body) {
    const text = user.name + ' (' + user.orgName + ') wrote about ' + t.notice + ': "' + (body.length > 80 ? body.slice(0, 77) + '...' : body) + '"';
    await notify.toCompany(db(), t.contractorId, 'CONTRACTOR_PM', text, t.url, user.id);
    await notify.toCompany(db(), t.supplierId, 'SUPPLIER', text, t.url, user.id);
    if (t.kind === 'delivery') {
        const [inspectors] = await db().execute(
            "SELECT DISTINCT msg.sender_id AS id FROM message msg JOIN user_account u ON u.user_id = msg.sender_id WHERE msg.delivery_id = ? AND u.role = 'INSPECTOR'",
            [t.key.delivery_id]);
        await notify.toUsers(db(), inspectors.map(i => i.id), text, t.url, user.id);
    }
}

// ---------- R: all the conversations of the user that have messages, the newest first ----------
// One row per conversation: the deliveries and the RFQ conversations that the user may see.
function inboxSelect(user) {
    const access = deliveryAccess(user);
    const parts = [`
        SELECT 'delivery' AS kind, d.delivery_id AS ID, NULL AS supplierId,
               CONCAT('Delivery #', d.delivery_id, ': ', m.material_name) AS title,
               CONCAT(p.project_name, ' · ', c.org_name, ' → ', s.org_name) AS subtitle,
               COUNT(*) AS messages, MAX(msg.created_at) AS lastAt, DATE_FORMAT(MAX(msg.created_at), '%Y-%m-%d %H:%i') AS last,
               SUBSTRING_INDEX(GROUP_CONCAT(msg.body ORDER BY msg.created_at DESC, msg.message_id DESC SEPARATOR '\\n'), '\\n', 1) AS lastBody
        FROM message msg
        JOIN delivery d     ON d.delivery_id = msg.delivery_id
        JOIN project p      ON p.project_id = d.project_id
        JOIN organization c ON c.org_id = p.org_id
        JOIN organization s ON s.org_id = d.org_id
        JOIN material m     ON m.material_id = d.material_id
        WHERE ${access.sql}
        GROUP BY d.delivery_id, m.material_name, p.project_name, c.org_name, s.org_name`];
    const args = access.args.slice();
    if (user.role !== 'INSPECTOR') {
        parts.push(`
        SELECT 'rfq' AS kind, r.rfq_id AS ID, msg.supplier_id AS supplierId,
               CONCAT('RFQ #', r.rfq_id, ': ', r.title) AS title,
               CONCAT(c.org_name, ' ↔ ', s.org_name) AS subtitle,
               COUNT(*) AS messages, MAX(msg.created_at) AS lastAt, DATE_FORMAT(MAX(msg.created_at), '%Y-%m-%d %H:%i') AS last,
               SUBSTRING_INDEX(GROUP_CONCAT(msg.body ORDER BY msg.created_at DESC, msg.message_id DESC SEPARATOR '\\n'), '\\n', 1) AS lastBody
        FROM message msg
        JOIN rfq r          ON r.rfq_id = msg.rfq_id
        JOIN project p      ON p.project_id = r.project_id
        JOIN organization c ON c.org_id = p.org_id
        JOIN organization s ON s.org_id = msg.supplier_id
        WHERE ${user.role === 'SUPPLIER' ? 'msg.supplier_id = ?' : 'p.org_id = ?'}
        GROUP BY r.rfq_id, msg.supplier_id, r.title, c.org_name, s.org_name`);
        args.push(user.orgId);
    }
    return { sql: 'SELECT t.* FROM (' + parts.join(' UNION ALL ') + ') t WHERE 1 = 1', args: args };
}

const INBOX = {
    search: ['t.title', 't.subtitle', 't.lastBody'],
    sorts: { last: 't.lastAt', title: 't.title', messages: 't.messages' },
    tieBreak: 't.title',
    defaultOrder: 't.lastAt DESC'
};

app.get('/', async (req, res) => {
    const inbox = inboxSelect(req.user);
    const data = await readList(db(), req, INBOX, inbox.sql, inbox.args, row => Object.assign(row, {
        url: row.kind === 'delivery' ? '/messages/delivery/' + row.ID : '/messages/rfq/' + row.ID + '/' + row.supplierId,
        messages: Number(row.messages),
        count: Number(row.messages) === 1 ? '1 message' : row.messages + ' messages'
    }));
    res.render('messages/index', data);
});

// ---------- R: one conversation (and only its messages, for the refresh every 10 seconds) ----------
// Express 5 writes an optional part of the address as {/:supplierId}: only the conversation of an RFQ has it.
app.get('/:kind/:id{/:supplierId}/list', async (req, res) => {
    const t = await thread(req, res);
    if (!t) return;
    res.render('messages/list', { messages: await readMessages(t, req.user), url: t.url });
});

app.get('/:kind/:id{/:supplierId}', async (req, res) => {
    const t = await thread(req, res);
    if (t) await showThread(req, res, t);
});

// ---------- C: write a message ----------
app.post('/:kind/:id{/:supplierId}', async (req, res) => {
    const t = await thread(req, res);
    if (!t) return;
    const body = String(req.body.body || '').trim();
    if (!body) return fail(res, 'Please write a message.');
    if (body.length > 1000) return fail(res, 'A message can have at most 1000 characters.');
    try {
        await db().execute('INSERT INTO message (delivery_id, rfq_id, supplier_id, sender_id, body) VALUES (?, ?, ?, ?, ?)',
            [t.key.delivery_id || null, t.key.rfq_id || null, t.key.supplier_id || null, req.user.id, body]);
        await notifyOthers(t, req.user, body);
        await showThread(req, res, t);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete one of the user's own messages ----------
app.delete('/message/:messageId', async (req, res) => {
    const [result] = await db().execute('DELETE FROM message WHERE message_id = ? AND sender_id = ?', [req.params.messageId, req.user.id]);
    if (result.affectedRows === 0) return fail(res, 'You can delete only your own messages.', 404);
    // hx-swap="delete" of the button removes the message.
    res.render('toast', { message: 'Message deleted.', kind: 'success' });
});

module.exports = app;
