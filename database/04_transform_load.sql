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

-- 4.9 Load the materials and give each one a category (1 = Labor, 2 = Equipment, 3 = Material, 4 = Other). The rules are checked in this order:
--     a) Material: names that start with "Product", and the items that are only a material even if the name does not start with "Product"
--        (structural concrete, backfill materials, cement mortar, rebar by kg).
--     b) Equipment: machines that are rented by hour, day or trip (wheeled and crawler machines, crushers, trailers).
--        The rows "Machine operator ...", "Machine tool operator ..." and "Equipment operator ..." are NOT equipment: they are the wages of the
--        person who operates the machine (about 330-400 per hour, like the other workers), so they are labor.
--     c) Labor: all the other items paid by hour or day (workers, technicians, machine operators, engineer).
--     d) Other: services and work items (tests, demolition, excavation, formwork, measurement, paving, pile driving, ...).
INSERT INTO material (material_id, material_name, unit, category_id)
SELECT material_id,
       item,
       unit,
       CASE
         WHEN item LIKE 'Product%' THEN 3
         WHEN item LIKE 'Structural concrete%'
              OR item LIKE 'Underground distribution pipe%'
              OR item LIKE 'Selective backfill material%'
              OR item LIKE 'Cement mortar%'
              OR item = 'rebar.' THEN 3
         WHEN unit IN ('Hour', 'Day', 'Trip')
              AND (item LIKE '%wheeled%' OR item LIKE '%crawler%' OR item LIKE '%trailer%' OR item LIKE '%crusher%') THEN 2
         WHEN unit IN ('Hour', 'Day') THEN 1
         ELSE 4
       END
FROM raw_materials;
-- 4.10 Load the clean transactions as purchases. Fix error 4: total_price is not copied; the view purchase_total calculates it again.
INSERT INTO purchase (purchase_id, org_id, material_id, quantity, unit_price, discount_rate, purchase_date)
SELECT transaction_id, company_id, material_id, quantity, price_per_unit, discount_rate, transaction_date
FROM raw_transactions;

-- 4.11 Fill the product catalog of the suppliers from the purchases: each supplier offers the materials that it has sold, and the
--      price range is the lowest and the highest unit price of those sales. The suppliers can change or unlist them on the website.
INSERT INTO supplier_product (org_id, material_id, price_min, price_max)
SELECT org_id, material_id, MIN(unit_price), MAX(unit_price)
FROM purchase
GROUP BY org_id, material_id;
