-- =====================================================================
-- Script 8 (only for an existing database): the product catalog of the suppliers.
-- A new database does NOT need it: 01_schema.sql, 04_transform_load.sql and 06_sample_data.sql have these changes already.
-- Run it once on a database that was made with the older scripts, if you want to keep its data instead of running 01 to 06 again.
-- =====================================================================

USE siteproof;

-- 8.1 The table (the same as step 1.13b of 01_schema.sql).
CREATE TABLE supplier_product (
    product_id     INT AUTO_INCREMENT PRIMARY KEY,
    org_id         CHAR(8)       NOT NULL,
    material_id    CHAR(8)       NOT NULL,
    price_min      DECIMAL(10,2) NOT NULL,
    price_max      DECIMAL(10,2) NOT NULL,
    min_order_qty  DECIMAL(10,2) NULL     CHECK (min_order_qty IS NULL OR min_order_qty > 0),
    lead_time_days INT           NULL     CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
    note           VARCHAR(200)  NULL,
    active         TINYINT(1)    NOT NULL DEFAULT 1,
    updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CHECK (price_min >= 0 AND price_max >= price_min),
    UNIQUE (org_id, material_id),
    FOREIGN KEY (org_id)      REFERENCES organization (org_id),
    FOREIGN KEY (material_id) REFERENCES material (material_id)
);

-- 8.2 Fill it from the purchases (step 4.11).
INSERT INTO supplier_product (org_id, material_id, price_min, price_max)
SELECT org_id, material_id, MIN(unit_price), MAX(unit_price)
FROM purchase
GROUP BY org_id, material_id;

-- 8.3 The materials of the sample deliveries (step 6.7b).
INSERT IGNORE INTO supplier_product (org_id, material_id, price_min, price_max, min_order_qty, lead_time_days)
SELECT d.org_id, d.material_id,
       ROUND(MIN(d.delivery_value / d.ordered_quantity) * 0.9, 2),
       ROUND(MAX(d.delivery_value / d.ordered_quantity) * 1.1, 2),
       10, 3
FROM delivery d
GROUP BY d.org_id, d.material_id;

-- 8.4 Check: number of products, and of suppliers that have products.
SELECT COUNT(*) AS products, COUNT(DISTINCT org_id) AS suppliers FROM supplier_product;
