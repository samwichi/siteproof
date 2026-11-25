// Unit tests of lib/listing.js (search, filter, sorting and paging of every list).
// The fake database records the SQL text and the parameters, so we can check that what the user types
// never becomes part of the SQL text (SQL injection), only a parameter.
// The last test is a small fuzz test (testing laboratory, section 10): many random addresses must never break the list.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readList, like, PAGE_SIZE } = require('../lib/listing');

const CFG = {
    search: ['m.material_name', 'o.org_name'],
    statuses: ['SCHEDULED', 'DELIVERED'],
    statusColumn: 'd.status',
    sorts: { slot: 'd.slot_start', value: 'd.delivery_value' },
    tieBreak: 'd.delivery_id',
    defaultOrder: 'd.slot_start DESC'
};
const SELECT = 'SELECT d.delivery_id FROM delivery d WHERE d.project_id = ?';

function fakeDb(total) {
    const calls = [];
    return {
        calls,
        execute: async (sql, args) => {
            calls.push({ sql, args });
            return sql.startsWith('SELECT COUNT(*)') ? [[{ n: total }]] : [[{ delivery_id: 1 }]];
        }
    };
}
const request = query => ({ query, baseUrl: '/deliveries' });

test('like() escapes % and _ so they are searched as normal characters', () => {
    assert.equal(like('rebar'), '%rebar%');
    assert.equal(like('100%'), '%100\\%%');
    assert.equal(like('SD_280'), '%SD\\_280%');
});

test('the search text is a parameter, never part of the SQL text', async () => {
    const db = fakeDb(3);
    const attack = "x' OR 1=1; DROP TABLE delivery; --";
    await readList(db, request({ q: attack }), CFG, SELECT, [42], r => r);
    for (const call of db.calls) assert.ok(!call.sql.includes('DROP TABLE'));
    assert.deepEqual(db.calls[1].args, [42, like(attack), like(attack)]);
});

test('an unknown status or sort key is ignored', async () => {
    const db = fakeDb(3);
    const { list } = await readList(db, request({ status: "DELIVERED' OR '1'='1", sort: 'd.password; --', dir: 'sideways' }), CFG, SELECT, [42], r => r);
    assert.equal(list.filtered, false);
    assert.equal(list.sort, '');
    assert.equal(list.dir, 'asc');
    assert.ok(db.calls[1].sql.includes('ORDER BY d.slot_start DESC'));
});

test('a known status and sort key are used', async () => {
    const db = fakeDb(3);
    await readList(db, request({ status: 'DELIVERED', sort: 'value', dir: 'desc' }), CFG, SELECT, [42], r => r);
    assert.ok(db.calls[1].sql.includes('AND d.status = ?'));
    assert.ok(db.calls[1].sql.includes('ORDER BY d.delivery_value desc, d.delivery_id'));
    assert.deepEqual(db.calls[1].args, [42, 'DELIVERED']);
});

test('the page number is kept between the first and the last page (boundary values)', async () => {
    const total = PAGE_SIZE * 2 + 1;          // 3 pages
    for (const [asked, page] of [['0', 1], ['-5', 1], ['abc', 1], ['1', 1], ['3', 3], ['4', 3], ['999999', 3]]) {
        const { list } = await readList(fakeDb(total), request({ page: asked }), CFG, SELECT, [42], r => r);
        assert.equal(list.page, page, 'page=' + asked);
        assert.equal(list.pages, 3);
    }
});

test('an empty list has 1 page and shows 0 to 0', async () => {
    const { list } = await readList(fakeDb(0), request({}), CFG, SELECT, [42], r => r);
    assert.equal(list.pages, 1);
    assert.equal(list.from, 0);
    assert.equal(list.to, 0);
    assert.equal(list.showPager, false);
});

test('fuzz: random addresses never break the list and never reach the SQL text', async () => {
    const pieces = ["'", '"', ';', '--', '%', '_', '\\', 'DROP', '<script>', '../', '\u0000', '中文', ' ', 'SCHEDULED', 'value', '-1', '1e9'];
    const random = () => Array.from({ length: 1 + Math.floor(Math.random() * 5) }, () => pieces[Math.floor(Math.random() * pieces.length)]).join('');
    for (let i = 0; i < 500; i++) {
        const query = { q: random(), status: random(), sort: random(), dir: random(), page: random() };
        const db = fakeDb(Math.floor(Math.random() * 100));
        const { list } = await readList(db, request(query), CFG, SELECT, [42], r => r);
        assert.ok(list.page >= 1 && list.page <= list.pages, JSON.stringify(query));
        const sql = db.calls[1].sql;
        assert.ok(!sql.includes('DROP') && !sql.includes('<script>'), JSON.stringify(query));
        assert.ok(/LIMIT 10 OFFSET \d+$/.test(sql), sql);
    }
});
