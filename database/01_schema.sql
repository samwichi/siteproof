-- =====================================================================
-- SiteProof - Script 1: create the database and the tables (MySQL)
-- Tables of our MVP data model + the purchase table for the given data.
-- =====================================================================

-- 1.1 Delete the database if it already exists, so the whole process can be run again from zero.
DROP DATABASE IF EXISTS siteproof;

-- 1.2 Create the database (utf8mb4 so symbols like m² are stored correctly).
CREATE DATABASE siteproof CHARACTER SET utf8mb4;

-- 1.3 Use the new database.
USE siteproof;

-- 1.4 Companies (contractors and suppliers). The id is the 8-digit company id; it is text because it has leading zeros.
CREATE TABLE organization (
    org_id   CHAR(8)      PRIMARY KEY,
    org_name VARCHAR(100) NOT NULL,
    org_type VARCHAR(20)  NOT NULL CHECK (org_type IN ('CONTRACTOR', 'SUPPLIER')),
    address  VARCHAR(200),
    phone    VARCHAR(30),
    email    VARCHAR(100)
);

-- 1.5 Users of the platform. Each user belongs to one company and has one role.
CREATE TABLE user_account (
    user_id   INT AUTO_INCREMENT PRIMARY KEY,
    org_id    CHAR(8)      NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email     VARCHAR(100) NOT NULL UNIQUE,
    password  VARCHAR(255) NOT NULL,
    role      VARCHAR(20)  NOT NULL CHECK (role IN ('CONTRACTOR_PM', 'SUPPLIER', 'INSPECTOR')),
    FOREIGN KEY (org_id) REFERENCES organization (org_id)
);

-- 1.6 Projects of a contractor, with the retention rate of the contract (0.05 = 5%).
CREATE TABLE project (
    project_id     INT AUTO_INCREMENT PRIMARY KEY,
    org_id         CHAR(8)      NOT NULL,
    project_name   VARCHAR(100) NOT NULL,
    retention_rate DECIMAL(4,3) NOT NULL CHECK (retention_rate BETWEEN 0 AND 1),
    FOREIGN KEY (org_id) REFERENCES organization (org_id)
);

-- 1.7 Categories to search the catalog: labor (man), equipment (machine), material and other.
CREATE TABLE material_category (
    category_id   INT AUTO_INCREMENT PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL UNIQUE
);

-- 1.8 Catalog of materials, labor and equipment. Each item belongs to one category.
CREATE TABLE material (
    material_id   CHAR(8)      PRIMARY KEY,
    material_name VARCHAR(255) NOT NULL,
    unit          VARCHAR(20)  NOT NULL,
    category_id   INT          NOT NULL,
    FOREIGN KEY (category_id) REFERENCES material_category (category_id)
);

-- 1.9 Purchases from the given data. The total price is not stored: it is calculated (step 1.14), so it can never be wrong.
CREATE TABLE purchase (
    purchase_id   CHAR(8)       PRIMARY KEY,
    org_id        CHAR(8)       NOT NULL,
    material_id   CHAR(8)       NOT NULL,
    quantity      INT           NOT NULL CHECK (quantity > 0),
    unit_price    DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    discount_rate INT           NOT NULL CHECK (discount_rate BETWEEN 0 AND 100),
    purchase_date DATE          NOT NULL CHECK (purchase_date >= '2000-01-01'),
    FOREIGN KEY (org_id)      REFERENCES organization (org_id),
    FOREIGN KEY (material_id) REFERENCES material (material_id)
);

-- 1.10 Delivery record (MVP core): project, supplier, material, quantity, value, time slot and status.
CREATE TABLE delivery (
    delivery_id      INT AUTO_INCREMENT PRIMARY KEY,
    project_id       INT           NOT NULL,
    org_id           CHAR(8)       NOT NULL,
    material_id      CHAR(8)       NOT NULL,
    created_by       INT           NOT NULL,
    ordered_quantity DECIMAL(10,2) NOT NULL CHECK (ordered_quantity > 0),
    delivery_value   DECIMAL(12,2) NOT NULL CHECK (delivery_value >= 0),
    slot_start       DATETIME      NOT NULL,
    slot_end         DATETIME      NOT NULL,
    status           VARCHAR(20)   NOT NULL DEFAULT 'SCHEDULED'
                     CHECK (status IN ('SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED')),
    FOREIGN KEY (project_id)  REFERENCES project (project_id),
    FOREIGN KEY (org_id)      REFERENCES organization (org_id),
    FOREIGN KEY (material_id) REFERENCES material (material_id),
    FOREIGN KEY (created_by)  REFERENCES user_account (user_id)
);

-- 1.11 Quality documents (PDF/JPG) uploaded to a delivery.
CREATE TABLE delivery_document (
    document_id INT AUTO_INCREMENT PRIMARY KEY,
    delivery_id INT          NOT NULL,
    uploaded_by INT          NOT NULL,
    doc_type    VARCHAR(50)  NOT NULL,
    file_name   VARCHAR(200) NOT NULL,
    FOREIGN KEY (delivery_id) REFERENCES delivery (delivery_id),
    FOREIGN KEY (uploaded_by) REFERENCES user_account (user_id)
);

-- 1.12 Inspection of a delivery (only one per delivery). The accepted quantity cannot be more than the received quantity.
CREATE TABLE inspection (
    inspection_id     INT AUTO_INCREMENT PRIMARY KEY,
    delivery_id       INT           NOT NULL UNIQUE,
    inspector_id      INT           NOT NULL,
    received_quantity DECIMAL(10,2) NOT NULL,
    accepted_quantity DECIMAL(10,2) NOT NULL,
    retention_rate    DECIMAL(4,3)  NOT NULL,
    CHECK (accepted_quantity >= 0 AND accepted_quantity <= received_quantity),
    FOREIGN KEY (delivery_id)  REFERENCES delivery (delivery_id),
    FOREIGN KEY (inspector_id) REFERENCES user_account (user_id)
);

-- 1.13 Mandatory 1-5 rating of the supplier when the delivery is completed (one per delivery).
CREATE TABLE supplier_rating (
    delivery_id INT     PRIMARY KEY,
    rated_by    INT     NOT NULL,
    score       TINYINT NOT NULL CHECK (score BETWEEN 1 AND 5),
    FOREIGN KEY (delivery_id) REFERENCES delivery (delivery_id),
    FOREIGN KEY (rated_by)    REFERENCES user_account (user_id)
);

-- 1.14 View that calculates the total price of each purchase: quantity x unit price x (1 - discount).
CREATE VIEW purchase_total AS
SELECT purchase_id,
       ROUND(quantity * unit_price * (100 - discount_rate) / 100, 2) AS total_price
FROM purchase;

-- 1.15 Check: list the tables created.
SHOW TABLES;
