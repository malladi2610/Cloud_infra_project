CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  page_count INT,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_documents_id_user UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS batch_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy TEXT NOT NULL CHECK (strategy IN ('count_only')),
  max_batch_size INT NOT NULL CHECK (max_batch_size > 0),
  max_wait_seconds INT NOT NULL CHECK (max_wait_seconds > 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'submitted', 'processing', 'completed', 'failed', 'expired')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  openai_batch_id TEXT,
  input_file_id TEXT,
  output_file_id TEXT,
  error_file_id TEXT
);

CREATE TABLE IF NOT EXISTS summary_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('sync', 'batch')),
  batch_strategy TEXT NOT NULL CHECK (batch_strategy IN ('count_only')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'batched', 'processing', 'completed', 'failed', 'expired')),
  error_message TEXT,
  openai_request_id TEXT,
  openai_batch_id TEXT,
  batch_id UUID REFERENCES batch_windows(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ, 
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_summary_jobs_id_user UNIQUE (id, user_id),
  CONSTRAINT fk_summary_jobs_document_user
    FOREIGN KEY (document_id, user_id)
    REFERENCES documents (id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS summary_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  input_tokens INT,
  output_tokens INT,
  total_tokens INT,
  latency_ms INT,
  cost_est_usd NUMERIC(12,6),
  raw_response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_summary_results_job_user
    FOREIGN KEY (job_id, user_id)
    REFERENCES summary_jobs (id, user_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_items (
  batch_id UUID NOT NULL REFERENCES batch_windows(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES summary_jobs(id) ON DELETE CASCADE,
  position INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, job_id)
);

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dataset_tier TEXT NOT NULL CHECK (dataset_tier IN ('S', 'M', 'L', 'all')),
  strategy TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  report_json JSONB
);

CREATE TABLE IF NOT EXISTS benchmark_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_run_id UUID NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('sync', 'batch')),
  dataset_tier TEXT NOT NULL CHECK (dataset_tier IN ('S', 'M', 'L')),
  strategy TEXT,
  jobs_submitted INT NOT NULL CHECK (jobs_submitted >= 0),
  jobs_completed INT NOT NULL CHECK (jobs_completed >= 0),
  total_time_ms INT NOT NULL CHECK (total_time_ms >= 0),
  avg_latency_ms INT NOT NULL CHECK (avg_latency_ms >= 0),
  p95_latency_ms INT NOT NULL CHECK (p95_latency_ms >= 0),
  total_cost_est_usd NUMERIC(12,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_expires_at ON documents(expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_user_status_created ON summary_jobs(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON summary_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON summary_jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_summary_jobs_document_user ON summary_jobs(document_id, user_id);
CREATE INDEX IF NOT EXISTS idx_results_user_created ON summary_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summary_results_job_user ON summary_results(job_id, user_id);
CREATE INDEX IF NOT EXISTS idx_batch_windows_status_opened ON batch_windows(status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_items_job ON batch_items(job_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status_created ON benchmark_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_benchmark_samples_run_tier ON benchmark_samples(benchmark_run_id, dataset_tier);
