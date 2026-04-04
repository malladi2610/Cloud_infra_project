# Expose deployed resource group name for operational commands.
output "resource_group_name" {
  value = azurerm_resource_group.core.name
}

# Expose Log Analytics workspace name for diagnostics lookup.
output "log_analytics_workspace_name" {
  value = azurerm_log_analytics_workspace.core.name
}

# Expose Container Apps environment name for runtime inspection.
output "container_app_environment_name" {
  value = azurerm_container_app_environment.core.name
}

# Expose ACR resource name for image management workflows.
output "acr_name" {
  value = azurerm_container_registry.core.name
}

# Expose ACR login server used by docker and container app image refs.
output "acr_login_server" {
  value = azurerm_container_registry.core.login_server
}

# Expose Key Vault name for secret operations.
output "key_vault_name" {
  value = azurerm_key_vault.core.name
}

# Expose Key Vault URI for SDK and CLI integrations.
output "key_vault_uri" {
  value = azurerm_key_vault.core.vault_uri
}

# Expose PostgreSQL server name for admin and diagnostics.
output "postgres_server_name" {
  value = azurerm_postgresql_flexible_server.core.name
}

# Expose PostgreSQL FQDN used by runtime connection strings.
output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.core.fqdn
}

# Expose frontend/API public hostname for smoke tests.
output "frontend_api_fqdn" {
  value = azurerm_container_app.frontend_api.ingress[0].fqdn
}

# Expose n8n public hostname for workflow UI and webhook calls.
output "n8n_fqdn" {
  value = azurerm_container_app.n8n.ingress[0].fqdn
}

# Expose shared managed identity principal ID used by n8n app.
output "n8n_principal_id" {
  value = azurerm_user_assigned_identity.container_apps.principal_id
}

# Expose shared managed identity principal ID used by frontend app.
output "frontend_api_principal_id" {
  value = azurerm_user_assigned_identity.container_apps.principal_id
}

# Expose resource group ARM ID for scripting and RBAC scopes.
output "resource_group_id" {
  value = azurerm_resource_group.core.id
}

# Expose Container Apps environment ARM ID for downstream references.
output "container_app_environment_id" {
  value = azurerm_container_app_environment.core.id
}

# Expose frontend container app name for CLI operations.
output "frontend_api_name" {
  value = azurerm_container_app.frontend_api.name
}

# Expose n8n container app name for CLI operations.
output "n8n_name" {
  value = azurerm_container_app.n8n.name
}

# Expose application database logical name for verification checks.
output "postgres_classifier_db_name" {
  value = azurerm_postgresql_flexible_server_database.classifier.name
}

# Expose n8n database logical name for verification checks.
output "postgres_n8ndb_name" {
  value = azurerm_postgresql_flexible_server_database.n8ndb.name
}


