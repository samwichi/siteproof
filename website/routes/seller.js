// The seller center: the home page of a supplier (the counterpart of the shop of the contractors, routes/shop.js).
//   - /seller (app.js also sends the Home page of a supplier here): what needs to be done now (RFQs to answer, deliveries to ship,
//     deliveries without a quality document, declined deliveries), the performance of the company (rating, on time, completed),
//     its products (listed, unlisted, the most ordered) and the latest ratings;
//   - /seller/storefront: "My storefront", the listed products of the company as cards, like the contractors see them in the shop,
//     with the place of its price among all the approved suppliers of the material (1 = the cheapest).
// Every query is limited to the company of the logged-in user (org_id = req.user.orgId). Read only.
const express = require('express');
const supplierStats = require('../lib/supplierStats');
const app = express.Router();

const db = () => app.connection.promise();

const money = column => `IF(${column} = ROUND(${column}), FORMAT(${column}, 0), FORMAT(${column}, 2))`;
// "1 delivery", "2 deliveries" (Handlebars cannot compare numbers, so the text is made here).
const plural = (n, word) => n + ' ' + (n === 1 ? word : /[^aeiou]y$/.test(word) ? word.slice(0, -1) + 'ies' : word + 's');
const ICONS = { Labor: 'bi-person-gear', Equipment: 'bi-truck-front', Material: 'bi-bricks', Other: 'bi-box-seam' };
const icon = name => ICONS[name] || 'bi-box-seam';
const LISTED_SHOWN = 3;      // RFQs, deliveries and ratings shown under each heading of the seller center

// ---------- the seller center ----------

// What needs to be done: each item is a number with a link to the page where the work is done.
async function readTodo(orgId) {
    const [rfqs] = await db().execute(
        `SELECT r.rfq_id AS ID, r.title, c.org_name AS contractor, DATE_FORMAT(r.due_date, '%Y-%m-%d') AS due,
                DATEDIFF(r.due_date, CURDATE()) AS daysLeft
         FROM rfq_supplier rs
         JOIN rfq r          ON r.rfq_id = rs.rfq_id AND r.status = 'SENT' AND r.due_date >= CURDATE()
         JOIN project p      ON p.project_id = r.project_id
         JOIN organization c ON c.org_id = p.org_id
         WHERE rs.org_id = ? AND NOT EXISTS (SELECT 1 FROM quotation q WHERE q.rfq_id = rs.rfq_id AND q.org_id = rs.org_id)
         ORDER BY r.due_date, r.rfq_id`, [orgId]);
    rfqs.forEach(r => { r.daysLeft = Number(r.daysLeft); r.dueText = r.daysLeft === 0 ? 'today' : r.daysLeft === 1 ? 'tomorrow' : 'in ' + r.daysLeft + ' days'; });

    const [[n]] = await db().execute(
        `SELECT COALESCE(SUM(d.status IN ('SCHEDULED', 'PREPARING', 'IN_TRANSIT') AND d.declined_at IS NULL
                             AND d.slot_start < CURDATE() + INTERVAL 2 DAY), 0)                       AS shipSoon,
                COALESCE(SUM(d.status IN ('SCHEDULED', 'PREPARING', 'IN_TRANSIT') AND d.declined_at IS NULL), 0) AS toShip,
                COALESCE(SUM(d.status IN ('IN_TRANSIT', 'DELIVERED')
                             AND NOT EXISTS (SELECT 1 FROM delivery_document x WHERE x.delivery_id = d.delivery_id)), 0) AS noDocument,
                COALESCE(SUM(d.status = 'SCHEDULED' AND d.declined_at IS NOT NULL), 0)                AS declined
         FROM delivery d WHERE d.org_id = ?`, [orgId]);

    // The next deliveries to work on (the nearest time slot first).
    const [next] = await db().execute(
        `SELECT d.delivery_id AS ID, m.material_name AS material, c.org_name AS contractor, d.status,
                DATE_FORMAT(d.slot_start, '%Y-%m-%d %H:%i') AS slotStart
         FROM delivery d
         JOIN material m     ON m.material_id = d.material_id
         JOIN project p      ON p.project_id = d.project_id
         JOIN organization c ON c.org_id = p.org_id
         WHERE d.org_id = ? AND d.status IN ('SCHEDULED', 'PREPARING', 'IN_TRANSIT') AND d.declined_at IS NULL
         ORDER BY d.slot_start, d.delivery_id
         LIMIT ${LISTED_SHOWN}`, [orgId]);

    const cards = [
        { n: rfqs.length, label: 'RFQs to answer', hint: rfqs.length ? 'the first one closes ' + rfqs[0].dueText : 'nothing to quote now',
          href: '/quotations', icon: 'bi-envelope-paper', kind: 'primary' },
        { n: Number(n.shipSoon), label: 'to ship today or tomorrow', hint: plural(Number(n.toShip), 'delivery') + ' to work on in all',
          href: '/assigned', icon: 'bi-truck', kind: 'success' },
        { n: Number(n.noDocument), label: 'without a quality document', hint: 'on the way or delivered', href: '/documents',
          icon: 'bi-file-earmark-x', kind: 'warning' },
        { n: Number(n.declined), label: 'declined by you', hint: 'waiting for the contractor', href: '/assigned?status=SCHEDULED',
          icon: 'bi-x-octagon', kind: 'danger' }
    ];
    cards.forEach(c => { c.zero = (c.n === 0); });
    return { cards: cards, rfqs: rfqs.slice(0, LISTED_SHOWN), moreRfqs: rfqs.length > LISTED_SHOWN, next: next };
}

