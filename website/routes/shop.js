// The shop: the home page of a contractor project manager, made like an online store.
//   - /            (app.js sends the Home page of a contractor here) and /shop: a big search box, the categories as tiles, the popular
//                  materials as cards (or the materials that match the search), and the deliveries of the company that are still open;
//   - /shop/materials/:id: the page of one material, like the page of a product in a store: every approved supplier that offers it,
//                  the cheapest first, with its price range, minimum order, lead time and rating, and the button "Order".
// Only the listed products (supplier_product.active = 1) of approved suppliers are shown, the same as "Find products" (routes/catalog.js).
// "Popular" = how often the material was bought in the purchases of the given data (table purchase) and in SiteProof (table delivery).
// Read only: the catalog belongs to the suppliers.
const express = require('express');
const { fail } = require('../lib/respond');
const { like } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;
const PAGE_SIZE = 12;          // 4 rows of 3 cards on a computer
const OPEN_DELIVERIES = 3;     // the open deliveries shown on the home page

// An icon for each category of the given data (the materials have no pictures).
const ICONS = { Labor: 'bi-person-gear', Equipment: 'bi-truck-front', Material: 'bi-bricks', Other: 'bi-box-seam' };
const icon = name => ICONS[name] || 'bi-box-seam';

// "1 supplier", "3 suppliers" (Handlebars cannot compare numbers, so the text is made here).
const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

