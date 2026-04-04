# Deploy the n8n runtime container app and wire its runtime dependencies.
resource "azurerm_container_app" "n8n" {
  name                         = "${local.name_prefix}-n8n"
  resource_group_name          = azurerm_resource_group.core.name
  container_app_environment_id = azurerm_container_app_environment.core.id
  revision_mode                = "Single"
  tags                         = var.tags
  depends_on                   = [azurerm_role_assignment.container_apps_acr_pull]

  # Attach the shared user-assigned identity for ACR and Key Vault access.
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.container_apps.id]
  }

  # Configure private image pull from ACR using managed identity auth.
  registry {
    server   = azurerm_container_registry.core.login_server
    identity = azurerm_user_assigned_identity.container_apps.id
  }

  # Inject PostgreSQL password as an internal app secret.
  secret {
    name  = "db-password"
    value = var.postgres_admin_password
  }

  # Inject n8n encryption key used for credential encryption at rest.
  secret {
    name  = "n8n-encryption-key"
    value = var.n8n_encryption_key
  }

  # Inject OpenAI key secret with non-empty fallback to satisfy ACA validation.
  secret {
    name  = "openai-api-key"
    value = trimspace(var.openai_api_key) != "" ? var.openai_api_key : "unused-openai-key"
  }

  # Inject Azure OpenAI key secret with non-empty fallback for optional mode.
  secret {
    name  = "azure-openai-api-key"
    value = trimspace(var.azure_openai_api_key) != "" ? var.azure_openai_api_key : "unused-azure-openai-key"
  }

  # Define n8n scaling policy and container runtime settings.
  template {
    min_replicas = var.n8n_min_replicas
    max_replicas = var.n8n_max_replicas

    # Configure the n8n container image and compute allocation.
    container {
      name   = "n8n"
      image  = var.n8n_image
      cpu    = 0.5
      memory = "1Gi"

      # Force PostgreSQL driver mode for n8n persistence.
      env {
        name  = "DB_TYPE"
        value = "postgresdb"
      }

      # Point n8n to the managed PostgreSQL server endpoint.
      env {
        name  = "DB_POSTGRESDB_HOST"
        value = azurerm_postgresql_flexible_server.core.fqdn
      }

      # Set PostgreSQL TCP port used by the managed server.
      env {
        name  = "DB_POSTGRESDB_PORT"
        value = "5432"
      }

      # Enable SSL for Azure Database for PostgreSQL connections.
      env {
        name  = "DB_POSTGRESDB_SSL_ENABLED"
        value = "true"
      }

      # Relax cert verification for current Azure PostgreSQL connectivity mode.
      env {
        name  = "DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED"
        value = "false"
      }

      # Select the dedicated n8n logical database.
      env {
        name  = "DB_POSTGRESDB_DATABASE"
        value = "n8ndb"
      }

      # Set database login username for n8n DB access.
      env {
        name  = "DB_POSTGRESDB_USER"
        value = var.postgres_admin_username
      }

      # Bind database password from secret instead of plain text.
      env {
        name        = "DB_POSTGRESDB_PASSWORD"
        secret_name = "db-password"
      }

      # Bind n8n encryption key from secret storage.
      env {
        name        = "N8N_ENCRYPTION_KEY"
        secret_name = "n8n-encryption-key"
      }

      # Enable n8n runners for execution workloads.
      env {
        name  = "N8N_RUNNERS_ENABLED"
        value = "true"
      }

      # Allow env var access inside n8n Code nodes.
      env {
        name  = "N8N_BLOCK_ENV_ACCESS_IN_NODE"
        value = "false"
      }

      # Select model provider mode consumed by workflow logic.
      env {
        name  = "MODEL_PROVIDER"
        value = var.model_provider
      }

      # Provide OpenAI key to n8n workflow runtime from secret.
      env {
        name        = "OPENAI_API_KEY"
        secret_name = "openai-api-key"
      }

      # Pin default OpenAI model used by n8n nodes/workflows.
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }

      # Provide Azure OpenAI endpoint for optional provider mode.
      env {
        name  = "AZURE_OPENAI_ENDPOINT"
        value = var.azure_openai_endpoint
      }

      # Provide Azure OpenAI deployment name for optional mode.
      env {
        name  = "AZURE_OPENAI_DEPLOYMENT"
        value = var.azure_openai_deployment
      }

      # Set Azure OpenAI API version used by optional mode.
      env {
        name  = "AZURE_OPENAI_API_VERSION"
        value = var.azure_openai_api_version
      }

      # Provide Azure OpenAI key to runtime from secret.
      env {
        name        = "AZURE_OPENAI_API_KEY"
        secret_name = "azure-openai-api-key"
      }
    }
  }

  # Expose n8n publicly and route all traffic to latest revision.
  ingress {
    external_enabled = true
    target_port      = var.n8n_target_port

    # Route 100% traffic to the active revision in single mode.
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}

