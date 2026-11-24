// Keyboard and screen reader help for the pages that HTMX changes without loading them again.
// A normal page load puts the cursor at the top of the new page. HTMX does not, so we do it here:
//   1. when main#main gets a new page, the focus goes to its title (h1), which the screen reader then reads;
//   2. when a table row is replaced (edit form opens, row is saved or deleted), the focus goes to the same row;
//      when a column header or a page number of a list is clicked, the focus goes to the same header or to the list;
//   3. a hidden message says how many results the list has after a search, a filter or a new page.
(function () {
    let loaded = false;    // true after the first content of the page is in
    let firstLoad = false; // the request that is running now is that first load
    let where = null;      // what the user used last: { rows: <tbody>, index } or { header: index } or { pager: true }

    function focusElement(el) {
        if (!el) return;
        if (!el.matches('a, button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
        el.focus();
    }

    // Before a request: remember where the user was.
    document.body.addEventListener('htmx:before:request', function (event) {
        const el = event.target;
        where = null;
        // the first load of a page: main#main fetches its own content (hx-trigger="load"); the cursor must stay at the top of the page
        if (el && el.id === 'main' && el.getAttribute('hx-trigger') === 'load' && !loaded) { firstLoad = true; }
        if (!el || !el.closest) return;
        const header = el.closest('#list thead th');
        const pager = el.closest('#list .pagination');
        const row = el.closest('tr');
        if (header) where = { header: Array.from(header.parentElement.children).indexOf(header) };
        else if (pager) where = { pager: true };
        else if (row && row.parentElement.tagName === 'TBODY') where = { rows: row.parentElement, index: Array.from(row.parentElement.children).indexOf(row) };
    });

    // After the new content is in the page.
    document.body.addEventListener('htmx:after:swap', function (event) {
        const target = event.detail && event.detail.ctx && event.detail.ctx.target;

        if (firstLoad) {
            firstLoad = false;
        }
        else if (target && target.id === 'main') {
            focusElement(document.querySelector('#main h1'));
        }
        else if (where && where.header !== undefined) {
            focusElement(document.querySelector('#list thead th:nth-child(' + (where.header + 1) + ') a'));
        }
        else if (where && where.pager) {
            focusElement(document.querySelector('#list'));
        }
        else if (where && where.rows && where.rows.isConnected && !document.querySelector('#list [autofocus]:focus')) {
            const rows = where.rows.children;
            const row = rows[Math.min(where.index, rows.length - 1)];
            // an open form already has the cursor in its first field (autofocus); otherwise the first button of the row that does not delete
            if (row && !row.querySelector('[autofocus]')) focusElement(row.querySelector('button:not(.btn-danger), a') || row.querySelector('button') || row);
            // the last row was deleted: the cursor goes to the title of the page
            if (!row) focusElement(document.querySelector('#main h1'));
        }
        where = null;
        loaded = true;

        // the message for screen readers
        const list = document.querySelector('#list');
        const status = document.querySelector('#listStatus');
        if (list && status && list.dataset.count !== undefined && target && target.id === 'list') {
            status.textContent = list.dataset.count + (list.dataset.count === '1' ? ' result' : ' results');
        }
    });
})();
