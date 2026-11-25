-- =====================================================================
-- Script 13 (only for an existing database): a supplier can decline a SCHEDULED delivery, with a reason.
-- A new database does NOT need it: 01_schema.sql has these columns already.
-- =====================================================================

USE siteproof;

ALTER TABLE delivery
    ADD COLUMN declined_at    DATETIME     NULL AFTER quotation_id,
    ADD COLUMN decline_reason VARCHAR(200) NULL AFTER declined_at;
