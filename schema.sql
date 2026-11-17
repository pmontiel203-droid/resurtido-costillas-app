-- Create the table used by functions/api/reports.js and migrate.js.
-- This does not delete or alter the existing daily_reports table.
CREATE TABLE IF NOT EXISTS reports (
  report_date TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_updated_at ON reports(updated_at);
