-- =====================================================================
-- Script 10 (only for an existing database): the notifications (the bell in the menu).
-- A new database does NOT need it: 01_schema.sql has this table already.
-- =====================================================================

USE siteproof;

-- 10.1 Notifications: a short message for one user about something that happened (a new delivery, a status change, a quotation...),
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
