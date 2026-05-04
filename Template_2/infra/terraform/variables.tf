# Optional subscription override when Azure CLI context should not be used.
variable "subscription_id" {
  description = "Azure subscription ID (optional if az account is already set)."
  type        = string
  default     = ""
}

# Project slug used as the base for Azure resource naming.
variable "project_name" {
  description = "Short project name used in resource naming."
  type        = string
}

# Environment suffix used in names and tags (dev/test/prod).
variable "environment" {
  description = "Environment name (dev/test/prod)."
  type        = string
}

# Azure region where resources are provisioned.
variable "location" {
  description = "Azure region."
  type        = string
}

# Full image reference for the frontend/API container.
variable "app_image" {
  description = "Frontend/API container image."
  type        = string
}

# Full image reference for the n8n container.
variable "n8n_image" {
  description = "n8n container image."
  type        = string
}

# PostgreSQL compute SKU controlling database performance tier.
variable "postgres_sku" {
  description = "PostgreSQL Flexible Server SKU."
  type        = string
  default     = "B_Standard_B1ms"
}

# PostgreSQL allocated storage size in megabytes.
variable "postgres_storage_mb" {
  description = "PostgreSQL storage in MB."
  type        = number
  default     = 32768
}

# Common Azure tags applied across provisioned resources.
variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default     = {}
}

# Optional explicit Key Vault name; auto-generated when empty.
variable "key_vault_name" {
  description = "Optional explicit Key Vault name (must be globally unique, 3-24 lowercase alphanumeric)."
  type        = string
  default     = ""
}

# Retention window used for Key Vault soft-deleted secrets.
variable "key_vault_soft_delete_retention_days" {
  description = "Soft delete retention for Key Vault (7-90 days)."
  type        = number
  default     = 90
}

# Optional explicit PostgreSQL server name; auto-generated when empty.
variable "postgres_server_name" {
  description = "Optional explicit PostgreSQL server name (must be globally unique)."
  type        = string
  default     = ""
}

# Admin username created on the PostgreSQL flexible server.
variable "postgres_admin_username" {
  description = "PostgreSQL admin username."
  type        = string
  default     = "pgadmincp9"
}

# Admin password for PostgreSQL supplied securely via environment input.
variable "postgres_admin_password" {
  description = "PostgreSQL admin password (set via TF_VAR_postgres_admin_password)."
  type        = string
  sensitive   = true
}

# PostgreSQL major engine version to deploy.
variable "postgres_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "16"
}

# Automated backup retention period for PostgreSQL server.
variable "postgres_backup_retention_days" {
  description = "Backup retention in days."
  type        = number
  default     = 7
}

# Toggle public network endpoint access for PostgreSQL server.
variable "postgres_public_network_access_enabled" {
  description = "Enable public network access for CP9/CP10 testing."
  type        = bool
  default     = true
}

# Optional developer public IP for temporary DB firewall access.
variable "developer_ip" {
  description = "Optional developer public IP for temporary firewall access."
  type        = string
  default     = ""
}

# Internal container port exposed by the frontend/API app.
variable "app_target_port" {
  description = "Target port exposed by frontend-api container."
  type        = number
  default     = 8080
}

# Internal container port exposed by the n8n app.
variable "n8n_target_port" {
  description = "Target port exposed by n8n container."
  type        = number
  default     = 5678
}

# Minimum replica count for frontend/API container app.
variable "app_min_replicas" {
  description = "Minimum replicas for frontend-api container app."
  type        = number
  default     = 1
}

# Maximum replica count for frontend/API container app.
variable "app_max_replicas" {
  description = "Maximum replicas for frontend-api container app."
  type        = number
  default     = 2
}

# Minimum replica count for n8n container app.
variable "n8n_min_replicas" {
  description = "Minimum replicas for n8n container app."
  type        = number
  default     = 1
}

# Maximum replica count for n8n container app.
variable "n8n_max_replicas" {
  description = "Maximum replicas for n8n container app."
  type        = number
  default     = 1
}

# Runtime selector for model provider routing in n8n.
variable "model_provider" {
  description = "Model provider for n8n runtime."
  type        = string
  default     = "openai"
}

# Default OpenAI model identifier consumed by workflows.
variable "openai_model" {
  description = "OpenAI model name used by workflow runtime."
  type        = string
  default     = "gpt-4.1-mini"
}

# Estimated OpenAI input token price used for cost metrics.
variable "openai_input_token_price_per_million_usd" {
  description = "Estimated OpenAI input token price per million tokens in USD."
  type        = number
  default     = 0.15
}

# Estimated OpenAI output token price used for cost metrics.
variable "openai_output_token_price_per_million_usd" {
  description = "Estimated OpenAI output token price per million tokens in USD."
  type        = number
  default     = 0.60
}

# Estimated OpenAI Batch input token price used for cost metrics.
variable "openai_batch_input_token_price_per_million_usd" {
  description = "Estimated OpenAI Batch input token price per million tokens in USD."
  type        = number
  default     = 0.075
}

# Estimated OpenAI Batch output token price used for cost metrics.
variable "openai_batch_output_token_price_per_million_usd" {
  description = "Estimated OpenAI Batch output token price per million tokens in USD."
  type        = number
  default     = 0.30
}

# OpenAI API key passed to n8n when provider mode is OpenAI.
variable "openai_api_key" {
  description = "OpenAI API key (set via TF_VAR_openai_api_key)."
  type        = string
  sensitive   = true
  default     = ""
}

# Azure OpenAI endpoint URL used when provider mode is Azure.
variable "azure_openai_endpoint" {
  description = "Azure OpenAI endpoint URL."
  type        = string
  default     = ""
}

