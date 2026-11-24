// UC6: the supplier registers the quality documents (delivery note, test reports...) of its own deliveries.
// A supplier only sees the documents of the deliveries of its own company (d.org_id = the company of the logged-in user).
// Rules: documents can be added, changed or deleted only until the delivery is inspected (status INSPECTED or COMPLETED
// closes them, so a document cannot be replaced after the inspection).
// Only the document type and the file name are stored (the file itself is not uploaded in this version).
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
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
    // The options of the <select> of the document type, with the current type selected.
    row.typeOptions = DOC_TYPES.map(t => ({ value: t, selected: t === row.docType }));
    return row;
}

async function findDocument(id, orgId) {
    const [rows] = await db().execute(SELECT_DOCUMENTS + ' AND doc.document_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// Show the whole list in main#main, with an optional message in the toast.
async function showList(res, orgId, message) {
    const [rows] = await db().execute(SELECT_DOCUMENTS + ' ORDER BY doc.document_id DESC', [orgId]);
    res.render('documents/index', { rows: rows.map(prepare), message: message, kind: 'success' });
}

// Check the document type and the file name (PDF or JPG, as in the data model). Returns an error message, or null when they are fine.
function checkFields(docType, fileName) {
    if (!DOC_TYPES.includes(docType)) return 'Please choose a document type.';
    if (!fileName) return 'Please enter the file name.';
    if (fileName.length > 200) return 'The file name is too long (200 characters at most).';
    if (!/^[^\\/:*?"<>|]+\.(pdf|jpe?g)$/i.test(fileName)) {
        return 'The file name must end with .pdf, .jpg or .jpeg and cannot contain / \\ : * ? " < > |';
    }
    return null;
}

// ---------- R: list ----------
app.get('/', async (req, res) => {
    await showList(res, req.user.orgId);
});

// ---------- C: the form to add a document (must be before /:id routes) ----------
app.get('/new', async (req, res) => {
    // Only the deliveries of this supplier that are not inspected yet.
    const [deliveries] = await db().execute(
        `SELECT d.delivery_id, p.project_name, m.material_name, d.status
         FROM delivery d
         JOIN project p  ON p.project_id = d.project_id
         JOIN material m ON m.material_id = d.material_id
         WHERE d.org_id = ? AND d.status NOT IN ('INSPECTED', 'COMPLETED')
         ORDER BY d.slot_start DESC, d.delivery_id DESC`, [req.user.orgId]);
    res.render('documents/new', {
        deliveries: deliveries,
        typeOptions: DOC_TYPES.map(t => ({ value: t, selected: false }))
    });
});

// ---------- C: add ----------
app.post('/', async (req, res) => {
    const b = req.body;
    const fileName = String(b.file_name || '').trim();
    const message = checkFields(b.doc_type, fileName);
    if (message) return fail(res, message);

    try {
        // The delivery must belong to the company of the logged-in user and must not be inspected yet (checked in the same SQL).
        const [result] = await db().execute(
            `INSERT INTO delivery_document (delivery_id, uploaded_by, doc_type, file_name)
             SELECT d.delivery_id, ?, ?, ?
             FROM delivery d
             WHERE d.delivery_id = ? AND d.org_id = ? AND d.status NOT IN ('INSPECTED', 'COMPLETED')`,
            [req.user.id, b.doc_type, fileName, b.delivery_id, req.user.orgId]);
        if (result.affectedRows === 0) {
            return fail(res, 'Please choose one of your deliveries that is not inspected yet.', 409);
        }
        await showList(res, req.user.orgId, 'Document "' + fileName + '" added.');
    }
    catch (err) {
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

    if (req.body.action !== 'update') {
        return res.render('documents/row', row);                  // cancel: show the row without changes
    }

    const fileName = String(req.body.file_name || '').trim();
    const message = checkFields(req.body.doc_type, fileName);
    if (message) return fail(res, message);
    if (!row.canEdit) return fail(res, 'The delivery is already inspected, so its documents cannot be changed.', 409);

    try {
        await db().execute(
            `UPDATE delivery_document doc JOIN delivery d ON d.delivery_id = doc.delivery_id
             SET doc.doc_type = ?, doc.file_name = ?
             WHERE doc.document_id = ? AND d.org_id = ? AND d.status NOT IN ('INSPECTED', 'COMPLETED')`,
            [req.body.doc_type, fileName, id, orgId]);

        const fresh = await findDocument(id, orgId);
        if (!fresh.canEdit && (fresh.docType !== req.body.doc_type || fresh.fileName !== fileName)) {
            return fail(res, 'The delivery was inspected meanwhile: its documents cannot be changed any more.', 409);
        }
        res.render('documents/rowToast', Object.assign(fresh, { message: 'Document #' + id + ' updated.', kind: 'success' }));
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete ----------
app.delete('/:id', async (req, res) => {
    try {
        const [result] = await db().execute(
            `DELETE doc FROM delivery_document doc JOIN delivery d ON d.delivery_id = doc.delivery_id
             WHERE doc.document_id = ? AND d.org_id = ? AND d.status NOT IN ('INSPECTED', 'COMPLETED')`,
            [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) {
            return fail(res, 'Only documents of your deliveries that are not inspected yet can be deleted.', 409);
        }
        // Nothing except the message: HTMX removes the row (outerHTML swap with an empty response) and shows the message in #toast.
        res.render('toast', { message: 'Document #' + req.params.id + ' deleted.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

module.exports = app;
