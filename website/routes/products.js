// Product catalog of a supplier ("My products"): the supplier adds the materials that its company can provide, with the price range
// per unit, the minimum order and the lead time, and edits, unlists (takes off the catalog for now) or deletes them.
// The contractors search the listed products of all approved suppliers on the page "Find products" (routes/catalog.js).
// Rules:
//   - every query is limited to the company of the logged-in supplier (sp.org_id = req.user.orgId);
//   - a company offers each material only once (UNIQUE in the database), so the material cannot be changed after the product is added;
//   - an unlisted product stays in the list of the supplier, but the contractors do not see it.
const express = require('express');
const { fail, sqlMessage } = require('../lib/respond');
const { readList } = require('../lib/listing');
const { findMaterials } = require('../lib/materials');
const app = express.Router();

const db = () => app.connection.promise();

// A price as the user reads it: without decimals when it is a whole number (2,400), else with 2 decimals (179.10).
const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;

// One product as the supplier sees it. The caller adds the rest of the WHERE condition and the ORDER BY.
const SELECT_PRODUCTS = `
    SELECT sp.product_id                               AS ID,
           m.material_name                             AS material,
           m.unit                                      AS unit,
           c.category_name                             AS category,
           CAST(sp.price_min AS DOUBLE)                AS priceMinRaw,
           CAST(sp.price_max AS DOUBLE)                AS priceMaxRaw,
           ${money('sp.price_min')}                    AS priceMin,
           ${money('sp.price_max')}                    AS priceMax,
           CAST(sp.min_order_qty AS DOUBLE)            AS minOrder,
           sp.lead_time_days                           AS leadTime,
           sp.note                                     AS note,
           sp.active                                   AS active,
           DATE_FORMAT(sp.updated_at, '%Y-%m-%d')      AS updated,
           (SELECT COUNT(*) FROM delivery d WHERE d.org_id = sp.org_id AND d.material_id = sp.material_id) AS deliveries
    FROM supplier_product sp
    JOIN material m          ON m.material_id = sp.material_id
    JOIN material_category c ON c.category_id = m.category_id
    WHERE sp.org_id = ?`;

function prepare(row) {
    row.isListed = (row.active === 1);
    row.samePrice = (row.priceMinRaw === row.priceMaxRaw);
    row.deliveries = Number(row.deliveries);
    return row;
}

async function findProduct(id, orgId) {
    const [rows] = await db().execute(SELECT_PRODUCTS + ' AND sp.product_id = ?', [orgId, id]);
    return rows.length === 1 ? prepare(rows[0]) : null;
}

// The list settings (see lib/listing.js). The category filter is built from the table material_category (4 rows), so it is read each time.
async function listSettings() {
    const [categories] = await db().execute('SELECT category_id, category_name FROM material_category ORDER BY category_id');
    return {
        search: ['m.material_name', 'sp.material_id', 'sp.note'],
        filters: [{ name: 'category', label: 'category', allLabel: 'All categories',
                    options: categories.map(c => ({ value: String(c.category_id), label: c.category_name, sql: 'm.category_id = ' + Number(c.category_id) })) }],
        statuses: ['LISTED', 'UNLISTED'],
        statusColumn: "IF(sp.active = 1, 'LISTED', 'UNLISTED')",
        sorts: { material: 'm.material_name', category: 'c.category_id', price: 'sp.price_min', minOrder: 'sp.min_order_qty',
                 lead: 'sp.lead_time_days', deliveries: 'deliveries', status: 'sp.active' },
        tieBreak: 'sp.product_id',
        defaultOrder: 'sp.active DESC, c.category_id, m.material_name'
    };
}

async function showList(req, res, message) {
    const data = await readList(db(), req, await listSettings(), SELECT_PRODUCTS, [req.user.orgId], prepare);
    const materials = await findMaterials(db(), '', 0, req.user.orgId);
    res.render('products/index', Object.assign(data, materials, { materialUrl: '/products/materials', message: message, kind: 'success' }));
}

