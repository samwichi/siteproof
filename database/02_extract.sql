-- =====================================================================
-- Script 2: EXTRACT - copy the three files into "raw" tables, exactly
-- as they are (all columns as text). Nothing is changed here.
-- =====================================================================

USE siteproof;

-- 2.1 Raw table for companies.tsv (only the columns we need are used later).
CREATE TABLE raw_companies (
    company_id  VARCHAR(20),
    name        VARCHAR(200),
    description VARCHAR(200),
    address     VARCHAR(200),
    phone       VARCHAR(50),
    email       VARCHAR(100),
    comments    VARCHAR(200)
);

-- 2.2 Raw table for materials.tsv.
CREATE TABLE raw_materials (
    material_id VARCHAR(20),
    item        VARCHAR(300),
    unit        VARCHAR(20),
    price_avg   VARCHAR(20),
    price_stdev VARCHAR(20),
    no_samples  VARCHAR(20)
);

-- 2.3 Raw table for transactions.tsv.
CREATE TABLE raw_transactions (
    transaction_id   VARCHAR(20),
    company_id       VARCHAR(20),
    material_id      VARCHAR(20),
    quantity         VARCHAR(20),
    price_per_unit   VARCHAR(20),
    discount_rate    VARCHAR(20),
    total_price      VARCHAR(20),
    transaction_date VARCHAR(20),
    notes            VARCHAR(200)
);

-- 2.4 Load companies.tsv (columns separated by tabs, first line is the header).
LOAD DATA INFILE '/var/lib/mysql-files/companies.tsv'
INTO TABLE raw_companies
CHARACTER SET utf8mb4
FIELDS TERMINATED BY '\t'
LINES TERMINATED BY '\r\n'
IGNORE 1 LINES;

-- 2.5 Load materials.tsv.
LOAD DATA INFILE '/var/lib/mysql-files/materials.tsv'
INTO TABLE raw_materials
CHARACTER SET utf8mb4
FIELDS TERMINATED BY '\t'
LINES TERMINATED BY '\r\n'
IGNORE 1 LINES;

-- 2.6 Load transactions.tsv.
LOAD DATA INFILE '/var/lib/mysql-files/transactions.tsv'
INTO TABLE raw_transactions
CHARACTER SET utf8mb4
FIELDS TERMINATED BY '\t'
LINES TERMINATED BY '\r\n'
IGNORE 1 LINES;

-- 2.7 Check that all the rows were loaded (500 companies, 458 materials, 51,947 transactions).
SELECT (SELECT COUNT(*) FROM raw_companies)    AS companies,
       (SELECT COUNT(*) FROM raw_materials)    AS materials,
       (SELECT COUNT(*) FROM raw_transactions) AS transactions;
