// UC6: the supplier registers the quality documents (delivery note, test reports...) of its own deliveries.
// A supplier only sees the documents of the deliveries of its own company (d.org_id = the company of the logged-in user).
// Rules: documents can be added at any time, because some reports arrive later (for example the 28-day concrete test report);
// they can be changed or deleted only until the delivery is inspected (INSPECTED or COMPLETED closes them).
// The file itself is uploaded (PDF, JPG or PNG, at most 5 MB; lib/upload.js checks its real type) and kept in website/uploads;
// routes/files.js lets the supplier, the contractor and the inspectors open it. Old documents may have only a file name.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const { readFiles, saveFiles, removeFiles } = require('../lib/upload');
const notify = require('../lib/notify');
const app = express.Router();

const db = () => app.connection.promise();

const DOC_TYPES = ['Delivery Note', 'Mill Certificate', 'Concrete Test Report', 'Tensile Test Report', 'Cement Test Report', 'Other'];

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};

// One document as the supplier sees it. The caller adds the rest of the WHERE condition and the ORDER BY.
const SELECT_DOCUMENTS = `
    SELECT doc.document_id     AS ID,
           doc.doc_type        AS docType,
           doc.file_name       AS fileName,
           doc.stored_name     AS storedName,
           doc.file_type       AS fileType,
           doc.file_size       AS fileSize,
           d.delivery_id       AS deliveryId,
           p.project_name      AS project,
           m.material_name     AS material,
           d.status            AS status,
           u.full_name         AS uploadedBy,
           (d.status NOT IN ('INSPECTED', 'COMPLETED')) AS canEdit
    FROM delivery_document doc
    JOIN delivery d      ON d.delivery_id = doc.delivery_id
    JOIN project p       ON p.project_id = d.project_id
    JOIN material m      ON m.material_id = d.material_id
    JOIN user_account u  ON u.user_id = doc.uploaded_by
    WHERE d.org_id = ?`;

// Add the values that the templates need (Handlebars cannot compare values, so we do it here).
function prepare(row) {
    row.badge = BADGES[row.status];
    row.hasFile = Boolean(row.storedName);
    row.kb = row.fileSize ? Math.max(1, Math.round(row.fileSize / 1024)) : null;
    // The options of the <select> of the document type, with the current type selected.
    row.typeOptions = DOC_TYPES.map(t => ({ value: t, selected: t === row.docType }));
    return row;
}