const BADGES = { SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary', DELIVERED: 'warning', INSPECTED: 'success' };

// The offers of the approved suppliers, one row per material: how many suppliers, the lowest and the highest price.
const OFFERS = `
    SELECT sp.material_id, COUNT(*) AS suppliers, MIN(sp.price_min) AS lowest, MAX(sp.price_max) AS highest
    FROM supplier_product sp
    JOIN organization s ON s.org_id = sp.org_id AND s.org_type = 'SUPPLIER' AND s.status = 'APPROVED'
    WHERE sp.active = 1
    GROUP BY sp.material_id`;

// How often each material was bought: the purchases of the given data plus the deliveries in SiteProof.
const BOUGHT = `
    SELECT material_id, SUM(n) AS bought FROM (
        SELECT material_id, COUNT(*) AS n FROM purchase GROUP BY material_id
        UNION ALL
        SELECT material_id, COUNT(*) AS n FROM delivery GROUP BY material_id
    ) AS counts GROUP BY material_id`;

// The categories with the number of materials that can be bought in each one.
async function readCategories(chosen) {
    const [rows] = await db().execute(
        `SELECT c.category_id AS id, c.category_name AS name, COUNT(o.material_id) AS materials
         FROM material_category c
         LEFT JOIN material m ON m.category_id = c.category_id
         LEFT JOIN (${OFFERS}) o ON o.material_id = m.material_id
         GROUP BY c.category_id, c.category_name
         ORDER BY c.category_id`);
    return rows.map(c => ({ id: c.id, name: c.name, materials: Number(c.materials), materialsText: plural(Number(c.materials), 'material'), icon: icon(c.name), chosen: String(c.id) === chosen }));
}

// One page of material cards: the popular ones, or those that match the search text and the category. Returns the cards and the pager.
async function readMaterials(q, category, page) {
    let where = '';
    const args = [];
    if (q) {
        where += ' AND (m.material_name LIKE ? OR m.material_id LIKE ?)';
        args.push(like(q), like(q));
    }
    if (category) {
        where += ' AND m.category_id = ?';
        args.push(Number(category));
    }
    const joins = `
        FROM material m
        JOIN material_category c ON c.category_id = m.category_id
        JOIN (${OFFERS}) o ON o.material_id = m.material_id`;
    const [[counted]] = await db().execute('SELECT COUNT(*) AS n ' + joins + ' WHERE 1 = 1' + where, args);
    const total = Number(counted.n);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(page, pages);
    const [rows] = await db().execute(
        `SELECT m.material_id AS id, m.material_name AS name, m.unit, c.category_name AS category,
                o.suppliers, ${money('o.lowest')} AS lowest, ${money('o.highest')} AS highest, (o.lowest = o.highest) AS samePrice,
                COALESCE(b.bought, 0) AS bought
         ${joins}
         LEFT JOIN (${BOUGHT}) b ON b.material_id = m.material_id
         WHERE 1 = 1 ${where}
         ORDER BY bought DESC, m.material_name, m.material_id
         LIMIT ${PAGE_SIZE} OFFSET ${(current - 1) * PAGE_SIZE}`, args);
    const cards = rows.map(r => Object.assign(r, {
        suppliers: Number(r.suppliers), bought: Number(r.bought), suppliersText: plural(Number(r.suppliers), 'supplier'),
        boughtText: plural(Number(r.bought), 'time'), samePrice: Boolean(r.samePrice), icon: icon(r.category)
    }));

    // The address of another page keeps the search and the category.
    const href = n => {
        const p = new URLSearchParams();
        if (q) p.set('q', q);
        if (category) p.set('category', category);
        if (n > 1) p.set('page', n);
        const text = p.toString();
        return '/shop' + (text ? '?' + text : '');
    };
    return {
        cards: cards, total: total,
        from: total ? (current - 1) * PAGE_SIZE + 1 : 0, to: (current - 1) * PAGE_SIZE + cards.length,
        prevHref: current > 1 ? href(current - 1) : null, nextHref: current < pages ? href(current + 1) : null,
        showPager: pages > 1, page: current, pages: pages
    };
}

// The deliveries of the company that are not completed yet, the nearest time slot first.
async function readOpenDeliveries(orgId) {
    const [rows] = await db().execute(
        `SELECT d.delivery_id AS ID, m.material_name AS material, s.org_name AS supplier, p.project_name AS project, d.status,
                DATE_FORMAT(d.slot_start, '%Y-%m-%d %H:%i') AS slotStart, (d.declined_at IS NOT NULL) AS declined
         FROM delivery d
         JOIN project p      ON p.project_id = d.project_id
         JOIN organization s ON s.org_id = d.org_id
         JOIN material m     ON m.material_id = d.material_id
         WHERE p.org_id = ? AND d.status <> 'COMPLETED'
         ORDER BY d.slot_start, d.delivery_id
         LIMIT ${OPEN_DELIVERIES}`, [orgId]);
    const [[n]] = await db().execute(
        `SELECT COUNT(*) AS n FROM delivery d JOIN project p ON p.project_id = d.project_id WHERE p.org_id = ? AND d.status <> 'COMPLETED'`, [orgId]);
    rows.forEach(r => { r.badge = BADGES[r.status]; r.declined = Boolean(r.declined); });
    return { open: rows, openTotal: Number(n.n), openMore: Number(n.n) > rows.length };
}

// The home page of the shop. Also used by app.js for the Home page (/) of a contractor.
async function showHome(req, res) {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const categories = await readCategories(String(req.query.category || ''));
    const chosen = categories.find(c => c.chosen);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const materials = await readMaterials(q, chosen ? String(chosen.id) : '', page);
    res.render('shop/index', Object.assign(materials, await readOpenDeliveries(req.user.orgId), {
        q: q, categories: categories, category: chosen || null,
        searching: Boolean(q || chosen),
        heading: q ? 'Materials for "' + q + '"' + (chosen ? ' in ' + chosen.name : '') : chosen ? chosen.name : 'Popular materials'
    }));
}

app.get('/', showHome);

// ---------- the page of one material ----------
app.get('/materials/:id', async (req, res) => {
    const [found] = await db().execute(
        `SELECT m.material_id AS id, m.material_name AS name, m.unit, c.category_id AS categoryId, c.category_name AS category
         FROM material m JOIN material_category c ON c.category_id = m.category_id WHERE m.material_id = ?`, [req.params.id]);
    if (found.length !== 1) return fail(res, 'Material not found.', 404);
    const material = found[0];
    material.icon = icon(material.category);

    // Every listed product of an approved supplier for this material, the cheapest first, with the rating of the supplier.
    const [offers] = await db().execute(
        `SELECT sp.product_id AS ID, s.org_name AS supplier,
                CAST(sp.price_min AS DOUBLE) AS priceMinRaw, CAST(sp.price_max AS DOUBLE) AS priceMaxRaw,
                ${money('sp.price_min')} AS priceMin, ${money('sp.price_max')} AS priceMax,
                CAST(sp.min_order_qty AS DOUBLE) AS minOrder, sp.lead_time_days AS leadTime, sp.note,
                rt.average, COALESCE(rt.rated, 0) AS rated
         FROM supplier_product sp
         JOIN organization s ON s.org_id = sp.org_id AND s.org_type = 'SUPPLIER' AND s.status = 'APPROVED'
         LEFT JOIN (SELECT d.org_id, CAST(AVG(r.score) AS DOUBLE) AS average, COUNT(*) AS rated
                    FROM supplier_rating r JOIN delivery d ON d.delivery_id = r.delivery_id GROUP BY d.org_id) rt ON rt.org_id = sp.org_id
         WHERE sp.material_id = ? AND sp.active = 1
         ORDER BY sp.price_min, sp.lead_time_days IS NULL, sp.lead_time_days, s.org_name`, [material.id]);
    offers.forEach((o, index) => {
        o.samePrice = (o.priceMinRaw === o.priceMaxRaw);
        o.rated = Number(o.rated);
        o.ratedText = plural(o.rated, 'rating');
        o.leadText = o.leadTime === null ? null : plural(o.leadTime, 'day');
        o.cheapest = (index === 0 && offers.length > 1);
        if (o.average !== null) {
            o.averageText = o.average.toFixed(1);
            const full = Math.round(o.average);
            o.stars = '★'.repeat(full) + '☆'.repeat(5 - full);
        }
    });

    // What was paid for it before (the purchases of the given data): a hint for the price, not an offer.
    const [[market]] = await db().execute(
        `SELECT COUNT(*) AS n, ${money('AVG(unit_price)')} AS average, ${money('MIN(unit_price)')} AS lowest, ${money('MAX(unit_price)')} AS highest,
                DATE_FORMAT(MAX(purchase_date), '%Y-%m-%d') AS latest
         FROM purchase WHERE material_id = ?`, [material.id]);
    market.n = Number(market.n);
    market.text = plural(market.n, 'purchase');

    res.render('shop/material', Object.assign(material, { offers: offers, market: market.n ? market : null,
        offersText: offers.length === 1 ? '1 supplier offers this material' : offers.length + ' suppliers offer this material' }));
});

app.showHome = showHome;
module.exports = app;
