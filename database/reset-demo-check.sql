-- Used by reset-demo.bat and reset-demo.sh after the reset: the number of rows of the demo, and the time slots
-- of the sample deliveries (they are counted from today, so they should be around today).
SELECT (SELECT COUNT(*) FROM organization)     AS companies,
       (SELECT COUNT(*) FROM supplier_product) AS products,
       (SELECT COUNT(*) FROM user_account)     AS users,
       (SELECT COUNT(*) FROM delivery)         AS deliveries,
       (SELECT COUNT(*) FROM rfq)              AS rfqs,
       CURDATE()                               AS today,
       (SELECT DATE(MIN(slot_start)) FROM delivery) AS first_slot,
       (SELECT DATE(MAX(slot_start)) FROM delivery) AS last_slot;
