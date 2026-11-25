// Helpers to answer HTMX requests with a message in div#toast (see views/toast.hbs).

// Error: the main swap is skipped (HX-Reswap: none), so the form or table row that the user is working on stays on the screen.
function fail(res, message, status = 400) {
    res.status(status).set('HX-Reswap', 'none').render('toast', { message: message, kind: 'danger', seconds: 10 });
}

// Turn a MySQL error into a short message for the user. The technical text of the database stays in the log only
// (it can show table and column names, and the user cannot do anything with it).
const SQL_MESSAGES = {
    1062: 'This record exists already.',
    1264: 'A number is too large.',
    1292: 'A date or time is not valid.',
    1366: 'A value has the wrong format.',
    1406: 'A text is too long.',
    1451: 'This record is used by other records, so it cannot be deleted.',
    1452: 'A selected value does not exist.',
    3819: 'A value is outside the allowed range. Please check the numbers and the dates.',     // CHECK rule (MySQL)
    4025: 'A value is outside the allowed range. Please check the numbers and the dates.'      // CHECK rule (MariaDB)
};
function sqlMessage(err) {
    console.log('SQL error: ', err);
    return SQL_MESSAGES[err.errno] || 'The database could not save this. Please check the values and try again.';
}

module.exports = { fail, sqlMessage };
