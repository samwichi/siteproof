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

-- 1.4 Companies (contractors, suppliers and third-party inspection companies). The id is the 8-digit company id; it is text because it has leading zeros.
--     A company that registers on the website starts as PENDING; the website administrator checks the proof documents and sets APPROVED or REJECTED.
--     The companies of the given file (and the sample data) are APPROVED (the default).
CREATE TABLE organization (
    org_id      CHAR(8)      PRIMARY KEY,
    org_name    VARCHAR(100) NOT NULL,
    org_type    VARCHAR(20)  NOT NULL CHECK (org_type IN ('CONTRACTOR', 'SUPPLIER', 'INSPECTION')),
    address     VARCHAR(200),
    phone       VARCHAR(30),
    email       VARCHAR(100),
    status      VARCHAR(10)  NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    review_note VARCHAR(200),                                  -- the reason, written by the administrator when a company is rejected
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.5 Users of the platform. Each user belongs to one company and has one role:
--       CONTRACTOR_PM, SUPPLIER, INSPECTOR  the people who work with the deliveries (they register themselves and choose their company);
--       COMPANY                             the company account (one per company): sees and manages the users of its company;
--       ADMIN                               the website administrator: belongs to no company (org_id is NULL) and approves the companies.
--     active = 0 means that the company account (or the administrator) has switched the user off: the user cannot sign in.
--     status: a person who registers as a user is PENDING until the company account of the chosen company approves (APPROVED) or
--     rejects (REJECTED) the registration, so nobody can work for a company only by choosing it in the list. Accounts that are created
--     directly (company accounts, the administrator, the sample data) are APPROVED.
CREATE TABLE user_account (
    user_id    INT AUTO_INCREMENT PRIMARY KEY,
    org_id     CHAR(8),
    full_name  VARCHAR(100) NOT NULL,
    email      VARCHAR(100) NOT NULL UNIQUE,
    password   VARCHAR(255) NOT NULL,
    role       VARCHAR(20)  NOT NULL CHECK (role IN ('CONTRACTOR_PM', 'SUPPLIER', 'INSPECTOR', 'COMPANY', 'ADMIN')),
    active     TINYINT(1)   NOT NULL DEFAULT 1,
    status     VARCHAR(10)  NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organization (org_id),
    CHECK ((role = 'ADMIN' AND org_id IS NULL) OR (role <> 'ADMIN' AND org_id IS NOT NULL))
);

-- 1.5b Proof documents (PDF, JPG or PNG) that a company uploads when it registers. The file itself is kept in the folder website/uploads
--      under the random name stored_name; only the administrator can open it.
CREATE TABLE org_document (
    document_id INT AUTO_INCREMENT PRIMARY KEY,
    org_id      CHAR(8)      NOT NULL,
    file_name   VARCHAR(150) NOT NULL,
    stored_name VARCHAR(60)  NOT NULL UNIQUE,
    file_type   VARCHAR(10)  NOT NULL CHECK (file_type IN ('PDF', 'JPG', 'PNG')),
    file_size   INT          NOT NULL,
    uploaded_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organization (org_id)
);

-- 1.5c A contractor appoints a third-party inspection company: the inspectors of that company can then see and inspect the deliveries
--      of the projects of the contractor. (Inspectors who work for the contractor itself do not need an appointment.)
CREATE TABLE inspection_appointment (
    contractor_id CHAR(8)   NOT NULL,
    inspection_id CHAR(8)   NOT NULL,
    appointed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contractor_id, inspection_id),
    FOREIGN KEY (contractor_id) REFERENCES organization (org_id),
    FOREIGN KEY (inspection_id) REFERENCES organization (org_id)
);

-- 1.6 Projects of a contractor, with the retention rate of the contract (0.05 = 5%). The company account of the contractor manages them.
CREATE TABLE project (
    project_id     INT AUTO_INCREMENT PRIMARY KEY,
    org_id         CHAR(8)      NOT NULL,
    project_name   VARCHAR(100) NOT NULL,
    retention_rate DECIMAL(4,3) NOT NULL CHECK (retention_rate BETWEEN 0 AND 1),
    FOREIGN KEY (org_id) REFERENCES organization (org_id),
    UNIQUE (org_id, project_name)      -- two projects of the same contractor cannot have the same name
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

-- 1.9b Requests for quotation (RFQ). A contractor project manager writes an RFQ for a project: the materials and quantities (rfq_item),
--      the wanted delivery time slot and the last day for the quotations (due_date). He invites suppliers (rfq_supplier) and sends it.
--      DRAFT     the contractor can still change or delete everything;
--      SENT      the invited suppliers can send a quotation until the due date; the RFQ cannot be changed or deleted any more;
--      AWARDED   the contractor accepted one quotation: one delivery per item was created for that supplier;
--      CANCELLED the contractor stopped a sent RFQ without accepting a quotation (it stays for the history).
CREATE TABLE rfq (
    rfq_id     INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT          NOT NULL,
    created_by INT          NOT NULL,
    title      VARCHAR(100) NOT NULL,
    slot_start DATETIME     NOT NULL,
    slot_end   DATETIME     NOT NULL,
    due_date   DATE         NOT NULL,
    note       VARCHAR(500) NULL,
    status     VARCHAR(10)  NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'AWARDED', 'CANCELLED')),
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at    DATETIME     NULL,
    CHECK (slot_end > slot_start),
    FOREIGN KEY (project_id) REFERENCES project (project_id),
    FOREIGN KEY (created_by) REFERENCES user_account (user_id)
);

