// The test database for the tests that need MySQL (tests/closedLoop.test.js).
// It is a separate database, siteproof_test, made from database/01_schema.sql, so the tests never change the data of the website.
// The connection data come from config.js (the same MySQL as the website). The database user needs the right to create it, once:
//     GRANT ALL ON siteproof_test.* TO 'siteproof'@'172.17.%';
// When MySQL cannot be reached, available() returns the reason and the tests are skipped (so `npm test` still runs the other tests).
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const NAME = 'siteproof_test';
const PASSWORD = 'test-password-123';          // the password of all the test users

function settings() {
    let config;
    try { config = require('../../config'); }
    catch (err) { return null; }
    return Object.assign({}, config.db, { database: undefined, multipleStatements: true, timezone: '+08:00', connectTimeout: 5000 });
}

// The file database/01_schema.sql: SCHEMA_FILE, else the folder of the repository, else /database in the container
// (the container only has the website folder, see website/README.md "Automated tests"). null when none of them exists.
function schemaFile() {
    const candidates = [process.env.SCHEMA_FILE, path.join(__dirname, '..', '..', '..', 'database', '01_schema.sql'), '/database/01_schema.sql']
        .filter(file => file);
    return candidates.find(file => fs.existsSync(file)) || null;
}

// null when MySQL can be used, otherwise the reason why the tests are skipped.
async function available() {
    if (!schemaFile()) return 'database/01_schema.sql not found (set SCHEMA_FILE, see website/README.md)';
    const s = settings();
    if (!s) return 'config.js is missing (copy config.example.js)';
    try {
        const conn = await mysql.createConnection(s);
        await conn.end();
        return null;
    }
    catch (err) {
        return 'MySQL cannot be reached (' + err.code + ')';
    }
}

// Make the empty test database again from 01_schema.sql and add a small world: one contractor with a project (5% retention),
// one supplier, one material, and four users (project manager, supplier, inspector, website administrator). Returns the ids that the tests need.
async function create() {
    const schema = fs.readFileSync(schemaFile(), 'utf8')
        .replace('DROP DATABASE IF EXISTS siteproof;', 'DROP DATABASE IF EXISTS ' + NAME + ';')
        .replace('CREATE DATABASE siteproof ', 'CREATE DATABASE ' + NAME + ' ')
        .replace('USE siteproof;', 'USE ' + NAME + ';');
    if (!schema.includes('USE ' + NAME + ';')) throw new Error('01_schema.sql changed: the test database name could not be set.');
    const conn = await mysql.createConnection(settings());
    try {
        await conn.query(schema);
        await conn.query("SET time_zone = '+08:00'");
        const hash = await bcrypt.hash(PASSWORD, 4);
        await conn.query(`
            INSERT INTO organization (org_id, org_name, org_type) VALUES
                ('90000101', 'Test Contractor', 'CONTRACTOR'), ('90000202', 'Test Supplier', 'SUPPLIER');
            INSERT INTO material_category (category_name) VALUES ('Material');
            INSERT INTO material (material_id, material_name, unit, category_id) VALUES ('90000303', 'Rebar SD420', 'ton', 1);
            INSERT INTO project (org_id, project_name, retention_rate) VALUES ('90000101', 'Test Tower', 0.050);`);
        await conn.execute(
            `INSERT INTO user_account (org_id, full_name, email, password, role) VALUES
                ('90000101', 'Test PM', 'pm@test.example.com', ?, 'CONTRACTOR_PM'),
                ('90000202', 'Test Supplier', 'supplier@test.example.com', ?, 'SUPPLIER'),
                ('90000101', 'Test Inspector', 'inspector@test.example.com', ?, 'INSPECTOR'),
                (NULL, 'Test Administrator', 'admin@test.example.com', ?, 'ADMIN')`, [hash, hash, hash, hash]);
        const [[project]] = await conn.query('SELECT project_id FROM project');
        return { projectId: project.project_id, supplierId: '90000202', materialId: '90000303' };
    }
    finally {
        await conn.end();
    }
}

module.exports = { NAME, PASSWORD, available, create };
