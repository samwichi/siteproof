// Helpers to answer HTMX requests with a message in div#toast (see views/toast.hbs).

// Error: the main swap is skipped (HX-Reswap: none), so the form or table row that the user is working on stays on the screen.
function fail(res, message, status = 400) {
    res.status(status).set('HX-Reswap', 'none').render('toast', { message: message, kind: 'danger' });
}

// Turn a MySQL error into a short message for the user.
function sqlMessage(err) {
    console.log('SQL error: ', err);
    if (err.errno === 1451) return 'This record is used by other records, so it cannot be deleted.';
    if (err.errno === 1452) return 'A selected value does not exist.';
    return err.sqlMessage || 'Unexpected error.';
}

module.exports = { fail, sqlMessage };