// The products of the company: how many are listed and unlisted, and the most ordered ones.
async function readProducts(orgId) {
    const [[p]] = await db().execute(
        'SELECT COALESCE(SUM(active = 1), 0) AS listed, COALESCE(SUM(active = 0), 0) AS unlisted FROM supplier_product WHERE org_id = ?', [orgId]);
    const [top] = await db().execute(
        `SELECT m.material_name AS material, COUNT(*) AS n
         FROM delivery d JOIN material m ON m.material_id = d.material_id
         WHERE d.org_id = ?
         GROUP BY d.material_id, m.material_name
         ORDER BY n DESC, m.material_name
         LIMIT ${LISTED_SHOWN}`, [orgId]);
    top.forEach(t => { t.text = plural(Number(t.n), 'delivery'); });
    return { listed: Number(p.listed), unlisted: Number(p.unlisted), top: top };
}

// The latest ratings: when the delivery was completed (rated), by which contractor, for which material.
async function readRatings(orgId) {
    const [rows] = await db().execute(
        `SELECT r.score, m.material_name AS material, c.org_name AS contractor,
                DATE_FORMAT((SELECT MAX(e.created_at) FROM delivery_event e WHERE e.delivery_id = d.delivery_id AND e.event = 'COMPLETED'), '%Y-%m-%d') AS day
         FROM supplier_rating r
         JOIN delivery d     ON d.delivery_id = r.delivery_id
         JOIN material m     ON m.material_id = d.material_id
         JOIN project p      ON p.project_id = d.project_id
         JOIN organization c ON c.org_id = p.org_id
         WHERE d.org_id = ?
         ORDER BY day IS NULL, day DESC, d.delivery_id DESC
         LIMIT ${LISTED_SHOWN}`, [orgId]);
    rows.forEach(r => { r.stars = supplierStats.stars(r.score); });
    return rows;
}

async function showCenter(req, res) {
    const orgId = req.user.orgId;
    res.render('seller/index', Object.assign(await readTodo(orgId), {
        stats: await supplierStats.summary(db(), orgId),
        products: await readProducts(orgId),
        ratings: await readRatings(orgId)
    }));
}

app.get('/', showCenter);

// ---------- My storefront ----------
app.get('/storefront', async (req, res) => {
    const orgId = req.user.orgId;
    // The listed products, with the place of the lowest price among the approved suppliers that list the same material
    // (1 = the cheapest; suppliers with the same price share the place).
    const [cards] = await db().execute(
        `SELECT m.material_id AS id, m.material_name AS name, m.unit, c.category_name AS category,
                ${money('sp.price_min')} AS priceMin, ${money('sp.price_max')} AS priceMax, (sp.price_min = sp.price_max) AS samePrice,
                CAST(sp.min_order_qty AS DOUBLE) AS minOrder, sp.lead_time_days AS leadTime, sp.note,
                (SELECT COUNT(*) FROM supplier_product o JOIN organization s ON s.org_id = o.org_id AND s.org_type = 'SUPPLIER' AND s.status = 'APPROVED'
                 WHERE o.material_id = sp.material_id AND o.active = 1) AS suppliers,
                (SELECT COUNT(*) FROM supplier_product o JOIN organization s ON s.org_id = o.org_id AND s.org_type = 'SUPPLIER' AND s.status = 'APPROVED'
                 WHERE o.material_id = sp.material_id AND o.active = 1 AND o.price_min < sp.price_min) + 1 AS place
         FROM supplier_product sp
         JOIN material m          ON m.material_id = sp.material_id
         JOIN material_category c ON c.category_id = m.category_id
         WHERE sp.org_id = ? AND sp.active = 1
         ORDER BY m.material_name, m.material_id`, [orgId]);
    cards.forEach(card => {
        card.icon = icon(card.category);
        card.samePrice = Boolean(card.samePrice);
        card.suppliers = Number(card.suppliers);
        card.place = Number(card.place);
        card.alone = (card.suppliers === 1);
        card.cheapest = (card.place === 1 && !card.alone);
        card.placeText = card.alone ? 'Only supplier of this material' : card.cheapest ? 'Lowest price of ' + card.suppliers + ' suppliers'
            : 'Price place ' + card.place + ' of ' + card.suppliers + ' suppliers';
        card.leadText = card.leadTime === null ? null : plural(card.leadTime, 'day');
    });
    const [[org]] = await db().execute('SELECT org_name AS name, status FROM organization WHERE org_id = ?', [orgId]);
    const [[unlisted]] = await db().execute('SELECT COUNT(*) AS n FROM supplier_product WHERE org_id = ? AND active = 0', [orgId]);
    res.render('seller/storefront', {
        company: org.name, approved: org.status === 'APPROVED', cards: cards, cardsText: plural(cards.length, 'listed product'),
        unlisted: Number(unlisted.n), unlistedText: plural(Number(unlisted.n), 'unlisted product'), stats: await supplierStats.summary(db(), orgId)
    });
});

app.showCenter = showCenter;
module.exports = app;
