// The performance of a supplier company: the rating that the contractors gave it and how punctual it is.
// Used by "My rating and history" (routes/history.js) and by the seller center (routes/seller.js), so both show the same numbers.
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

async function summary(db, orgId) {
    // Over all the deliveries of the supplier.
    const [[sum]] = await db.execute(
        `SELECT COUNT(*)                          AS deliveries,
                COALESCE(SUM(d.status = 'COMPLETED'), 0) AS completed,
                COUNT(r.score)                    AS rated,
                CAST(AVG(r.score) AS DOUBLE)      AS average
         FROM delivery d
         LEFT JOIN supplier_rating r ON r.delivery_id = d.delivery_id
         WHERE d.org_id = ?`, [orgId]);

    // Punctuality: for every delivery that arrived, was its last arrival (DELIVERED in delivery_event) inside the time slot?
    const [[punctual]] = await db.execute(
        `SELECT COUNT(*) AS arrived, COALESCE(SUM(a.at <= d.slot_end), 0) AS onTime
         FROM delivery d
         JOIN (SELECT delivery_id, MAX(created_at) AS at FROM delivery_event WHERE event = 'DELIVERED' GROUP BY delivery_id) a
           ON a.delivery_id = d.delivery_id
         WHERE d.org_id = ? AND d.status IN ('DELIVERED', 'INSPECTED', 'COMPLETED')`, [orgId]);

    const result = {
        deliveries: Number(sum.deliveries),
        completed: Number(sum.completed),
        rated: Number(sum.rated),
        average: sum.average === null ? null : sum.average.toFixed(1),      // text like 3.0, so the page always shows one decimal
        averageStars: sum.average === null ? '' : stars(Math.round(sum.average)),
        arrived: Number(punctual.arrived),
        onTime: Number(punctual.onTime)
    };
    result.onTimePercent = result.arrived ? Math.round(result.onTime / result.arrived * 100) : null;
    return result;
}

module.exports = { summary, stars };
