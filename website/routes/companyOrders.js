// Company overview (company account, read only): what the whole company is doing, with a few totals at the top.
//   - a CONTRACTOR sees all the deliveries of all its projects (who ordered them, the inspection result, the retention), and its RFQs;
//   - a SUPPLIER sees all the deliveries it received from all contractors, its average rating and its quotations;
//   - an INSPECTION company sees all the inspections that its inspectors recorded, and the deliveries that wait for an inspection.
// Every query is limited to the company of the logged-in company account. Nothing can be changed here: the users do the work.
const express = require('express');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};
const STATUSES = Object.keys(BADGES);
const STATUS_ORDER = "FIELD(d.status, 'SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED')";

const money = sql => `FORMAT(${sql}, 0)`;
const ACCEPTED_VALUE = 'd.delivery_value * i.accepted_quantity / d.ordered_quantity';

// The columns that all three lists share.
const COMMON = `
    d.delivery_id                                  AS ID,
    p.project_name                                 AS project,
    m.material_name                                AS material,
    m.unit                                         AS unit,
    CAST(d.ordered_quantity AS DOUBLE)             AS quantity,
    ${money('d.delivery_value')}                   AS value,
    DATE_FORMAT(d.slot_start, '%Y-%m-%d')          AS day,
    d.status                                       AS status,
    d.declined_at IS NOT NULL                      AS declined,
    CAST(i.accepted_quantity AS DOUBLE)            AS accepted,
    CAST(i.received_quantity AS DOUBLE)            AS received,
    ${money(ACCEPTED_VALUE)}                       AS acceptedValue,
    ${money(ACCEPTED_VALUE + ' * i.retention_rate')} AS retention,
    r.score                                        AS score`;

const JOINS = `
    FROM delivery d
    JOIN project p       ON p.project_id = d.project_id
    JOIN organization c  ON c.org_id = p.org_id
    JOIN organization s  ON s.org_id = d.org_id
    JOIN material m      ON m.material_id = d.material_id
    LEFT JOIN inspection i      ON i.delivery_id = d.delivery_id
    LEFT JOIN supplier_rating r ON r.delivery_id = d.delivery_id`;

