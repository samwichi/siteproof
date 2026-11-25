const express = require('express');
const mysql = require('mysql2');
const cookieParser = require('cookie-parser');
const { engine } = require('express-handlebars');

const configs = require('./config');
const { loadUser, requireRole } = require('./lib/auth');
const { fail } = require('./lib/respond');

const app = express();

// ---- Template engine (same options as the HTMX laboratory) ----
app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: false,
    partialsDir: 'views'
}));
app.set('view engine', 'hbs');
app.set('views', './views');

// ---- Middleware ----
app.use(express.urlencoded({ extended: true }));
// Express 5 leaves req.body undefined when a request has no body; an empty object lets the routes read req.body.x without an error.
app.use((req, res, next) => { req.body = req.body || {}; next(); });
app.use(cookieParser(configs.cookieSecret));
app.use(express.static('public'));
app.use(express.static('node_modules/htmx.org/dist'));
app.use(express.static('node_modules/bootstrap/dist/css'));
app.use(express.static('node_modules/bootstrap/dist/js'));
app.use(express.static('node_modules/bootstrap-icons/font'));

// ---- Database: a connection pool (laboratory section 9.4) ----
const connection = mysql.createPool(configs.db);
app.use(loadUser(connection.promise()));   // who is logged in? (req.user)
connection.query('SELECT 1', (err) => {
    if (err) {
        console.log('Error connecting to database: ', err);
        process.exit();
    }
    else {
        console.log('Connected to database');
    }
});

// ---- A normal link (not HTMX), so it must be before the wildcard route: the administrator opens a proof document of a company ----
const adminDocuments = require('./routes/adminDocuments');
adminDocuments.connection = connection;
app.use('/admin/documents', requireRole('ADMIN'), adminDocuments);

// ---- Homepage and the wildcard route (partial page updates, see laboratory section 5) ----
app.get('/', (req, res) => {
    if (req.get('HX-Request')) {
        res.render('home');
    }
    else {
        res.render('index', { title: 'SiteProof' });
    }
});

// A normal browser request (reload, bookmark) gets the full page; the page then asks HTMX for the missing content (where).
app.get(/.*/, (req, res, next) => {
    if (req.get('HX-Request')) {
        next();
    }
    else {
        res.render('index', { title: 'SiteProof', where: req.url });
    }
});

// ---- Routers. Each router gets the database connection from here. ----
const auth = require('./routes/auth');
auth.connection = connection;
app.use('/', auth);

const deliveries = require('./routes/deliveries');
deliveries.connection = connection;
app.use('/deliveries', requireRole('CONTRACTOR_PM'), deliveries);

const rfqs = require('./routes/rfqs');
rfqs.connection = connection;
app.use('/rfqs', requireRole('CONTRACTOR_PM'), rfqs);

const catalog = require('./routes/catalog');
catalog.connection = connection;
app.use('/catalog', requireRole('CONTRACTOR_PM'), catalog);

const inspections = require('./routes/inspections');
inspections.connection = connection;
app.use('/inspections', requireRole('INSPECTOR'), inspections);

const ratings = require('./routes/ratings');
ratings.connection = connection;
app.use('/ratings', requireRole('CONTRACTOR_PM'), ratings);

const assigned = require('./routes/assigned');
assigned.connection = connection;
app.use('/assigned', requireRole('SUPPLIER'), assigned);

const quotations = require('./routes/quotations');
quotations.connection = connection;
app.use('/quotations', requireRole('SUPPLIER'), quotations);

const products = require('./routes/products');
products.connection = connection;
app.use('/products', requireRole('SUPPLIER'), products);

const history = require('./routes/history');
history.connection = connection;
app.use('/history', requireRole('SUPPLIER'), history);

const documents = require('./routes/documents');
documents.connection = connection;
app.use('/documents', requireRole('SUPPLIER'), documents);

const register = require('./routes/register');
register.connection = connection;
app.use('/register', register);

const projects = require('./routes/projects');
projects.connection = connection;
app.use('/projects', requireRole('COMPANY'), projects);          // only the company account of a contractor (checked in the router)

const company = require('./routes/company');
company.connection = connection;
app.use('/company', requireRole('COMPANY'), company);

const adminUsers = require('./routes/adminUsers');
adminUsers.connection = connection;
app.use('/admin/users', requireRole('ADMIN'), adminUsers);       // before /admin, so that /admin does not catch it

const admin = require('./routes/admin');
admin.connection = connection;
app.use('/admin', requireRole('ADMIN'), admin);

// ---- Errors that nobody handled (for example a failed query inside an async route) ----
app.use((err, req, res, next) => {
    console.log('Unhandled error: ', err);
    fail(res, 'Unexpected server error.', 500);
});

const port = process.env.PORT || 80;
app.listen(port, function () {
    console.log('Web server listening on port ' + port + '!');
});
