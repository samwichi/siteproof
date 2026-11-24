// Registration. Two kinds of accounts:
//   - a COMPANY account: registers a company (contractor, supplier or third-party inspection company) with its first account and,
//     if wanted, proof documents. The company is PENDING until the administrator approves it (routes/admin.js).
//   - a USER account (contractor, supplier or inspector): chooses one of the APPROVED companies and can work at once.
const express = require('express');
const bcrypt = require('bcryptjs');
const { fail } = require('../lib/respond');
const { like } = require('../lib/listing');
const { setLoginCookie, HOME_PAGES } = require('../lib/auth');
const { readFiles, saveFiles, removeFiles, MAX_FILES } = require('../lib/upload');
const app = express.Router();

const db = () => app.connection.promise();

const COMPANY_TYPES = {
    CONTRACTOR: 'Contractor',
    SUPPLIER: 'Supplier',
    INSPECTION: 'Third-party inspection company'
};

// Which kind of company can a user of each role work for?
const ROLE_COMPANIES = {
    CONTRACTOR_PM: ['CONTRACTOR'],
    SUPPLIER: ['SUPPLIER'],
    INSPECTOR: ['CONTRACTOR', 'INSPECTION']       // an inspector works for a contractor, or for a third-party inspection company
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = v => String(v === undefined || v === null ? '' : v).trim();

// Checks that are the same in both forms. Returns an error message or null.
function checkPerson(name, email, password, password2) {
    if (!name) return 'Please enter your name.';
    if (name.length > 100) return 'The name can have at most 100 characters.';
    if (!EMAIL.test(email) || email.length > 100) return 'Please enter a valid e-mail address (at most 100 characters).';
    if (password.length < 8) return 'The password needs at least 8 characters.';
    if (Buffer.byteLength(password) > 72) return 'The password can have at most 72 bytes.';
    if (password !== password2) return 'The two passwords are not the same.';
    return null;
}

// ---------- the choice: company or user ----------
app.get('/', (req, res) => {
    res.render('register/index');
});

// ---------- company account ----------
app.get('/company', (req, res) => {
    res.render('register/company', { types: Object.entries(COMPANY_TYPES).map(([value, label]) => ({ value, label })), maxFiles: MAX_FILES });
});

app.post('/company', async (req, res) => {
    const upload = await readFiles(req, res);          // multipart form: the fields are in req.body after this
    if (upload.error) return fail(res, upload.error);

    const b = req.body;
    const type = text(b.org_type), id = text(b.org_id), name = text(b.org_name);
    const address = text(b.address), phone = text(b.phone), orgEmail = text(b.org_email);
    const person = text(b.full_name), email = text(b.email).toLowerCase();

    if (!Object.hasOwn(COMPANY_TYPES, type)) return fail(res, 'Please choose the type of your company.');
    if (!/^\d{8}$/.test(id)) return fail(res, 'The company ID has 8 digits.');
    if (!name) return fail(res, 'Please enter the name of the company.');
    if (name.length > 100) return fail(res, 'The company name can have at most 100 characters.');
    if (address.length > 200) return fail(res, 'The address can have at most 200 characters.');
    if (phone.length > 30) return fail(res, 'The phone number can have at most 30 characters.');
    if (orgEmail && (!EMAIL.test(orgEmail) || orgEmail.length > 100)) return fail(res, 'The e-mail address of the company is not valid.');
    const message = checkPerson(person, email, String(b.password || ''), String(b.password2 || ''));
    if (message) return fail(res, message);

    const hash = await bcrypt.hash(String(b.password), 10);
    let saved = [];
    const conn = await db().getConnection();
    try {
        saved = await saveFiles(upload.files);
        await conn.beginTransaction();
        await conn.execute(
            "INSERT INTO organization (org_id, org_name, org_type, address, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')",
            [id, name, type, address || null, phone || null, orgEmail || null]);
        await conn.execute(
            "INSERT INTO user_account (org_id, full_name, email, password, role) VALUES (?, ?, ?, ?, 'COMPANY')",
            [id, person, email, hash]);
        for (const f of saved) {
            await conn.execute('INSERT INTO org_document (org_id, file_name, stored_name, file_type, file_size) VALUES (?, ?, ?, ?, ?)',
                [id, f.name, f.stored, f.type, f.size]);
        }
        await conn.commit();
        res.render('register/companyDone', { name: name, files: saved.length, many: saved.length > 1 });
    }
    catch (err) {
        await conn.rollback().catch(() => {});
        await removeFiles(saved.map(f => f.stored));
        if (err.errno === 1062 && /user_account|email/.test(err.sqlMessage)) return fail(res, 'This e-mail address already has an account.', 409);
        if (err.errno === 1062) return fail(res, 'A company with this ID is already registered. If it is yours, please contact the administrator.', 409);
        console.log('Company registration error: ', err);
        fail(res, 'The registration failed. Please try again.', 500);
    }
    finally {
        conn.release();
    }
});

// ---------- user account ----------
app.get('/user', async (req, res) => {
    res.render('register/user', { roles: Object.keys(ROLE_COMPANIES), companies: await findCompanies('', '') });
});

// The approved companies that the role can work for and whose name or ID contains the text (the first 50; type to narrow down).
const COMPANY_LIMIT = 50;
async function findCompanies(role, textToFind) {
    const types = ROLE_COMPANIES[role];
    if (!types) return { chosen: false, companies: [], total: 0, shown: 0, more: false };
    const q = text(textToFind).slice(0, 100);
    const marks = types.map(() => '?').join(', ');
    const where = " WHERE status = 'APPROVED' AND org_type IN (" + marks + ')' + (q ? ' AND (org_name LIKE ? OR org_id LIKE ?)' : '');
    const args = types.concat(q ? [like(q), like(q)] : []);
    const [[counted]] = await db().execute('SELECT COUNT(*) AS n FROM organization' + where, args);
    const [rows] = await db().execute('SELECT org_id, org_name, org_type FROM organization' + where + ' ORDER BY org_name LIMIT ' + COMPANY_LIMIT, args);
    const total = Number(counted.n);
    // The type is shown only when the role can work for more than one type of company.
    const companies = rows.map(r => ({ org_id: r.org_id, org_name: r.org_name, typeLabel: types.length > 1 ? COMPANY_TYPES[r.org_type] : '' }));
    return { chosen: true, companies: companies, total: total, shown: companies.length, more: total > companies.length };
}

// The <option>s of the company <select> (the role select and the search box ask for them).
app.get('/companies', async (req, res) => {
    res.render('register/companyOptions', await findCompanies(req.query.role, req.query.q));
});

app.post('/user', async (req, res) => {
    const b = req.body;
    const role = text(b.role), orgId = text(b.org_id), name = text(b.full_name), email = text(b.email).toLowerCase();

    if (!Object.hasOwn(ROLE_COMPANIES, role)) return fail(res, 'Please choose your role.');
    if (!orgId) return fail(res, 'Please choose your company.');
    const message = checkPerson(name, email, String(b.password || ''), String(b.password2 || ''));
    if (message) return fail(res, message);

    try {
        // The company must be approved and of the right type for the role (the browser could send anything).
        const marks = ROLE_COMPANIES[role].map(() => '?').join(', ');
        const [orgs] = await db().execute(
            "SELECT org_id FROM organization WHERE org_id = ? AND status = 'APPROVED' AND org_type IN (" + marks + ')', [orgId].concat(ROLE_COMPANIES[role]));
        if (orgs.length === 0) return fail(res, 'Please choose a company from the list.', 404);

        const hash = await bcrypt.hash(String(b.password), 10);
        const [result] = await db().execute(
            'INSERT INTO user_account (org_id, full_name, email, password, role) VALUES (?, ?, ?, ?, ?)', [orgId, name, email, hash, role]);

        // The account can be used at once: sign in and open the page of the role (HX-Redirect loads the whole page, so the menu changes).
        setLoginCookie(res, { user_id: result.insertId, org_id: orgId, full_name: name, role: role });
        res.set('HX-Redirect', HOME_PAGES[role]).send('');
    }
    catch (err) {
        if (err.errno === 1062) return fail(res, 'This e-mail address already has an account.', 409);
        console.log('User registration error: ', err);
        fail(res, 'The registration failed. Please try again.', 500);
    }
});

module.exports = app;
