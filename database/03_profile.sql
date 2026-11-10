-- =====================================================================
-- Script 3: FIND THE ERRORS in the raw data with SQL queries.
-- =====================================================================

USE siteproof;

-- 3.1 Error 1: transactions with a company_id that does not exist in the companies file (LEFT JOIN + IS NULL).
SELECT COUNT(*) AS unknown_company
FROM raw_transactions t
LEFT JOIN raw_companies c ON t.company_id = c.company_id
WHERE c.company_id IS NULL;

-- 3.2 Error 2: transactions with a material_id that does not exist in the materials file.
SELECT COUNT(*) AS unknown_material
FROM raw_transactions t
LEFT JOIN raw_materials m ON t.material_id = m.material_id
WHERE m.material_id IS NULL;

-- 3.3 Error 3: transactions per decade. Almost all are from 2010-2025; the dates from 1950-1980 are not possible.
SELECT CONCAT(LEFT(transaction_date, 3), '0s') AS decade, COUNT(*) AS transactions
FROM raw_transactions
GROUP BY decade
ORDER BY decade;

-- 3.4 Error 4: total_price different from quantity x price x (1 - discount). A difference up to 5 is allowed because the file rounds totals to tens.
SELECT COUNT(*) AS wrong_total
FROM raw_transactions
WHERE ABS(total_price - quantity * price_per_unit * (100 - discount_rate) / 100) > 5;

-- 3.5 Error 4 in detail: in all those rows the total is just a copy of the unit price.
SELECT transaction_id, quantity, price_per_unit, discount_rate, total_price
FROM raw_transactions
WHERE ABS(total_price - quantity * price_per_unit * (100 - discount_rate) / 100) > 5
LIMIT 5;

-- 3.6 Error 5: the same material twice (same name and unit) with two different ids.
SELECT item, unit, COUNT(*) AS times, GROUP_CONCAT(material_id) AS ids
FROM raw_materials
GROUP BY item, unit
HAVING COUNT(*) > 1;

-- 3.7 Error 6: units written in two ways ("piece" and "Piece", "one test" and "One test"). COLLATE utf8mb4_bin shows upper and lower case as different.
SELECT unit COLLATE utf8mb4_bin AS unit, COUNT(*) AS materials
FROM raw_materials
WHERE unit IN ('piece', 'one test')
GROUP BY unit COLLATE utf8mb4_bin;
