CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS classification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL,
  reference_url TEXT NOT NULL,
  run_mode TEXT NOT NULL,
  profile_id TEXT,
  input_payload_json JSONB,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE classification_jobs
  ADD COLUMN IF NOT EXISTS profile_id TEXT,
  ADD COLUMN IF NOT EXISTS input_payload_json JSONB;

CREATE TABLE IF NOT EXISTS classification_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES classification_jobs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  confidence NUMERIC(5,4),
  evidence TEXT,
  provider TEXT,
  model TEXT,
  raw_response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON classification_jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON classification_jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_profile_id ON classification_jobs(profile_id);
CREATE INDEX IF NOT EXISTS idx_results_job_id ON classification_results(job_id);
CREATE INDEX IF NOT EXISTS idx_results_created_at ON classification_results(created_at);
