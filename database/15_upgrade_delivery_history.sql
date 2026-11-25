-- =====================================================================
-- Script 15 (only for an existing database): the history of the deliveries (when each step happened, and who did it).
-- A new database does NOT need it: 01_schema.sql and 06_sample_data.sql have it already.
-- The deliveries that exist get an approximate history (step 15.2), counted from their time slot, like the sample data.
-- =====================================================================

USE siteproof;

-- 15.1 History of a delivery: one row for every step and every change, with the time and the user. It shows when the delivery was
--       created, prepared, sent, delivered (on time or late), inspected and completed, and who did it, also when a step was undone.
--       The website writes it in the same transaction as the change itself (lib/events.js).
CREATE TABLE delivery_event (
    event_id    INT AUTO_INCREMENT PRIMARY KEY,
    delivery_id INT          NOT NULL,
    event       VARCHAR(20)  NOT NULL CHECK (event IN ('CREATED', 'CHANGED', 'DECLINED', 'ACCEPTED_AGAIN', 'PREPARING', 'IN_TRANSIT',
                                                       'DELIVERED', 'INSPECTED', 'INSPECTION_CHANGED', 'INSPECTION_DELETED',
                                                       'COMPLETED', 'RATING_CHANGED', 'RATING_DELETED')),
    user_id     INT          NOT NULL,
    note        VARCHAR(200) NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (delivery_id, created_at),
    FOREIGN KEY (delivery_id) REFERENCES delivery (delivery_id),
    FOREIGN KEY (user_id)     REFERENCES user_account (user_id)
);

-- 15.2 History of the sample deliveries (table delivery_event), so that the detail page shows when each step happened.
--      The times are counted from the time slot of each delivery; delivery #2 arrived 50 minutes after its slot (late).
--      The supplier steps are written by the first supplier user of the company (or by the project manager when the company has none).
INSERT INTO delivery_event (delivery_id, event, user_id, created_at)
SELECT d.delivery_id, 'CREATED', d.created_by, d.slot_start - INTERVAL 7 DAY FROM delivery d;
INSERT INTO delivery_event (delivery_id, event, user_id, created_at)
SELECT d.delivery_id, e.event,
       COALESCE((SELECT MIN(u.user_id) FROM user_account u WHERE u.org_id = d.org_id AND u.role = 'SUPPLIER'), d.created_by),
       CASE e.event WHEN 'PREPARING' THEN d.slot_start - INTERVAL 1 DAY
                    WHEN 'IN_TRANSIT' THEN d.slot_start - INTERVAL 1 HOUR
                    ELSE IF(d.delivery_id = 2, d.slot_end + INTERVAL 50 MINUTE, d.slot_start + INTERVAL 20 MINUTE) END
FROM delivery d
JOIN (SELECT 'PREPARING' AS event, 2 AS step UNION ALL SELECT 'IN_TRANSIT', 3 UNION ALL SELECT 'DELIVERED', 4) e
  ON e.step <= FIELD(d.status, 'SCHEDULED', 'PREPARING', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'COMPLETED');
INSERT INTO delivery_event (delivery_id, event, user_id, note, created_at)
SELECT i.delivery_id, 'INSPECTED', i.inspector_id, CONCAT('received ', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM i.received_quantity)), ', accepted ', TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM i.accepted_quantity))),
       IF(i.delivery_id = 2, d.slot_end + INTERVAL 2 HOUR, d.slot_start + INTERVAL 90 MINUTE)
FROM inspection i JOIN delivery d ON d.delivery_id = i.delivery_id;
INSERT INTO delivery_event (delivery_id, event, user_id, note, created_at)
SELECT r.delivery_id, 'COMPLETED', r.rated_by, CONCAT('rating ', r.score, '/5'), d.slot_end + INTERVAL 1 DAY
FROM supplier_rating r JOIN delivery d ON d.delivery_id = r.delivery_id;