# Azure OpenAI deployment name used for completions calls.
variable "azure_openai_deployment" {
  description = "Azure OpenAI deployment name."
  type        = string
  default     = ""
}

# Azure OpenAI API version used by request clients.
variable "azure_openai_api_version" {
  description = "Azure OpenAI API version."
  type        = string
  default     = "2024-10-21"
}

# Azure OpenAI API key passed when Azure provider mode is enabled.
variable "azure_openai_api_key" {
  description = "Azure OpenAI API key (set via TF_VAR_azure_openai_api_key)."
  type        = string
  sensitive   = true
  default     = ""
}

# n8n encryption key used to protect stored credentials.
variable "n8n_encryption_key" {
  description = "N8N encryption key (set via TF_VAR_n8n_encryption_key)."
  type        = string
  sensitive   = true
}

# Optional availability zone pinning for PostgreSQL server placement.
variable "postgres_zone" {
  description = "Availability zone for PostgreSQL Flexible Server."
  type        = string
  default     = null
}

# Optional explicit storage account name; autogenerated when empty.
variable "storage_account_name" {
  description = "Optional explicit storage account name for PDF blobs."
  type        = string
  default     = ""
}

# Blob container name used for uploaded PDF documents.
variable "storage_container_name" {
  description = "Blob container name for user uploaded PDFs."
  type        = string
  default     = "template2-documents"
}

# Session cookie signing secret for app authentication state.
variable "session_secret" {
  description = "Session cookie secret (set via TF_VAR_session_secret)."
  type        = string
  sensitive   = true
}

# Internal service-to-service token used for protected ingestion endpoints.
variable "internal_api_token" {
  description = "Internal API token (set via TF_VAR_internal_api_token)."
  type        = string
  sensitive   = true
}

# Bootstrap admin email used for initial admin user seeding.
variable "admin_email" {
  description = "Bootstrap admin email."
  type        = string
  default     = "admin@template2.local"
}

# Bootstrap admin password used for initial admin user seeding.
variable "admin_password" {
  description = "Bootstrap admin password (set via TF_VAR_admin_password)."
  type        = string
  sensitive   = true
}

# Sync execution mode used by app runtime (mock, n8n, openai).
variable "sync_summary_mode" {
  description = "Sync summarization mode."
  type        = string
  default     = "n8n"
}

# Batch execution mode used by scheduler runtime (mock, n8n, openai).
variable "batch_execution_mode" {
  description = "Batch execution mode."
  type        = string
  default     = "n8n"
}

# Maximum jobs dispatched in one batch window.
variable "max_batch_size" {
  description = "Max jobs per batch window."
  type        = number
  default     = 20
}

# Maximum wait in seconds before a batch window is forced to dispatch.
variable "max_wait_seconds" {
  description = "Max wait in seconds for batch dispatch."
  type        = number
  default     = 60
}

# Scheduler tick interval in seconds.
variable "batch_scheduler_interval_sec" {
  description = "Batch scheduler tick interval seconds."
  type        = number
  default     = 10
}

# OpenAI batch poller tick interval in seconds.
variable "batch_poller_interval_sec" {
  description = "Batch poller tick interval seconds."
  type        = number
  default     = 20
}

# PDF retention period in days.
variable "pdf_retention_days" {
  description = "Retention period for uploaded PDFs."
  type        = number
  default     = 30
}

# Max upload size allowed by app in MB.
variable "max_upload_mb" {
  description = "Max PDF upload size in MB."
  type        = number
  default     = 25
}

# OpenAI Batch API completion window value.
variable "openai_batch_completion_window" {
  description = "OpenAI batch completion window."
  type        = string
  default     = "24h"
}

# Benchmark repetitions for each mode/tier scenario.
variable "benchmark_repetitions" {
  description = "Benchmark repetitions per scenario."
  type        = number
  default     = 3
}

# Benchmark jobs submitted per scenario repetition.
variable "benchmark_jobs_per_run" {
  description = "Benchmark jobs per scenario repetition."
  type        = number
  default     = 20
}

# OpenAI Batch polling interval during benchmark execution.
variable "benchmark_batch_poll_interval_sec" {
  description = "Benchmark batch poll interval seconds."
  type        = number
  default     = 20
}

# Max time to wait for one benchmark batch repetition before failure.
variable "benchmark_batch_max_wait_minutes" {
  description = "Benchmark batch max wait minutes."
  type        = number
  default     = 120
}

# Max poll loops for the n8n batch poller workflow.
variable "batch_poller_max_loops" {
  description = "Max loops for n8n batch poller before marking a batch failed."
  type        = number
  default     = 45
}

# n8n runner task timeout in seconds.
variable "n8n_runners_task_timeout" {
  description = "n8n task runner timeout in seconds."
  type        = number
  default     = 1200
}

# n8n runner memory cap in MB.
variable "n8n_runners_max_old_space_size" {
  description = "n8n task runner max old space size in MB."
  type        = number
  default     = 512
}

# Retry count for sync benchmark OpenAI requests.
variable "benchmark_sync_max_retries" {
  description = "Benchmark sync max retries."
  type        = number
  default     = 3
}

# Retry count for app-managed OpenAI file upload proxy calls.
variable "openai_file_upload_max_retries" {
  description = "Max retries for app OpenAI file upload proxy calls."
  type        = number
  default     = 3
}

# Base backoff in milliseconds for app-managed OpenAI file upload proxy calls.
variable "openai_file_upload_retry_base_ms" {
  description = "Base retry backoff in milliseconds for app OpenAI file upload proxy calls."
  type        = number
  default     = 750
}
