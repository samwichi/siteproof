// Search, status filter, sorting and paging for the lists. All lists use this one helper, so they all work in the same way.
//
// How a list works in the browser (HTMX):
//   - the search form and the links of the column headers and of the pager ask the server for the same page with ?q=&status=&sort=&dir=&page=
//   - the server always answers with the whole page, and HTMX takes only <div id="list"> out of it (hx-select="#list")
//   - the URL is updated (hx-push-url), so the user can reload the page, use the back button or share the link
const PAGE_SIZE = 10;

// Turn the text of the user into a LIKE pattern (the characters % and _ are searched as normal characters).
function like(text) {
    return '%' + text.replace(/[\\%_]/g, '\\$&') + '%';
}

// What the user asked for. Everything that is not valid is ignored, so a strange URL only shows the normal list.
function readState(req, cfg) {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const status = cfg.statuses && cfg.statuses.includes(req.query.status) ? req.query.status : '';
    const sort = Object.hasOwn(cfg.sorts, req.query.sort) ? req.query.sort : '';
    const dir = req.query.dir === 'desc' ? 'desc' : 'asc';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    // Extra filters (cfg.filters): each one is a choice between fixed options, and every option has its own SQL condition written by us.
    // A value that is not one of the options is ignored, so the filter has its default value.
    const filters = {};
    for (const f of cfg.filters || []) {
        const asked = String(req.query[f.name] === undefined ? '' : req.query[f.name]);
        filters[f.name] = filterValues(f).includes(asked) && req.query[f.name] !== undefined ? asked : filterDefault(f);
    }
    return { q: q, status: status, sort: sort, dir: dir, page: page, filters: filters };
}

// The values that a filter accepts, and the value that it has when the address does not say anything.
const filterValues = f => (f.allLabel ? [''] : []).concat(f.options.map(o => o.value));
const filterDefault = f => f.default || '';

// The address of a list page: the state of the user plus the changes. Default values are left out.
function href(path, state, changes, cfg) {
    const t = Object.assign({}, state, changes);
    const p = new URLSearchParams();
    if (t.q) p.set('q', t.q);
    if (t.status) p.set('status', t.status);
    for (const f of (cfg && cfg.filters) || []) {
        if (t.filters[f.name] !== filterDefault(f)) p.set(f.name, t.filters[f.name]);
    }
    if (t.sort) { p.set('sort', t.sort); p.set('dir', t.dir); }
    if (t.page > 1) p.set('page', t.page);
    const text = p.toString();
    return path + (text ? '?' + text : '');
}

// Read one page of a list.
//   db      the promise version of the connection pool
//   cfg     { search: [SQL expressions], statuses: [...], statusColumn, sorts: { key: SQL expression }, tieBreak, defaultOrder,
//             and optional: path, filterLabel, allLabel,
//             filters: [{ name, label, allLabel?, default?, options: [{ value, label, sql }] }]   more filters next to the status
//             (allLabel adds the option "all" with the value ''; default is the value that is used when the address has none) }
//   select  the SELECT of the list, ending with its WHERE condition (the helper adds AND ...)
//   params  the parameters of that WHERE condition
// Returns { rows, list }: the rows of the page and everything the templates need (see views/list/*.hbs).
async function readList(db, req, cfg, select, params, prepare) {
    const path = cfg.path || req.baseUrl;       // the address of the list page (cfg.path when the list is not at the root of its router)
    const s = readState(req, cfg);

    let where = '';
    const args = params.slice();
    if (s.q) {
        where += ' AND (' + cfg.search.map(e => e + ' LIKE ?').join(' OR ') + ')';
        cfg.search.forEach(() => args.push(like(s.q)));
    }
    if (s.status) {
        where += ' AND ' + cfg.statusColumn + ' = ?';
        args.push(s.status);
    }

    for (const f of cfg.filters || []) {
        const option = f.options.find(o => o.value === s.filters[f.name]);
        if (option && option.sql) where += ' AND (' + option.sql + ')';
    }

    const [counted] = await db.execute('SELECT COUNT(*) AS n FROM (' + select + where + ') AS counted', args);
    const total = Number(counted[0].n);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(s.page, pages);
    const offset = (page - 1) * PAGE_SIZE;                 // both numbers are calculated here, so they are safe in the SQL text

    // Only the keys of cfg.sorts can reach the SQL text, the user only chooses one of them.
    const order = s.sort ? cfg.sorts[s.sort] + ' ' + s.dir + ', ' + cfg.tieBreak : cfg.defaultOrder;
    const [rows] = await db.execute(select + where + ' ORDER BY ' + order + ' LIMIT ' + PAGE_SIZE + ' OFFSET ' + offset, args);

    // The headers of the columns: where the link goes and which arrow is shown.
    const th = {};
    for (const key of Object.keys(cfg.sorts)) {
        const active = (s.sort === key);
        th[key] = {
            href: href(path, s, { sort: key, dir: active && s.dir === 'asc' ? 'desc' : 'asc', page: 1 }, cfg),
            icon: !active ? 'bi-arrow-down-up text-muted opacity-50' : (s.dir === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill'),
            ariaSort: !active ? 'none' : (s.dir === 'asc' ? 'ascending' : 'descending')
        };
    }

    // The pager: previous, up to 5 page numbers around the current page, next.
    const numbers = [];
    for (let n = Math.max(1, page - 2); n <= Math.min(pages, page + 2); n++) {
        numbers.push({ n: n, href: href(path, s, { page: n }, cfg), current: n === page });
    }

    const list = {
        path: path, q: s.q, sort: s.sort, dir: s.dir, th: th,
        filterLabel: cfg.filterLabel || 'status',
        statusOptions: [{ value: '', label: cfg.allLabel || 'All statuses', selected: !s.status }]
            .concat((cfg.statuses || []).map(v => ({ value: v, label: v, selected: v === s.status }))),
        filters: (cfg.filters || []).map(f => ({
            name: f.name, label: f.label, value: s.filters[f.name], isDefault: s.filters[f.name] === filterDefault(f),
            options: (f.allLabel ? [{ value: '', label: f.allLabel }] : []).concat(f.options.map(o => ({ value: o.value, label: o.label })))
                .map(o => Object.assign(o, { selected: o.value === s.filters[f.name] }))
        })),
        filtered: Boolean(s.q || s.status || (cfg.filters || []).some(f => s.filters[f.name] !== filterDefault(f))),
        total: total, pages: pages, page: page, showPager: pages > 1,
        from: total === 0 ? 0 : offset + 1, to: Math.min(total, offset + PAGE_SIZE),
        numbers: numbers,
        prevHref: page > 1 ? href(path, s, { page: page - 1 }, cfg) : null,
        nextHref: page < pages ? href(path, s, { page: page + 1 }, cfg) : null
    };
    return { rows: rows.map(prepare), list: list };
}

module.exports = { readList, like, PAGE_SIZE };
