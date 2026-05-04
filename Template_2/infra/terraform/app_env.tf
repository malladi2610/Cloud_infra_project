# Create the shared Container Apps environment backing both runtime apps.
resource "azurerm_container_app_environment" "core" {
  name                       = "${local.name_prefix}-cae"
  location                   = azurerm_resource_group.core.location
  resource_group_name        = azurerm_resource_group.core.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.core.id
  tags                       = var.tags
}
