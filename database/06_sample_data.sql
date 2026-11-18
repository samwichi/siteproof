-- =====================================================================
-- Script 6: SAMPLE DATA for the tables that the given files do not fill
-- (contractors, users, projects, deliveries, documents, inspections,
-- ratings). It is needed to test and demonstrate the website.
--
-- Run it after scripts 01 to 04 (the 500 suppliers and the materials
-- must already be loaded). To run everything again from zero, run
-- 01_schema.sql first: it deletes the database.
--
-- Demo password of ALL users: siteproof123 (stored as a bcrypt hash).
-- All e-mails end with @siteproof.example.com. Do not use this data in production.
-- =====================================================================

USE siteproof;

-- 6.1 Two contractors. The given file has only suppliers, so the contractors are new (ids 9000000x are not used by the file).
INSERT INTO organization (org_id, org_name, org_type, address, phone, email) VALUES
('90000001', 'Formosa Build Co., Ltd.',   'CONTRACTOR', 'No. 100, Sec. 4, Civic Blvd., Da''an Dist., Taipei City',  '+886-2-5550-0101', 'office@formosabuild.example.com'),
('90000002', 'Pacific Civil Works Ltd.',  'CONTRACTOR', 'No. 28, Zhongzheng Rd., Zhongli Dist., Taoyuan City',      '+886-3-5550-0202', 'office@pacificcivil.example.com');

-- 6.2 Users: 2 contractor project managers, 2 site inspectors (they work for a contractor) and 4 supplier users
--     (one for each of 4 suppliers of the given file). The password is the bcrypt hash of "siteproof123".
INSERT INTO user_account (org_id, full_name, email, password, role) VALUES
('90000001', 'Lin Wei-Ting',   'pm.lin@siteproof.example.com',        '$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'CONTRACTOR_PM'),
('90000002', 'Chen Yu-Hsuan',  'pm.chen@siteproof.example.com',       '$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'CONTRACTOR_PM'),
('90000001', 'Wang Chia-Hao',  'inspector.wang@siteproof.example.com','$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'INSPECTOR'),
('90000002', 'Huang Mei-Ling', 'inspector.huang@siteproof.example.com','$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'INSPECTOR'),
('03028108', 'Tsai Ming-Che',   'supplier.central@siteproof.example.com',   '$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'SUPPLIER'),
('28001683', 'Liu Shu-Fen',    'supplier.superior@siteproof.example.com',  '$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'SUPPLIER'),
('32120654', 'Yang Zhi-Wei',   'supplier.cornerstone@siteproof.example.com','$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'SUPPLIER'),
('15984815', 'Wu Ya-Ting',     'supplier.united@siteproof.example.com',    '$2b$10$ypLdRc9Bqq5e/dNQlnlgKOJM2B3riql5dGNUPq0NH52VwMlu60hTa', 'SUPPLIER');

-- 6.3 Three projects with different contract retention rates (3% to 10%).
INSERT INTO project (org_id, project_name, retention_rate) VALUES
('90000001', 'Neihu Office Tower',        0.050),
('90000001', 'Xinyi Parking Structure',   0.100),
('90000002', 'Taoyuan Logistics Center',  0.030);

-- 6.4 Eight deliveries, one for each situation of the Material Delivery Closed-Loop:
--     3 completed (full, partial and rejected), 1 inspected, 1 delivered, 1 in transit, 1 preparing, 1 scheduled.
--     The delivery value is the ordered quantity x the average price of the material in the given file.
--     After each insert, @dN keeps the new delivery_id to use it in the next tables.

-- Delivery 1 (COMPLETED, fully accepted): 80 m3 of ready-mix concrete.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Neihu Office Tower'),
        '03028108', '04265799',
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        80, 202080.00, '2026-10-05 08:00:00', '2026-10-05 10:00:00', 'COMPLETED');
SET @d1 = LAST_INSERT_ID();

-- Delivery 2 (COMPLETED, partially accepted): 12 tons of rebar SD280, 9 accepted.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Xinyi Parking Structure'),
        '28001683', '51220073',
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        12, 255000.00, '2026-10-12 09:00:00', '2026-10-12 12:00:00', 'COMPLETED');
SET @d2 = LAST_INSERT_ID();

-- Delivery 3 (COMPLETED, rejected): 200 m2 of plywood, 0 accepted (the rating is mandatory even when the delivery is rejected).
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Taoyuan Logistics Center'),
        '32120654', '29345092',
        (SELECT user_id FROM user_account WHERE email = 'pm.chen@siteproof.example.com'),
        200, 54400.00, '2026-10-19 13:00:00', '2026-10-19 15:00:00', 'COMPLETED');
SET @d3 = LAST_INSERT_ID();

-- Delivery 4 (INSPECTED, waiting for the contractor to complete and rate): 300 bags of cement, all accepted.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Neihu Office Tower'),
        '28001683', '14942603',
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        300, 49800.00, '2026-11-09 08:30:00', '2026-11-09 10:30:00', 'INSPECTED');
SET @d4 = LAST_INSERT_ID();

-- Delivery 5 (DELIVERED, in the inspection queue): 40 m3 of graded aggregates.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Xinyi Parking Structure'),
        '15984815', '79254563',
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        40, 27560.00, '2026-11-17 14:00:00', '2026-11-17 16:00:00', 'DELIVERED');
SET @d5 = LAST_INSERT_ID();

-- Delivery 6 (IN_TRANSIT): 100 helmets.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Taoyuan Logistics Center'),
        '28001683', '90825067',
        (SELECT user_id FROM user_account WHERE email = 'pm.chen@siteproof.example.com'),
        100, 19900.00, '2026-11-18 15:00:00', '2026-11-18 17:00:00', 'IN_TRANSIT');
SET @d6 = LAST_INSERT_ID();

-- Delivery 7 (PREPARING): 60 m3 of ready-mix concrete 140 kgf/cm2.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Neihu Office Tower'),
        '03028108', '80801586',
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        60, 138600.00, '2026-11-24 08:00:00', '2026-11-24 10:00:00', 'PREPARING');
SET @d7 = LAST_INSERT_ID();

