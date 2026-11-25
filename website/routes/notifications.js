// Notifications of the logged-in user (the bell in the menu). They are written by the other routes through lib/notify.js.
// The user sees only his own notifications (n.user_id = req.user.id), opens one (it is marked as read and the page it is about
// opens), marks all as read, or deletes one or all the read ones.
const express = require('express');
const { fail } = require('../lib/respond');
const { readList } = require('../lib/listing');
const app = express.Router();

const db = () => app.connection.promise();

const SELECT_NOTIFICATIONS = `
    SELECT n.notification_id                          AS ID,
           n.text                                     AS text,
           DATE_FORMAT(n.created_at, '%Y-%m-%d %H:%i') AS created,
           n.read_at IS NULL                          AS isNew
    FROM notification n
    WHERE n.user_id = ?`;

const LIST = {
    search: ['n.text'],
    statuses: ['NEW', 'READ'],
    statusColumn: "IF(n.read_at IS NULL, 'NEW', 'READ')",
    sorts: { created: 'n.created_at', status: 'n.read_at IS NULL' },
    tieBreak: 'n.notification_id DESC',
    defaultOrder: 'n.created_at DESC'
};

const prepare = row => Object.assign(row, { isNew: Boolean(row.isNew) });

const unreadOf = async userId =>
    Number((await db().execute('SELECT COUNT(*) AS n FROM notification WHERE user_id = ? AND read_at IS NULL', [userId]))[0][0].n);

async function showList(req, res, message) {
    const data = await readList(db(), req, LIST, SELECT_NOTIFICATIONS, [req.user.id], prepare);
    data.unread = await unreadOf(req.user.id);          // the badge of the page is sent with the list (an <hx-partial>)
    res.render('notifications/index', Object.assign(data, { message: message, kind: 'success' }));
}

// ---------- R: the list ----------
app.get('/', async (req, res) => {
    await showList(req, res);
});

// ---------- R: only the badge of the bell (the menu asks for it every 30 seconds) ----------
app.get('/badge', async (req, res) => {
    res.render('notifications/badge', { unread: await unreadOf(req.user.id) });
});

// ---------- U: open a notification: mark it as read and go to its page ----------
app.get('/:id/open', async (req, res) => {
    const [rows] = await db().execute('SELECT link FROM notification WHERE notification_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (rows.length === 0) return fail(res, 'Notification not found.', 404);
    await db().execute('UPDATE notification SET read_at = COALESCE(read_at, NOW()) WHERE notification_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    // Only a page of this website (the links are written by the routes, but a link must never lead to another site).
    const link = /^\/[^/\\]/.test(rows[0].link) ? rows[0].link : '/';
    if (req.get('HX-Request')) return res.set('HX-Redirect', link).send('');
    res.redirect(link);
});

// ---------- U: mark all as read ----------
app.put('/read', async (req, res) => {
    await db().execute('UPDATE notification SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL', [req.user.id]);
    await showList(req, res, 'All notifications are marked as read.');
});

// ---------- D: delete the read notifications ----------
app.delete('/read', async (req, res) => {
    const [result] = await db().execute('DELETE FROM notification WHERE user_id = ? AND read_at IS NOT NULL', [req.user.id]);
    await showList(req, res, result.affectedRows + ' read notification' + (result.affectedRows === 1 ? '' : 's') + ' deleted.');
});

// ---------- D: delete one ----------
app.delete('/:id', async (req, res) => {
    const [result] = await db().execute('DELETE FROM notification WHERE notification_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (result.affectedRows === 0) return fail(res, 'Notification not found.', 404);
    // hx-swap="delete" of the button removes the row; the new count goes to the bell.
    res.render('notifications/deleted', { unread: await unreadOf(req.user.id) });
});

module.exports = app;
