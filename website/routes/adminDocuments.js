// The administrator opens a proof document of a company (mounted at /admin/documents, before the wildcard route of app.js,
// because it is a normal link and not an HTMX request). The type of the file comes from our own check at the upload, not from the user.
const express = require('express');
const { filePath } = require('../lib/upload');
const app = express.Router();

const MIME = { PDF: 'application/pdf', JPG: 'image/jpeg', PNG: 'image/png' };

app.get('/:id', async (req, res) => {
    const [rows] = await app.connection.promise().execute(
        'SELECT stored_name, file_name, file_type FROM org_document WHERE document_id = ?', [req.params.id]);
    const full = rows.length === 1 ? filePath(rows[0].stored_name) : null;
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