-- Delivery 8 (SCHEDULED, just created by the contractor): 50 pairs of safety shoes.
INSERT INTO delivery (project_id, org_id, material_id, created_by, ordered_quantity, delivery_value, slot_start, slot_end, status)
VALUES ((SELECT project_id FROM project WHERE project_name = 'Xinyi Parking Structure'),
        '28001683', '29958838',
        (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),
        50, 30150.00, '2026-12-02 09:00:00', '2026-12-02 11:00:00', 'SCHEDULED');
SET @d8 = LAST_INSERT_ID();

-- 6.5 Quality documents uploaded by the suppliers (deliveries 1 to 5 have documents).
INSERT INTO delivery_document (delivery_id, uploaded_by, doc_type, file_name) VALUES
(@d1, (SELECT user_id FROM user_account WHERE email = 'supplier.central@siteproof.example.com'),      'Delivery Note',    'delivery_note_d1.pdf'),
(@d1, (SELECT user_id FROM user_account WHERE email = 'supplier.central@siteproof.example.com'),      'Concrete Test Report', 'concrete_test_report_d1.pdf'),
(@d2, (SELECT user_id FROM user_account WHERE email = 'supplier.superior@siteproof.example.com'),     'Mill Certificate', 'mill_certificate_d2.pdf'),
(@d2, (SELECT user_id FROM user_account WHERE email = 'supplier.superior@siteproof.example.com'),     'Tensile Test Report', 'tensile_test_report_d2.pdf'),
(@d3, (SELECT user_id FROM user_account WHERE email = 'supplier.cornerstone@siteproof.example.com'),  'Delivery Note',    'delivery_note_d3.jpg'),
(@d4, (SELECT user_id FROM user_account WHERE email = 'supplier.superior@siteproof.example.com'),     'Delivery Note',    'delivery_note_d4.pdf'),
(@d4, (SELECT user_id FROM user_account WHERE email = 'supplier.superior@siteproof.example.com'),     'Cement Test Report', 'cement_test_report_d4.pdf'),
(@d5, (SELECT user_id FROM user_account WHERE email = 'supplier.united@siteproof.example.com'),       'Delivery Note',    'delivery_note_d5.pdf');