async function findDocument(id, orgId) {
    const [rows] = await db().execute(SELECT_DOCUMENTS + ' AND doc.document_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Search, status filter and sorting of the list (see lib/listing.js).
const LIST = {
    search: ['CAST(doc.document_id AS CHAR)', 'CAST(d.delivery_id AS CHAR)', 'p.project_name', 'm.material_name',
             'doc.doc_type', 'doc.file_name', 'u.full_name'],
    statuses: ['SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED'],
    statusColumn: 'd.status',
    sorts: {
        ID: 'doc.document_id', delivery: 'd.delivery_id', material: 'm.material_name', docType: 'doc.doc_type',
        fileName: 'doc.file_name', uploadedBy: 'u.full_name', status: "FIELD(d.status, 'SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED')"
    },
    tieBreak: 'doc.document_id DESC',
    defaultOrder: 'doc.document_id DESC'
};

// Show the page of the list that the user asked for (?q=&status=&sort=&dir=&page=) in main#main, with an optional message in the toast.
async function showList(req, res, message) {
    const data = await readList(db(), req, LIST, SELECT_DOCUMENTS, [req.user.orgId], prepare);
    res.render('documents/index', Object.assign(data, { message: message, kind: 'success' }));
}

// Check the document type. Returns an error message, or null when it is fine. (The file is checked by lib/upload.js.)
function checkType(docType) {
    return DOC_TYPES.includes(docType) ? null : 'Please choose a document type.';
}

// ---------- R: list ----------
app.get('/', async (req, res) => {
    await showList(req, res);
});

// ---------- C: the form to add a document (must be before /:id routes) ----------
app.get('/new', async (req, res) => {
        // All the deliveries of this supplier (a document can be added after the inspection too).
    const [deliveries] = await db().execute(
        `SELECT d.delivery_id, p.project_name, m.material_name, d.status
         FROM delivery d
         JOIN project p  ON p.project_id = d.project_id
         JOIN material m ON m.material_id = d.material_id
         WHERE d.org_id = ?
         ORDER BY d.slot_start DESC, d.delivery_id DESC`, [req.user.orgId]);
    res.render('documents/new', {
        deliveries: deliveries,
        typeOptions: DOC_TYPES.map(t => ({ value: t, selected: false }))
    });
});

// ---------- C: add (a multipart form with the file) ----------
app.post('/', async (req, res) => {
    const upload = await readFiles(req, res, { field: 'file', max: 1 });      // the other fields are in req.body after this
    if (upload.error) return fail(res, upload.error);
    const b = req.body;
    const message = checkType(b.doc_type);
    if (message) return fail(res, message);
    if (upload.files.length === 0) return fail(res, 'Please choose the file of the document (PDF, JPG or PNG, at most 5 MB).');

    let saved = [];
    try {
        saved = await saveFiles(upload.files);
        const f = saved[0];
        // The delivery must belong to the company of the logged-in user (checked in the same SQL).
        const [result] = await db().execute(
            `INSERT INTO delivery_document (delivery_id, uploaded_by, doc_type, file_name, stored_name, file_type, file_size)
             SELECT d.delivery_id, ?, ?, ?, ?, ?, ?
             FROM delivery d
             WHERE d.delivery_id = ? AND d.org_id = ?`,
            [req.user.id, b.doc_type, f.name, f.stored, f.type, f.size, b.delivery_id, req.user.orgId]);
        if (result.affectedRows === 0) {
            await removeFiles([f.stored]);
            return fail(res, 'Please choose one of your deliveries.', 409);
        }
        // The contractor (and the inspectors, when the delivery waits for the inspection) learn that a document is there.
        const about = await notify.aboutDelivery(db(), b.delivery_id);
        const text = about.supplier + ' added a ' + b.doc_type + ' to delivery #' + about.ID + ' (' + about.material + ').';
        await notify.toCompany(db(), about.contractorId, 'CONTRACTOR_PM', text, notify.pages.contractor(about.ID), req.user.id);
        const [[st]] = await db().execute('SELECT status FROM delivery WHERE delivery_id = ?', [about.ID]);
        if (st.status === 'DELIVERED') await notify.toInspectors(db(), about.contractorId, text, notify.pages.inspector(about.ID), req.user.id);
        await showList(req, res, 'Document "' + f.name + '" added.');
    }
    catch (err) {
        await removeFiles(saved.map(f => f.stored));
        fail(res, sqlMessage(err));
    }
});

// ---------- U: the form to edit one row ----------
app.get('/:id/edit', async (req, res) => {
    const row = await findDocument(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Document not found.', 404);
    if (!row.canEdit) return fail(res, 'The delivery is already inspected, so its documents cannot be changed.', 409);
    res.render('documents/edit', row);
});

// ---------- U: save (action=update) or close the form (action=cancel) ----------
app.put('/:id', async (req, res) => {
    const id = req.params.id;
    const orgId = req.user.orgId;
    const row = await findDocument(id, orgId);
    if (!row) return fail(res, 'Document not found.', 404);

    // The edit form is a multipart form (it can carry a new file), so multer reads it before req.body is used.
    const upload = await readFiles(req, res, { field: 'file', max: 1 });
    if (upload.error) return fail(res, upload.error);
    if (req.body.action !== 'update') {
        return res.render('documents/row', row);                  // cancel: show the row without changes
    }

    const message = checkType(req.body.doc_type);
    if (message) return fail(res, message);
    if (!row.canEdit) return fail(res, 'The delivery is already inspected, so its documents cannot be changed.', 409);

    let saved = [];
    try {
        saved = await saveFiles(upload.files);            // optional: a new file replaces the old one
        const f = saved[0];
        const [result] = await db().execute(
            `UPDATE delivery_document doc JOIN delivery d ON d.delivery_id = doc.delivery_id
             SET doc.doc_type = ?,
                 doc.file_name = COALESCE(?, doc.file_name), doc.stored_name = COALESCE(?, doc.stored_name),
                 doc.file_type = COALESCE(?, doc.file_type), doc.file_size = COALESCE(?, doc.file_size)
             WHERE doc.document_id = ? AND d.org_id = ? AND d.status NOT IN ('INSPECTED', 'COMPLETED')`,
            [req.body.doc_type, f ? f.name : null, f ? f.stored : null, f ? f.type : null, f ? f.size : null, id, orgId]);
        if (result.affectedRows === 0) {
            await removeFiles(saved.map(x => x.stored));
            return fail(res, 'The delivery was inspected meanwhile: its documents cannot be changed any more.', 409);
        }
        if (f && row.storedName) await removeFiles([row.storedName]);      // the old file is not needed any more

        const fresh = await findDocument(id, orgId);
        res.render('documents/rowToast', Object.assign(fresh, { message: 'Document #' + id + ' updated' + (f ? ' with the new file.' : '.'), kind: 'success' }));
    }
    catch (err) {
        await removeFiles(saved.map(x => x.stored));
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete ----------
app.delete('/:id', async (req, res) => {
    try {
        const row = await findDocument(req.params.id, req.user.orgId);       // to know the file to remove
        const [result] = await db().execute(
            `DELETE doc FROM delivery_document doc JOIN delivery d ON d.delivery_id = doc.delivery_id
             WHERE doc.document_id = ? AND d.org_id = ? AND d.status NOT IN ('INSPECTED', 'COMPLETED')`,
            [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) {
            return fail(res, 'Only documents of your deliveries that are not inspected yet can be deleted.', 409);
        }
        if (row && row.storedName) await removeFiles([row.storedName]);
        // Nothing except the message: hx-swap="delete" of the button removes the row (HTMX 4 does not swap an empty response next to a partial) and the message goes to #toast.
        res.render('toast', { message: 'Document #' + req.params.id + ' deleted.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
