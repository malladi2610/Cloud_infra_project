# Provision Log Analytics for Container Apps diagnostics and platform logs.
resource "azurerm_log_analytics_workspace" "core" {
  name                = "${local.name_prefix}-law"
  location            = azurerm_resource_group.core.location
  resource_group_name = azurerm_resource_group.core.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}