-- 6.6 Inspections (deliveries 1 to 4). The retention rate is copied from the project when the decision is recorded.
INSERT INTO inspection (delivery_id, inspector_id, received_quantity, accepted_quantity, retention_rate) VALUES
(@d1, (SELECT user_id FROM user_account WHERE email = 'inspector.wang@siteproof.example.com'),  80,  80,  0.050),  -- full acceptance
(@d2, (SELECT user_id FROM user_account WHERE email = 'inspector.wang@siteproof.example.com'),  12,   9,  0.100),  -- partial acceptance
(@d3, (SELECT user_id FROM user_account WHERE email = 'inspector.huang@siteproof.example.com'), 200,  0,  0.030),  -- rejection
(@d4, (SELECT user_id FROM user_account WHERE email = 'inspector.wang@siteproof.example.com'),  300, 300, 0.050);  -- full acceptance, not completed yet

-- 6.7 Mandatory supplier ratings (only the completed deliveries 1 to 3).
INSERT INTO supplier_rating (delivery_id, rated_by, score) VALUES
(@d1, (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),  5),
(@d2, (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'),  3),
(@d3, (SELECT user_id FROM user_account WHERE email = 'pm.chen@siteproof.example.com'), 2);

-- 6.8 Check: rows in each table (expected: organization 502, user_account 8, project 3, delivery 8, delivery_document 8, inspection 4, supplier_rating 3).
SELECT (SELECT COUNT(*) FROM organization)      AS organizations,
       (SELECT COUNT(*) FROM user_account)      AS users,
       (SELECT COUNT(*) FROM project)           AS projects,
       (SELECT COUNT(*) FROM delivery)          AS deliveries,
       (SELECT COUNT(*) FROM delivery_document) AS documents,
       (SELECT COUNT(*) FROM inspection)        AS inspections,
       (SELECT COUNT(*) FROM supplier_rating)   AS ratings;

-- 6.9 Check: accepted value and retention, calculated (not stored) as in the business rules:
--     accepted value = delivery value x accepted quantity / ordered quantity; retention = accepted value x retention rate.
--     Expected: delivery 1 = 202,080.00 / 10,104.00; delivery 2 = 191,250.00 / 19,125.00; delivery 3 = 0 / 0; delivery 4 = 49,800.00 / 2,490.00.
SELECT d.delivery_id,
       d.status,
       ROUND(d.delivery_value * i.accepted_quantity / d.ordered_quantity, 2)                      AS accepted_value,
       ROUND(d.delivery_value * i.accepted_quantity / d.ordered_quantity * i.retention_rate, 2)   AS retention,
       r.score                                                                                    AS supplier_rating
FROM delivery d
JOIN inspection i           ON i.delivery_id = d.delivery_id
LEFT JOIN supplier_rating r ON r.delivery_id = d.delivery_id
ORDER BY d.delivery_id;

-- 6.10 Check: average rating and number of rated deliveries of each supplier (UC7).
SELECT o.org_name, COUNT(*) AS rated_deliveries, ROUND(AVG(r.score), 1) AS average_score
FROM supplier_rating r
JOIN delivery d     ON d.delivery_id = r.delivery_id
JOIN organization o ON o.org_id = d.org_id
GROUP BY o.org_id, o.org_name
ORDER BY average_score DESC;

-- 6.11 The constraints protect the data: the accepted quantity is more than the received quantity, so this insert must FAIL (expected error).
INSERT INTO inspection (delivery_id, inspector_id, received_quantity, accepted_quantity, retention_rate)
VALUES (@d5, (SELECT user_id FROM user_account WHERE email = 'inspector.wang@siteproof.example.com'), 40, 50, 0.100);

-- 6.12 A second rating for the same delivery must FAIL (expected error): there is only one rating per delivery.
INSERT INTO supplier_rating (delivery_id, rated_by, score)
VALUES (@d1, (SELECT user_id FROM user_account WHERE email = 'pm.lin@siteproof.example.com'), 4);
