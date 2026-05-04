# ACR pull permission for the shared Container Apps user-assigned identity
resource "azurerm_role_assignment" "container_apps_acr_pull" {
  scope                            = azurerm_container_registry.core.id
  role_definition_name             = "AcrPull"
  principal_id                     = azurerm_user_assigned_identity.container_apps.principal_id
  skip_service_principal_aad_check = true
}

# Optional but recommended for Key Vault secret references from Container Apps
resource "azurerm_role_assignment" "container_apps_kv_secrets_user" {
  scope                            = azurerm_key_vault.core.id
  role_definition_name             = "Key Vault Secrets User"
  principal_id                     = azurerm_user_assigned_identity.container_apps.principal_id
  skip_service_principal_aad_check = true
}
