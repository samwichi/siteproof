-- =====================================================================
-- Script 5: CHECK the result.
-- =====================================================================

USE siteproof;

-- 5.1 Rows in the final tables (51,947 transactions - 9,817 deleted = 42,130 purchases; 458 - 1 duplicated = 457 materials).
SELECT (SELECT COUNT(*) FROM organization) AS companies,
       (SELECT COUNT(*) FROM material)     AS materials,
       (SELECT COUNT(*) FROM purchase)     AS purchases;

-- 5.2 No purchase points to a company or material that does not exist (both must be 0).
SELECT (SELECT COUNT(*) FROM purchase p LEFT JOIN organization o ON p.org_id = o.org_id WHERE o.org_id IS NULL)          AS purchases_without_company,
       (SELECT COUNT(*) FROM purchase p LEFT JOIN material m ON p.material_id = m.material_id WHERE m.material_id IS NULL) AS purchases_without_material;

-- 5.3 Dates: the oldest and newest purchase.
SELECT MIN(purchase_date) AS first_date, MAX(purchase_date) AS last_date
FROM purchase;

-- 5.4 Error 4 fixed: rows where the original total was wrong now have the correct total from the view.
SELECT p.purchase_id, r.total_price AS wrong_total_in_file, v.total_price AS correct_total
FROM purchase p
JOIN purchase_total v   ON p.purchase_id = v.purchase_id
JOIN raw_transactions r ON p.purchase_id = r.transaction_id
WHERE ABS(r.total_price - v.total_price) > 5
LIMIT 5;

-- 5.5 Units after cleaning (no more "piece" / "one test").
SELECT unit COLLATE utf8mb4_bin AS unit, COUNT(*) AS materials
FROM material
GROUP BY unit COLLATE utf8mb4_bin
ORDER BY materials DESC;

-- 5.6 Materials per category.
SELECT c.category_name, COUNT(*) AS materials
FROM material m
JOIN material_category c ON m.category_id = c.category_id
GROUP BY c.category_name;

-- 5.7 The constraints protect the data: this insert has an impossible date, so it must FAIL (expected error).
INSERT INTO purchase (purchase_id, org_id, material_id, quantity, unit_price, discount_rate, purchase_date)
VALUES ('TEST0001', '03028108', '51019678', 10, 100, 0, '1959-06-29');

-- 5.8 This insert uses a company that does not exist, so it must FAIL (expected error).
INSERT INTO purchase (purchase_id, org_id, material_id, quantity, unit_price, discount_rate, purchase_date)
VALUES ('TEST0002', '99999999', '51019678', 10, 100, 0, '2024-01-15');

-- 5.9 Example: the 5 suppliers we bought the most from.
SELECT o.org_name, COUNT(*) AS purchases, ROUND(SUM(v.total_price)) AS total_amount
FROM purchase p
JOIN purchase_total v ON p.purchase_id = v.purchase_id
JOIN organization o   ON p.org_id = o.org_id
GROUP BY o.org_id, o.org_name
ORDER BY total_amount DESC
LIMIT 5;