// Check the fields of the create form and the edit form. Returns { error } or the values to save.
const MAX_MONEY = 99999999.99;
function readFields(b) {
    const text = v => String(v === undefined || v === null ? '' : v).trim();
    const priceMin = Number(text(b.price_min)), priceMax = Number(text(b.price_max));
    if (text(b.price_min) === '' || !(priceMin >= 0 && priceMin <= MAX_MONEY)) return { error: 'Please enter the lowest price per unit (0 or more).' };
    if (text(b.price_max) === '' || !(priceMax >= 0 && priceMax <= MAX_MONEY)) return { error: 'Please enter the highest price per unit (0 or more).' };
    if (priceMax < priceMin) return { error: 'The highest price cannot be lower than the lowest price.' };

    let minOrder = null;
    if (text(b.min_order_qty) !== '') {
        minOrder = Number(text(b.min_order_qty));
        if (!(minOrder > 0 && minOrder <= MAX_MONEY)) return { error: 'The minimum order must be more than 0 (or leave it empty).' };
    }
    let leadTime = null;
    if (text(b.lead_time_days) !== '') {
        leadTime = Number(text(b.lead_time_days));
        if (!Number.isInteger(leadTime) || leadTime < 0 || leadTime > 365) return { error: 'The lead time must be a whole number of days from 0 to 365 (or leave it empty).' };
    }
    const note = text(b.note);
    if (note.length > 200) return { error: 'The note can have at most 200 characters.' };

    const round = n => Math.round(n * 100) / 100;
    return { priceMin: round(priceMin), priceMax: round(priceMax), minOrder: minOrder === null ? null : round(minOrder), leadTime: leadTime, note: note || null };
}

// ---------- R: list (with the form to add a product at the top) ----------
app.get('/', async (req, res) => {
    await showList(req, res);
});

// ---------- C: the material picker of the add form (only the materials that the company does not offer yet; must be before /:id routes) ----------
app.get('/materials', async (req, res) => {
    const materials = await findMaterials(db(), req.query.material_q, req.query.category, req.user.orgId);
    res.render('deliveries/materialResponse', Object.assign(materials, { materialUrl: '/products/materials' }));
});

// ---------- C: add a product ----------
app.post('/', async (req, res) => {
    const materialId = String(req.body.material_id || '').trim();
    if (!materialId) return fail(res, 'Please choose a material.');
    const f = readFields(req.body);
    if (f.error) return fail(res, f.error);
    try {
        await db().execute(
            `INSERT INTO supplier_product (org_id, material_id, price_min, price_max, min_order_qty, lead_time_days, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.user.orgId, materialId, f.priceMin, f.priceMax, f.minOrder, f.leadTime, f.note]);
        await showList(req, res, 'Product added. The contractors can find it now.');
    }
    catch (err) {
        if (err.errno === 1062) return fail(res, 'Your company offers this material already. Edit that product instead.', 409);
        fail(res, sqlMessage(err));
    }
});

// ---------- U: the form to edit one row ----------
app.get('/:id/edit', async (req, res) => {
    const row = await findProduct(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Product not found.', 404);
    res.render('products/edit', row);
});

// ---------- U: save (action=update) or close the form (action=cancel) ----------
app.put('/:id', async (req, res) => {
    const row = await findProduct(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Product not found.', 404);
    if (req.body.action !== 'update') return res.render('products/row', row);      // cancel: show the row without changes

    const f = readFields(req.body);
    if (f.error) return fail(res, f.error);
    try {
        await db().execute(
            `UPDATE supplier_product SET price_min = ?, price_max = ?, min_order_qty = ?, lead_time_days = ?, note = ?
             WHERE product_id = ? AND org_id = ?`,
            [f.priceMin, f.priceMax, f.minOrder, f.leadTime, f.note, req.params.id, req.user.orgId]);
        const fresh = await findProduct(req.params.id, req.user.orgId);
        res.render('products/rowToast', Object.assign(fresh, { message: fresh.material + ' updated.', kind: 'success' }));
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- U: unlist (active=0) or list again (active=1) ----------
app.put('/:id/active', async (req, res) => {
    const row = await findProduct(req.params.id, req.user.orgId);
    if (!row) return fail(res, 'Product not found.', 404);
    const active = (req.body.active === '1') ? 1 : 0;
    try {
        await db().execute('UPDATE supplier_product SET active = ? WHERE product_id = ? AND org_id = ?', [active, req.params.id, req.user.orgId]);
        const fresh = await findProduct(req.params.id, req.user.orgId);
        fresh.message = active ? fresh.material + ' is listed again: the contractors can find it.'
                               : fresh.material + ' is unlisted: the contractors do not see it any more.';
        fresh.kind = 'success';
        res.render('products/rowToast', fresh);
    }
    catch (err) {
        fail(res, sqlMessage(err));
    }
});

// ---------- D: delete ----------
app.delete('/:id', async (req, res) => {
    try {
        const [result] = await db().execute('DELETE FROM supplier_product WHERE product_id = ? AND org_id = ?', [req.params.id, req.user.orgId]);
        if (result.affectedRows === 0) return fail(res, 'Product not found.', 404);
        // hx-swap="delete" of the button removes the row (see website/README.md, section 4).
        res.render('toast', { message: 'Product deleted.', kind: 'success' });
    }
    catch (err) {
        fail(res, sqlMessage(err));     // later a product that is used by a request for quotation cannot be deleted (unlist it instead)
    }
});

module.exports = app;
