project_name = "template2batch"
environment  = "dev"
location     = "swedencentral"

app_image = "template2batchdevacr.azurecr.io/template2-app:sessionfix"
n8n_image = "n8nio/n8n:latest"

postgres_sku        = "B_Standard_B1ms"
postgres_storage_mb = 32768

key_vault_name = "t2batchdevkv01"

storage_container_name = "template2-documents"

# n8n-only execution policy (sync/batch modes are orchestrated in workflows)
max_batch_size                            = 2
max_wait_seconds                          = 60
batch_scheduler_interval_sec              = 10
batch_poller_interval_sec                 = 20
pdf_retention_days                        = 30
max_upload_mb                             = 25
openai_batch_completion_window            = "24h"
openai_input_token_price_per_million_usd  = 0.75
openai_output_token_price_per_million_usd = 4.50
benchmark_repetitions                     = 3
benchmark_jobs_per_run                    = 20
benchmark_batch_poll_interval_sec         = 20
benchmark_batch_max_wait_minutes          = 120

openai_batch_input_token_price_per_million_usd  = 0.375
openai_batch_output_token_price_per_million_usd = 2.25
batch_poller_max_loops                          = 45
n8n_runners_task_timeout                        = 1200
n8n_runners_max_old_space_size                  = 512
openai_file_upload_max_retries                  = 3
openai_file_upload_retry_base_ms                = 750

openai_model   = "gpt-5.4-mini"
model_provider = "openai"
admin_email    = "admin@template2.local"

tags = {
  project     = "template2batch"
  environment = "dev"
  owner       = "subhash"
  managed_by  = "terraform"
  workload    = "batch-pdf-summarization"
}

postgres_server_name                   = "t2batchdevpg01"
postgres_admin_username                = "pgadmint2"
postgres_version                       = "16"
postgres_backup_retention_days         = 7
postgres_public_network_access_enabled = true
postgres_zone                          = "2"

# optional
# developer_ip = "X.X.X.X"