# Deploy the combined frontend+API container app for user-facing operations.
resource "azurerm_container_app" "frontend_api" {
  name                         = "${local.name_prefix}-fa"
  resource_group_name          = azurerm_resource_group.core.name
  container_app_environment_id = azurerm_container_app_environment.core.id
  revision_mode                = "Single"
  tags                         = var.tags
  depends_on                   = [azurerm_role_assignment.container_apps_acr_pull]

  # Attach the shared user-assigned identity for image pull permissions.
  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.container_apps.id]
  }

  # Configure frontend image pull from ACR through managed identity.
  registry {
    server   = azurerm_container_registry.core.login_server
    identity = azurerm_user_assigned_identity.container_apps.id
  }

  # Inject application DB password as a container app secret.
  secret {
    name  = "db-password"
    value = var.postgres_admin_password
  }

  # Define frontend/API scaling behavior and container runtime.
  template {
    min_replicas = var.app_min_replicas
    max_replicas = var.app_max_replicas

    # Configure frontend/API container image and compute allocation.
    container {
      name   = "frontend-api"
      image  = var.app_image
      cpu    = 0.5
      memory = "1Gi"

      # Tell the app which container port to bind internally.
      env {
        name  = "APP_PORT"
        value = tostring(var.app_target_port)
      }

      # Point the app to the managed PostgreSQL host.
      env {
        name  = "DB_HOST"
        value = azurerm_postgresql_flexible_server.core.fqdn
      }

      # Set PostgreSQL TCP port used by application DB connections.
      env {
        name  = "DB_PORT"
        value = "5432"
      }

      # Enable SSL for app connections to Azure PostgreSQL.
      env {
        name  = "DB_SSL"
        value = "true"
      }

      # Relax TLS cert verification for current DB connectivity mode.
      env {
        name  = "DB_SSL_REJECT_UNAUTHORIZED"
        value = "false"
      }

      # Select the application logical database.
      env {
        name  = "DB_NAME"
        value = "classifier"
      }

      # Set database username for application queries.
      env {
        name  = "DB_USER"
        value = var.postgres_admin_username
      }

      # Bind DB password from secret storage.
      env {
        name        = "DB_PASSWORD"
        secret_name = "db-password"
      }

      # Set the default profile loaded by the frontend runtime.
      env {
        name  = "DEFAULT_PROFILE_ID"
        value = "custom_profile_starter"
      }

      # Expose base n8n webhook URL for API orchestration calls.
      env {
        name  = "N8N_WEBHOOK_BASE"
        value = "https://${azurerm_container_app.n8n.ingress[0].fqdn}/webhook"
      }

      # Expose full default n8n webhook endpoint for classification trigger.
      env {
        name  = "N8N_WEBHOOK_URL"
        value = "https://${azurerm_container_app.n8n.ingress[0].fqdn}/webhook/classifications/run-e2e-cp5-cp6"
      }
    }
  }

  # Expose frontend/API publicly and route all traffic to latest revision.
  ingress {
    external_enabled = true
    target_port      = var.app_target_port

    # Route 100% traffic to the active revision in single mode.
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }
}
