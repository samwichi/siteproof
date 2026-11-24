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
app.use(cookieParser(configs.cookieSecret));
app.use(express.static('public'));
app.use(express.static('node_modules/htmx.org/dist'));
app.use(express.static('node_modules/bootstrap/dist/css'));
app.use(express.static('node_modules/bootstrap/dist/js'));
app.use(express.static('node_modules/bootstrap-icons/font'));
app.use(loadUser);                      // who is logged in? (req.user)

// ---- Database: a connection pool (laboratory section 9.4) ----
const connection = mysql.createPool(configs.db);
connection.query('SELECT 1', (err) => {
    if (err) {
        console.log('Error connecting to database: ', err);
        process.exit();
    }
    else {
        console.log('Connected to database');
    }
});

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

const inspections = require('./routes/inspections');
inspections.connection = connection;
app.use('/inspections', requireRole('INSPECTOR'), inspections);

const ratings = require('./routes/ratings');
ratings.connection = connection;
app.use('/ratings', requireRole('CONTRACTOR_PM'), ratings);

const documents = require('./routes/documents');
documents.connection = connection;
app.use('/documents', requireRole('SUPPLIER'), documents);

// ---- Errors that nobody handled (for example a failed query inside an async route) ----
app.use((err, req, res, next) => {
    console.log('Unhandled error: ', err);
    fail(res, 'Unexpected server error.', 500);
});

const port = process.env.PORT || 80;
app.listen(port, function () {
    console.log('Web server listening on port ' + port + '!');
});
