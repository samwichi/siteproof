// The administrator sees all users and the company of each one (mounted at /admin/users).
const express = require('express');
const { readList } = require('../lib/listing');
const { ROLE_NAMES } = require('../lib/auth');
const app = express.Router();

const SELECT_USERS = `
    SELECT u.user_id AS ID, u.full_name AS name, u.email AS email, u.role AS role, u.active AS active,
           u.org_id AS orgId, o.org_name AS company, DATE_FORMAT(u.created_at, '%Y-%m-%d') AS registered
    FROM user_account u LEFT JOIN organization o ON o.org_id = u.org_id
    WHERE 1 = 1`;

const LIST = {
    search: ['u.full_name', 'u.email', 'o.org_name'],
    statuses: Object.keys(ROLE_NAMES),
    statusColumn: 'u.role',
    sorts: { name: 'u.full_name', email: 'u.email', role: 'u.role', company: 'o.org_name', status: 'u.active', registered: 'u.created_at' },
    tieBreak: 'u.user_id',
    defaultOrder: 'o.org_name, u.full_name',
    filterLabel: 'role',
    allLabel: 'All roles'
};

function prepare(row) {
    row.roleName = ROLE_NAMES[row.role];
    row.isActive = (row.active === 1);
    return row;
}

app.get('/', async (req, res) => {
    res.render('admin/users', await readList(app.connection.promise(), req, LIST, SELECT_USERS, [], prepare));
});

module.exports = app;
