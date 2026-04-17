-- Add notification_preferences JSON column to users table.
-- Stores per-user toggles (emailNotifications, weeklySummary, abnormalAlerts).
-- Non-PHI: plain JSON, no encryption.

ALTER TABLE "users"
  ADD COLUMN "notification_preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
