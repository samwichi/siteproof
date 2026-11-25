// Notifications: short messages for the users about what happened, shown by the bell in the menu (routes/notifications.js).
// The routes call these helpers after their change is saved. A notification is only a help: if writing it fails, the change
// itself is kept and the error is only written to the log.
// Every helper sends the notification to all ACTIVE and APPROVED users of one company with one role, except the user who caused it.

// Send `text` with the page `link` to the users of company `orgId` with role `role` (except user `exceptUserId`).
async function toCompany(db, orgId, role, text, link, exceptUserId) {
    await safe(db,
        `INSERT INTO notification (user_id, text, link)
         SELECT user_id, ?, ? FROM user_account
         WHERE org_id = ? AND role = ? AND active = 1 AND status = 'APPROVED' AND user_id <> ?`,
        [cut(text), link, orgId, role, exceptUserId || 0]);
}

// The inspectors that may inspect the deliveries of a contractor: its own inspectors and those of the appointed inspection companies.
async function toInspectors(db, contractorOrgId, text, link, exceptUserId) {
    await safe(db,
        `INSERT INTO notification (user_id, text, link)
         SELECT user_id, ?, ? FROM user_account
         WHERE role = 'INSPECTOR' AND active = 1 AND status = 'APPROVED' AND user_id <> ?
           AND (org_id = ? OR org_id IN (SELECT a.inspection_id FROM inspection_appointment a WHERE a.contractor_id = ?))`,
        [cut(text), link, exceptUserId || 0, contractorOrgId, contractorOrgId]);
}

// What the notifications say about one delivery: its material, project, contractor and supplier.
async function aboutDelivery(db, deliveryId) {
    const [rows] = await db.execute(
        `SELECT d.delivery_id AS ID, m.material_name AS material, p.project_name AS project,
                p.org_id AS contractorId, c.org_name AS contractor, d.org_id AS supplierId, s.org_name AS supplier
         FROM delivery d
         JOIN project p      ON p.project_id = d.project_id
         JOIN organization c ON c.org_id = p.org_id
         JOIN organization s ON s.org_id = d.org_id
         JOIN material m     ON m.material_id = d.material_id
         WHERE d.delivery_id = ?`, [deliveryId]);
    return rows[0];
}

// The same for a request for quotation.
async function aboutRfq(db, rfqId) {
    const [rows] = await db.execute(
        `SELECT r.rfq_id AS ID, r.title, DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due, p.org_id AS contractorId, c.org_name AS contractor
         FROM rfq r JOIN project p ON p.project_id = r.project_id JOIN organization c ON c.org_id = p.org_id
         WHERE r.rfq_id = ?`, [rfqId]);
    return rows[0];
}

// The pages that show a delivery to each role (the supplier and the inspector have lists, searched by the delivery number).
const pages = {
    contractor: id => '/deliveries/' + id,
    supplier: id => '/assigned?q=' + id,
    inspector: id => '/inspections?q=' + id
};

// At most 255 characters; a company name like "Ltd." at the end must not give two periods.
const cut = text => String(text).replace(/\.\.$/, '.').slice(0, 255);

async function safe(db, sql, args) {
    try {
        await db.execute(sql, args);
    }
    catch (err) {
        console.log('Notification not saved: ', err.message);
    }
}

module.exports = { toCompany, toInspectors, aboutDelivery, aboutRfq, pages };
