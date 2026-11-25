// The administrator sees the products of ALL suppliers (mounted at /admin/products), read only.
// Unlike "Find products" of the contractors (routes/catalog.js), the list also has the unlisted products and the products of
// suppliers that are not approved (waiting or rejected), so the administrator can check what each supplier offers.
// The catalog belongs to the suppliers: the administrator cannot change it here.
const express = require('express');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;

// There is no "?" in it: the administrator sees every product.
const SELECT_PRODUCTS = `
    SELECT sp.product_id                               AS ID,
           m.material_name                             AS material,
           m.unit                                      AS unit,
           c.category_name                             AS category,
           s.org_id                                    AS orgId,
           s.org_name                                  AS supplier,
           s.status                                    AS supplierStatus,
           CAST(sp.price_min AS DOUBLE)                AS priceMinRaw,
           CAST(sp.price_max AS DOUBLE)                AS priceMaxRaw,
           ${money('sp.price_min')}                    AS priceMin,
           ${money('sp.price_max')}                    AS priceMax,
           CAST(sp.min_order_qty AS DOUBLE)            AS minOrder,
           sp.lead_time_days                           AS leadTime,
           sp.note                                     AS note,
           sp.active                                   AS active,
           DATE_FORMAT(sp.updated_at, '%Y-%m-%d')      AS updated
    FROM supplier_product sp
    JOIN organization s      ON s.org_id = sp.org_id
    JOIN material m          ON m.material_id = sp.material_id
    JOIN material_category c ON c.category_id = m.category_id
    WHERE 1 = 1`;

function prepare(row) {
    row.samePrice = (row.priceMinRaw === row.priceMaxRaw);
    row.isListed = (row.active === 1);
    row.isWaiting = (row.supplierStatus === 'PENDING');
    row.isRejected = (row.supplierStatus === 'REJECTED');
    return row;
}

async function listSettings() {
    const [categories] = await db().execute('SELECT category_id, category_name FROM material_category ORDER BY category_id');
    return {
        search: ['m.material_name', 'sp.material_id', 's.org_name', 's.org_id', 'sp.note'],
        filters: [
            { name: 'listed', label: 'listing', allLabel: 'All listings',
              options: [{ value: 'yes', label: 'Listed', sql: 'sp.active = 1' }, { value: 'no', label: 'Unlisted', sql: 'sp.active = 0' }] },
            { name: 'category', label: 'category', allLabel: 'All categories',
              options: categories.map(c => ({ value: String(c.category_id), label: c.category_name, sql: 'm.category_id = ' + Number(c.category_id) })) }
        ],
        sorts: {
            material: 'm.material_name', supplier: 's.org_name', price: 'sp.price_min', minOrder: 'sp.min_order_qty',
            lead: 'sp.lead_time_days IS NULL, sp.lead_time_days', updated: 'sp.updated_at'
        },
        tieBreak: 'sp.product_id',
        defaultOrder: 's.org_name, m.material_name'          // the products of one supplier together
    };
}

// ---------- R: all products of all suppliers ----------
app.get('/', async (req, res) => {
    res.render('admin/products', await readList(db(), req, await listSettings(), SELECT_PRODUCTS, [], prepare));
});

module.exports = app;
