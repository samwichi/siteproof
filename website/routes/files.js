// Open the file of a quality document (a normal link, not an HTMX request, so it is mounted before the wildcard route of app.js).
// Who may open it: the supplier that delivered, the project managers of the contractor, and the inspectors that may inspect
// the delivery (the contractor's own and those of its appointed inspection companies). The type comes from our own check at the upload.
const express = require('express');
const { filePath } = require('../lib/upload');
const app = express.Router();

const MIME = { PDF: 'application/pdf', JPG: 'image/jpeg', PNG: 'image/png' };

function access(user) {
    if (user.role === 'CONTRACTOR_PM') return { sql: 'p.org_id = ?', args: [user.orgId] };
    if (user.role === 'SUPPLIER') return { sql: 'd.org_id = ?', args: [user.orgId] };
    return { sql: '(p.org_id = ? OR p.org_id IN (SELECT a.contractor_id FROM inspection_appointment a WHERE a.inspection_id = ?))', args: [user.orgId, user.orgId] };
}

app.get('/:id', async (req, res) => {
    const a = access(req.user);
    const [rows] = await app.connection.promise().execute(
        `SELECT doc.stored_name, doc.file_name, doc.file_type
         FROM delivery_document doc JOIN delivery d ON d.delivery_id = doc.delivery_id JOIN project p ON p.project_id = d.project_id
         WHERE doc.document_id = ? AND ${a.sql}`, [req.params.id].concat(a.args));
    const full = rows.length === 1 && rows[0].stored_name ? filePath(rows[0].stored_name) : null;
    if (!full) return res.status(404).send('Document not found.');

    res.set({
        'Content-Type': MIME[rows[0].file_type],
        'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(rows[0].file_name),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Cache-Control': 'private, no-store'
    });
    res.sendFile(full, err => {
        if (err && !res.headersSent) res.status(404).send('The file is missing on the server.');
    });
});

module.exports = app;
