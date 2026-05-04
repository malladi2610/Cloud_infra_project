locals {
  n8n_app_name          = "${local.name_prefix}-n8n"
  frontend_api_app_name = "${local.name_prefix}-fa"
  n8n_public_base_url   = "https://${local.n8n_app_name}.${azurerm_container_app_environment.core.default_domain}"
  app_public_base_url   = "https://${local.frontend_api_app_name}.${azurerm_container_app_environment.core.default_domain}"
}

resource "azurerm_container_app" "n8n" {
  name                         = local.n8n_app_name
  resource_group_name          = azurerm_resource_group.core.name
  container_app_environment_id = azurerm_container_app_environment.core.id
  revision_mode                = "Single"
  tags                         = var.tags
  depends_on                   = [azurerm_role_assignment.container_apps_acr_pull]

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.container_apps.id]
  }

  registry {
    server   = azurerm_container_registry.core.login_server
    identity = azurerm_user_assigned_identity.container_apps.id
  }

  secret {
    name  = "db-password"
    value = var.postgres_admin_password
  }

  secret {
    name  = "n8n-encryption-key"
    value = var.n8n_encryption_key
  }

  secret {
    name  = "openai-api-key"
    value = trimspace(var.openai_api_key) != "" ? var.openai_api_key : "unused-openai-key"
  }

  secret {
    name  = "azure-openai-api-key"
    value = trimspace(var.azure_openai_api_key) != "" ? var.azure_openai_api_key : "unused-azure-openai-key"
  }

  secret {
    name  = "internal-api-token"
    value = var.internal_api_token
  }

  template {
    min_replicas = var.n8n_min_replicas
    max_replicas = var.n8n_max_replicas

    container {
      name   = "n8n"
      image  = var.n8n_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "DB_TYPE"
        value = "postgresdb"
      }

      env {
        name  = "DB_POSTGRESDB_HOST"
        value = azurerm_postgresql_flexible_server.core.fqdn
      }

      env {
        name  = "DB_POSTGRESDB_PORT"
        value = "5432"
      }

      env {
        name  = "DB_POSTGRESDB_SSL_ENABLED"
        value = "true"
      }

      env {
        name  = "DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED"
        value = "false"
      }

      env {
        name  = "DB_POSTGRESDB_DATABASE"
        value = "n8ndb"
      }

      env {
        name  = "DB_POSTGRESDB_USER"
        value = var.postgres_admin_username
      }

      env {
        name        = "DB_POSTGRESDB_PASSWORD"
        secret_name = "db-password"
      }

      env {
        name        = "N8N_ENCRYPTION_KEY"
        secret_name = "n8n-encryption-key"
      }

      env {
        name  = "N8N_RUNNERS_ENABLED"
        value = "true"
      }

      env {
        name  = "N8N_RUNNERS_TASK_TIMEOUT"
        value = tostring(var.n8n_runners_task_timeout)
      }

      env {
        name  = "N8N_RUNNERS_MAX_OLD_SPACE_SIZE"
        value = tostring(var.n8n_runners_max_old_space_size)
      }

      env {
        name  = "N8N_BLOCK_ENV_ACCESS_IN_NODE"
        value = "false"
      }

      env {
        name  = "APP_INTERNAL_BASE_URL"
        value = local.app_public_base_url
      }

      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }

      env {
        name  = "OPENAI_BATCH_COMPLETION_WINDOW"
        value = var.openai_batch_completion_window
      }

      env {
        name  = "OPENAI_INPUT_TOKEN_PRICE_PER_MILLION_USD"
        value = tostring(var.openai_input_token_price_per_million_usd)
      }

      env {
        name  = "OPENAI_OUTPUT_TOKEN_PRICE_PER_MILLION_USD"
        value = tostring(var.openai_output_token_price_per_million_usd)
      }

      env {
        name  = "OPENAI_BATCH_INPUT_TOKEN_PRICE_PER_MILLION_USD"
        value = tostring(var.openai_batch_input_token_price_per_million_usd)
      }

      env {
        name  = "OPENAI_BATCH_OUTPUT_TOKEN_PRICE_PER_MILLION_USD"
        value = tostring(var.openai_batch_output_token_price_per_million_usd)
      }

      env {
        name  = "MAX_BATCH_SIZE"
        value = tostring(var.max_batch_size)
      }

      env {
        name  = "MAX_WAIT_SECONDS"
        value = tostring(var.max_wait_seconds)
      }

      env {
        name  = "BENCHMARK_REPETITIONS"
        value = tostring(var.benchmark_repetitions)
      }

      env {
        name  = "BENCHMARK_JOBS_PER_RUN"
        value = tostring(var.benchmark_jobs_per_run)
      }

      env {
        name  = "BENCHMARK_BATCH_POLL_INTERVAL_MS"
        value = tostring(var.benchmark_batch_poll_interval_sec * 1000)
      }

      env {
        name  = "BENCHMARK_BATCH_MAX_WAIT_MS"
        value = tostring(var.benchmark_batch_max_wait_minutes * 60 * 1000)
      }

      env {
        name  = "BATCH_POLLER_INTERVAL_MS"
        value = tostring(var.batch_poller_interval_sec * 1000)
      }

      env {
        name  = "BATCH_POLLER_MAX_LOOPS"
        value = tostring(var.batch_poller_max_loops)
      }

      env {
        name        = "OPENAI_API_KEY"
        secret_name = "openai-api-key"
      }

      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = var.azure_openai_endpoint
      }

      env {
        name  = "AZURE_OPENAI_DEPLOYMENT"
        value = var.azure_openai_deployment
      }

      env {
        name  = "AZURE_OPENAI_API_VERSION"
        value = var.azure_openai_api_version
      }

      env {
        name        = "AZURE_OPENAI_API_KEY"
        secret_name = "azure-openai-api-key"
      }

      env {
        name        = "INTERNAL_API_TOKEN"
        secret_name = "internal-api-token"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.n8n_target_port

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

resource "azurerm_container_app" "frontend_api" {
  name                         = local.frontend_api_app_name
  resource_group_name          = azurerm_resource_group.core.name
  container_app_environment_id = azurerm_container_app_environment.core.id
  revision_mode                = "Single"
  tags                         = var.tags
  depends_on                   = [azurerm_role_assignment.container_apps_acr_pull]

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.container_apps.id]
  }

  registry {
    server   = azurerm_container_registry.core.login_server
    identity = azurerm_user_assigned_identity.container_apps.id
  }

  secret {
    name  = "db-password"
    value = var.postgres_admin_password
  }

  secret {
    name  = "session-secret"
    value = var.session_secret
  }

  secret {
    name  = "internal-api-token"
    value = var.internal_api_token
  }

  secret {
    name  = "openai-api-key"
    value = trimspace(var.openai_api_key) != "" ? var.openai_api_key : "unused-openai-key"
  }

  secret {
    name  = "admin-password"
    value = var.admin_password
  }

  secret {
    name  = "blob-connection-string"
    value = azurerm_storage_account.core.primary_connection_string
  }

  template {
    min_replicas = var.app_min_replicas
    max_replicas = var.app_max_replicas

    container {
      name   = "frontend-api"
      image  = var.app_image
      cpu    = 0.5
      memory = "1Gi"

      env {
        name  = "APP_PORT"
        value = tostring(var.app_target_port)
      }

      env {
        name  = "DB_HOST"
        value = azurerm_postgresql_flexible_server.core.fqdn
      }

      env {
        name  = "DB_PORT"
        value = "5432"
      }

      env {
        name  = "DB_SSL"
        value = "true"
      }

      env {
        name  = "DB_SSL_REJECT_UNAUTHORIZED"
        value = "false"
      }

      env {
        name  = "DB_NAME"
        value = "template2"
      }

      env {
        name  = "DB_USER"
        value = var.postgres_admin_username
      }

      env {
        name        = "DB_PASSWORD"
        secret_name = "db-password"
      }

      env {
        name        = "SESSION_SECRET"
        secret_name = "session-secret"
      }

      env {
        name        = "INTERNAL_API_TOKEN"
        secret_name = "internal-api-token"
      }

      env {
        name        = "OPENAI_API_KEY"
        secret_name = "openai-api-key"
      }

      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }

      env {
        name  = "OPENAI_FILE_UPLOAD_MAX_RETRIES"
        value = tostring(var.openai_file_upload_max_retries)
      }

      env {
        name  = "OPENAI_FILE_UPLOAD_RETRY_BASE_MS"
        value = tostring(var.openai_file_upload_retry_base_ms)
      }

      env {
        name  = "OPENAI_BATCH_INPUT_TOKEN_PRICE_PER_MILLION_USD"
        value = tostring(var.openai_batch_input_token_price_per_million_usd)
      }

      env {
        name  = "OPENAI_BATCH_OUTPUT_TOKEN_PRICE_PER_MILLION_USD"
        value = tostring(var.openai_batch_output_token_price_per_million_usd)
      }

      env {
        name  = "BENCHMARK_REPETITIONS"
        value = tostring(var.benchmark_repetitions)
      }

      env {
        name  = "BENCHMARK_JOBS_PER_RUN"
        value = tostring(var.benchmark_jobs_per_run)
      }

      env {
        name  = "MAX_BATCH_SIZE"
        value = tostring(var.max_batch_size)
      }

      env {
        name  = "MAX_WAIT_SECONDS"
        value = tostring(var.max_wait_seconds)
      }

      env {
        name  = "PDF_RETENTION_DAYS"
        value = tostring(var.pdf_retention_days)
      }

      env {
        name  = "MAX_UPLOAD_MB"
        value = tostring(var.max_upload_mb)
      }

      env {
        name  = "BLOB_PROVIDER"
        value = "azure"
      }

      env {
        name        = "AZURE_BLOB_CONNECTION_STRING"
        secret_name = "blob-connection-string"
      }

      env {
        name  = "AZURE_BLOB_CONTAINER"
        value = azurerm_storage_container.documents.name
      }

      env {
        name  = "N8N_WEBHOOK_BASE"
        value = "${local.n8n_public_base_url}/webhook"
      }

      env {
        name  = "N8N_RUN_WEBHOOK_URL"
        value = "${local.n8n_public_base_url}/webhook/summaries/run"
      }

      env {
        name  = "N8N_BENCHMARK_WEBHOOK_URL"
        value = "${local.n8n_public_base_url}/webhook/benchmarks/run"
      }

      env {
        name  = "N8N_REQUEST_TIMEOUT_MS"
        value = "10000"
      }

      env {
        name  = "DEFAULT_PROFILE_ID"
        value = "pdf_batch_summary"
      }

      env {
        name  = "ADMIN_EMAIL"
        value = var.admin_email
      }

      env {
        name        = "ADMIN_PASSWORD"
        secret_name = "admin-password"
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.app_target_port

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}
