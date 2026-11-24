// UC7: the supplier sees its own rating and its delivery history (read only).
// A supplier only sees its own company (d.org_id = the company of the logged-in user): the average score,
// how many deliveries were rated, how the scores are distributed, and the list of its deliveries with the
// inspection result and the score of each one.
const express = require('express');
const app = express.Router();

const db = () => app.connection.promise();

const BADGES = {
    SCHEDULED: 'secondary', PREPARING: 'info', IN_TRANSIT: 'primary',
    DELIVERED: 'warning', INSPECTED: 'dark', COMPLETED: 'success'
};

const MAX_ROWS = 100;       // the list shows the latest deliveries; the summary always counts all of them

const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

// ---------- R: rating summary and delivery history ----------
app.get('/', async (req, res) => {
    const orgId = req.user.orgId;

    // The summary over all the deliveries of the supplier.
    const [[sum]] = await db().execute(
        `SELECT COUNT(*)                          AS deliveries,
                COALESCE(SUM(d.status = 'COMPLETED'), 0) AS completed,
                COUNT(r.score)                    AS rated,
                CAST(AVG(r.score) AS DOUBLE)      AS average
         FROM delivery d
         LEFT JOIN supplier_rating r ON r.delivery_id = d.delivery_id
         WHERE d.org_id = ?`, [orgId]);

    // How many deliveries got each score (5 to 1).
    const [counts] = await db().execute(
        `SELECT r.score AS score, COUNT(*) AS n
         FROM supplier_rating r JOIN delivery d ON d.delivery_id = r.delivery_id
         WHERE d.org_id = ? GROUP BY r.score`, [orgId]);
    const distribution = [5, 4, 3, 2, 1].map(score => {
        const found = counts.find(c => c.score === score);
        const n = found ? Number(found.n) : 0;
        return { score: score, n: n, percent: sum.rated > 0 ? Math.round(n * 100 / sum.rated) : 0 };
    });

    // The history: newest first. The limit is written in the SQL text because it is a fixed number.
    const [rows] = await db().execute(
        `SELECT d.delivery_id                               AS ID,
                c.org_name                                  AS contractor,
                p.project_name                              AS project,
                m.material_name                             AS material,
                m.unit                                      AS unit,
                CAST(d.ordered_quantity AS DOUBLE)          AS quantity,
                DATE_FORMAT(d.slot_start, '%Y-%m-%d')       AS date,
                d.status                                    AS status,
                CAST(i.received_quantity AS DOUBLE)         AS received,
                CAST(i.accepted_quantity AS DOUBLE)         AS accepted,
                r.score                                     AS score
         FROM delivery d
         JOIN project p      ON p.project_id = d.project_id
         JOIN organization c ON c.org_id = p.org_id
         JOIN material m     ON m.material_id = d.material_id
         LEFT JOIN inspection i      ON i.delivery_id = d.delivery_id
         LEFT JOIN supplier_rating r ON r.delivery_id = d.delivery_id
         WHERE d.org_id = ?
         ORDER BY d.slot_start DESC, d.delivery_id DESC
         LIMIT ${MAX_ROWS}`, [orgId]);

    for (const row of rows) {
        row.badge = BADGES[row.status];
        if (row.received !== null) {
            if (row.accepted === 0) row.decision = 'Rejected';
            else if (row.accepted === row.received) row.decision = 'Accepted';
            else row.decision = 'Partially accepted';
        }
        if (row.score) row.stars = stars(row.score);
    }

    const summary = {
        deliveries: Number(sum.deliveries),
        completed: Number(sum.completed),
        rated: Number(sum.rated),
        average: sum.average === null ? null : sum.average.toFixed(1),      // text like 3.0, so the page always shows one decimal
    };
    summary.averageStars = sum.average === null ? '' : stars(Math.round(sum.average));

    res.render('history/index', {
        summary: summary,
        distribution: distribution,
        rows: rows,
        limited: summary.deliveries > MAX_ROWS,
        maxRows: MAX_ROWS
    });
});

module.exports = app;
