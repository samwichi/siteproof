-- =====================================================================
-- Script 9 (only for an existing database): requests for quotation (RFQ) and quotations.
-- A new database does NOT need it: 01_schema.sql and 06_sample_data.sql have these changes already.
-- Run it once on a database that was made with the older scripts, if you want to keep its data instead of running 01 to 06 again.
-- =====================================================================

USE siteproof;

-- 9.b Requests for quotation (RFQ). A contractor project manager writes an RFQ for a project: the materials and quantities (rfq_item),
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

-- 9.c The materials and quantities of an RFQ (each material once).
CREATE TABLE rfq_item (
    item_id     INT AUTO_INCREMENT PRIMARY KEY,
    rfq_id      INT           NOT NULL,
    material_id CHAR(8)       NOT NULL,
    quantity    DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
    UNIQUE (rfq_id, material_id),
    FOREIGN KEY (rfq_id)      REFERENCES rfq (rfq_id),
    FOREIGN KEY (material_id) REFERENCES material (material_id)
);

-- 9.d The suppliers that are invited to an RFQ.
CREATE TABLE rfq_supplier (
    rfq_id INT     NOT NULL,
    org_id CHAR(8) NOT NULL,
    PRIMARY KEY (rfq_id, org_id),
    FOREIGN KEY (rfq_id) REFERENCES rfq (rfq_id),
    FOREIGN KEY (org_id) REFERENCES organization (org_id)
);

-- 9.e The quotation of one invited supplier for one RFQ (at most one; the foreign key to rfq_supplier makes sure that only an
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

-- 9.f The unit price of each item of the RFQ in a quotation (a quotation has a price for every item).
CREATE TABLE quotation_item (
    quotation_id INT           NOT NULL,
    item_id      INT           NOT NULL,
    unit_price   DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY (quotation_id, item_id),
    FOREIGN KEY (quotation_id) REFERENCES quotation (quotation_id),
    FOREIGN KEY (item_id)      REFERENCES rfq_item (item_id)
);

-- 9.g The delivery remembers the accepted quotation that created it (NULL: the delivery was created directly).
ALTER TABLE delivery ADD COLUMN quotation_id INT NULL AFTER status;
ALTER TABLE delivery ADD FOREIGN KEY (quotation_id) REFERENCES quotation (quotation_id);

-- 9.h One request for quotation of Formosa Build for the demo: 50 m3 of ready-mix concrete and 300 bags of cement for the Neihu
--      Office Tower. It is SENT to two suppliers; Central Concrete has answered already, Superior Steel not yet (sign in as
--      supplier.superior to answer, then as pm.lin to compare and accept). The dates are counted from today, so the demo always works.
INSERT INTO rfq (project_id, created_by, title, slot_start, slot_end, due_date, note, status, sent_at)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Neihu Office Tower'),
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        'Concrete and cement for floor 12',
        TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 21 DAY), '08:00:00'), TIMESTAMP(DATE_ADD(CURDATE(), INTERVAL 21 DAY), '12:00:00'),
        DATE_ADD(CURDATE(), INTERVAL 14 DAY), 'Pump truck access from Neihu Rd. Please include the delivery cost in the unit price.',
        'SENT', NOW());
SET @r1 = LAST_INSERT_ID();
INSERT INTO rfq_item (rfq_id, material_id, quantity) VALUES (@r1, '04265799', 50), (@r1, '14942603', 300);
INSERT INTO rfq_supplier (rfq_id, org_id) VALUES (@r1, '03028108'), (@r1, '28001683');
INSERT INTO quotation (rfq_id, org_id, submitted_by, lead_time_days, note)
VALUES (@r1, '03028108', (SELECT user_id FROM user_account WHERE email = 'supplier.central@siteproof.example.com'), 5, 'Price includes the pump truck.');
SET @q1 = LAST_INSERT_ID();
INSERT INTO quotation_item (quotation_id, item_id, unit_price)
SELECT @q1, item_id, IF(material_id = '04265799', 2550, 175) FROM rfq_item WHERE rfq_id = @r1;