-- 1.9c The materials and quantities of an RFQ (each material once).
CREATE TABLE rfq_item (
    item_id     INT AUTO_INCREMENT PRIMARY KEY,
    rfq_id      INT           NOT NULL,
    material_id CHAR(8)       NOT NULL,
    quantity    DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
    UNIQUE (rfq_id, material_id),
    FOREIGN KEY (rfq_id)      REFERENCES rfq (rfq_id),
    FOREIGN KEY (material_id) REFERENCES material (material_id)
);

-- 1.9d The suppliers that are invited to an RFQ.
CREATE TABLE rfq_supplier (
    rfq_id INT     NOT NULL,
    org_id CHAR(8) NOT NULL,
    PRIMARY KEY (rfq_id, org_id),
    FOREIGN KEY (rfq_id) REFERENCES rfq (rfq_id),
    FOREIGN KEY (org_id) REFERENCES organization (org_id)
);

-- 1.9e The quotation of one invited supplier for one RFQ (at most one; the foreign key to rfq_supplier makes sure that only an
--      invited supplier can answer). SUBMITTED until the contractor decides: ACCEPTED for the chosen one, NOT_CHOSEN for the others.
CREATE TABLE quotation (
    quotation_id   INT AUTO_INCREMENT PRIMARY KEY,
    rfq_id         INT          NOT NULL,
    org_id         CHAR(8)      NOT NULL,
    submitted_by   INT          NOT NULL,
    lead_time_days INT          NULL CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 365),
    note           VARCHAR(500) NULL,
    status         VARCHAR(10)  NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'ACCEPTED', 'NOT_CHOSEN')),
    submitted_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE (rfq_id, org_id),
    FOREIGN KEY (rfq_id, org_id) REFERENCES rfq_supplier (rfq_id, org_id),
    FOREIGN KEY (submitted_by)   REFERENCES user_account (user_id)
);

-- 1.9f The unit price of each item of the RFQ in a quotation (a quotation has a price for every item).
CREATE TABLE quotation_item (
    quotation_id INT           NOT NULL,
    item_id      INT           NOT NULL,
    unit_price   DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (quotation_id, item_id),
    FOREIGN KEY (quotation_id) REFERENCES quotation (quotation_id),
    FOREIGN KEY (item_id)      REFERENCES rfq_item (item_id)
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
    quotation_id     INT           NULL,      -- the accepted quotation that created this delivery (NULL: created directly)
    FOREIGN KEY (quotation_id) REFERENCES quotation (quotation_id),
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

-- 1.13b Product catalog of the suppliers: the materials that a supplier can provide, with its price range per unit (the unit is the
--       unit of the material). The supplier manages it (website: My products); the contractors search it (website: Find products).
--       active = 0 means that the supplier has taken the product off the catalog for now (unlisted); the row stays.
--       A supplier offers each material only once. Step 4.11 fills it from the purchases of the given data.
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

-- 1.13c Notifications: a short message for one user about something that happened (a new delivery, a status change, a quotation...),
--       with the page that shows it. read_at is NULL while the user has not opened it (the bell in the menu counts them).
CREATE TABLE notification (
    notification_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT          NOT NULL,
    text            VARCHAR(255) NOT NULL,
    link            VARCHAR(100) NOT NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at         DATETIME     NULL,
    INDEX (user_id, read_at),
    FOREIGN KEY (user_id) REFERENCES user_account (user_id)
);

-- 1.13d Messages. A message belongs to one conversation:
--       - the conversation of a delivery (delivery_id): the contractor, the supplier and the inspectors of that delivery; or
--       - the private conversation of an RFQ between the contractor and ONE invited supplier (rfq_id + supplier_id); the foreign key
--         to rfq_supplier allows it only for an invited supplier, and the other suppliers never see it.
--       Exactly one of the two is filled (CHECK).
CREATE TABLE message (
    message_id  INT AUTO_INCREMENT PRIMARY KEY,
    delivery_id INT           NULL,
    rfq_id      INT           NULL,
    supplier_id CHAR(8)       NULL,
    sender_id   INT           NOT NULL,
    body        VARCHAR(1000) NOT NULL,
    created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((delivery_id IS NOT NULL AND rfq_id IS NULL AND supplier_id IS NULL)
        OR (delivery_id IS NULL AND rfq_id IS NOT NULL AND supplier_id IS NOT NULL)),
    INDEX (delivery_id, created_at),
    INDEX (rfq_id, supplier_id, created_at),
    FOREIGN KEY (delivery_id)          REFERENCES delivery (delivery_id),
    FOREIGN KEY (rfq_id, supplier_id)  REFERENCES rfq_supplier (rfq_id, org_id),
    FOREIGN KEY (sender_id)            REFERENCES user_account (user_id)
);

-- 1.14 View that calculates the total price of each purchase: quantity x unit price x (1 - discount).
CREATE VIEW purchase_total AS
SELECT purchase_id,
       ROUND(quantity * unit_price * (100 - discount_rate) / 100, 2) AS total_price
FROM purchase;

-- 1.15 Check: list the tables created.
SHOW TABLES;