// What each kind of company sees: the list, its filters and sorting, and the totals.
const VIEWS = {
    CONTRACTOR: {
        title: 'All deliveries of the company',
        intro: 'Every delivery of every project, whoever of your project managers ordered it.',
        select: `SELECT ${COMMON}, s.org_name AS partner, u.full_name AS person ${JOINS}
                 JOIN user_account u ON u.user_id = d.created_by
                 WHERE p.org_id = ?`,
        partner: 'Supplier', person: 'Ordered by',
        search: ['CAST(d.delivery_id AS CHAR)', 'p.project_name', 's.org_name', 'm.material_name', 'u.full_name'],
        projects: 'SELECT project_id AS id, project_name AS name FROM project WHERE org_id = ? ORDER BY project_name',
        totals: `SELECT COUNT(*) AS deliveries,
                        SUM(d.status <> 'COMPLETED') AS open,
                        SUM(d.declined_at IS NOT NULL) AS declined,
                        ${money('COALESCE(SUM(d.delivery_value), 0)')} AS ordered,
                        ${money('COALESCE(SUM(' + ACCEPTED_VALUE + '), 0)')} AS acceptedValue,
                        ${money('COALESCE(SUM(' + ACCEPTED_VALUE + ' * i.retention_rate), 0)')} AS retention,
                        (SELECT COUNT(*) FROM rfq x JOIN project px ON px.project_id = x.project_id WHERE px.org_id = ? AND x.status = 'SENT') AS openRfqs
                 FROM delivery d JOIN project p ON p.project_id = d.project_id LEFT JOIN inspection i ON i.delivery_id = d.delivery_id
                 WHERE p.org_id = ?`,
        cards: t => [
            { label: 'Deliveries not completed', value: t.open, icon: 'truck' },
            { label: 'Declined by a supplier', value: t.declined, icon: 'x-circle', warn: Number(t.declined) > 0 },
            { label: 'Ordered value (NT$)', value: t.ordered, icon: 'cash-stack' },
            { label: 'Accepted value (NT$)', value: t.acceptedValue, icon: 'check2-circle' },
            { label: 'Retention kept (NT$)', value: t.retention, icon: 'safe' },
            { label: 'RFQs waiting for quotations', value: t.openRfqs, icon: 'envelope-paper' }
        ],
        totalArgs: orgId => [orgId, orgId]
    },
    SUPPLIER: {
        title: 'All deliveries of the company',
        intro: 'Every delivery that the contractors ordered from your company.',
        select: `SELECT ${COMMON}, c.org_name AS partner, NULL AS person ${JOINS}
                 WHERE d.org_id = ?`,
        partner: 'Contractor', person: null,
        search: ['CAST(d.delivery_id AS CHAR)', 'p.project_name', 'c.org_name', 'm.material_name'],
        totals: `SELECT COUNT(*) AS deliveries,
                        SUM(d.status NOT IN ('DELIVERED', 'INSPECTED', 'COMPLETED')) AS toDeliver,
                        ${money("COALESCE(SUM(IF(d.status = 'COMPLETED', " + ACCEPTED_VALUE + ', 0)), 0)')} AS completedValue,
                        (SELECT ROUND(AVG(r2.score), 1) FROM supplier_rating r2 JOIN delivery d2 ON d2.delivery_id = r2.delivery_id WHERE d2.org_id = ?) AS rating,
                        (SELECT COUNT(*) FROM quotation q WHERE q.org_id = ?) AS quotations,
                        (SELECT COUNT(*) FROM quotation q WHERE q.org_id = ? AND q.status = 'ACCEPTED') AS won,
                        (SELECT COUNT(*) FROM supplier_product sp WHERE sp.org_id = ? AND sp.active = 1) AS products
                 FROM delivery d LEFT JOIN inspection i ON i.delivery_id = d.delivery_id
                 WHERE d.org_id = ?`,
        cards: t => [
            { label: 'Deliveries to prepare or bring', value: t.toDeliver, icon: 'truck' },
            { label: 'Value of completed deliveries (NT$)', value: t.completedValue, icon: 'cash-stack' },
            { label: 'Average rating', value: t.rating === null ? '-' : t.rating + ' / 5', icon: 'star-half' },
            { label: 'Quotations sent / accepted', value: t.quotations + ' / ' + t.won, icon: 'receipt' },
            { label: 'Listed products', value: t.products, icon: 'boxes' }
        ],
        totalArgs: orgId => [orgId, orgId, orgId, orgId, orgId]
    },
    INSPECTION: {
        title: 'All inspections of the company',
        intro: 'Every delivery that one of your inspectors inspected, for all the contractors that appointed you.',
        select: `SELECT ${COMMON}, c.org_name AS partner, u.full_name AS person ${JOINS}
                 JOIN user_account u ON u.user_id = i.inspector_id
                 WHERE u.org_id = ?`,
        partner: 'Contractor', person: 'Inspector',
        search: ['CAST(d.delivery_id AS CHAR)', 'p.project_name', 'c.org_name', 's.org_name', 'm.material_name', 'u.full_name'],
        totals: `SELECT COUNT(*) AS inspections,
                        SUM(i.accepted_quantity = 0) AS rejected,
                        COUNT(DISTINCT p.org_id) AS contractors,
                        (SELECT COUNT(*) FROM delivery d2 JOIN project p2 ON p2.project_id = d2.project_id
                         JOIN inspection_appointment a ON a.contractor_id = p2.org_id AND a.inspection_id = ?
                         WHERE d2.status = 'DELIVERED') AS waiting
                 FROM inspection i JOIN user_account u ON u.user_id = i.inspector_id
                 JOIN delivery d ON d.delivery_id = i.delivery_id JOIN project p ON p.project_id = d.project_id
                 WHERE u.org_id = ?`,
        cards: t => [
            { label: 'Deliveries waiting for an inspection', value: t.waiting, icon: 'hourglass-split', warn: Number(t.waiting) > 0 },
            { label: 'Inspections recorded', value: t.inspections, icon: 'clipboard-check' },
            { label: 'Rejected deliveries', value: t.rejected || 0, icon: 'x-octagon' },
            { label: 'Contractors served', value: t.contractors, icon: 'buildings' }
        ],
        totalArgs: orgId => [orgId, orgId]
    }
};

function prepare(row) {
    row.badge = BADGES[row.status];
    row.declined = Boolean(row.declined);
    if (row.accepted !== null) {
        row.decision = row.accepted === 0 ? 'Rejected' : row.accepted === row.received ? 'Accepted' : 'Partially accepted';
    }
    return row;
}

app.get('/', async (req, res) => {
    const orgId = req.user.orgId;
    const view = VIEWS[req.user.orgType];
    const filters = [];
    if (view.projects) {
        const [projects] = await db().execute(view.projects, [orgId]);
        filters.push({ name: 'project', label: 'project', allLabel: 'All projects',
                       options: projects.map(p => ({ value: String(p.id), label: p.name, sql: 'p.project_id = ' + Number(p.id) })) });
    }
    const list = {
        search: view.search,
        filters: filters,
        statuses: STATUSES,
        statusColumn: 'd.status',
        sorts: { ID: 'd.delivery_id', project: 'p.project_name', partner: req.user.orgType === 'CONTRACTOR' ? 's.org_name' : 'c.org_name',
                 material: 'm.material_name', value: 'd.delivery_value', day: 'd.slot_start', status: STATUS_ORDER },
        tieBreak: 'd.delivery_id DESC',
        defaultOrder: 'd.slot_start DESC'
    };
    const data = await readList(db(), req, list, view.select, [orgId], prepare);
    const [[totals]] = await db().execute(view.totals, view.totalArgs(orgId));
    res.render('company/orders', Object.assign(data, {
        title: view.title, intro: view.intro, partner: view.partner, person: view.person, cards: view.cards(totals)
    }));
});

module.exports = app;
