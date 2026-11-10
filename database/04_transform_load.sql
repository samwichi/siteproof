-- =====================================================================
-- Script 4: CLEAN the raw data (TRANSFORM) and copy it into the final
-- tables (LOAD). Everything is done with SQL.
-- =====================================================================

USE siteproof;

-- 4.1 Fix error 1: delete the transactions whose company does not exist.
DELETE FROM raw_transactions
WHERE company_id NOT IN (SELECT company_id FROM raw_companies);

-- 4.2 Fix error 2: delete the transactions whose material does not exist.
DELETE FROM raw_transactions
WHERE material_id NOT IN (SELECT material_id FROM raw_materials);

-- 4.3 Fix error 3: delete the transactions with an impossible date (before 2000).
DELETE FROM raw_transactions
WHERE transaction_date < '2000-01-01';

-- 4.4 Fix error 5 (part 1): move the transactions of the duplicated material 65579548 to the material we keep, 51019678 (it has more price samples).
UPDATE raw_transactions
SET material_id = '51019678'
WHERE material_id = '65579548';

-- 4.5 Fix error 5 (part 2): delete the duplicated material.
DELETE FROM raw_materials
WHERE material_id = '65579548';

-- 4.6 Fix error 6: write the units always the same way. The comparison ignores upper/lower case, so both spellings get the same value.
UPDATE raw_materials SET unit = 'Piece'    WHERE unit = 'piece';
UPDATE raw_materials SET unit = 'One test' WHERE unit = 'one test';

-- 4.7 Create the categories.
INSERT INTO material_category (category_name)
VALUES ('Labor'), ('Equipment'), ('Material'), ('Other');

-- 4.8 Load the companies. All of them are suppliers. Only the columns we need are used.
INSERT INTO organization (org_id, org_name, org_type, address, phone, email)
SELECT company_id, name, 'SUPPLIER', address, phone, email
FROM raw_companies;

-- 4.9 Load the materials and give each one a category: "Product..." items are materials; items paid by hour/day/trip are equipment if they mention a machine, otherwise labor; the rest is other.
INSERT INTO material (material_id, material_name, unit, category_id)
SELECT material_id,
       item,
       unit,
       CASE
         WHEN item LIKE 'Product%' THEN 3
         WHEN unit IN ('Hour', 'Day', 'Trip')
              AND (item LIKE '%machine%' OR item LIKE '%equipment%' OR item LIKE '%crawler%'
                   OR item LIKE '%wheeled%' OR item LIKE '%trailer%' OR item LIKE '%crusher%') THEN 2
         WHEN unit IN ('Hour', 'Day') THEN 1
         ELSE 4
       END
FROM raw_materials;

-- 4.10 Load the clean transactions as purchases. Fix error 4: total_price is not copied; the view purchase_total calculates it again.
INSERT INTO purchase (purchase_id, org_id, material_id, quantity, unit_price, discount_rate, purchase_date)
SELECT transaction_id, company_id, material_id, quantity, price_per_unit, discount_rate, transaction_date
FROM raw_transactions;
