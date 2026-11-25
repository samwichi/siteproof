// Uploaded files: the proof documents of a company (registration) and the quality documents of a delivery.
// Upload, check and save (and later read) the files. The files are kept in the folder website/uploads under a random name.
// Nobody can open them by a link in the folder: only the routes that check who may see them read them
// (routes/adminDocuments.js for the administrator, routes/files.js for the quality documents).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const FOLDER = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(FOLDER, { recursive: true });

const MAX_FILES = 3;
const MAX_SIZE = 5 * 1024 * 1024;        // 5 MB per file

// The files are first kept in memory, so nothing is written to the disk before everything is checked.
// field: the name of the file input (proof for the registration, file for a quality document); max: how many files.
const receiver = (field, max) => multer({ storage: multer.memoryStorage(), limits: { files: max, fileSize: MAX_SIZE, fields: 20 } }).array(field, max);

// What the file really is. The name and the type that the browser sends can be false, so we look at the first bytes of the file.
function detectType(buffer) {
    if (buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'PDF', ext: '.pdf', mime: 'application/pdf' };
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { type: 'JPG', ext: '.jpg', mime: 'image/jpeg' };
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'PNG', ext: '.png', mime: 'image/png' };
    return null;
}

// The name of the file as the user sees it: no folder, no control characters, at most 150 characters.
// (Browsers send the name as UTF-8, but multer reads it as Latin-1, so a Chinese name must be converted back.)
function cleanName(original) {
    let name = String(original || '');
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('�')) name = fixed;
    name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return (name || 'document').slice(-150);
}

// Run multer and check every file. Returns { files: [{ name, type, ext, mime, size, buffer }] } or { error: 'message' }.
function readFiles(req, res, options = {}) {
    const field = options.field || 'proof';
    const max = options.max || MAX_FILES;
    return new Promise(resolve => {
        receiver(field, max)(req, res, err => {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE') return resolve({ error: 'A file is larger than 5 MB.' });
                if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return resolve({ error: max === 1 ? 'Please upload one file.' : 'You can upload at most ' + max + ' files.' });
                console.log('Upload error: ', err);
                return resolve({ error: 'The upload failed. Please try again.' });
            }
            const files = [];
            for (const f of req.files || []) {
                if (f.size === 0) continue;                 // an empty file field: the user did not choose a file
                const kind = detectType(f.buffer);
                if (!kind) return resolve({ error: 'The file "' + cleanName(f.originalname) + '" is not a PDF, JPG or PNG file.' });
                files.push({ name: cleanName(f.originalname), type: kind.type, ext: kind.ext, mime: kind.mime, size: f.size, buffer: f.buffer });
            }
            resolve({ files: files });
        });
    });
}

// Write the checked files to the folder. Returns the same list with the stored name of each file.
async function saveFiles(files) {
    const saved = [];
    try {
        for (const f of files) {
            const stored = crypto.randomBytes(16).toString('hex') + f.ext;
            await fs.promises.writeFile(path.join(FOLDER, stored), f.buffer, { flag: 'wx' });
            saved.push(Object.assign({}, f, { stored: stored }));
        }
        return saved;
    }
    catch (err) {
        await removeFiles(saved.map(f => f.stored));
        throw err;
    }
}

// Delete files again (when the database did not accept the change, or when the document is deleted or replaced).
async function removeFiles(storedNames) {
    for (const name of storedNames) {
        await fs.promises.rm(path.join(FOLDER, name), { force: true }).catch(() => {});
    }
}

// The full path of a stored file. The name comes from the database, but we check it anyway.
function filePath(stored) {
    return /^[0-9a-f]{32}\.(pdf|jpg|png)$/.test(stored) ? path.join(FOLDER, stored) : null;
}

module.exports = { readFiles, saveFiles, removeFiles, filePath, detectType, cleanName, MAX_FILES, MAX_SIZE };
