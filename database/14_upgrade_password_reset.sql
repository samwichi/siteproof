-- =====================================================================
-- Script 14 (only for an existing database): reset of a forgotten password (temporary password that must be changed).
-- A new database does NOT need it: 01_schema.sql has this column already.
-- =====================================================================

USE siteproof;

ALTER TABLE user_account ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER status;
