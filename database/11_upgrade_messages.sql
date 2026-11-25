-- =====================================================================
-- Script 11 (only for an existing database): the messages of the deliveries and of the requests for quotation.
-- A new database does NOT need it: 01_schema.sql has this table already.
-- =====================================================================

USE siteproof;

-- 11.1 Messages. A message belongs to one conversation:
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
