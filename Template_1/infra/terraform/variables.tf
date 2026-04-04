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
