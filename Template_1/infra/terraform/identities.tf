# Create a shared user-assigned identity used by both container apps.
resource "azurerm_user_assigned_identity" "container_apps" {
  name                = "${local.name_prefix}-ca-uai"
  resource_group_name = azurerm_resource_group.core.name
  location            = azurerm_resource_group.core.location
  tags                = var.tags
}
