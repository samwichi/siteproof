// "Find products": the contractor searches the product catalog of all approved suppliers (the listed products of routes/products.js)
// and compares the suppliers of a material: price range per unit, minimum order, lead time and the average rating that the contractors
// gave the supplier. The button "Order" opens the new delivery form with the supplier and the material already chosen.
// Read only: the catalog belongs to the suppliers.
const express = require('express');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;

// The listed products of approved suppliers, with the rating of each supplier (average of all its rated deliveries).
// There is no "?" in it: the catalog is the same for every contractor.
const SELECT_CATALOG = `
    SELECT sp.product_id                               AS ID,
           m.material_name                             AS material,
           m.unit                                      AS unit,
           c.category_name                             AS category,
           s.org_name                                  AS supplier,
           CAST(sp.price_min AS DOUBLE)                AS priceMinRaw,
           CAST(sp.price_max AS DOUBLE)                AS priceMaxRaw,
           ${money('sp.price_min')}                    AS priceMin,
           ${money('sp.price_max')}                    AS priceMax,
           CAST(sp.min_order_qty AS DOUBLE)            AS minOrder,
           sp.lead_time_days                           AS leadTime,
           sp.note                                     AS note,
           rt.average                                  AS average,
           COALESCE(rt.rated, 0)                       AS rated
    FROM supplier_product sp
    JOIN organization s      ON s.org_id = sp.org_id AND s.org_type = 'SUPPLIER' AND s.status = 'APPROVED'
    JOIN material m          ON m.material_id = sp.material_id
    JOIN material_category c ON c.category_id = m.category_id
    LEFT JOIN (SELECT d.org_id, CAST(AVG(r.score) AS DOUBLE) AS average, COUNT(*) AS rated
               FROM supplier_rating r JOIN delivery d ON d.delivery_id = r.delivery_id
               GROUP BY d.org_id) rt ON rt.org_id = sp.org_id
    WHERE sp.active = 1`;

function prepare(row) {
    row.samePrice = (row.priceMinRaw === row.priceMaxRaw);
    row.rated = Number(row.rated);
    if (row.average !== null) {
        row.averageText = row.average.toFixed(1);
        const full = Math.round(row.average);
        row.stars = '★'.repeat(full) + '☆'.repeat(5 - full);
    }
    return row;
}

async function listSettings() {
    const [categories] = await db().execute('SELECT category_id, category_name FROM material_category ORDER BY category_id');
    return {
        search: ['m.material_name', 'sp.material_id', 's.org_name', 'sp.note'],
        filters: [{ name: 'category', label: 'category', allLabel: 'All categories',
                    options: categories.map(c => ({ value: String(c.category_id), label: c.category_name, sql: 'm.category_id = ' + Number(c.category_id) })) }],
        sorts: {
            material: 'm.material_name', supplier: 's.org_name', price: 'sp.price_min', minOrder: 'sp.min_order_qty',
            lead: 'sp.lead_time_days IS NULL, sp.lead_time_days',       // the products without a lead time last
            rating: 'COALESCE(rt.average, 0)'
        },
        tieBreak: 'sp.price_min, sp.product_id',
        defaultOrder: 'm.material_name, sp.price_min, s.org_name'          // the same material together, the cheapest first
    };
}

// ---------- R: search the catalog ----------
app.get('/', async (req, res) => {
    res.render('catalog/index', await readList(db(), req, await listSettings(), SELECT_CATALOG, [], prepare));
});

module.exports = app;
