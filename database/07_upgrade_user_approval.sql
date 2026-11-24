-- =====================================================================
-- Script 7 (only for an existing database): the user approval by the company account and the unique project names.
-- A new database does NOT need it: 01_schema.sql has these changes already. Run it once on a database that was made with the
-- older 01_schema.sql, if you want to keep its data instead of running 01 to 06 again.
-- =====================================================================

USE siteproof;

-- 7.1 A new user waits (PENDING) until the company account approves or rejects the registration. The users that exist already stay APPROVED.
ALTER TABLE user_account
    ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')) AFTER active;

-- 7.2 Two projects of the same contractor cannot have the same name (this fails if your data has such projects: rename one first).
ALTER TABLE project ADD UNIQUE (org_id, project_name);
