// The history of a delivery (table delivery_event): every step and every change with its time and its user.
// The routes call record() with the same connection as the change itself (inside the transaction when there is one),
// so the history and the delivery never disagree.
const EVENTS = {
    CREATED: 'Created', CHANGED: 'Changed (quantity, price or time slot)', DECLINED: 'Declined', ACCEPTED_AGAIN: 'Accepted again',
    PREPARING: 'Being prepared', IN_TRANSIT: 'On the way', DELIVERED: 'Delivered on site',
    INSPECTED: 'Inspected', INSPECTION_CHANGED: 'Inspection changed', INSPECTION_DELETED: 'Inspection deleted (waits for inspection again)',
    COMPLETED: 'Completed and rated', RATING_CHANGED: 'Rating changed', RATING_DELETED: 'Rating deleted (waits for the rating again)'
};

async function record(conn, deliveryId, event, userId, note) {
    await conn.execute('INSERT INTO delivery_event (delivery_id, event, user_id, note) VALUES (?, ?, ?, ?)',
        [deliveryId, event, userId, note ? String(note).slice(0, 200) : null]);
}

module.exports = { record, EVENTS };
