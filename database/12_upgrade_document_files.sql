-- =====================================================================
-- Script 12 (only for an existing database): the real files of the quality documents.
-- A new database does NOT need it: 01_schema.sql has these columns already. The documents that exist stay without a file.
-- =====================================================================

USE siteproof;

ALTER TABLE delivery_document
    ADD COLUMN stored_name VARCHAR(40) NULL AFTER file_name,
    ADD COLUMN file_type   VARCHAR(10) NULL CHECK (file_type IS NULL OR file_type IN ('PDF', 'JPG', 'PNG')) AFTER stored_name,
    ADD COLUMN file_size   INT         NULL AFTER file_type;
